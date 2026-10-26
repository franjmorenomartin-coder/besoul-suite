// GESTION-ENTRENADORES: la retirada de acceso de un entrenador (besoulUsers/{email}.activo = false)
// es efectiva en el servidor, no solo en la interfaz. Con las reglas REALES de firestore.rules (sin
// cambios) y el emulador: lo que un PT activo puede leer y escribir de lo suyo, deja de poder hacerlo
// en cuanto su perfil queda inactivo; y no puede reactivarse a sí mismo. Nada se borra.
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_acceso_retirado_tests.cjs"
// (el emulador debe escuchar en 127.0.0.1:8080, como run_tests.cjs)
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebaseCompat = require('firebase/compat/app');
require('firebase/compat/firestore');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
const PT = 'ptbaja@x.com', TK = 'ptbaja';

let pass = 0, fail = 0;
const fails = [];
async function checkOk(desc, promise) {
  try { await assertSucceeds(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba PERMITIDO, fue DENEGADO (${e.message.split('\n')[0]})`); }
}
async function checkDenied(desc, promise) {
  try { await assertFails(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba DENEGADO, fue PERMITIDO`); }
}

const LECTURAS = [
  ['besoulAgendaSemanas', `${TK}__2026-10-05`],
  ['besoulClientes', `${TK}__c1`],
  ['besoulHistoricoClientes', `${TK}__h1`],
  ['besoulTrainers', TK],
  ['besoulNotas', `${TK}__2026-10-06_10:00`],
  ['besoulReservas', 'r1'],
  ['besoulSolicitudesEliminacion', 's1'],
  ['besoulNotifications', 'n1'],
  ['besoulLeads', 'l1'],
  ['besoulAgendaConfig', 'catalogo'],
];

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  const FV = firebaseCompat.firestore.FieldValue;
  const fijarActivo = activo => testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection('besoulUsers').doc(PT).set({ nombre: 'PT Baja', rol: 'pt', trainerKey: TK, activo, email: PT });
  });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const base = { trainerKey: TK, rev: 1, actualizadoEn: new Date() };
    await db.collection('besoulAgendaSemanas').doc(`${TK}__2026-10-05`).set({ ...base, semana: '2026-10-05', sesiones: {} });
    await db.collection('besoulClientes').doc(`${TK}__c1`).set({ ...base, ficha: { id: 'c1', estadoCliente: 'inactivo' } });
    await db.collection('besoulHistoricoClientes').doc(`${TK}__h1`).set({ ...base });
    await db.collection('besoulTrainers').doc(TK).set({ ...base, disponibilidad: {} });
    await db.collection('besoulNotas').doc(`${TK}__2026-10-06_10:00`).set({ ...base, clave: `${TK}__2026-10-06_10:00`, texto: 'x' });
    await db.collection('besoulReservas').doc('r1').set({ trainerKey: TK, estado: 'pendiente' });
    await db.collection('besoulSolicitudesEliminacion').doc('s1').set({ trainerKey: TK, estado: 'pendiente', solicitadoPor: TK });
    await db.collection('besoulNotifications').doc('n1').set({ audience: 'trainer', trainerKey: TK });
    await db.collection('besoulLeads').doc('l1').set({ trainerKey: TK, estado: 'nuevo' });
    await db.collection('besoulAgendaConfig').doc('catalogo').set({ rev: 1 });
  });
  await fijarActivo(true);
  const pt = testEnv.authenticatedContext('uid_ptbaja', { email: PT }).firestore();
  const actualizarTrainer = rev => pt.collection('besoulTrainers').doc(TK).update({ rev, actualizadoEn: FV.serverTimestamp(), disponibilidad: { semanal: {} } });

  console.log('=== 1. Con acceso (activo: true): lee y escribe lo suyo ===');
  for (const [col, id] of LECTURAS) await checkOk(`activo: lee ${col}/${id}`, pt.collection(col).doc(id).get());
  await checkOk('activo: actualiza su disponibilidad (besoulTrainers)', actualizarTrainer(2));

  console.log('\n=== 2. Acceso retirado (activo: false): todo denegado salvo leer su propio perfil ===');
  await fijarActivo(false);
  for (const [col, id] of LECTURAS) await checkDenied(`retirado: NO lee ${col}/${id}`, pt.collection(col).doc(id).get());
  await checkDenied('retirado: NO lista sus fichas (besoulClientes where trainerKey)', pt.collection('besoulClientes').where('trainerKey', '==', TK).get());
  await checkDenied('retirado: NO actualiza su disponibilidad', actualizarTrainer(3));
  await checkDenied('retirado: NO crea una semana de agenda', pt.collection('besoulAgendaSemanas').doc(`${TK}__2026-10-12`).set({ trainerKey: TK, semana: '2026-10-12', rev: 1, actualizadoEn: FV.serverTimestamp(), sesiones: {} }));
  await checkDenied('retirado: NO crea notificaciones', pt.collection('besoulNotifications').doc('n2').set({ audience: 'admin', trainerKey: TK }));
  await checkDenied('retirado: NO lee Finanzas', pt.collection('besoulSuite').doc('finanzas').get());
  await checkOk('retirado: puede leer SU perfil (la app detecta la retirada y cierra la sesión)', pt.collection('besoulUsers').doc(PT).get());
  await checkDenied('retirado: NO puede reactivarse (activo: true en su perfil)', pt.collection('besoulUsers').doc(PT).update({ activo: true }));
  await checkDenied('retirado: NO puede borrar su perfil', pt.collection('besoulUsers').doc(PT).delete());

  console.log('\n=== 3. Nada se borra: sus datos siguen en el servidor ===');
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [col, id] of LECTURAS) {
      const snap = await db.collection(col).doc(id).get();
      if (snap.exists) { pass++; console.log(`PASS -- conserva ${col}/${id}`); } else { fail++; fails.push(`conserva ${col}/${id}`); console.log(`FAIL -- conserva ${col}/${id}`); }
    }
  });

  console.log('\n=== 4. Reactivación por administración: vuelve a tener acceso ===');
  await fijarActivo(true);
  await checkOk('reactivado: vuelve a leer sus fichas', pt.collection('besoulClientes').doc(`${TK}__c1`).get());

  await testEnv.cleanup();
  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail) { console.log('FALLOS:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
}
main().catch(e => { console.error('ERROR EJECUTANDO TESTS:', e); process.exitCode = 1; });
