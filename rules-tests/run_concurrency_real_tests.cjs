// P0 (QA 2026-09-17, segunda ronda) -- CAUSA RAÍZ REAL del "false conflict": aplicarEstadoNubeAgenda()
// asignaba dbAgenda = data.agenda (referencia, no copia) y LUEGO sincronizarPruebasCRMDentroDeAgenda()
// mutaba dbAgenda en el sitio para pintar en Agenda las pruebas CRM que aún no estaban fusionadas de
// verdad en el campo "agenda" del servidor -- como dbAgenda y data.agenda eran el MISMO objeto, la
// instantánea "bsUltimoServidorConocido" (incluso leyendo de `data`, no de dbAgenda) quedaba
// contaminada igualmente si se capturaba DESPUÉS de esa mutación. Cualquier trainerKey con una
// prueba CRM activa producía un conflicto FALSO, determinista, en cada guardado -- sin que nadie
// más escribiera nada. Fix real: capturar la instantánea ANTES de crear cualquier alias hacia los
// campos de `data` (primera línea del try{}, antes de "dbAgenda = data.agenda").
//
// Esta suite reproduce la matriz completa pedida contra el Firebase Emulator Suite REAL (Rules
// reales, SDK real, guardarEstadoNubeAgenda()/aplicarEstadoNubeAgenda()/
// sincronizarPruebasCRMDentroDeAgenda() extraídas VERBATIM de agenda.html) -- un mock de Firestore
// (como concurrency-tests/, que usa datos sintéticos sin pruebasCRM) nunca habría podido detectar
// este bug, por eso esta suite existe aparte, con el SDK y las Rules reales de por medio.
//
// Ejecutar (desde la raiz del repo):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_concurrency_real_tests.cjs"

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

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

const firebaseCompat = require('firebase/compat/app');
require('firebase/compat/firestore');

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// Crea una "sesión" real: writer + su propio window/bsUltimoServidorConocido, sobre un Firestore
// real del emulador (autenticado como el uid/email dado). trainerKeyPropio se usa solo para el
// perfil (isAdmin() lo hace irrelevante para el propio write).
function crearSesion(firestoreCtx, entrenadorVisto) {
  const docRef = firestoreCtx.collection('besoulSuite').doc('agenda');
  const window_ = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: undefined };
  const firebase_ = {
    apps: [{}],
    firestore: Object.assign(() => firestoreCtx, {
      FieldPath: firebaseCompat.firestore.FieldPath,
      FieldValue: firebaseCompat.firestore.FieldValue,
    }),
  };
  const sandbox = new Function(
    'window', 'firebase', 'console',
    extracted + `
    const localStorage = { setItem(){}, getItem(){return null;} };
    const document = { getElementById(){return null;} };
    function recalcularKPIs(){} function renderClientes(){} function renderAgenda(){} function actualizarLabelsKPIMes(){}
    function configurarSelectorAdmin(){}
    function sanitizarCredenciales(c){ return c || {}; }
    function normalizarCredenciales(){}
    async function publicarReservasPublicas(){ return; }
    let dbClientes = {}, dbAgenda = {}, dbPruebasCRM = {}, dbDisponibilidadReservas = {}, dbHistoricoClientes = {}, dbNotas = {};
    let dbCredenciales = {};
    let dbCatalogoActividades = {}, dbTrainerActividades = {}, dbTarifasActividadVersiones = {}, dbRepartoActividadVersiones = {};
    let rolActivo = '${entrenadorVisto === '__admin__' ? 'admin' : 'pt'}';
    let entrenadorVisto = '${entrenadorVisto}';
    return {
      guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda,
      get dbClientes(){ return dbClientes; }, set dbClientes(v){ dbClientes = v; },
      set entrenadorVisto(v){ entrenadorVisto = v; },
    };
  `);
  return sandbox(window_, firebase_, console);
}

async function sync(sesion, docRef) {
  const snap = await docRef.get();
  sesion.aplicarEstadoNubeAgenda(snap.data());
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8080 },
  });

  async function seed(extra = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('besoulUsers').doc('admin@x.com').set({ rol: 'admin', trainerKey: 'admin', activo: true });
      await db.collection('besoulUsers').doc('pta@x.com').set({ rol: 'pt', trainerKey: 'pta', activo: true });
      await db.collection('besoulUsers').doc('ptb@x.com').set({ rol: 'pt', trainerKey: 'ptb', activo: true });
      await db.collection('besoulSuite').doc('agenda').set({
        clientes: { pta: [{ id: 'ca1', nombre: 'Cliente A' }], ptb: [{ id: 'cb1', nombre: 'Cliente B' }] },
        agenda: { pta: {}, ptb: {} },
        pruebasCRM: { pta: {}, ptb: { '2026-10-05_10:00': { esPruebaCRM: true, nombre: 'Lead Valoración B' } } },
        disponibilidadReservas: { pta: {}, ptb: {} }, historicoClientes: { pta: {}, ptb: {} }, notas: {},
        ...extra,
      });
    });
  }
  async function docRefFor(ctx) { return ctx.collection('besoulSuite').doc('agenda'); }
  async function otraSesionEscribe(campo, trainerKey, valor) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('besoulSuite').doc('agenda').update({ [`${campo}.${trainerKey}`]: valor });
    });
  }

  // ============================================================
  console.log('\n=== 1. ADMIN ve A -> cambia a B -> edita B -> servidor B sin cambios = SAVE OK ===');
  // ============================================================
  {
    await seed();
    const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();
    const docRef = await docRefFor(admin);
    const s = crearSesion(admin, 'pta');
    await sync(s, docRef);
    s.entrenadorVisto = 'ptb';
    s.dbClientes = { pta: [{ id: 'ca1' }], ptb: [{ id: 'cb1', nombre: 'Editado por admin' }] };
    const r = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 1: ok:true', r.ok, true);
  }

  // ============================================================
  console.log('\n=== 2. ADMIN ve A -> cambia a B -> OTRO cambia A -> edita B = SAVE OK (cross-trainer no es conflicto) ===');
  // ============================================================
  {
    await seed();
    const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();
    const docRef = await docRefFor(admin);
    const s = crearSesion(admin, 'pta');
    await sync(s, docRef);
    s.entrenadorVisto = 'ptb';
    await otraSesionEscribe('clientes', 'pta', [{ id: 'ca1', nombre: 'Cambiado por OTRA sesión mientras tanto' }]);
    s.dbClientes = { pta: [{ id: 'ca1' }], ptb: [{ id: 'cb1', nombre: 'Editado por admin' }] };
    const r = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 2: ok:true (cambio de OTRO trainer no cuenta como conflicto)', r.ok, true);
  }

  // ============================================================
  console.log('\n=== 3. ADMIN ve B (con prueba CRM activa) -> edita B = SAVE OK (el bug real, ya corregido) ===');
  // ============================================================
  {
    await seed();
    const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();
    const docRef = await docRefFor(admin);
    const s = crearSesion(admin, 'ptb');
    await sync(s, docRef);
    s.dbClientes = { ptb: [{ id: 'cb1', nombre: 'Editado por admin, PT B tiene prueba CRM' }] };
    const r = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 3: ok:true (CAUSA RAÍZ del P0 reportado)', r.ok, true);
  }

  // ============================================================
  console.log('\n=== 4. ADMIN cambia repetidamente A/B/A, sin cambios concurrentes = SAVE OK cada vez ===');
  // ============================================================
  {
    await seed();
    const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();
    const docRef = await docRefFor(admin);
    const s = crearSesion(admin, 'pta');
    await sync(s, docRef);
    s.dbClientes = { pta: [{ id: 'ca1', nombre: 'Editado A (1)' }], ptb: [{ id: 'cb1' }] };
    const r1 = await s.guardarEstadoNubeAgenda('pta');
    check('escenario 4a: A -> SAVE OK', r1.ok, true);

    s.entrenadorVisto = 'ptb';
    await sync(s, docRef); // el propio self-echo también sincroniza el baseline realista
    s.dbClientes = { pta: [{ id: 'ca1' }], ptb: [{ id: 'cb1', nombre: 'Editado B (1)' }] };
    const r2 = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 4b: B -> SAVE OK', r2.ok, true);

    s.entrenadorVisto = 'pta';
    await sync(s, docRef);
    s.dbClientes = { pta: [{ id: 'ca1', nombre: 'Editado A (2)' }], ptb: [{ id: 'cb1' }] };
    const r3 = await s.guardarEstadoNubeAgenda('pta');
    check('escenario 4c: A otra vez -> SAVE OK', r3.ok, true);
  }

  // ============================================================
  console.log('\n=== 5. ADMIN ve B -> OTRA sesión cambia cliente B -> admin guarda stale = CONFLICT (protección real intacta) ===');
  // ============================================================
  {
    await seed();
    const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();
    const docRef = await docRefFor(admin);
    const s = crearSesion(admin, 'ptb');
    await sync(s, docRef);
    // Otra sesión (el propio PT B, por ejemplo) guarda algo REAL de B que este admin no ha visto.
    await otraSesionEscribe('clientes', 'ptb', [{ id: 'cb1', nombre: 'Cambio real de otra sesión' }, { id: 'cb2', nombre: 'Cliente nuevo de otra sesión' }]);
    s.dbClientes = { ptb: [{ id: 'cb1', nombre: 'Editado por admin, SIN saber del cambio anterior' }] };
    const r = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 5: ok:false, code:conflict', [r.ok, r.err && r.err.code], [false, 'conflict']);
    let estadoServidor;
    await testEnv.withSecurityRulesDisabled(async (ctx) => { estadoServidor = (await ctx.firestore().collection('besoulSuite').doc('agenda').get()).data(); });
    check('escenario 5: el cambio real de la otra sesión SIGUE intacto en el servidor', estadoServidor.clientes.ptb, [{ id: 'cb1', nombre: 'Cambio real de otra sesión' }, { id: 'cb2', nombre: 'Cliente nuevo de otra sesión' }]);
  }

  // ============================================================
  console.log('\n=== 6. PT B, otra pestaña cambia B, la pestaña obsoleta intenta guardar = CONFLICT ===');
  // ============================================================
  {
    await seed();
    const ptB = testEnv.authenticatedContext('uid_ptb', { email: 'ptb@x.com' }).firestore();
    const docRef = await docRefFor(ptB);
    const tabVieja = crearSesion(ptB, 'ptb');
    await sync(tabVieja, docRef);
    await otraSesionEscribe('clientes', 'ptb', [{ id: 'cb1', nombre: 'Guardado por la pestaña NUEVA' }]);
    tabVieja.dbClientes = { ptb: [{ id: 'cb1', nombre: 'La pestaña VIEJA no se enteró' }] };
    const r = await tabVieja.guardarEstadoNubeAgenda('ptb');
    check('escenario 6: ok:false, code:conflict', [r.ok, r.err && r.err.code], [false, 'conflict']);
  }

  // ============================================================
  console.log('\n=== 7. PT B -> PT A cambia -> B guarda = SAVE OK ===');
  // ============================================================
  {
    await seed();
    const ptB = testEnv.authenticatedContext('uid_ptb', { email: 'ptb@x.com' }).firestore();
    const docRef = await docRefFor(ptB);
    const s = crearSesion(ptB, 'ptb');
    await sync(s, docRef);
    await otraSesionEscribe('clientes', 'pta', [{ id: 'ca1', nombre: 'PT A cambió lo suyo' }]);
    s.dbClientes = { ptb: [{ id: 'cb1', nombre: 'PT B edita lo suyo' }] };
    const r = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 7: ok:true', r.ok, true);
  }

  // ============================================================
  console.log('\n=== 8. ADMIN ve B -> timestamp global (actualizadoEn) cambia, contenido de B igual = SAVE OK ===');
  // ============================================================
  {
    await seed();
    const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();
    const docRef = await docRefFor(admin);
    const s = crearSesion(admin, 'ptb');
    await sync(s, docRef);
    // Otra sesión guarda de un campo top-level ajeno a los 5 comparables (actualizadoEn), sin
    // tocar ningún dato scoped de ningún trainer -- CAMPOS_CONCURRENCIA_COMPARABLES nunca incluye
    // actualizadoEn/ultimaActualizacionLocal a propósito.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('besoulSuite').doc('agenda').update({ ultimaActualizacionLocal: new Date().toISOString() });
    });
    s.dbClientes = { ptb: [{ id: 'cb1', nombre: 'Editado por admin' }] };
    const r = await s.guardarEstadoNubeAgenda('ptb');
    check('escenario 8: ok:true (timestamp global no cuenta como conflicto)', r.ok, true);
  }

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); }
  await testEnv.cleanup();
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
