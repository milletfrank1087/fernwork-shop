"""Fernwork image pipeline - headless Blender (Cycles) renders of CC0 Poly Haven models.

Workflow (run from the fernwork folder; tested with Blender 5.3 + an NVIDIA GPU, CPU also works but is slow):
  1. node tools/render/fetch-assets.js        download models / HDRI / textures into tools/render/.cache (~100 MB, once)
  2. blender -b --factory-startup -P tools/render/render.py -- [--quick] [--only a,b,c] [--samples N]
       --samples N   override the final-quality sample count (default 96; use 160 for a slower, cleaner result)
       --quick   previews at HALF resolution per side (1/4 of the pixels, same sample count, no thumbnails) into tools/render/out/_quick
       --only    comma-separated shot names, e.g. --only terracotta-leaf-plant/1,site/hero-desktop
       --tm=AgX  tone mapper for the lifestyle scenes (studio shots always use Standard)
  3. powershell tools/render/sync-images.ps1  copy finished renders into src/assets/img
  4. node build.js

Shot names look like  <handle>/<n>  (n = 1..5)  or  site/<hero-desktop|hero-mobile|newsletter|about|contact>.
Blender lives at "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" unless it is on your PATH.
"""
import bpy, bmesh, math, os, sys, time
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, '.cache')   # downloaded models/, hdri/, tex/ (see fetch-assets.js)
OUT = os.path.join(HERE, 'out')    # finished renders: out/products/<handle>/<n>.webp, out/site/<name>.webp
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in args
ONLY = args[args.index('--only') + 1].split(',') if '--only' in args else None
TM = next((a.split('=', 1)[1] for a in args if a.startswith('--tm=')), 'AgX')
SAMPLES_OVERRIDE = int(args[args.index('--samples') + 1]) if '--samples' in args else None
FINAL_SAMPLES = 96   # path-tracing samples per final image; pass --samples 160 for a slightly cleaner image (measured: only ~20% slower, adaptive sampling stops early)

def log(*a):
    print('[fw]', *a, flush=True)

# --------------------------------------------------------------------------------------
# Scene helpers
# --------------------------------------------------------------------------------------
def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)

def setup_render(rx, ry, samples, transform='Standard', look='None', exposure=0.0):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type != 'CPU'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = SAMPLES_OVERRIDE or samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 4
    sc.cycles.glossy_bounces = 4
    sc.cycles.transparent_max_bounces = 12
    sc.cycles.sample_clamp_indirect = 10
    scale = 0.5 if QUICK else 1.0
    sc.render.resolution_x = int(rx * scale)
    sc.render.resolution_y = int(ry * scale)
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = transform
    sc.view_settings.look = look
    sc.view_settings.exposure = exposure
    sc.render.film_transparent = False
    ims = sc.render.image_settings
    ims.file_format = 'WEBP'
    ims.color_mode = 'RGB'
    ims.quality = 90
    return sc

def make_world(hdri, strength, rot_deg=0.0, tint=(1, 1, 1)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('FW')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(W, 'hdri', hdri + '_2k.hdr'))
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    mp.inputs['Rotation'].default_value[2] = math.radians(rot_deg)
    bg.inputs['Strength'].default_value = strength
    bg.inputs['Color'].default_value = (*tint, 1)
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bg.inputs['Strength'].default_value = strength
    # tint multiplies the environment colour
    if tint != (1, 1, 1):
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = (*tint, 1)
        nt.links.new(env.outputs['Color'], mix.inputs['A'])
        nt.links.new(mix.outputs['Result'], bg.inputs['Color'])

def world_bbox(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

def bbox_corners(mn, mx):
    return [Vector((x, y, z)) for x in (mn.x, mx.x) for y in (mn.y, mx.y) for z in (mn.z, mx.z)]

def load_model(mid, x=0.0, y=0.0, rot=0.0, scale=1.0):
    folder = os.path.join(W, 'models', mid)
    gltf = next(f for f in os.listdir(folder) if f.endswith(('.gltf', '.glb')))   # .glb: models from Blendkit / Amazon ABO etc.
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    roots = [o for o in new if o.parent is None]
    pivot = bpy.data.objects.new(mid + '_pivot', None)
    bpy.context.scene.collection.objects.link(pivot)
    rig = bpy.data.objects.new(mid + '_rig', None)
    bpy.context.scene.collection.objects.link(rig)
    rig.parent = pivot
    for r in roots:
        r.parent = rig
    bpy.context.view_layer.update()
    mn, mx = world_bbox(meshes)
    rig.location = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    pivot.location = Vector((x, y, 0))
    pivot.rotation_euler = (0, 0, math.radians(rot))
    pivot.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    return meshes

def aim(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()

def add_area(loc, target, size, power, color=(1, 1, 1), size_y=None):
    ld = bpy.data.lights.new('L', 'AREA')
    ld.energy = power
    ld.color = color
    ld.shape = 'RECTANGLE' if size_y else 'SQUARE'
    ld.size = size
    if size_y:
        ld.size_y = size_y
    o = bpy.data.objects.new('L', ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    aim(o, Vector(target))
    return o

def surface_mat(name, color, rough=0.9, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m

def tex_mat(name, prefix, tile=1.0, tint=None, tint_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    def img(key, cs):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(os.path.join(W, 'tex', f'{prefix}_{key}.jpg'))
        n.image.colorspace_settings.name = cs
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n
    d, r, nm = img('diff', 'sRGB'), img('rough', 'Non-Color'), img('nor', 'Non-Color')
    col = d.outputs['Color']
    if tint is not None:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = tint_strength
        mix.inputs['B'].default_value = (*tint, 1)
        nt.links.new(col, mix.inputs['A'])
        col = mix.outputs['Result']
    nt.links.new(col, b.inputs['Base Color'])
    nt.links.new(r.outputs['Color'], b.inputs['Roughness'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    return m

def mesh_obj(name, verts, faces, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o

def make_sweep(k, color=(1, 1, 1), emit=0.4):
    """White cyclorama: floor that curves up into a back wall. k scales the whole set."""
    R = 1.4 * k
    flat_end = 1.6 * k
    pts = [(-9 * k, 0.0), (flat_end, 0.0)]
    n = 16
    for i in range(1, n + 1):
        a = math.pi / 2 * i / n
        pts.append((flat_end + R * math.sin(a), R - R * math.cos(a)))
    pts.append((flat_end + R, 9 * k))
    hw = 9 * k
    verts, faces = [], []
    for (yy, zz) in pts:
        verts += [(-hw, yy, zz), (hw, yy, zz)]
    for i in range(len(pts) - 1):
        a = 2 * i
        faces.append((a, a + 1, a + 3, a + 2))
    return mesh_obj('sweep', verts, faces, surface_mat('sweep', color, 1.0, emit))

def make_plane(name, mat, y=0.0, vertical=False, half=14.0, height=6.0):
    if vertical:
        verts = [(-half, 0, 0), (half, 0, 0), (half, height, 0), (-half, height, 0)]
        o = mesh_obj(name, verts, [(0, 1, 2, 3)], mat, smooth=False)
        o.rotation_euler = (math.radians(90), 0, 0)
        o.location = (0, y, 0)
    else:
        verts = [(-half, -half, 0), (half, -half, 0), (half, half, 0), (-half, half, 0)]
        o = mesh_obj(name, verts, [(0, 1, 2, 3)], mat, smooth=False)
    return o

def aim_cam(cam, target):
    aim(cam, target)

def fit_camera(cam, corners, target, az, el, fill_x, fill_y):
    sc = bpy.context.scene
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    lo, hi = 0.05, 60.0
    for _ in range(48):
        mid = (lo + hi) / 2
        cam.location = target + d * mid
        aim(cam, target)
        bpy.context.view_layer.update()
        co = [world_to_camera_view(sc, cam, c) for c in corners]
        sx = max(c.x for c in co) - min(c.x for c in co)
        sy = max(c.y for c in co) - min(c.y for c in co)
        if sx > fill_x or sy > fill_y:
            lo = mid
        else:
            hi = mid
    cam.location = target + d * hi
    aim(cam, target)
    bpy.context.view_layer.update()
    return hi, d

def make_camera(lens):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.sensor_width = 36
    cd.clip_start = 0.02
    cd.clip_end = 200
    co = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(co)
    bpy.context.scene.camera = co
    return co

def set_dof(cam, target_point, fstop):
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = max(0.05, (target_point - cam.location).length)
    cam.data.dof.aperture_fstop = fstop

def set_levels(white):
    """Colour-management 'levels': any scene-linear value >= white is output as pure white."""
    vs = bpy.context.scene.view_settings
    vs.use_curve_mapping = True
    cm = vs.curve_mapping
    cm.white_level = (white, white, white)
    cm.update()

def probe(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    px = im.pixels[:]
    def at(fx, fy):
        x, y = int(fx * (w - 1)), int(fy * (h - 1))
        i = (y * w + x) * 4
        return tuple(round(v * 255) for v in px[i:i + 3])
    log('probe', os.path.basename(path), 'TL', at(.03, .97), 'T', at(.5, .95), 'floor-front', at(.5, .04),
        'floor-L', at(.1, .2), 'center', at(.5, .5))
    bpy.data.images.remove(im)

def feather_alpha(path, frac=0.07):
    """Fade the alpha channel to 0 over the outer `frac` of the width on both sides (smoothstep)."""
    import numpy as np
    im = bpy.data.images.load(path)
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    x = np.arange(w, dtype=np.float32)
    t = np.clip(np.minimum(x, w - 1 - x) / (frac * w), 0.0, 1.0)
    px[:, :, 3] *= (t * t * (3 - 2 * t))[None, :]
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path
    im.file_format = 'WEBP'
    try:
        im.save(quality=90)
    except TypeError:
        im.save()
    bpy.data.images.remove(im)

def render_to(path_noext, make_thumb=None, feather=0.0):
    sc = bpy.context.scene
    os.makedirs(os.path.dirname(path_noext), exist_ok=True)
    sc.render.filepath = path_noext
    bpy.ops.render.render(write_still=True)
    full = path_noext + '.webp'
    if feather:
        feather_alpha(full, feather)
    if '--probe' in args:
        probe(full)
    if make_thumb and not QUICK:
        im = bpy.data.images.load(full)
        im.scale(make_thumb, make_thumb)
        im.filepath_raw = path_noext + '-sm.webp'
        im.file_format = 'WEBP'
        try:
            im.save(quality=88)
        except TypeError:
            im.save()
        bpy.data.images.remove(im)
    return full

# --------------------------------------------------------------------------------------
# Shot builders
# --------------------------------------------------------------------------------------
STUDIO = dict(key=220.0, fill=70.0, back=50.0, hdri=0.45, white=0.80, bgk=0.9, expo=1.0)
for _a in args:  # quick tuning from the command line: --studio key=200,fill=60
    if _a.startswith('--studio='):
        for kv in _a.split('=', 1)[1].split(','):
            kk, vv = kv.split(':')
            STUDIO[kk] = float(vv)
def srgb_to_lin(v):
    v = v / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def studio_shot(out, model, az, el, fill=0.76, zoom=1.0, tz=0.5, rot=0.0, lens=85, fstop=10.0,
                hdri='studio_small_09', hdri_rot=0.0, res=1200, bg=None, expo=1.0):
    reset()
    setup_render(res, res, FINAL_SAMPLES, 'Standard')
    set_levels(STUDIO['white'])
    ex = STUDIO['expo'] * expo
    make_world(hdri, STUDIO['hdri'] * ex, hdri_rot)
    meshes = load_model(model, rot=rot)
    mn, mx = world_bbox(meshes)
    size = mx - mn
    k = max(1.0, max(size.x, size.y, size.z) / 0.45)
    sweep_col = (1, 1, 1) if bg is None else tuple(srgb_to_lin(v) * STUDIO['bgk'] for v in bg)
    make_sweep(k, color=sweep_col, emit=0.0)
    c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
    add_area((-2.6 * k, -2.8 * k, 3.6 * k), c, 3.0 * k, STUDIO['key'] * ex * k * k)
    add_area((3.2 * k, -2.2 * k, 1.8 * k), c, 3.5 * k, STUDIO['fill'] * ex * k * k, (0.96, 0.98, 1.0))
    add_area((0.0, 2.0 * k, 3.5 * k), c, 4.0 * k, STUDIO['back'] * ex * k * k)
    cam = make_camera(lens)
    dist, d = fit_camera(cam, bbox_corners(mn, mx), c, math.radians(az), math.radians(el), fill, fill)
    focus = c
    if zoom != 1.0:
        tgt = Vector((c.x, c.y, mn.z + size.z * tz))
        cam.location = tgt + d * dist * zoom
        aim(cam, tgt)
        focus = tgt
        fstop = min(fstop, 3.2)
    bpy.context.view_layer.update()
    set_dof(cam, focus, fstop)
    return render_to(out, make_thumb=640)

def styled_scene(items, tint_wall=None, floor_prefix='laminate_floor_02', wall_prefix='plastered_wall_02',
                 window_color=(1.0, 0.86, 0.68), window_power=900, hdri_strength=0.5,
                 res=(1200, 1200), wall_gap=0.5, floor_tile=0.9, exposure=0.0, hdri='studio_small_09', transparent=False, soft=False, window_size=(1.0, 1.3)):
    reset()
    setup_render(res[0], res[1], FINAL_SAMPLES, TM, 'None', exposure)
    make_world(hdri, hdri_strength, 160)
    allm = []
    for it in items:
        allm += load_model(it['id'], it.get('x', 0), it.get('y', 0), it.get('rot', 0), it.get('scale', 1))
    mn, mx = world_bbox(allm)
    size = mx - mn
    k = max(1.0, max(size.x, size.z) / 0.8)
    c = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
    wall_y = mx.y + max(0.35, size.z * 0.45) * wall_gap / 0.5
    floor = make_plane('floor', tex_mat('floor', floor_prefix, floor_tile), half=16)
    if transparent:
        sc = bpy.context.scene
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = 'RGBA'
        floor.is_shadow_catcher = True
    else:
        make_plane('wall', tex_mat('wall', wall_prefix, 1.4, tint=tint_wall), y=wall_y, vertical=True, half=16, height=8)
    if soft:
        add_area((0.0, -0.6 * k, 3.4 * k), c, 4.0 * k, 420 * k * k, (1, 0.98, 0.95))
        add_area((2.8 * k, -2.0 * k, 1.6 * k), c, 3.0 * k, 90 * k * k, (1, 0.97, 0.92))
    else:
        add_area((-2.8 * k, -1.6 * k, c.z + 1.4 * k), c, window_size[0] * k, window_power * k * k, window_color, window_size[1] * k)
        add_area((2.6 * k, -2.4 * k, 1.6 * k), c, 3.0 * k, 70 * k * k, (1, 0.97, 0.92))
    return allm, mn, mx, c, k

def styled_shot(out, items, az=14, el=11, fill=1.1, lens=65, fstop=4.5, focus_on=0, thumb=True, **kw):
    allm, mn, mx, c, k = styled_scene(items, **kw)
    cam = make_camera(lens)
    fit_camera(cam, bbox_corners(mn, mx), c, math.radians(az), math.radians(el), fill, fill)
    # focus on first item
    first = items[focus_on]
    fx, fy = first.get('x', 0), first.get('y', 0)
    set_dof(cam, Vector((fx, fy, c.z * 0.8)), fstop)
    return render_to(out, make_thumb=640 if thumb else None)

# --------------------------------------------------------------------------------------
# Shot list
# --------------------------------------------------------------------------------------
# handle: (model, yaw rot, detail target height fraction, detail zoom, styled props)
PRODUCTS = {
    'terracotta-leaf-plant': dict(model='potted_plant_01', rot=0, tz=0.82, zoom=0.5, scale=0.7, fill=0.88,
        props=[dict(id='wicker_basket_01', x=0.5, y=-0.15, rot=25), dict(id='jug_01', x=-0.45, y=-0.1, rot=-30)]),
    'elephant-ear-clay-pot': dict(model='potted_plant_02', rot=0, tz=0.7, zoom=0.55, scale=0.75, fill=0.8,
        props=[dict(id='wooden_bucket_01', x=-0.6, y=0.15, scale=0.7), dict(id='ceramic_vase_01', x=0.55, y=0.05, scale=0.8)]),
    'desert-aloe-chalk-planter': dict(model='potted_plant_04', rot=0, tz=0.7, zoom=0.55, scale=1.0, bg=(212, 222, 216), expo=0.6,
        props=[dict(id='wooden_bowl_02', x=0.22, y=-0.06), dict(id='brass_vase_02', x=-0.3, y=0.12, scale=0.6), dict(id='jug_01', x=0.36, y=0.14, scale=0.8, rot=-20)]),
    'hand-thrown-terracotta-pot': dict(model='planter_pot_clay', rot=0, tz=0.75, zoom=0.62, scale=1.0,
        props=[dict(id='watering_can_metal_01', x=0.34, y=0.1, rot=50), dict(id='potted_plant_04', x=-0.3, y=0.08)]),
    'cream-pitcher-vase': dict(model='ceramic_vase_04', rot=-20, tz=0.8, zoom=0.62, bg=(212, 222, 216), expo=0.6, scale=1.0,
        props=[dict(id='ceramic_vase_01', x=0.27, y=0.1, scale=0.8), dict(id='wooden_bowl_02', x=-0.2, y=-0.06, scale=1.1)]),
    'glazed-blue-globe-vase': dict(model='antique_ceramic_vase_01', rot=0, tz=0.6, zoom=0.58, scale=1.0,
        props=[dict(id='jug_01', x=0.34, y=0.05, rot=-20), dict(id='brass_vase_02', x=-0.32, y=0.1, scale=0.7)]),
    'storm-hurricane-lantern': dict(model='Lantern_01', rot=-25, tz=0.65, zoom=0.5, scale=1.0,
        props=[dict(id='wooden_bowl_02', x=0.2, y=-0.06), dict(id='ceramic_vase_01', x=-0.26, y=0.1, scale=0.9)]),
    'oak-candle-lantern': dict(model='wooden_lantern_01', rot=0, tz=0.7, zoom=0.5, scale=1.0,
        props=[dict(id='wicker_basket_01', x=0.5, y=-0.05, rot=10), dict(id='potted_plant_04', x=-0.38, y=0.0)]),
    'lidded-wicker-basket': dict(model='wicker_basket_02', rot=-15, tz=0.6, zoom=0.5, scale=1.0,
        props=[dict(id='throw_pillows_01', x=-0.15, y=0.38, rot=-15, scale=0.55), dict(id='potted_plant_02', x=0.55, y=0.1, scale=0.45)]),
    'zinc-watering-can': dict(model='watering_can_metal_01', rot=-70, tz=0.6, zoom=0.5, scale=1.0,
        props=[dict(id='potted_plant_04', x=0.36, y=-0.04, scale=1.2), dict(id='planter_pot_clay', x=-0.36, y=0.06), dict(id='wooden_bucket_01', x=0.0, y=0.45, scale=0.6)]),
}

ANGLES = {1: dict(az=0, el=8), 2: dict(az=-38, el=20), 3: dict(az=52, el=34)}

def run_product(handle, n):
    p = PRODUCTS[handle]
    out = os.path.join(OUT, '_quick', f'{handle}_{n}') if QUICK else os.path.join(OUT, 'products', handle, str(n))
    opt = dict(fill=p.get('fill', 0.76), bg=p.get('bg'), rot=p['rot'], expo=p.get('expo', 1.0))
    if n in ANGLES:
        a = ANGLES[n]
        return studio_shot(out, p['model'], a['az'], a['el'], **opt)
    if n == 4:
        opt.pop('fill')
        return studio_shot(out, p['model'], -20, 14, zoom=p['zoom'], tz=p['tz'], **opt)
    if n == 5:
        items = [dict(id=p['model'], x=0, y=0, rot=p['rot'], scale=p.get('scale', 1.0))] + p['props']
        return styled_shot(out, items)
    raise ValueError(n)

SITE_SHOTS = {}

# --------------------------------------------------------------------------------------
# Site-level images (hero, newsletter, about, contact)
# --------------------------------------------------------------------------------------
SAGE_WALL = (0.40, 0.60, 0.55)

def site_shot(name, items, res, az=0, el=5, lens=50, fstop=5.6, fill_x=0.6, fill_y=0.9, shift=(0, 0),
              tint=None, transparent=False, wall_gap=1.0, focus=None, hdri_strength=0.5, window_power=900, soft=False, exposure=0.0):
    def go(quick):
        out = os.path.join(OUT, '_quick', 'site_' + name) if quick else os.path.join(OUT, 'site', name)
        allm, mn, mx, c, k = styled_scene(items, tint_wall=tint, res=res, wall_gap=wall_gap, transparent=transparent,
                                          hdri_strength=hdri_strength, window_power=window_power, soft=soft, exposure=exposure)
        cam = make_camera(lens)
        fit_camera(cam, bbox_corners(mn, mx), c, math.radians(az), math.radians(el), fill_x, fill_y)
        cam.data.shift_x, cam.data.shift_y = shift
        fp = Vector(focus) if focus else c
        set_dof(cam, fp, fstop)
        return render_to(out, feather=0.07 if transparent else 0.0)
    SITE_SHOTS['site/' + name] = go

HERO_ITEMS = [
    dict(id='ceramic_vase_04', x=-0.15, y=0.05, rot=-20, scale=1.5),
    dict(id='potted_plant_02', x=0.4, y=0.0, scale=1.1),
    dict(id='potted_plant_01', x=1.1, y=0.25, scale=0.8),
    dict(id='wooden_lantern_01', x=1.6, y=-0.05, rot=15),
    dict(id='watering_can_metal_01', x=0.05, y=-0.5, rot=-60, scale=1.3),
    dict(id='potted_plant_04', x=0.85, y=-0.45, scale=1.7),
    dict(id='wicker_basket_02', x=1.45, y=-0.5, rot=-15, scale=1.2),
]
site_shot('hero-desktop', HERO_ITEMS, (1938, 812), el=5, lens=50, fstop=5.6, fill_x=0.5, fill_y=0.78, shift=(-0.17, 0.03),
          tint=SAGE_WALL, focus=(0.9, 0.0, 0.4), window_power=1500, hdri_strength=0.3, exposure=-0.3)
MOB_ITEMS = [
    dict(id='ceramic_vase_04', x=-0.5, y=0.0, rot=-20, scale=1.5),
    dict(id='potted_plant_02', x=0.0, y=0.0, scale=1.15),
    dict(id='potted_plant_01', x=0.72, y=0.2, scale=0.82),
    dict(id='potted_plant_04', x=0.32, y=-0.45, scale=1.7),
]
site_shot('hero-mobile', MOB_ITEMS, (941, 1672), el=5, lens=50, fstop=5.6, fill_x=0.9, fill_y=0.4, shift=(0.0, 0.2),
          tint=SAGE_WALL, focus=(0.3, 0.0, 0.4), window_power=1500, hdri_strength=0.3, exposure=-0.3)
NEWS_ITEMS = [
    dict(id='potted_plant_04', x=0.0, y=0.0, scale=1.9),
    dict(id='ceramic_vase_04', x=0.6, y=0.0, rot=-20, scale=1.8),
    dict(id='potted_plant_01', x=1.25, y=0.1, scale=0.88),
    dict(id='wooden_lantern_01', x=1.85, y=0.0, rot=15, scale=1.05),
    dict(id='wicker_basket_02', x=2.4, y=0.0, rot=-15, scale=1.5),
    dict(id='potted_plant_02', x=3.05, y=0.05, scale=0.95),
]
site_shot('newsletter', NEWS_ITEMS, (1600, 638), el=6, lens=60, fstop=9, fill_x=0.84, fill_y=0.95, transparent=True, soft=True, hdri_strength=0.9)
ABOUT_ITEMS = [
    dict(id='potted_plant_01', x=0.0, y=0.1, scale=0.8),
    dict(id='antique_ceramic_vase_01', x=0.55, y=-0.1, scale=1.15),
    dict(id='wicker_basket_01', x=-0.5, y=-0.15, rot=20),
    dict(id='wooden_bowl_02', x=0.2, y=-0.4, scale=1.6),
]
site_shot('about', ABOUT_ITEMS, (1254, 1254), az=10, el=9, lens=60, fstop=4.5, fill_x=1.0, fill_y=1.0, tint=SAGE_WALL, focus=(0, 0, 0.4), window_power=1500, hdri_strength=0.3, exposure=-0.3)
CONTACT_ITEMS = [
    dict(id='potted_plant_02', x=0.0, y=0.1, scale=0.8),
    dict(id='Lantern_01', x=0.55, y=-0.2, rot=-25, scale=1.5),
    dict(id='jug_01', x=-0.5, y=-0.1, rot=25, scale=1.2),
    dict(id='throw_pillows_01', x=0.15, y=0.55, rot=-10, scale=0.6),
]
site_shot('contact', CONTACT_ITEMS, (1278, 1230), az=-8, el=9, lens=60, fstop=4.5, fill_x=1.0, fill_y=1.0, tint=SAGE_WALL, focus=(0, 0, 0.4), window_power=1500, hdri_strength=0.3, exposure=-0.3)
def all_shot_names():
    names = [f'{h}/{n}' for h in PRODUCTS for n in range(1, 6)]
    return names + list(SITE_SHOTS)

def main():
    names = ONLY or all_shot_names()
    if '--list' in args:
        print('\n'.join(all_shot_names()))
        return
    t0 = time.time()
    for nm in names:
        t = time.time()
        if nm in SITE_SHOTS:
            SITE_SHOTS[nm](QUICK)
        else:
            h, n = nm.rsplit('/', 1)
            run_product(h, int(n))
        log(f'done {nm} in {time.time() - t:.1f}s')
    log(f'ALL DONE {len(names)} shots in {time.time() - t0:.0f}s')

main()










