// P0 CONFIRMADO EN QA (2026-09-17, segunda ronda): "Se han detectado cambios más recientes de
// este entrenador..." (code:'conflict') en un guardado limpio, sin ninguna otra sesión escribiendo
// de verdad. Reproduce el ciclo REAL: onSnapshot -> aplicarEstadoNubeAgenda() (que INCLUYE
// sincronizarPruebasCRMDentroDeAgenda(), la sospechosa) -> "ver como" PT B -> editar cliente B en
// memoria -> guardarEstadoNubeAgenda('ptb') -> transacción real contra el emulador con las Rules
// reales. NEGATIVE CONTROL: con el código de aplicarEstadoNubeAgenda() tal como estaba ANTES de
// este fix (captura bsUltimoServidorConocido DESPUÉS de sincronizarPruebasCRMDentroDeAgenda(), que
// muta dbAgenda in-place con una prueba CRM que NUNCA está en el agenda.<trainerKey> real del
// servidor), este test debe producir code:'conflict' en un escenario limpio, sin nadie más
// escribiendo. Tras el fix (capturar el baseline desde `data` crudo, antes de cualquier mutación
// local derivada), debe pasar a ok:true.

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
const AGENDA_HTML_PATH = path.join(__dirname, '..', 'agenda.html');

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
const extracted = [
  extractSimpleConst(agendaHtml, 'BS_APP_BUILD_TAG'),
  ...[
    'valorInvalidoParaFirestore', 'canonicalizarValorDiagnostico', 'hashEstableDiagnostico',
    'contarElementosDiagnostico', 'estadoLocalAgendaParaNube', 'payloadParaUpdateFirestore',
    'guardarEstadoNubeAgenda', 'aplicarEstadoNubeAgenda', 'sincronizarPruebasCRMDentroDeAgenda',
    'esCitaPruebaCRM',
  ].map(n => extractFunction(agendaHtml, n)),
].join('\n\n');

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8085 },
  });

  // Escenario REALISTA de negocio: PT B tiene una "prueba CRM" (valoración/lead agendada) en su
  // pruebasCRM, ya usada por consultaLeadsPermitidosAgenda() para pintar la tarjeta "Valoración" en
  // la Agenda del propio PT -- flujo real, cotidiano, no un borde raro. NUNCA se ha escrito nadie
  // más al documento tras el último snapshot: es un guardado completamente limpio.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('admin@x.com').set({ nombre: 'Admin', rol: 'admin', trainerKey: 'admin', activo: true, email: 'admin@x.com' });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ nombre: 'PT B', rol: 'pt', trainerKey: 'ptb', activo: true, email: 'ptb@x.com' });
    await db.collection('besoulSuite').doc('agenda').set({
      clientes: { ptb: [{ id: 'cb1', nombre: 'Cliente de B' }] },
      agenda: { ptb: {} },
      pruebasCRM: { ptb: { '2026-10-05_10:00': { esPruebaCRM: true, nombre: 'Lead Valoración', fuenteCaptacion: 'QR' } } },
      disponibilidadReservas: { ptb: {} }, historicoClientes: { ptb: {} }, notas: {},
    });
  });

  const adminCtx = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' });
  const firestoreAdmin = adminCtx.firestore();
  const docRef = firestoreAdmin.collection('besoulSuite').doc('agenda');

  let dbClientes = { ptb: [{ id: 'cb1', nombre: 'Cliente de B' }] };
  let dbAgenda = {};
  let dbPruebasCRM = {};
  let dbDisponibilidadReservas = { ptb: {} };
  let dbHistoricoClientes = { ptb: {} };
  let dbNotas = {};
  const window_ = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: undefined };

  const firebaseCompat = require('firebase/compat/app');
  require('firebase/compat/firestore');
  const firebase_ = {
    apps: [{}],
    firestore: Object.assign(() => firestoreAdmin, {
      FieldPath: firebaseCompat.firestore.FieldPath,
      FieldValue: firebaseCompat.firestore.FieldValue,
    }),
  };

  const sandbox = new Function(
    'window', 'firebase', 'dbClientes', 'dbAgenda', 'dbPruebasCRM', 'dbDisponibilidadReservas',
    'dbHistoricoClientes', 'dbNotas', 'console',
    extracted + `
    const localStorage = { setItem(){}, getItem(){return null;} };
    const document = { getElementById(){return null;} };
    function recalcularKPIs(){} function renderClientes(){} function renderAgenda(){} function actualizarLabelsKPIMes(){}
    function configurarSelectorAdmin(){}
    function sanitizarCredenciales(c){ return c || {}; }
    function normalizarCredenciales(){}
    async function publicarReservasPublicas(){ return; }
    let dbCredenciales = {};
    let rolActivo = 'admin';
    let entrenadorVisto = 'ptb';
    return { guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda };
  `);

  const M = sandbox(window_, firebase_, dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes, dbNotas, console);

  // Paso 1: onSnapshot inicial (real, primer render) -- exactamente lo que pasa al cargar la app.
  const snapInicial = await docRef.get();
  M.aplicarEstadoNubeAgenda(snapInicial.data());

  // Paso 2: "ver como PT B" ya está fijado (entrenadorVisto = 'ptb' en el sandbox). Paso 3: editar
  // cliente B EN MEMORIA (igual que guardarCliente()) -- dbClientes ya viene con el cliente.
  // Ningún OTRO escritor ha tocado el documento desde el snapshot inicial -- guardado limpio.
  console.log('=== NEGATIVE CONTROL: guardado limpio, PT B tiene una prueba CRM activa, nadie más escribió ===');
  const resultado = await M.guardarEstadoNubeAgenda('ptb');
  console.log('resultado:', JSON.stringify(resultado));

  if (resultado && resultado.ok === false && resultado.err && resultado.err.code === 'conflict') {
    console.log('\nNEGATIVE CONTROL: REPRODUCIDO -- code:"conflict" en un guardado limpio, confirma el false positive.');
  } else if (resultado && resultado.ok === true) {
    console.log('\nNEGATIVE CONTROL: NO reproducido -- ok:true (si esto corre DESPUÉS del fix, es el resultado correcto).');
  } else {
    console.log('\nNEGATIVE CONTROL: resultado inesperado, revisar.', resultado);
  }

  await testEnv.cleanup();
}

main().catch(err => { console.error('ERROR EJECUTANDO LA REPRODUCCIÓN:', err); process.exitCode = 1; });
