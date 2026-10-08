// HOTFIX-V1-AGENDA-PERSISTENCIA-P0 (2026-10-08) -- pruebas de regresión del P0 "el cambio de la
// Agenda aparece en pantalla y después desaparece".
//
// Contra el Firebase Emulator REAL (Rules reales de firestore.rules, SDK real, sesiones PT/admin
// autenticadas) con las funciones extraídas VERBATIM de agenda.html -- mismo patrón que
// rules-tests/run_concurrency_real_tests.cjs. Proyecto demo-besoul-suite (prefijo demo-: el SDK no
// puede llegar nunca a producción). Datos ficticios.
//
// Ejecutar (desde la raíz del repo; necesita `npm install` hecho en rules-tests/):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node .review-local/agenda-persistencia/run_tests.cjs"
// o, con un emulador de Firestore ya arrancado en 127.0.0.1:8085:
//   node .review-local/agenda-persistencia/run_tests.cjs

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const requireRules = createRequire(path.join(__dirname, '..', '..', 'rules-tests', 'package.json'));
const { initializeTestEnvironment } = requireRules('@firebase/rules-unit-testing');
const firebaseCompat = requireRules('firebase/compat/app');
requireRules('firebase/compat/firestore');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', '..', 'firestore.rules');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'agenda.html'), 'utf8');

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
  const finParametros = extractBalanced(m.index + m[0].length - 1, '(', ')');
  const end = extractBalanced(finParametros, '{', '}');
  return html.slice(m.index, end);
}
function extractSimpleConst(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`).exec(html);
  if (!m) throw new Error(`No se encontró const simple ${name}`);
  return m[0];
}

const extracted = [
  extractSimpleConst('BS_APP_BUILD_TAG'),
  ...[
    'valorInvalidoParaFirestore', 'clonarDatosParaGuardado', 'canonicalizarValorDiagnostico', 'igualdadCanonica',
    'hashEstableDiagnostico', 'contarElementosDiagnostico', 'diffEstructuralDiagnostico', 'estadoLocalAgendaParaNube',
    'payloadParaUpdateFirestore', 'estadoGuardadoAgenda', 'estadoGuardadoPendienteScope', 'scopeConCambiosSinConfirmar',
    'marcarNotaTocada', 'avisarCambioAgendaNoGuardado', 'mensajeErrorGuardadoAgenda', 'guardarEstadoNubeAgenda',
    'gestionarGuardadoAgendaFallido', 'ejecutarGuardadoEstadoNubeAgenda', 'programarGuardadoNubeAgenda',
    'aplicarEstadoNubeAgenda', 'sincronizarPruebasCRMDentroDeAgenda', 'esCitaPruebaCRM', 'claveNotaAgenda',
    'fijarNotaAgenda', 'publicarReservasPublicas',
  ].map(extractFunction),
].join('\n\n');

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}
const espera = ms => new Promise(r => setTimeout(r, ms));
// Espera a una condición (sondeo cada 100 ms, tope 10 s) en vez de un tiempo fijo: dos transacciones
// simultáneas sobre el mismo documento pueden tardar ~2 s en el emulador por contención.
async function esperarHasta(condicion, topeMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < topeMs) { if (await condicion()) return true; await espera(100); }
  return false;
}

// Una "pestaña" real de Agenda: su propio window/estado en memoria, autenticada en el emulador.
function crearPestana(firestoreCtx, entrenadorVisto, rol = 'pt', opciones = {}) {
  const docRef = firestoreCtx.collection('besoulSuite').doc('agenda');
  const window_ = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: undefined };
  const firebase_ = {
    apps: [{}],
    firestore: Object.assign(() => firestoreCtx, { FieldPath: firebaseCompat.firestore.FieldPath, FieldValue: firebaseCompat.firestore.FieldValue }),
  };
  const alertas = [];
  const vistoPorPublicacion = [];
  const consola = { ...console, log() {}, info() {}, warn() {}, error() {} };
  const sandbox = new Function('window', 'firebase', 'console', 'alertas', 'vistoPorPublicacion', 'alertaLanza', `
    ${extracted}
    const localStorage = { setItem(){}, getItem(){ return null; } };
    const document = { getElementById(){ return null; } };
    function alert(msg) { alertas.push(String(msg)); if (alertaLanza) throw new Error('alert roto'); }
    function nombreEntrenador(k) { return k; }
    function recalcularKPIs(){} function renderClientes(){} function renderAgenda(){} function actualizarLabelsKPIMes(){}
    function configurarSelectorAdmin(){} function normalizarCredenciales(){}
    function sanitizarCredenciales(c){ return c || {}; }
    // Sustituto de la publicación por trainerKey: registra QUÉ estado ve (síncrono, igual que la real).
    async function publicarReservasPublicasParaTrainer(trainerKey) {
      vistoPorPublicacion.push({ trainerKey, agenda: Object.keys((dbAgenda || {})[trainerKey] || {}).sort() });
    }
    let usuarioFirebaseActual = { uid: 'x' };
    let dbClientes = {}, dbAgenda = {}, dbPruebasCRM = {}, dbDisponibilidadReservas = {}, dbHistoricoClientes = {}, dbNotas = {};
    let dbCredenciales = {}, CREDENCIALES_BASE = {};
    let dbCatalogoActividades = {}, dbTrainerActividades = {}, dbTarifasActividadVersiones = {}, dbRepartoActividadVersiones = {};
    let rolActivo = '${rol}';
    let entrenadorVisto = '${entrenadorVisto}';
    return {
      guardarEstadoNubeAgenda, programarGuardadoNubeAgenda, aplicarEstadoNubeAgenda, fijarNotaAgenda, publicarReservasPublicas,
      get dbAgenda(){ return dbAgenda; }, get dbNotas(){ return dbNotas; }, get dbClientes(){ return dbClientes; },
      window,
    };
  `);
  window_.firebase = firebase_;
  const t = sandbox(window_, firebase_, consola, alertas, vistoPorPublicacion, !!opciones.alertaLanza);
  t.docRef = docRef;
  t.alertas = alertas;
  t.vistoPorPublicacion = vistoPorPublicacion;
  // Equivale al listener onSnapshot de la página: aplica lo que hay AHORA en el servidor.
  t.sync = async () => { const snap = await docRef.get(); t.aplicarEstadoNubeAgenda(snap.data()); };
  return t;
}

const sesion = (id, nombre) => ({ id, nombre, tipo: 'individual', duracionMin: 45, estadoCliente: 'activo' });

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8085 },
  });
  async function seed(extra = {}) {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('besoulUsers').doc('admin@x.com').set({ rol: 'admin', trainerKey: 'admin', activo: true });
      await db.collection('besoulUsers').doc('laura@x.com').set({ rol: 'pt', trainerKey: 'laura', activo: true });
      await db.collection('besoulUsers').doc('carlos@x.com').set({ rol: 'pt', trainerKey: 'carlos', activo: true });
      await db.collection('besoulSuite').doc('agenda').set({
        clientes: { laura: [{ id: 'cli_rosa' }], carlos: [{ id: 'cli_tomas' }] },
        agenda: { laura: {}, carlos: {} }, pruebasCRM: { laura: {}, carlos: {} },
        disponibilidadReservas: { laura: {}, carlos: {} }, historicoClientes: { laura: {}, carlos: {} }, notas: {},
        ...extra,
      });
    });
  }
  const ctx = (uid, email) => testEnv.authenticatedContext(uid, { email }).firestore();
  async function servidor() {
    let datos;
    await testEnv.withSecurityRulesDisabled(async (c) => { datos = (await c.firestore().collection('besoulSuite').doc('agenda').get()).data(); });
    return datos;
  }

  // ============================================================
  console.log('\n=== 1. CAUSA RAÍZ: publicarReservasPublicas() ya NO sustituye el estado vivo de la Agenda ===');
  // ============================================================
  {
    await seed({ agenda: { laura: { '2026-10-09_08:00': sesion('cli_rosa', 'Rosa') }, carlos: {} } });
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    await laura.sync();
    laura.dbAgenda.laura['2026-10-09_16:00'] = sesion('cli_rosa', 'Rosa (edición local sin guardar)');
    await laura.publicarReservasPublicas();
    check('la edición local sin guardar SIGUE en memoria tras publicar', Object.keys(laura.dbAgenda.laura).sort(), ['2026-10-09_08:00', '2026-10-09_16:00']);
    const vista = laura.vistoPorPublicacion.find(v => v.trainerKey === 'laura');
    check('la publicación usó los datos FRESCOS del servidor (no la edición local)', vista && vista.agenda, ['2026-10-09_08:00']);
  }
  {
    const cuerpo = extractFunction('publicarReservasPublicasParaTrainer');
    const awaits = cuerpo.match(/\bawait\b[^;]*/g) || [];
    check('publicarReservasPublicasParaTrainer(): un único await, el batch.commit() final (requisito del préstamo síncrono)', awaits.map(a => a.trim()), ['await batch.commit()']);
  }

  // ============================================================
  console.log('\n=== 2. Edición pendiente (debounce) + OTRO PT guarda entre medias: el cambio NO se pierde ===');
  // ============================================================
  {
    await seed();
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    const carlos = crearPestana(ctx('u_carlos', 'carlos@x.com'), 'carlos');
    await laura.sync(); await carlos.sync();
    laura.dbAgenda.laura['2026-10-09_10:00'] = sesion('cli_rosa', 'Rosa');
    laura.programarGuardadoNubeAgenda('laura');                 // guardado diferido 350 ms
    carlos.dbAgenda.carlos['2026-10-09_12:00'] = sesion('cli_tomas', 'Tomás');
    check('carlos guarda lo suyo', (await carlos.guardarEstadoNubeAgenda('carlos')).ok, true);
    await laura.sync();                                         // snapshot llega DURANTE la espera
    check('el snapshot ajeno NO borra de la memoria la sesión pendiente de laura', Object.keys(laura.dbAgenda.laura), ['2026-10-09_10:00']);
    check('el snapshot ajeno SÍ trae la sesión de carlos', Object.keys(laura.dbAgenda.carlos), ['2026-10-09_12:00']);
    await esperarHasta(async () => Object.keys((await servidor()).agenda.laura).length > 0);
    const s = await servidor();
    check('servidor: la sesión de laura se ha guardado', Object.keys(s.agenda.laura), ['2026-10-09_10:00']);
    check('servidor: la sesión de carlos sigue intacta', Object.keys(s.agenda.carlos), ['2026-10-09_12:00']);
    check('sin avisos de error', laura.alertas.length, 0);
  }

  // ============================================================
  console.log('\n=== 3. La protección de concurrencia sigue intacta (misma agenda desde otra sesión) y el fallo YA NO es silencioso ===');
  // ============================================================
  {
    await seed();
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    const admin = crearPestana(ctx('u_admin', 'admin@x.com'), 'laura', 'admin');
    await laura.sync(); await admin.sync();
    laura.dbAgenda.laura['2026-10-09_10:00'] = sesion('cli_rosa', 'Rosa (laura)');
    laura.programarGuardadoNubeAgenda('laura');
    admin.dbAgenda.laura['2026-10-09_18:00'] = sesion('cli_rosa', 'Rosa (admin)');
    check('admin guarda primero', (await admin.guardarEstadoNubeAgenda('laura')).ok, true);
    await laura.sync();                                         // llega el cambio del admin durante la espera
    await esperarHasta(async () => laura.alertas.length > 0);
    const s = await servidor();
    check('el cambio del admin NO se ha pisado', Object.keys(s.agenda.laura), ['2026-10-09_18:00']);
    check('laura recibe UN aviso visible de que su cambio no se ha guardado', laura.alertas.length, 1);
    check('el aviso dice que NO se ha guardado', /NO se ha guardado/.test(laura.alertas[0] || ''), true);
    check('la pantalla de laura vuelve a coincidir con el servidor', Object.keys(laura.dbAgenda.laura), ['2026-10-09_18:00']);
  }

  // ============================================================
  console.log('\n=== 4. avisoPropio: quien ya avisa por su cuenta no recibe un segundo aviso ===');
  // ============================================================
  {
    await seed();
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    await laura.sync();
    await testEnv.withSecurityRulesDisabled(async (c) => { await c.firestore().collection('besoulSuite').doc('agenda').update({ 'agenda.laura': { '2026-10-09_07:00': sesion('x', 'otra sesión') } }); });
    laura.dbAgenda.laura['2026-10-09_10:00'] = sesion('cli_rosa', 'Rosa');
    const r = await laura.guardarEstadoNubeAgenda('laura', { avisoPropio: true });
    check('conflicto detectado', r.err && r.err.code, 'conflict');
    check('sin alerta duplicada', laura.alertas.length, 0);
    check('pantalla resincronizada con el servidor igualmente', Object.keys(laura.dbAgenda.laura), ['2026-10-09_07:00']);
  }

  // ============================================================
  console.log('\n=== 5. Dos ediciones seguidas de la MISMA pestaña, con la segunda hecha mientras la primera se guarda ===');
  // ============================================================
  {
    await seed();
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    await laura.sync();
    laura.dbAgenda.laura['2026-10-09_10:00'] = sesion('cli_rosa', 'Rosa');
    const p1 = laura.guardarEstadoNubeAgenda('laura');          // transacción en curso...
    laura.dbAgenda.laura['2026-10-09_16:00'] = sesion('cli_rosa', 'Rosa 2'); // ...y se edita otra vez
    const p2 = laura.guardarEstadoNubeAgenda('laura');
    const [r1, r2] = await Promise.all([p1, p2]);
    check('primer guardado ok', r1.ok, true);
    check('segundo guardado ok (sin falso conflicto contra la propia pestaña)', r2.ok, true);
    const s = await servidor();
    check('servidor: ambas sesiones guardadas', Object.keys(s.agenda.laura).sort(), ['2026-10-09_10:00', '2026-10-09_16:00']);
    check('sin avisos', laura.alertas.length, 0);
  }

  // ============================================================
  console.log('\n=== 6. Notas: solo viajan las claves tocadas -- la nota de otro PT ya no se borra (Rules reales de PT) ===');
  // ============================================================
  {
    await seed({ notas: { 'carlos__2026-10-09_08:00': 'nota previa de carlos' } });
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    const carlos = crearPestana(ctx('u_carlos', 'carlos@x.com'), 'carlos');
    await laura.sync(); await carlos.sync();
    laura.fijarNotaAgenda('2026-10-09_10:00', 'NOTA DE LAURA');
    check('laura guarda su nota (PT, Rules reales)', (await laura.guardarEstadoNubeAgenda('laura')).ok, true);
    // carlos NO ha recibido todavía el snapshot con la nota de laura y guarda lo suyo
    carlos.fijarNotaAgenda('2026-10-09_12:00', 'NOTA DE CARLOS');
    check('carlos guarda su nota', (await carlos.guardarEstadoNubeAgenda('carlos')).ok, true);
    let s = await servidor();
    check('servidor: la nota de laura NO ha sido borrada por el guardado de carlos', s.notas['laura__2026-10-09_10:00'], 'NOTA DE LAURA');
    check('servidor: la nota nueva de carlos está', s.notas['carlos__2026-10-09_12:00'], 'NOTA DE CARLOS');
    check('servidor: la nota previa de carlos sigue', s.notas['carlos__2026-10-09_08:00'], 'nota previa de carlos');
    await carlos.sync();
    carlos.fijarNotaAgenda('2026-10-09_08:00', '');              // borrar una nota
    check('carlos borra una nota', (await carlos.guardarEstadoNubeAgenda('carlos')).ok, true);
    s = await servidor();
    check('servidor: la nota borrada ya no existe', 'carlos__2026-10-09_08:00' in s.notas, false);
    check('servidor: el resto de notas intactas', Object.keys(s.notas).sort(), ['carlos__2026-10-09_12:00', 'laura__2026-10-09_10:00']);
  }

  // ============================================================
  console.log('\n=== 7. Antes del primer snapshot (estado de caché local): no se escribe nada ===');
  // ============================================================
  {
    await seed({ agenda: { laura: { '2026-10-09_08:00': sesion('cli_rosa', 'del servidor') }, carlos: {} } });
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura');
    laura.dbAgenda.laura = { '2026-10-01_08:00': sesion('cli_rosa', 'caché antigua') };
    const r = await laura.guardarEstadoNubeAgenda('laura');
    check('bloqueado con agenda-no-cargada', r.err && r.err.code, 'agenda-no-cargada');
    const s = await servidor();
    check('servidor intacto (la caché antigua NO lo ha pisado)', Object.keys(s.agenda.laura), ['2026-10-09_08:00']);
    check('el usuario recibe aviso', laura.alertas.length, 1);
  }

  // ============================================================
  console.log('\n=== 8. Contrato: guardarEstadoNubeAgenda() nunca rechaza su promesa, ni aunque falle el aviso ===');
  // ============================================================
  {
    await seed();
    const laura = crearPestana(ctx('u_laura', 'laura@x.com'), 'laura', 'pt', { alertaLanza: true });
    await laura.sync();
    await testEnv.withSecurityRulesDisabled(async (c) => { await c.firestore().collection('besoulSuite').doc('agenda').update({ 'agenda.laura': { '2026-10-09_07:00': sesion('x', 'otra') } }); });
    laura.dbAgenda.laura['2026-10-09_10:00'] = sesion('cli_rosa', 'Rosa');
    let rechazada = false, r = null;
    try { r = await laura.guardarEstadoNubeAgenda('laura'); } catch (e) { rechazada = true; }
    check('la promesa NO se rechaza', rechazada, false);
    check('resuelve ok:false con conflict', r && r.err && r.err.code, 'conflict');
  }

  // ============================================================
  console.log('\n=== 9. Un temporizador por trainerKey: el admin edita dos agendas en <350 ms y se guardan ambas ===');
  // ============================================================
  {
    await seed();
    const admin = crearPestana(ctx('u_admin', 'admin@x.com'), 'laura', 'admin');
    await admin.sync();
    admin.dbAgenda.laura['2026-10-09_10:00'] = sesion('cli_rosa', 'Rosa');
    admin.programarGuardadoNubeAgenda('laura');
    admin.dbAgenda.carlos['2026-10-09_11:00'] = sesion('cli_tomas', 'Tomás');
    admin.programarGuardadoNubeAgenda('carlos');
    await esperarHasta(async () => { const d = await servidor(); return Object.keys(d.agenda.laura).length > 0 && Object.keys(d.agenda.carlos).length > 0; });
    const s = await servidor();
    check('agenda de laura guardada', Object.keys(s.agenda.laura), ['2026-10-09_10:00']);
    check('agenda de carlos guardada', Object.keys(s.agenda.carlos), ['2026-10-09_11:00']);
  }

  // ============================================================
  console.log('\n=== 10. Cancelación de otro entrenador: solo se borra SU nota, nunca la del entrenador en pantalla ===');
  // ============================================================
  {
    await seed({ notas: { 'laura__2026-10-09_10:00': 'nota de laura', 'carlos__2026-10-09_10:00': 'nota de carlos (misma hora)' } });
    const admin = crearPestana(ctx('u_admin', 'admin@x.com'), 'carlos', 'admin'); // el admin está viendo a carlos
    await admin.sync();
    admin.fijarNotaAgenda('2026-10-09_10:00', '', 'laura');      // como hace procesarCancelacionCliente()
    check('guardado ok', (await admin.guardarEstadoNubeAgenda('laura', { avisoPropio: true })).ok, true);
    const s = await servidor();
    check('la nota de laura (la de la cancelación) se borra', 'laura__2026-10-09_10:00' in s.notas, false);
    check('la nota de carlos, a la misma hora, sigue intacta', s.notas['carlos__2026-10-09_10:00'], 'nota de carlos (misma hora)');
  }

  await testEnv.cleanup();
  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
