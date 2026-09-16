// QA-BESOUL-MEGA-V3-CONT: extrae VERBATIM de finanzas.html el guardián de meses cerrados
// (puedeEditarMes) y las mutaciones de gastos/otros-ingresos que dependen de él -- "closed months
// immutable" no tenía ningún test propio hasta ahora.
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
function extractLet(name) {
  const re = new RegExp(`let\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró let ${name}`);
  return m[0];
}

const parts = [
  extractLet('dbFinanzas'),
  extractLet('mesCerradoEditando'),
  extractLet('mesSeleccionadoFinanzas'),
  extractFunction('mesActualKey'),
  extractFunction('mesTrabajoKey'),
  extractFunction('mesEstaCerrado'),
  extractFunction('mesEnEdicion'),
  extractFunction('puedeEditarMes'),
  extractFunction('obtenerMesGastos'),
  extractFunction('obtenerMesIngresos'),
  extractFunction('asegurarGastosMes'),
  extractFunction('agregarGasto'),
  extractFunction('editarGasto'),
  extractFunction('borrarGasto'),
  extractFunction('asegurarOtrosIngresosMes'),
  extractFunction('agregarOtroIngreso'),
];
fs.writeFileSync(path.join(__dirname, 'cierre_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
