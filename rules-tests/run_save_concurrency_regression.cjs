// BESOUL SAVE INCIDENT (2026-09-21) -- regression suite for the fix in guardarEstadoNubeAgenda():
// after a successful save, this tab's own bsUltimoServidorConocido baseline is updated to reflect
// what it just wrote (see agenda.html, the .then() right after tx.update()), closing the race where
// a second, immediately-consecutive save from the SAME tab saw its own prior save as a false
// "conflict from another session". This suite proves both directions: same-session saves succeed,
// AND a genuine two-writer conflict is still correctly detected -- never silently "last write wins".
//
// Runs the REAL extracted functions against the real Emulator + real Rules, same harness as
// rules-tests/run_false_conflict_repro.cjs and run_double_save_race_repro.cjs.
//
// Ejecutar (desde la raiz del repo):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_save_concurrency_regression.cjs"

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
const AGENDA_HTML_PATH = path.join(__dirname, '..', 'agenda.html');

let pass = 0, fail = 0;
const fails = [];
function check(desc, cond) {
  if (cond) { pass++; console.log(`PASS -- ${desc}`); }
  else { fail++; fails.push(desc); console.log(`FAIL -- ${desc}`); }
}

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
  ].map((n) => extractFunction(agendaHtml, n)),
].join('\n\n');

/** Builds one independent "browser tab" sandbox against the given firestore instance. */
function crearPestana(firestoreCtx, docRef, seedClientes, rol, entrenador) {
  const window_ = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: undefined };
  const firebaseCompat = require('firebase/compat/app');
  require('firebase/compat/firestore');
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
    let dbClientes = ${JSON.stringify(seedClientes)};
    let dbAgenda = {}; let dbPruebasCRM = {}; let dbDisponibilidadReservas = {}; let dbHistoricoClientes = {}; let dbNotas = {};
    const localStorage = { setItem(){}, getItem(){return null;} };
    const document = { getElementById(){return null;} };
    function recalcularKPIs(){} function renderClientes(){} function renderAgenda(){} function actualizarLabelsKPIMes(){}
    function configurarSelectorAdmin(){}
    function sanitizarCredenciales(c){ return c || {}; }
    function normalizarCredenciales(){}
    async function publicarReservasPublicas(){ return; }
    let dbCredenciales = {};
    let rolActivo = ${JSON.stringify(rol)};
    let entrenadorVisto = ${JSON.stringify(entrenador)};
    function editarNotaCliente(trainerKey, clienteId, nuevoValor) {
      const ficha = (dbClientes[trainerKey] || []).find(c => c.id === clienteId);
      if (!ficha) throw new Error('Cliente no encontrado: ' + clienteId);
      ficha.notas = nuevoValor;
    }
    return { guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda, editarNotaCliente };
  `,
  );
  return sandbox(window_, firebase_, console);
}

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

  const seed = { pta: [{ id: 'ca1', nombre: 'Cliente A1', notas: 'v0' }] };

  console.log('\n=== TEST 1: una pestaña + edición normal => SAVE PASS ===');
  {
    const ctx = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRef = ctx.collection('besoulSuite').doc('agenda');
    const M = crearPestana(ctx, docRef, seed, 'pt', 'pta');
    M.aplicarEstadoNubeAgenda((await docRef.get()).data());
    M.editarNotaCliente('pta', 'ca1', 'test1');
    const r = await M.guardarEstadoNubeAgenda('pta');
    check('TEST 1: guardado único, edición normal -> ok:true', r.ok === true);
  }

  console.log('\n=== TEST 2: guardar dos veces consecutivas desde la MISMA sesión => SAVE PASS ===');
  {
    const ctx = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRef = ctx.collection('besoulSuite').doc('agenda');
    const M = crearPestana(ctx, docRef, seed, 'pt', 'pta');
    M.aplicarEstadoNubeAgenda((await docRef.get()).data());
    M.editarNotaCliente('pta', 'ca1', 'test2-a');
    const r1 = await M.guardarEstadoNubeAgenda('pta');
    // Deliberadamente SIN llamar a aplicarEstadoNubeAgenda() entre medias -- el listener aún "no ha
    // vuelto". Antes del fix, esto reproducía el P0 real.
    M.editarNotaCliente('pta', 'ca1', 'test2-b');
    const r2 = await M.guardarEstadoNubeAgenda('pta');
    check('TEST 2: guardado #1 -> ok:true', r1.ok === true);
    check('TEST 2: guardado #2 inmediatamente consecutivo (mismo tab, listener no ha vuelto) -> ok:true', r2.ok === true);
  }

  console.log('\n=== TEST 3: dos pestañas cargan versión N; A guarda => N+1; B intenta guardar N => CONFLICT DETECTED ===');
  {
    const ctxA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const ctxB = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefA = ctxA.collection('besoulSuite').doc('agenda');
    const docRefB = ctxB.collection('besoulSuite').doc('agenda');
    // Reset a un estado limpio conocido para este test (independiente de lo que dejaron TEST 1/2).
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await adminCtx.firestore().collection('besoulSuite').doc('agenda').update({ 'clientes.pta': [{ id: 'ca1', nombre: 'Cliente A1', notas: 'N' }] });
    });
    const seedN = { pta: [{ id: 'ca1', nombre: 'Cliente A1', notas: 'N' }] };
    const A = crearPestana(ctxA, docRefA, seedN, 'pt', 'pta');
    const B = crearPestana(ctxB, docRefB, seedN, 'pt', 'pta');
    // Ambas pestañas cargan la MISMA versión N (cada una con su PROPIO listener/baseline).
    const snapN = (await docRefA.get()).data();
    A.aplicarEstadoNubeAgenda(snapN);
    B.aplicarEstadoNubeAgenda(snapN);
    // A edita y guarda -> servidor pasa a N+1. B NUNCA se entera (nunca vuelve a llamar
    // aplicarEstadoNubeAgenda) -- exactamente "dos pestañas reales, una desactualizada".
    A.editarNotaCliente('pta', 'ca1', 'N+1 (escrito por A)');
    const rA = await A.guardarEstadoNubeAgenda('pta');
    B.editarNotaCliente('pta', 'ca1', 'intento de B sobre N, ya obsoleto');
    const rB = await B.guardarEstadoNubeAgenda('pta');
    check('TEST 3: A guarda su cambio -> ok:true', rA.ok === true);
    check('TEST 3: B intenta guardar sobre una versión YA obsoleta (otra pestaña real escribió) -> CONFLICT DETECTED, no ok:true', rB.ok === false && rB.err && rB.err.code === 'conflict');
  }

  console.log('\n=== TEST 4: después de conflicto + reload (nuevo snapshot aplicado) => SAVE PASS ===');
  {
    const ctxB = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefB = ctxB.collection('besoulSuite').doc('agenda');
    const B = crearPestana(ctxB, docRefB, { pta: [{ id: 'ca1', nombre: 'Cliente A1', notas: 'stale' }] }, 'pt', 'pta');
    // "Recargar la página": aplica el snapshot REAL y ACTUAL del servidor (post-conflicto de TEST 3).
    const snapFresco = (await docRefB.get()).data();
    B.aplicarEstadoNubeAgenda(snapFresco);
    B.editarNotaCliente('pta', 'ca1', 'edición tras recargar');
    const r = await B.guardarEstadoNubeAgenda('pta');
    check('TEST 4: tras recargar (nuevo snapshot aplicado) el guardado vuelve a funcionar -> ok:true', r.ok === true);
  }

  console.log('\n=== TEST 5: serverTimestamp / Timestamp serialization => NO FALSE CONFLICT ===');
  {
    // actualizadoEn usa FieldValue.serverTimestamp() en cada guardado -- un sentinel, no un valor
    // serializable de la forma habitual. Confirma que no está entre los campos comparados (por
    // diseño, CAMPOS_CONCURRENCIA_COMPARABLES no lo incluye) y que dos guardados consecutivos
    // (cada uno con su propio serverTimestamp()) no producen un falso conflicto por su causa.
    const ctx = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRef = ctx.collection('besoulSuite').doc('agenda');
    const M = crearPestana(ctx, docRef, seed, 'pt', 'pta');
    M.aplicarEstadoNubeAgenda((await docRef.get()).data());
    M.editarNotaCliente('pta', 'ca1', 'ts-a');
    const r1 = await M.guardarEstadoNubeAgenda('pta');
    M.editarNotaCliente('pta', 'ca1', 'ts-b');
    const r2 = await M.guardarEstadoNubeAgenda('pta');
    check('TEST 5: dos guardados consecutivos, cada uno con su propio serverTimestamp(), sin falso conflicto', r1.ok === true && r2.ok === true);
  }

  console.log('\n=== TEST 6: listener update entre medias => NO FALSE CONFLICT ===');
  {
    // El listener SÍ vuelve a tiempo esta vez (simulado llamando a aplicarEstadoNubeAgenda() con el
    // snapshot post-guardado #1 antes del guardado #2) -- debe seguir funcionando igual de bien que
    // cuando el listener NO vuelve a tiempo (TEST 2). Las dos rutas de refresco (el fix optimista
    // tras el propio guardado, y el listener real) no deben pisarse ni producir un estado inconsistente.
    const ctx = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRef = ctx.collection('besoulSuite').doc('agenda');
    const M = crearPestana(ctx, docRef, seed, 'pt', 'pta');
    M.aplicarEstadoNubeAgenda((await docRef.get()).data());
    M.editarNotaCliente('pta', 'ca1', 'listener-a');
    const r1 = await M.guardarEstadoNubeAgenda('pta');
    // El listener "vuelve" -- aplica el snapshot real post-guardado.
    M.aplicarEstadoNubeAgenda((await docRef.get()).data());
    M.editarNotaCliente('pta', 'ca1', 'listener-b');
    const r2 = await M.guardarEstadoNubeAgenda('pta');
    check('TEST 6: guardado #1 -> ok:true', r1.ok === true);
    check('TEST 6: guardado #2, tras un refresco real del listener de por medio -> ok:true (sin falso conflicto)', r2.ok === true);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) { console.log('Failures:', fails); process.exitCode = 1; }
  await testEnv.cleanup();
}

main().catch((err) => { console.error('ERROR EJECUTANDO LA SUITE:', err); process.exitCode = 1; });
