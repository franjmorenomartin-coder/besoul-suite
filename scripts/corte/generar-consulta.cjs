// ARQ-V1-MIGRACION-IMPL — genera la carpeta "consulta/" (app NUEVA en MODO CONSULTA, solo lectura)
// dentro de la rama de contingencia, para que durante una contingencia se pueda consultar TODO el
// histórico (sesiones, fichas, histórico mensual, finanzas) desde la estructura nueva, que conserva
// los datos intactos. La app anterior (raíz) opera; /consulta/ solo lee.
//   node scripts/corte/generar-consulta.cjs <carpeta_rama_contingencia>
// Copia los archivos de ESTA rama (la versión nueva publicada) e inyecta BS_MODO_CONSULTA.
'use strict';
const fs = require('fs');
const path = require('path');
const origen = path.join(__dirname, '..', '..');
const destinoRaiz = process.argv[2];
if (!destinoRaiz || !fs.existsSync(destinoRaiz)) { console.error('Uso: node scripts/corte/generar-consulta.cjs <carpeta_rama_contingencia>'); process.exit(2); }
const destino = path.join(destinoRaiz, 'consulta');
fs.mkdirSync(destino, { recursive: true });
const PAGINAS = ['agenda.html', 'dashboard.html', 'finanzas.html'];
const RECURSOS = ['besoul-datos.js', 'besoul-identidad.js', 'besoul-entorno-local.js', 'manifest.json', 'besoul-icon-192.png', 'besoul-icon-512.png'];
const MARCA = `<script>window.BS_MODO_CONSULTA = true;</script>
<div id="bs-franja-consulta" style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#7c2d12;color:#fff;font:700 12px system-ui,sans-serif;text-align:center;padding:4px 8px">MODO CONSULTA (solo lectura): histórico completo. La operativa diaria está en la Agenda principal.</div>`;
PAGINAS.forEach(p => {
  let html = fs.readFileSync(path.join(origen, p), 'utf8');
  if (!/<head[^>]*>/i.test(html)) throw new Error(`${p}: sin <head>`);
  html = html.replace(/<head([^>]*)>/i, m => `${m}\n${MARCA.split('\n')[0]}`);
  html = html.replace(/<body([^>]*)>/i, m => `${m}\n${MARCA.split('\n')[1]}`);
  // Los enlaces entre módulos se quedan dentro de /consulta/ (páginas relativas); el CRM no se incluye.
  html = html.replace(/href="(\.\/)?crm\.html"/g, 'href="../crm.html"');
  // Sin service worker propio en /consulta/ (se evita cachear la copia de consulta).
  html = html.replace(/navigator\.serviceWorker\.register\([^)]*\)/g, 'Promise.resolve()');
  fs.writeFileSync(path.join(destino, p), html);
});
RECURSOS.forEach(r => { if (fs.existsSync(path.join(origen, r))) fs.copyFileSync(path.join(origen, r), path.join(destino, r)); });
console.log(`consulta/ generada en ${destino} (${PAGINAS.length} páginas en modo solo lectura)`);
