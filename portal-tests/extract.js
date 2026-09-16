// PORTAL-RESERVATIONS-INTEGRATION: extrae VERBATIM de portal-cliente.html el motor de reservas
// que ya vive dentro del Portal (portado de reservas.html en una fase anterior, PORTAL-03..09) --
// mismo patrón de brace-matching que el resto de la suite, nunca una reimplementación paralela.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'portal-cliente.html'), 'utf8');

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

const funciones = [
  'dateISO', 'timeToMin', 'minToTime', 'dayIndexMonSun', 'normalizarDiaTexto',
  'parseBloqueosCliente', 'bloqueadoPorCliente', 'normalizarBloques', 'fusionarBloques',
  'bloquesDisponibilidadFechaCliente', 'slotBloqueadoPorPT', 'slotOcupado', 'bloqueLibre',
  'intervalosOcupadosDentroBloque', 'huecosLibresFecha', 'iniciosEficientesHueco',
  'generarSlotsReserva', 'gruposAbiertosDisponiblesReserva', 'escapeHTML', 'labelFecha',
  'enviarSolicitudReserva'
];
const lets = ['clientData', 'scheduleData', 'selectedReserva'];

const parts = [...lets.map(extractLet), ...funciones.map(extractFunction)];
fs.writeFileSync(path.join(__dirname, 'portal_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
