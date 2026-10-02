// HOTFIX-CRM-DUPLICADOS-FECHA-ALTA -- servidor estático SOLO para la revisión local.
// Escucha únicamente en 127.0.0.1 (no accesible desde la red) y sirve los ficheros de este
// repositorio tal cual. "/" redirige al CRM en modo emulador.
//
//   node review-local/serve.cjs [puerto=5560]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PUERTO = Number(process.argv[2] || 5560);
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`);
  if (url.pathname === '/') { res.writeHead(302, { Location: '/crm.html?emulador=1' }); res.end(); return; }
  const ruta = path.normalize(path.join(RAIZ, decodeURIComponent(url.pathname)));
  if (!ruta.startsWith(RAIZ) || ruta.includes(`${path.sep}.git`) || ruta.includes('node_modules')) { res.writeHead(403); res.end(); return; }
  fs.readFile(ruta, (err, datos) => {
    if (err) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(datos);
  });
}).listen(PUERTO, '127.0.0.1', () => console.log(`Revisión local: http://127.0.0.1:${PUERTO}/crm.html?emulador=1`));
