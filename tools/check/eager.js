(async () => {
  document.querySelectorAll('img[loading=lazy]').forEach(i => (i.loading = 'eager'));
  const imgs = [...document.images];
  const t0 = Date.now();
  while (imgs.some(i => !i.complete) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 150));
  await Promise.all(imgs.map(i => i.decode().catch(() => null)));
  return { total: imgs.length, notComplete: imgs.filter(i => !i.complete).length, zeroWidth: imgs.filter(i => i.complete && !i.naturalWidth).map(i => i.src.split('/').slice(-3).join('/')) };
})()
