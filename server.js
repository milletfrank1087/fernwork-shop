#!/usr/bin/env node
/** Tiny zero-dependency static file server for dist/. Usage: node server.js [port] */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function send(res, status, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    // Code revalidates every time so edits show up on reload; heavy static assets stay cached.
    'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http
  .createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }

    // resolve inside dist/ only (blocks ../ traversal)
    let file = path.normalize(path.join(DIST, pathname));
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('Forbidden'); }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      // clean URLs: /products/x -> redirect to /products/x/ so relative links resolve
      if (!pathname.endsWith('/')) { res.writeHead(301, { Location: pathname + '/' }); return res.end(); }
      file = path.join(file, 'index.html');
    }

    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, 200, file);
    const notFound = path.join(DIST, '404.html');
    return fs.existsSync(notFound) ? send(res, 404, notFound) : (res.writeHead(404), res.end('Not found'));
  });

// If the port is already taken (another dev server), try the next one instead of crashing.
let port = PORT;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < PORT + 20) {
    console.log(`Port ${port} is in use, trying ${port + 1}...`);
    server.listen(++port);
  } else {
    throw err;
  }
});
server.on('listening', () => console.log(`Fernwork running at http://localhost:${port}`));
server.listen(port);
