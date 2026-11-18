(async () => {
  document.querySelectorAll('img[loading=lazy]').forEach(i => (i.loading = 'eager'));
  const imgs = [...document.images];
  const t0 = Date.now();
  while (imgs.some(i => !i.complete) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 150));
  await Promise.all(imgs.map(i => i.decode().catch(() => null)));
  window.scrollTo(0, document.body.scrollHeight);
  return imgs.length;
})()
