// QA-BESOUL-MEGA-V3-CONT: extrae VERBATIM de finanzas.html el reparto porcentual de actividades
// especiales (Pilates Máquina/Ciclo Indoor) -- el ejemplo "Verónica / Alfa Prime / Pilates
// Máquina, 8 sesiones, 95€ -> 47,50 PT / 33,25 centro / 14,25 BESOUL, sin restar dos veces el
// centro" que se pidió mantener coherente no tenía NINGÚN test propio hasta ahora.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'finanzas.html'), 'utf8');

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
function extractConstBraces(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const ${name}`);
  const end = extractBalanced(m.index, '{', '}');
  return html.slice(m.index, end) + ';';
}

const parts = [
  extractConstBraces('DEFAULT_CATALOGO_ACTIVIDADES'),
  extractFunction('catalogoActividadesVivo'),
  extractFunction('catalogoActividadVivo'),
  extractFunction('entradaEfectivaTemporal'),
  extractFunction('actividadEfectivaParaMes'),
  extractFunction('repartoLiveActividad'),
  extractFunction('repartoEfectivoActividad'),
  extractFunction('distribuirReparto'),
  extractFunction('validarSumaReparto'),
  extractFunction('calcularFacturacionActividadFicha'),
];
fs.writeFileSync(path.join(__dirname, 'reparto_actividad_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
