# Copies finished renders from tools/render/out into src/assets/img.
# Usage (from the fernwork folder):  powershell tools/render/sync-images.ps1
# Falls back to a --quick preview for a site image if its final render does not exist yet.
$out  = Join-Path $PSScriptRoot 'out'
$dest = Join-Path $PSScriptRoot '..\..\src\assets\img'

New-Item -ItemType Directory -Force "$dest\products" | Out-Null
if (Test-Path "$out\products") { Copy-Item "$out\products\*" "$dest\products" -Recurse -Force }
foreach ($n in 'hero-desktop', 'hero-mobile', 'newsletter', 'about', 'contact') {
  if (Test-Path "$out\site\$n.webp") { Copy-Item "$out\site\$n.webp" "$dest\$n.webp" -Force; "final   $n" }
  elseif (Test-Path "$out\_quick\site_$n.webp") { Copy-Item "$out\_quick\site_$n.webp" "$dest\$n.webp" -Force; "PREVIEW $n" }
}
