// HARDENING-PRE-BASELINE-v3.2.1: extrae verbatim el saneado de caché sensible al cerrar sesión.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');

function extractBalanced(startIndex, openChar, closeChar) {
  let i = html.indexOf(openChar, startIndex);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === openChar) depth++;
    else if (html[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  return i;
}
function extractFunction(name) {
  const re = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  const end = extractBalanced(m.index, '{', '}');
  return html.slice(m.index, end);
}
function extractConstArray(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[[^\\]]*\\];`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const array ${name}`);
  return m[0];
}

const parts = [
  extractConstArray('BS_CLAVES_SENSIBLES_EXACTAS'),
  extractConstArray('BS_PREFIJOS_SENSIBLES'),
  extractFunction('limpiarCacheSensibleBesoul'),
];
fs.writeFileSync(path.join(__dirname, 'logout_cache_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
