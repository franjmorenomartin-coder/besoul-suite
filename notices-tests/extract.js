// PORTAL-NOTICES-FIX: extrae VERBATIM de agenda.html el flujo de avisos internos PT -> cliente --
// mismo patrón de brace-matching que el resto de la suite.
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
function extractLet(name) {
  const re = new RegExp(`let\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró let ${name}`);
  return m[0];
}

const funciones = [
  'valorInvalidoParaFirestore',
  'estadoLocalAgendaParaNube',
  'guardarEstadoNubeAgenda',
  'payloadParaUpdateFirestore',
  'programarGuardadoNubeAgenda',
  'aplicarEstadoNubeAgenda',
  'sincronizarPruebasCRMDentroDeAgenda',
  'normalizarCredenciales',
  'guardarCredenciales',
  'sanitizarCredenciales',
  'buscarClientePorIdTrainer',
  'nombreEntrenador',
  'publicarAvisoPortalCliente',
];
const lets = [
  'usuarioLogeado', 'rolActivo', 'entrenadorVisto',
  'dbClientes', 'dbAgenda', 'dbPruebasCRM', 'dbDisponibilidadReservas',
  'dbNotas', 'dbHistoricoClientes', 'dbCredenciales',
  'avisoMultipleEstados', 'avisoCanalWhatsAppActivo',
];

const parts = [...lets.map(extractLet), ...funciones.map(extractFunction)];
fs.writeFileSync(path.join(__dirname, 'notices_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
