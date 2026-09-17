// HARDENING-PRE-BASELINE-v3.2.1 (continuación, 2026-09-17) -- Section 6: matriz exhaustiva de
// aislamiento por trainerKey en besoulSuite/agenda, contra el firestore.rules REAL del repo (FASE
// 2 ya activada aquí, no una construcción en memoria -- reemplaza a run_fase2_candidate_tests.cjs,
// cuyo trabajo terminó en cuanto el bloque comentado que manipulaba pasó a ser el bloque real).
//
// Ejecutar (desde la raiz del repo):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_fase2_tests.cjs"

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

let pass = 0, fail = 0;
const fails = [];
async function checkOk(desc, promise) {
  try { await assertSucceeds(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba ALLOW, fue DENY`); }
}
async function checkDenied(desc, promise) {
  try { await assertFails(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba DENY, fue ALLOW`); }
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8080 },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('pta@x.com').set({ rol: 'pt', trainerKey: 'pta', activo: true });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ rol: 'pt', trainerKey: 'ptb', activo: true });
    await db.collection('besoulUsers').doc('ptinactivo@x.com').set({ rol: 'pt', trainerKey: 'ptinactivo', activo: false });
    await db.collection('besoulUsers').doc('admin@x.com').set({ rol: 'admin', trainerKey: 'admin', activo: true });
    await db.collection('besoulSuite').doc('agenda').set({
      clientes: { pta: [{ id: 'ca1' }], ptb: [{ id: 'cb1' }] },
      agenda: { pta: {}, ptb: {} },
      pruebasCRM: { pta: {}, ptb: {} },
      disponibilidadReservas: { pta: {}, ptb: {} },
      historicoClientes: { pta: {}, ptb: {} },
      notas: {},
    });
  });

  const ptA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
  const ptInactivo = testEnv.authenticatedContext('uid_ptinactivo', { email: 'ptinactivo@x.com' }).firestore();
  const sinPerfil = testEnv.authenticatedContext('uid_sinperfil', { email: 'sinperfil@x.com' }).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();
  const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();

  // ============================================================
  console.log('\n=== Matriz por campo: PT A modifica SU PROPIO trainerKey -> ALLOW ===');
  // ============================================================
  const CAMPOS = ['clientes', 'agenda', 'disponibilidadReservas', 'historicoClientes', 'pruebasCRM'];
  for (const campo of CAMPOS) {
    await checkOk(`PT A modifica ${campo}.pta (propio) -> ALLOW`, ptA.collection('besoulSuite').doc('agenda').update({ [`${campo}.pta`]: campo === 'clientes' ? [{ id: 'ca1', v: 'editado' }] : { v: 'editado' } }));
  }

  // ============================================================
  console.log('\n=== Matriz por campo: PT A modifica el trainerKey de OTRO (PT B) -> DENY ===');
  // ============================================================
  for (const campo of CAMPOS) {
    await checkDenied(`PT A modifica ${campo}.ptb (ajeno) -> DENY`, ptA.collection('besoulSuite').doc('agenda').update({ [`${campo}.ptb`]: campo === 'clientes' ? [{ id: 'hackeado' }] : { hackeado: true } }));
  }

  // ============================================================
  console.log('\n=== Roles sin permiso, independientemente del campo ===');
  // ============================================================
  await checkDenied('PT INACTIVO -> DENY (clientes.ptinactivo, aunque fuera su propio trainerKey)', ptInactivo.collection('besoulSuite').doc('agenda').update({ 'clientes.ptinactivo': [{ id: 'x' }] }));
  await checkDenied('AUTH SIN PERFIL -> DENY', sinPerfil.collection('besoulSuite').doc('agenda').update({ 'clientes.pta': [{ id: 'x' }] }));
  await checkDenied('ANONYMOUS -> DENY', anon.collection('besoulSuite').doc('agenda').update({ 'clientes.pta': [{ id: 'x' }] }));

  // ============================================================
  console.log('\n=== ADMIN: acceso total, sin restricción de trainerKey ===');
  // ============================================================
  await checkOk('ADMIN modifica clientes.pta (de un PT) -> ALLOW', admin.collection('besoulSuite').doc('agenda').update({ 'clientes.pta': [{ id: 'ca1', v: 'editado por admin' }] }));
  await checkOk('ADMIN modifica clientes.ptb (de OTRO PT) -> ALLOW (viendo-como, sin restricción)', admin.collection('besoulSuite').doc('agenda').update({ 'clientes.ptb': [{ id: 'cb1', v: 'editado por admin viendo-como B' }] }));

  // ============================================================
  console.log('\n=== Payload REAL que ya envía guardarEstadoNubeAgenda() hoy en producción ===');
  // ============================================================
  // Forma exacta de estadoLocalAgendaParaNube()/payloadParaUpdateFirestore(): un único .update()
  // dirigido a los 5 campos de la propia trainerKey + notas (mapa plano completo) +
  // ultimaActualizacionLocal -- debe seguir permitido sin cambios tras activar FASE 2.
  await checkOk('payload real completo de guardarEstadoNubeAgenda() para el propio PT -> ALLOW', ptA.collection('besoulSuite').doc('agenda').update({
    'clientes.pta': [{ id: 'ca1', v: 'guardado real' }],
    'agenda.pta': {}, 'pruebasCRM.pta': {}, 'disponibilidadReservas.pta': {}, 'historicoClientes.pta': {},
    notas: {}, ultimaActualizacionLocal: new Date().toISOString(),
  }));
  await checkDenied('el MISMO payload pero con una de las 5 claves apuntando a OTRO trainerKey -> DENY (ninguna cuela)', ptA.collection('besoulSuite').doc('agenda').update({
    'clientes.pta': [{ id: 'ca1' }],
    'agenda.pta': {}, 'pruebasCRM.pta': {}, 'disponibilidadReservas.ptb': { hackeado: true }, 'historicoClientes.pta': {},
    notas: {}, ultimaActualizacionLocal: new Date().toISOString(),
  }));

  // ============================================================
  console.log('\n=== Lectura: SIN CAMBIO (limitación arquitectónica, no la resuelve FASE 2) ===');
  // ============================================================
  await checkOk('PT A sigue leyendo el documento COMPLETO (incluye datos de ptb) -- no es un bug de esta fase', ptA.collection('besoulSuite').doc('agenda').get());

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); }

  await testEnv.cleanup();
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
