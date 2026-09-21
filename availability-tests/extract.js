// FIX-PT-AVAILABILITY-PERSISTENCE: extrae VERBATIM de agenda.html todo el flujo real de
// disponibilidad PT -- UI -> estado en memoria -> payload de guardado -> Firestore (simulado) ->
// carga posterior -> render. Mismo patrón de brace-matching que el resto de la suite.
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
  // Algunas declaraciones let comparten línea con otras ("let a = 1; let b = 2;") -- se busca
  // la MÁS CORTA coincidencia hasta el primer ';' propio de esta variable.
  const re = new RegExp(`let\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró let ${name}`);
  return m[0];
}
function extractSimpleConst(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const simple ${name}`);
  return m[0];
}

const consts = ['BS_APP_BUILD_TAG'];
const funciones = [
  'valorInvalidoParaFirestore',
  'canonicalizarValorDiagnostico', 'igualdadCanonica',
  'hashEstableDiagnostico',
  'contarElementosDiagnostico', 'diffEstructuralDiagnostico',
  'estadoLocalAgendaParaNube',
  'guardarEstadoNubeAgenda',
  'mensajeErrorGuardadoAgenda',
  'payloadParaUpdateFirestore',
  'programarGuardadoNubeAgenda',
  'aplicarEstadoNubeAgenda',
  'sincronizarPruebasCRMDentroDeAgenda',
  'normalizarCredenciales',
  'guardarCredenciales',
  'sanitizarCredenciales',
  'normalizarTrainerKey',
  'disponibilidadReservasPorDefecto',
  'disponibilidadTrainerActual',
  'leerDisponibilidadFormulario',
  'guardarDisponibilidadReservas',
  'disponibilidadListaParaEditar',
  'asegurarDisponibilidadTrainerEditable',
  'disponibilidadTrainerLectura',
  'bloquesDisponibilidadFecha',
  'normalizarBloquesDisponibilidad',
  'fusionarBloquesDisponibilidad',
  'formatoFechaLocal',
  'emailDocId',
  'trainerKeyDesdeEmail',
  'perfilFirestoreAcredencial',
];
const lets = [
  'usuarioLogeado', 'rolActivo', 'entrenadorVisto',
  'dbClientes', 'dbAgenda', 'dbPruebasCRM', 'dbDisponibilidadReservas',
  'dbNotas', 'dbHistoricoClientes', 'dbCredenciales', 'lunesActual',
];

const parts = [...consts.map(extractSimpleConst), ...lets.map(extractLet), ...funciones.map(extractFunction)];
fs.writeFileSync(path.join(__dirname, 'availability_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraidos:', parts.length);
