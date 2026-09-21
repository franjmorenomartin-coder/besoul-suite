// BESOUL SAVE INCIDENT (2026-09-21) -- hypothesis: two saves from the SAME tab, close enough
// together that the onSnapshot listener hasn't re-fired (and re-synced window.bsUltimoServidorConocido)
// between them, cause the SECOND save to see its own FIRST save (already committed to the server)
// as a "conflict from another session". This never requires a second tab, a second user, or Rules/
// index involvement -- it's a pure client-side staleness race in bsUltimoServidorConocido.
//
// Reproduces the REAL extracted guardarEstadoNubeAgenda()/aplicarEstadoNubeAgenda() against the real
// Emulator + real Rules, exactly like rules-tests/run_false_conflict_repro.cjs. The only difference:
// this script calls guardarEstadoNubeAgenda() TWICE in a row, WITHOUT ever calling
// aplicarEstadoNubeAgenda() in between (simulating "the listener echo from save #1 hasn't arrived
// yet when save #2 fires") -- which is exactly what onSnapshot's real, unbounded network latency
// allows to happen for two edits a debounce-interval apart.

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
    'contarElementosDiagnostico', 'diffEstructuralDiagnostico', 'estadoLocalAgendaParaNube', 'payloadParaUpdateFirestore',
    'guardarEstadoNubeAgenda', 'aplicarEstadoNubeAgenda', 'sincronizarPruebasCRMDentroDeAgenda',
    'esCitaPruebaCRM',
  ].map((n) => extractFunction(agendaHtml, n)),
].join('\n\n');

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8085 },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('pta@x.com').set({ nombre: 'PT A', rol: 'pt', trainerKey: 'pta', activo: true, email: 'pta@x.com' });
    await db.collection('besoulSuite').doc('agenda').set({
      clientes: { pta: [{ id: 'ca1', nombre: 'Cliente A1', notas: 'v0' }] },
      agenda: { pta: {} }, pruebasCRM: { pta: {} },
      disponibilidadReservas: { pta: {} }, historicoClientes: { pta: {} }, notas: {},
    });
  });

  const ptaCtx = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' });
  const firestorePt = ptaCtx.firestore();
  const docRef = firestorePt.collection('besoulSuite').doc('agenda');

  let dbClientes = { pta: [{ id: 'ca1', nombre: 'Cliente A1', notas: 'v0' }] };
  let dbAgenda = {};
  let dbPruebasCRM = {};
  let dbDisponibilidadReservas = { pta: {} };
  let dbHistoricoClientes = { pta: {} };
  let dbNotas = {};
  const window_ = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: undefined };

  const firebaseCompat = require('firebase/compat/app');
  require('firebase/compat/firestore');
  const firebase_ = {
    apps: [{}],
    firestore: Object.assign(() => firestorePt, {
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
    let rolActivo = 'pt';
    let entrenadorVisto = 'pta';
    // Expone un mutador que SIEMPRE opera sobre el dbClientes ACTUAL del sandbox (que
    // aplicarEstadoNubeAgenda() reasigna internamente a data.clientes -- un dbClientes capturado
    // por VALOR de referencia antes de esa reasignación quedaría huérfano, igual que en el
    // navegador real un closure que capturase la referencia original en vez de leer la variable
    // global viva tampoco vería la edición).
    function editarNotaCliente(trainerKey, clienteId, nuevoValor) {
      const ficha = (dbClientes[trainerKey] || []).find(c => c.id === clienteId);
      if (!ficha) throw new Error('Cliente no encontrado en el sandbox: ' + clienteId);
      ficha.notas = nuevoValor;
    }
    return { guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda, editarNotaCliente };
  `,
  );

  const M = sandbox(window_, firebase_, dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes, dbNotas, console);

  // Paso 1: carga inicial real -- onSnapshot #1 (equivalente a abrir la app).
  const snapInicial = await docRef.get();
  M.aplicarEstadoNubeAgenda(snapInicial.data());

  // Paso 2: usuario edita el cliente (edición #1) y guarda -- SIN esperar a que el listener
  // onSnapshot re-sincronice bsUltimoServidorConocido después de este guardado (exactamente lo que
  // pasa en un navegador real: el listener depende de la red, no es instantáneo).
  M.editarNotaCliente('pta', 'ca1', 'v1 -- primera edición');
  console.log('=== Guardado #1 (edición real, tab única, nadie más escribe) ===');
  const resultado1 = await M.guardarEstadoNubeAgenda('pta');
  console.log('resultado1:', JSON.stringify(resultado1));

  // Paso 3: SIN llamar a aplicarEstadoNubeAgenda() (== el listener aún no ha vuelto), el mismo
  // usuario hace una SEGUNDA edición normal (p.ej. otro campo, o el debounce de 350ms disparó dos
  // veces porque hubo más de un cambio en menos de ese margen) y guarda otra vez.
  M.editarNotaCliente('pta', 'ca1', 'v2 -- segunda edición, inmediatamente después');
  console.log('\n=== Guardado #2 (segunda edición, MISMA pestaña, ANTES de que el listener vuelva) ===');
  const resultado2 = await M.guardarEstadoNubeAgenda('pta');
  console.log('resultado2:', JSON.stringify(resultado2));

  if (resultado1.ok === true && resultado2 && resultado2.ok === false && resultado2.err && resultado2.err.code === 'conflict') {
    console.log('\nREPRODUCIDO: el guardado #2 (misma pestaña, mismo usuario, edición normal e inmediatamente consecutiva) ve su PROPIO guardado #1 como "conflicto de otra sesión". Root cause confirmada: bsUltimoServidorConocido no se resincroniza entre guardados consecutivos si el listener onSnapshot no ha vuelto a disparar todavía.');
    process.exitCode = 2;
  } else if (resultado1.ok === true && resultado2 && resultado2.ok === true) {
    console.log('\nNO reproducido: ambos guardados consecutivos tuvieron éxito (ok:true).');
  } else {
    console.log('\nResultado inesperado, revisar.', { resultado1, resultado2 });
  }

  await testEnv.cleanup();
}

main().catch((err) => { console.error('ERROR EJECUTANDO LA REPRODUCCIÓN:', err); process.exitCode = 1; });
