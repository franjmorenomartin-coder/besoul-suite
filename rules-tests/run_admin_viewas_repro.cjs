// P0 REGRESSION REPORTADA EN QA (2026-09-17): ADMIN -> "ver como PT B" -> editar cliente -> guardar
// -> "No se ha podido guardar la ficha en el servidor". Reproduce la cadena COMPLETA y real:
// guardarEstadoNubeAgenda() (transacción + detección de conflicto) SEGUIDO de publicarReservasPublicas()
// REAL (no stubeado) -- que escribe besoulPublicSchedule/besoulPublicClients para TODOS los
// trainerKeys con datos, no solo el editado -- contra el Firebase Emulator Suite REAL con las
// Rules REALES desplegadas. Ambas cadenas extraídas VERBATIM de agenda.html (la segunda,
// reutilizando la extracción ya existente y mantenida de portal-slots-p0-tests/).

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
const AGENDA_HTML_PATH = path.join(__dirname, '..', 'agenda.html');
const PORTAL_SLOTS_EXTRACT_PATH = path.join(__dirname, '..', 'portal-slots-p0-tests', 'agenda_slots_extract.js');

function extractBalanced(html, startIndex, openChar, closeChar) {
  let i = html.indexOf(openChar, startIndex);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === openChar) depth++;
    else if (html[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  return i;
}
function extractFunction(html, name) {
  const re = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  const finParametros = extractBalanced(html, m.index + m[0].length - 1, '(', ')');
  const end = extractBalanced(html, finParametros, '{', '}');
  return html.slice(m.index, end);
}
function extractSimpleConst(html, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const simple ${name}`);
  return m[0];
}

const agendaHtml = fs.readFileSync(AGENDA_HTML_PATH, 'utf8');
const escrituraExtract = [
  extractSimpleConst(agendaHtml, 'BS_APP_BUILD_TAG'),
  ...[
    'valorInvalidoParaFirestore', 'canonicalizarValorDiagnostico', 'hashEstableDiagnostico',
    'contarElementosDiagnostico', 'diffEstructuralDiagnostico', 'estadoLocalAgendaParaNube', 'payloadParaUpdateFirestore',
    'guardarEstadoNubeAgenda', 'aplicarEstadoNubeAgenda',
  ].map(n => extractFunction(agendaHtml, n)),
].join('\n\n');
// publicarReservasPublicas() y TODA su cadena de dependencias reales -- reutiliza la extracción ya
// mantenida por portal-slots-p0-tests/extract.js (debe estar regenerada y actualizada; si esta
// prueba falla por una función ausente, ejecutar `node extract.js` ahí primero).
const publicacionExtract = fs.readFileSync(PORTAL_SLOTS_EXTRACT_PATH, 'utf8');

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8085 },
  });

  // Escenario realista: 3 trainers con datos (no solo el que el admin está editando), y
  // deliberadamente un cliente de OTRO trainer (pta) SIN besoulPublicClients todavía (primera
  // publicación pendiente) -- exactamente la condición bajo la que besoulPublicClients.create
  // exige request.resource.data.trainerKey == myTrainerKey(), sin bypass para isAdmin().
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('admin@x.com').set({ nombre: 'Admin', rol: 'admin', trainerKey: 'admin', activo: true, email: 'admin@x.com' });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ nombre: 'PT B', rol: 'pt', trainerKey: 'ptb', activo: true, email: 'ptb@x.com' });
    await db.collection('besoulSuite').doc('agenda').set({
      clientes: {
        pta: [{ id: 'ca1', nombre: 'Cliente de A, SIN publicar todavia', tipo: 'individual', email: 'a@x.com', telefono: '600000001', reservasOnlineActivas: true }],
        ptb: [{ id: 'cb1', nombre: 'Cliente de B', tipo: 'individual', email: 'b@x.com', telefono: '600000002', reservasOnlineActivas: true }],
      },
      agenda: { pta: {}, ptb: {} }, pruebasCRM: { pta: {}, ptb: {} },
      disponibilidadReservas: { pta: {}, ptb: {} }, historicoClientes: { pta: {}, ptb: {} },
      notas: {},
    });
  });

  const adminCtx = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' });
  const firestoreAdmin = adminCtx.firestore();

  let dbClientes = {
    pta: [{ id: 'ca1', nombre: 'Cliente de A, SIN publicar todavia', tipo: 'individual', email: 'a@x.com', telefono: '600000001', reservasOnlineActivas: true }],
    ptb: [{ id: 'cb1', nombre: 'Cliente de B EDITADO por admin', tipo: 'individual', email: 'b@x.com', telefono: '600000002', reservasOnlineActivas: true }],
  };
  let dbAgenda = { pta: {}, ptb: {} };
  let dbPruebasCRM = { pta: {}, ptb: {} };
  let dbDisponibilidadReservas = { pta: {}, ptb: {} };
  let dbHistoricoClientes = { pta: {}, ptb: {} };
  let dbNotas = {};
  let dbSolicitudesReservas = {};
  let dbCredenciales = { admin: { nombre: 'Admin', centroId: '', centroNombre: '' }, pta: { nombre: 'PT A', centroId: '', centroNombre: '' }, ptb: { nombre: 'PT B', centroId: '', centroNombre: '' } };

  const docRef = firestoreAdmin.collection('besoulSuite').doc('agenda');
  const window_ = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: undefined, firebase: null };

  const firebaseCompat = require('firebase/compat/app');
  require('firebase/compat/firestore');
  const firebase_ = {
    apps: [{}],
    firestore: Object.assign(() => firestoreAdmin, {
      FieldPath: firebaseCompat.firestore.FieldPath,
      FieldValue: firebaseCompat.firestore.FieldValue,
    }),
  };
  window_.firebase = firebase_;

  const sandbox = new Function(
    'window', 'firebase', 'dbClientes', 'dbAgenda', 'dbPruebasCRM', 'dbDisponibilidadReservas',
    'dbHistoricoClientes', 'dbNotas', 'dbSolicitudesReservas', 'dbCredenciales', 'usuarioFirebaseActual', 'console',
    escrituraExtract + '\n\n' + publicacionExtract + `
    const localStorage = { setItem(){}, getItem(){return null;} };
    const document = { getElementById(){return null;} };
    function recalcularKPIs(){} function renderClientes(){} function renderAgenda(){} function actualizarLabelsKPIMes(){}
    function configurarSelectorAdmin(){} function sincronizarPruebasCRMDentroDeAgenda(){}
    function sanitizarCredenciales(c){ return c || {}; }
    function normalizarCredenciales(){}
    let _tokenSeq = 0;
    function generarTokenReservaCliente(){ return 'res_test_repro_' + (++_tokenSeq) + '_' + Math.random().toString(36).slice(2); }
    let dbCatalogoActividades = {}, dbTrainerActividades = {}, dbTarifasActividadVersiones = {}, dbRepartoActividadVersiones = {};
    let rolActivo = 'admin';
    let entrenadorVisto = 'ptb';
    return { guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda, publicarReservasPublicas };
  `);

  const M = sandbox(window_, firebase_, dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes, dbNotas, dbSolicitudesReservas, dbCredenciales, { uid: 'uid_admin' }, console);

  const snapInicial = await docRef.get();
  M.aplicarEstadoNubeAgenda(snapInicial.data());

  console.log('\n=== REPRO COMPLETA: ADMIN, ver-como PT B, edita cliente de B, guarda (guardarEstadoNubeAgenda + publicarReservasPublicas REAL, sin stub) ===');
  const resultado = await M.guardarEstadoNubeAgenda('ptb');

  console.log('resultado de guardarEstadoNubeAgenda():', JSON.stringify(resultado));
  if (resultado && resultado.ok === true) {
    console.log('CONCLUSION: guardarEstadoNubeAgenda() devuelve ok:true incluso con publicarReservasPublicas() real (no stubeado) y un cliente de OTRO trainer sin publicar -- confirma que publicarReservasPublicas() NO propaga sus fallos internos al resultado que ve guardarCliente().');
  } else {
    console.log('CONCLUSION: guardarEstadoNubeAgenda() SÍ devuelve ok:false -- esto refutaría la hipótesis de que publicarReservasPublicas() siempre traga sus errores. Revisar resultado.err arriba.');
  }

  // Verifica el estado real de besoulPublicSchedule/besoulPublicClients tras el intento, saltando
  // Rules (verificación, no prueba de comportamiento de la app).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const scheduleB = await db.collection('besoulPublicSchedule').doc('ptb').get();
    const scheduleA = await db.collection('besoulPublicSchedule').doc('pta').get();
    console.log('\nbesoulPublicSchedule/ptb (el trainer que el admin editaba) existe tras el intento:', scheduleB.exists);
    console.log('besoulPublicSchedule/pta (OTRO trainer, cliente sin publicar) existe tras el intento:', scheduleA.exists);
    const clientesPublicadosPtb = await db.collection('besoulPublicClients').where('trainerKey', '==', 'ptb').get();
    const clientesPublicadosPta = await db.collection('besoulPublicClients').where('trainerKey', '==', 'pta').get();
    console.log('besoulPublicClients publicados para ptb:', clientesPublicadosPtb.size, '(esperado 1 si el admin SÍ pudo publicar al PT que estaba viendo)');
    console.log('besoulPublicClients publicados para pta:', clientesPublicadosPta.size, '(esperado 1 tras el fix QA-2026-09-17: besoulPublicClients.create ahora acepta isAdmin() igual que update/delete)');
  });

  await testEnv.cleanup();
}

main().catch(err => { console.error('ERROR EJECUTANDO LA REPRODUCCIÓN:', err); process.exitCode = 1; });
