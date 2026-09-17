// HARDENING-PRE-BASELINE-v3.2.1: extrae verbatim la cadena real de guardado de Agenda
// (valorInvalidoParaFirestore -> estadoLocalAgendaParaNube -> payloadParaUpdateFirestore ->
// guardarEstadoNubeAgenda, con su detección de conflicto de concurrencia same-trainerKey vía
// transacción real) desde agenda.html. Mismo patrón de brace-matching que el resto de la suite.
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
function extractSimpleConst(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const simple ${name}`);
  return m[0];
}

const names = [
  'valorInvalidoParaFirestore', 'estadoLocalAgendaParaNube', 'payloadParaUpdateFirestore',
  'guardarEstadoNubeAgenda',
  'canonicalizarValorDiagnostico', 'hashEstableDiagnostico', 'contarElementosDiagnostico',
];
const parts = [extractSimpleConst('BS_APP_BUILD_TAG'), ...names.map(extractFunction)];
fs.writeFileSync(path.join(__dirname, 'concurrency_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
