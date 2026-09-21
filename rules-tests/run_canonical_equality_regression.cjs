// BESOUL P0 SAVE INCIDENT -- FOURTH ROUND, ROOT CAUSE FIX REGRESSION (2026-09-21)
//
// Real production evidence (buildId save-diag-v3-2026-09-21, trainerScope 'fran') showed
// rawEqual:false + canonicalEqual:true + structuralDiff:[] simultaneously for 4 of the 5
// comparable fields -- proof, not hypothesis, that the raw JSON.stringify(a)!==JSON.stringify(b)
// concurrency decision was treating object-key-order differences as real conflicts. The fix
// switches the decision to igualdadCanonica() (same primitive used everywhere: the decision, the
// diagnostic's canonicalEqual, and diffEstructuralDiagnostico's leaf comparison).
//
// This suite proves BOTH directions with the real extracted functions against the real Emulator +
// real Rules: same-data-different-key-order is now allowed (TEST A/B/C/J), while every real
// difference -- including array reordering, which must stay significant -- still blocks the save
// exactly as before (TEST D/E/F/G/H), and the same-tab/reload behaviors already fixed in prior
// rounds still hold (TEST I).
//
// Ejecutar (desde la raiz del repo):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_canonical_equality_regression.cjs"

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
const FN_NAMES = [
  'valorInvalidoParaFirestore', 'canonicalizarValorDiagnostico', 'igualdadCanonica',
  'hashEstableDiagnostico', 'contarElementosDiagnostico', 'diffEstructuralDiagnostico',
  'estadoLocalAgendaParaNube', 'payloadParaUpdateFirestore', 'guardarEstadoNubeAgenda',
  'aplicarEstadoNubeAgenda', 'sincronizarPruebasCRMDentroDeAgenda', 'esCitaPruebaCRM',
];
const extracted = [
  extractSimpleConst(agendaHtml, 'BS_APP_BUILD_TAG'),
  ...FN_NAMES.map((n) => extractFunction(agendaHtml, n)),
].join('\n\n');

// --- Unit-level access to igualdadCanonica() alone, for TEST A-D which don't need a full save. ---
const unitSandbox = new Function(extracted + `
  return { igualdadCanonica, canonicalizarValorDiagnostico };
`)();

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
    let dbClientes = ${JSON.stringify(seedClientes.clientes || {})};
    let dbAgenda = ${JSON.stringify(seedClientes.agenda || {})};
    let dbPruebasCRM = ${JSON.stringify(seedClientes.pruebasCRM || {})};
    let dbDisponibilidadReservas = ${JSON.stringify(seedClientes.disponibilidadReservas || {})};
    let dbHistoricoClientes = ${JSON.stringify(seedClientes.historicoClientes || {})};
    let dbNotas = {};
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
    function editarCliente(trainerKey, clienteId, mutador) {
      const ficha = (dbClientes[trainerKey] || []).find(c => c.id === clienteId);
      if (!ficha) throw new Error('Cliente no encontrado: ' + clienteId);
      mutador(ficha);
    }
    function reemplazarClientesArray(trainerKey, nuevoArray) { dbClientes[trainerKey] = nuevoArray; }
    return { guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda, editarCliente, reemplazarClientesArray };
  `,
  );
  return sandbox(window_, firebase_, console);
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8085 },
  });

  // ============================================================
  console.log('\n=== TEST A: mismo objeto, orden de claves distinto => IGUAL ===');
  // ============================================================
  {
    const local = { a: 1, b: 2 };
    const remoto = { b: 2, a: 1 };
    check('TEST A: igualdadCanonica({a,b}, {b,a}) === true', unitSandbox.igualdadCanonica(local, remoto) === true);
    check('TEST A: JSON.stringify crudo SÍ los distinguiría (confirma que el caso es real)', JSON.stringify(local) !== JSON.stringify(remoto));
  }

  // ============================================================
  console.log('\n=== TEST B: objetos anidados, mismo valor, orden de inserción distinto => IGUAL ===');
  // ============================================================
  {
    const local = { cliente: { nombre: 'X', contacto: { tel: '1', email: 'a@x.com' } } };
    const remoto = { cliente: { contacto: { email: 'a@x.com', tel: '1' }, nombre: 'X' } };
    check('TEST B: igualdadCanonica anidado === true', unitSandbox.igualdadCanonica(local, remoto) === true);
    check('TEST B: JSON.stringify crudo SÍ los distinguiría', JSON.stringify(local) !== JSON.stringify(remoto));
  }

  // ============================================================
  console.log('\n=== TEST C: array de objetos con claves internas reordenadas, ORDEN del array intacto => IGUAL ===');
  // ============================================================
  {
    const local = [{ id: 'x', nombre: 'A' }, { id: 'y', nombre: 'B' }];
    const remoto = [{ nombre: 'A', id: 'x' }, { nombre: 'B', id: 'y' }];
    check('TEST C: igualdadCanonica(array con claves internas reordenadas) === true', unitSandbox.igualdadCanonica(local, remoto) === true);
  }

  // ============================================================
  console.log('\n=== TEST D: mismo array, ORDEN de elementos cambiado => DIFERENCIA REAL ===');
  // ============================================================
  {
    const local = [{ id: 'x', nombre: 'A' }, { id: 'y', nombre: 'B' }];
    const remoto = [{ id: 'y', nombre: 'B' }, { id: 'x', nombre: 'A' }];
    check('TEST D: igualdadCanonica([A,B], [B,A]) === false (el orden del array SÍ importa)', unitSandbox.igualdadCanonica(local, remoto) === false);
  }

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('pta@x.com').set({ nombre: 'PT A', rol: 'pt', trainerKey: 'pta', activo: true, email: 'pta@x.com' });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ nombre: 'PT B', rol: 'pt', trainerKey: 'ptb', activo: true, email: 'ptb@x.com' });
    await db.collection('besoulSuite').doc('agenda').set({
      clientes: {
        pta: [{ id: 'ca1', nombre: 'Cliente A1', telefono: '600000001', notas: 'v0' }],
        ptb: [{ id: 'cb1', nombre: 'Cliente B1' }],
      },
      agenda: { pta: {}, ptb: {} }, pruebasCRM: { pta: {}, ptb: {} },
      disponibilidadReservas: { pta: {}, ptb: {} }, historicoClientes: { pta: {}, ptb: {} }, notas: {},
    });
  });

  // ============================================================
  console.log('\n=== TEST E: cambio REAL de contenido en clientes (mismo trainer) => CONFLICT ===');
  // ============================================================
  {
    const ctxA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const ctxB = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefA = ctxA.collection('besoulSuite').doc('agenda');
    const docRefB = ctxB.collection('besoulSuite').doc('agenda');
    const seed = { clientes: { pta: [{ id: 'ca1', nombre: 'Cliente A1', telefono: '600000001', notas: 'v0' }] } };
    const A = crearPestana(ctxA, docRefA, seed, 'pt', 'pta');
    const B = crearPestana(ctxB, docRefB, seed, 'pt', 'pta');
    const snap = (await docRefA.get()).data();
    A.aplicarEstadoNubeAgenda(snap); B.aplicarEstadoNubeAgenda(snap);
    A.editarCliente('pta', 'ca1', (c) => { c.notas = 'cambiado de verdad por A'; });
    const rA = await A.guardarEstadoNubeAgenda('pta');
    B.editarCliente('pta', 'ca1', (c) => { c.telefono = '699999999'; }); // cambio real, distinto
    const rB = await B.guardarEstadoNubeAgenda('pta');
    check('TEST E: A guarda -> ok:true', rA.ok === true);
    check('TEST E: B, sobre una base ya obsoleta por un cambio REAL de A -> CONFLICT', rB.ok === false && rB.err && rB.err.code === 'conflict');
  }

  // ============================================================
  console.log('\n=== TEST F: cambio REAL en agenda (mismo trainer) => CONFLICT ===');
  // ============================================================
  {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await adminCtx.firestore().collection('besoulSuite').doc('agenda').update({ 'agenda.pta': {} });
    });
    const ctxA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const ctxB = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefA = ctxA.collection('besoulSuite').doc('agenda');
    const docRefB = ctxB.collection('besoulSuite').doc('agenda');
    const seed = { agenda: { pta: {} } };
    const A = crearPestana(ctxA, docRefA, seed, 'pt', 'pta');
    const B = crearPestana(ctxB, docRefB, seed, 'pt', 'pta');
    const snap = (await docRefA.get()).data();
    A.aplicarEstadoNubeAgenda(snap); B.aplicarEstadoNubeAgenda(snap);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      // Simula la escritura real de A sobre "agenda" fuera del sandbox (el sandbox no expone un
      // mutador de dbAgenda; el objetivo de este test es solo la RUTA "agenda", no cómo la UI la
      // edita) -- equivalente a que A guarde una cita nueva.
      await ctx.firestore().collection('besoulSuite').doc('agenda').update({ 'agenda.pta': { '2026-10-01_10:00': { id: 'ca1', nombre: 'Cliente A1' } } });
    });
    const rB = await B.guardarEstadoNubeAgenda('pta');
    check('TEST F: B, sobre "agenda" ya cambiada de verdad -> CONFLICT', rB.ok === false && rB.err && rB.err.code === 'conflict');
  }

  // ============================================================
  console.log('\n=== TEST G: cambio en OTRO trainerKey => NO CONFLICT (scope propio intacto) ===');
  // ============================================================
  {
    const ctxA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefA = ctxA.collection('besoulSuite').doc('agenda');
    const seed = { clientes: { pta: [{ id: 'ca1', nombre: 'Cliente A1' }] } };
    const A = crearPestana(ctxA, docRefA, seed, 'pt', 'pta');
    const snap = (await docRefA.get()).data();
    A.aplicarEstadoNubeAgenda(snap);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('besoulSuite').doc('agenda').update({ 'clientes.ptb': [{ id: 'cb1', nombre: 'Cliente B1 cambiado' }] });
    });
    A.editarCliente('pta', 'ca1', (c) => { c.notas = 'edición legítima de A'; });
    const rA = await A.guardarEstadoNubeAgenda('pta');
    check('TEST G: cambio real en OTRO trainerKey (ptb) NUNCA bloquea el guardado de pta', rA.ok === true);
  }

  // ============================================================
  console.log('\n=== TEST H: dos sesiones reales, misma versión N, A guarda, B (sobre N) => CONFLICT ===');
  // ============================================================
  {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await adminCtx.firestore().collection('besoulSuite').doc('agenda').update({ 'clientes.pta': [{ id: 'ca1', nombre: 'Cliente A1', notas: 'N' }] });
    });
    const ctxA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const ctxB = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefA = ctxA.collection('besoulSuite').doc('agenda');
    const docRefB = ctxB.collection('besoulSuite').doc('agenda');
    const seedN = { clientes: { pta: [{ id: 'ca1', nombre: 'Cliente A1', notas: 'N' }] } };
    const A = crearPestana(ctxA, docRefA, seedN, 'pt', 'pta');
    const B = crearPestana(ctxB, docRefB, seedN, 'pt', 'pta');
    const snapN = (await docRefA.get()).data();
    A.aplicarEstadoNubeAgenda(snapN); B.aplicarEstadoNubeAgenda(snapN);
    A.editarCliente('pta', 'ca1', (c) => { c.notas = 'N+1 real, escrito por A'; });
    const rA = await A.guardarEstadoNubeAgenda('pta');
    B.editarCliente('pta', 'ca1', (c) => { c.notas = 'intento de B, todavía sobre N'; });
    const rB = await B.guardarEstadoNubeAgenda('pta');
    check('TEST H: A guarda -> ok:true', rA.ok === true);
    check('TEST H: B, todavía sobre N -> CONFLICT DETECTED', rB.ok === false && rB.err && rB.err.code === 'conflict');
  }

  // ============================================================
  console.log('\n=== TEST I: dos guardados consecutivos, MISMA pestaña => AMBOS OK ===');
  // ============================================================
  {
    const ctxA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
    const docRefA = ctxA.collection('besoulSuite').doc('agenda');
    const seed = { clientes: { pta: [{ id: 'ca1', nombre: 'Cliente A1' }] } };
    const A = crearPestana(ctxA, docRefA, seed, 'pt', 'pta');
    A.aplicarEstadoNubeAgenda((await docRefA.get()).data());
    A.editarCliente('pta', 'ca1', (c) => { c.notas = 'edición 1'; });
    const r1 = await A.guardarEstadoNubeAgenda('pta');
    A.editarCliente('pta', 'ca1', (c) => { c.notas = 'edición 2, inmediatamente después'; });
    const r2 = await A.guardarEstadoNubeAgenda('pta');
    check('TEST I: guardado #1 -> ok:true', r1.ok === true);
    check('TEST I: guardado #2 inmediatamente consecutivo -> ok:true', r2.ok === true);
  }

  // ============================================================
  console.log('\n=== TEST J: forma EXACTA capturada en producción (rawEqual:false, canonicalEqual:true, structuralDiff:[] en 4 campos a la vez) => SAVE DEBE TENER ÉXITO ===');
  // ============================================================
  {
    // Reconstruye, para clientes/agenda/disponibilidadReservas/historicoClientes, un par
    // local/remoto con EXACTAMENTE el mismo contenido pero orden de claves distinto -- la forma
    // real capturada en [BESOUL_SAVE_CONFLICT_JSON] (trainerScope 'fran').
    const clienteLocal = { id: 'ca1', nombre: 'Cliente A1', telefono: '600000001', notas: 'x', tipo: 'individual' };
    const clienteRemoto = { tipo: 'individual', notas: 'x', telefono: '600000001', nombre: 'Cliente A1', id: 'ca1' };
    const agendaLocal = { '2026-10-01_10:00': { id: 'ca1', nombre: 'Cliente A1', modalidad: 'personal' } };
    const agendaRemoto = { '2026-10-01_10:00': { modalidad: 'personal', nombre: 'Cliente A1', id: 'ca1' } };
    const dispLocal = { semanal: { 1: { activo: true, bloques: [] } }, excepciones: {}, bloqueos: {}, recurrenteSemanal: true };
    const dispRemoto = { recurrenteSemanal: true, bloqueos: {}, excepciones: {}, semanal: { 1: { bloques: [], activo: true } } };
    const histLocal = { ca1: { '2026-09': { clienteId: 'ca1', mes: '2026-09', sesionesAgendadas: 2 } } };
    const histRemoto = { ca1: { '2026-09': { sesionesAgendadas: 2, mes: '2026-09', clienteId: 'ca1' } } };

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('besoulSuite').doc('agenda').set({
        clientes: { fran: [clienteRemoto] },
        agenda: { fran: agendaRemoto },
        pruebasCRM: { fran: {} },
        disponibilidadReservas: { fran: dispRemoto },
        historicoClientes: { fran: histRemoto },
        notas: {},
      });
    });

    const ctxFran = testEnv.authenticatedContext('uid_fran', { email: 'fran@x.com' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('besoulUsers').doc('fran@x.com').set({ nombre: 'Fran', rol: 'pt', trainerKey: 'fran', activo: true, email: 'fran@x.com' });
    });
    const firestoreFran = ctxFran.firestore();
    const docRef = firestoreFran.collection('besoulSuite').doc('agenda');
    const seedLocal = {
      clientes: { fran: [clienteLocal] }, agenda: { fran: agendaLocal }, pruebasCRM: { fran: {} },
      disponibilidadReservas: { fran: dispLocal }, historicoClientes: { fran: histLocal },
    };
    const Fran = crearPestana(firestoreFran, docRef, seedLocal, 'pt', 'fran');
    // El baseline de "Fran" se fija a la versión LOCAL (orden de claves distinto del servidor) --
    // exactamente la condición de partida real: la pestaña sincronizó una forma, el servidor
    // tiene la MISMA información con otro orden de claves (nunca un cambio de contenido real).
    Fran.aplicarEstadoNubeAgenda({
      clientes: { fran: [clienteLocal] }, agenda: { fran: agendaLocal }, pruebasCRM: { fran: {} },
      disponibilidadReservas: { fran: dispLocal }, historicoClientes: { fran: histLocal },
    });
    // Edición real y legítima de Fran (no relacionada con el reordenamiento de claves).
    Fran.editarCliente('fran', 'ca1', (c) => { c.notas = 'edición real de Fran'; });
    const resultado = await Fran.guardarEstadoNubeAgenda('fran');
    check('TEST J: guardado sobre la forma EXACTA de producción (solo orden de claves distinto) -> ok:true, NO conflict', resultado.ok === true);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) { console.log('Failures:', fails); process.exitCode = 1; }
  await testEnv.cleanup();
}

main().catch((err) => { console.error('ERROR EJECUTANDO LA SUITE:', err); process.exitCode = 1; });
