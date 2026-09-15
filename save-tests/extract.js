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
function extractConstBraces(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const ${name}`);
  const end = extractBalanced(m.index, '{', '}');
  return html.slice(m.index, end) + ';';
}

const names = [
  'buscarFichaPorId', 'tarifaBaseFicha', 'multiplicadorFacturacionFicha',
  'normalizarPorcentajeDescuento', 'formatoPorcentajeDescuento', 'obtenerDescuentoFicha',
  'aplicarDescuentoImporte', 'fechaHoyISO', 'normalizarEstadoCliente', 'estadoClienteFicha',
  'esGrupoAbierto', 'esFichaMiembroGrupo', 'importeEfectivoCliente', 'fichasMiembrosGrupo',
  'calcularFacturacionGrupoTotal', 'calcularFacturacionEstadisticaMiembro', 'contratoVacio',
  'normalizarReservasBloqueadasTexto', 'sincronizarIntegrantesGrupo', 'generarTokenReservaCliente',
  'catalogoActividadesVivo', 'guardarCliente', 'valorInvalidoParaFirestore'
];

const derivBono8 = [...html.matchAll(/TARIFAS_2026\["[^"]+"\]\s*=\s*\{[^}]*\};/g)].map(x => x[0]).join('\n');

const parts = [
  extractConstBraces('TARIFAS_2026') + '\n' + derivBono8,
  extractConstBraces('DEFAULT_CATALOGO_ACTIVIDADES'),
  ...names.map(extractFunction)
];
fs.writeFileSync(path.join(__dirname, 'guardar_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
