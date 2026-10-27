// REFORMA-FINANZAS: reglas de besoulFinanzasMeses/{AAAA-MM} con el emulador y las reglas REALES de
// firestore.rules (preparadas, sin publicar). Las operaciones válidas se hacen con el mismo módulo que usa
// Finanzas (besoul-finanzas-real.js → ejecutarOperacion); las inválidas, con escrituras directas que
// imitan a un cliente antiguo, manipulado o desfasado. Nunca toca Firestore real (projectId demo-…).
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_finanzas_meses_tests.cjs"
// (el emulador debe escuchar en 127.0.0.1:8080, como run_tests.cjs)
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebaseCompat = require('firebase/compat/app');
require('firebase/compat/firestore');
const FR = require(path.join(__dirname, '..', 'besoul-finanzas-real.js'));

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
const ADMIN = 'admin@x.com', ADMIN_INACTIVO = 'admin2@x.com', PT = 'pt@x.com';
const COL = 'besoulFinanzasMeses';

let pass = 0, fail = 0;
const fails = [];
async function checkOk(desc, promise) {
  try { await assertSucceeds(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba PERMITIDO, fue DENEGADO (${String(e.message).split('\n')[0]})`); }
}
async function checkDenied(desc, promise) {
  try { await assertFails(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba DENEGADO, fue PERMITIDO`); }
}
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(desc); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await testEnv.clearFirestore();
  const FV = firebaseCompat.firestore.FieldValue, FP = firebaseCompat.firestore.FieldPath;
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc(ADMIN).set({ nombre: 'Admin', rol: 'admin', activo: true, email: ADMIN });
    await db.collection('besoulUsers').doc(ADMIN_INACTIVO).set({ nombre: 'Admin baja', rol: 'admin', activo: false, email: ADMIN_INACTIVO });
    await db.collection('besoulUsers').doc(PT).set({ nombre: 'PT', rol: 'pt', trainerKey: 'pt', activo: true, email: PT });
  });
  const admin = testEnv.authenticatedContext('uid_admin', { email: ADMIN }).firestore();
  const adminBaja = testEnv.authenticatedContext('uid_admin2', { email: ADMIN_INACTIVO }).firestore();
  const pt = testEnv.authenticatedContext('uid_pt', { email: PT }).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();
  const op = (db, mes, o, ctx = {}) => FR.ejecutarOperacion({ firestore: db, FieldValue: FV, FieldPath: FP, mes, op: o, ctx: { actor: ADMIN, ...ctx } });
  const leer = async mes => { let d; await testEnv.withSecurityRulesDisabled(async c => { d = (await c.firestore().collection(COL).doc(mes).get()).data(); }); return d; };
  const cobro = { trainerKey: 'eu', centroId: 'inacua', fecha: '2026-10-05', importe: 200, estado: 'confirmado' };

  // ---- creación y escritura normal (admin, mismo código que la página)
  await checkOk('admin crea el mes con el primer cobro', op(admin, '2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: cobro }));
  await checkOk('admin añade un segundo cobro (escritura dirigida, rev+1)', op(admin, '2026-10', { tipo: 'crear', coleccion: 'ingresosEntrenadores', datos: { ...cobro, fecha: '2026-10-20', importe: 150 } }));
  const d1 = await leer('2026-10');
  check('documento con rev 2 y dos cobros', [d1.rev, Object.keys(d1.ingresosEntrenadores).length, d1.estado], [2, 2, 'abierto']);
  const id1 = Object.keys(d1.ingresosEntrenadores)[0];
  await checkOk('admin edita un cobro', op(admin, '2026-10', { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: id1, datos: { observaciones: 'pagado por transferencia' } }));
  await checkOk('admin anula un cobro', op(admin, '2026-10', { tipo: 'anular', coleccion: 'ingresosEntrenadores', id: id1, motivo: 'error' }));
  await checkOk('admin registra un gasto de centro', op(admin, '2026-10', { tipo: 'crear', coleccion: 'gastosCentros', datos: { centroId: 'inacua', fecha: '2026-10-01', concepto: 'Alquiler', importe: 500 } }));

  // ---- acceso
  await checkDenied('PT no lee meses de Finanzas', pt.collection(COL).doc('2026-10').get());
  await checkDenied('PT no lista meses de Finanzas', pt.collection(COL).get());
  await checkDenied('PT no crea un mes', pt.collection(COL).doc('2026-11').set({ mes: '2026-11', estado: 'abierto', rev: 1, actualizadoEn: FV.serverTimestamp() }));
  await checkDenied('PT no modifica un mes', pt.collection(COL).doc('2026-10').update({ rev: 6, actualizadoEn: FV.serverTimestamp() }));
  await checkDenied('sin sesión: ni lectura ni escritura', anon.collection(COL).doc('2026-10').get());
  await checkDenied('admin con acceso retirado (activo:false) no lee', adminBaja.collection(COL).doc('2026-10').get());
  await checkOk('admin activo lee el mes', admin.collection(COL).doc('2026-10').get());

  // ---- forma del documento y concurrencia
  const ref = admin.collection(COL).doc('2026-10');
  const rev = (await leer('2026-10')).rev;
  await checkDenied('rev desfasada (escritura de una pestaña antigua) rechazada', ref.update({ rev, actualizadoEn: FV.serverTimestamp(), 'gastos.x': { importe: 1 } }));
  await checkDenied('rev que salta (+2) rechazada', ref.update({ rev: rev + 2, actualizadoEn: FV.serverTimestamp() }));
  await checkDenied('hora del cliente en actualizadoEn rechazada', ref.update({ rev: rev + 1, actualizadoEn: new Date() }));
  await checkDenied('campo desconocido rechazado (p. ej. un canon automático)', ref.update({ rev: rev + 1, actualizadoEn: FV.serverTimestamp(), canones: { inacua: 2223.32 } }));
  await checkDenied('no se puede cambiar el mes del documento', ref.update({ rev: rev + 1, actualizadoEn: FV.serverTimestamp(), mes: '2026-09' }));
  await checkDenied('crear con id de mes no válido', admin.collection(COL).doc('octubre').set({ mes: 'octubre', estado: 'abierto', rev: 1, actualizadoEn: FV.serverTimestamp() }));
  await checkDenied('crear con rev distinta de 1', admin.collection(COL).doc('2026-12').set({ mes: '2026-12', estado: 'abierto', rev: 5, actualizadoEn: FV.serverTimestamp() }));
  await checkDenied('crear un mes directamente cerrado', admin.collection(COL).doc('2026-12').set({ mes: '2026-12', estado: 'cerrado', rev: 1, actualizadoEn: FV.serverTimestamp(), cierre: { snapshot: {} } }));
  await checkDenied('no se puede borrar un mes', ref.delete());
  await checkDenied('abierto: no se puede inventar una fotografía de cierre', ref.update({ rev: rev + 1, actualizadoEn: FV.serverTimestamp(), cierre: { cerradoPor: ADMIN, cerradoEn: FV.serverTimestamp(), snapshot: {} } }));
  await checkDenied('abierto → cerrado directamente (sin revisar) rechazado', ref.update({ rev: rev + 1, actualizadoEn: FV.serverTimestamp(), estado: 'cerrado', cierre: { cerradoPor: ADMIN, cerradoEn: FV.serverTimestamp(), snapshot: {} } }));

  // ---- revisión
  await checkDenied('revisar a nombre de otro usuario rechazado', ref.update({ rev: rev + 1, actualizadoEn: FV.serverTimestamp(), estado: 'revisado', revision: { por: 'otro@x.com', en: FV.serverTimestamp() } }));
  await checkDenied('revisar y a la vez cambiar un registro rechazado', ref.update({ rev: rev + 1, actualizadoEn: FV.serverTimestamp(), estado: 'revisado', revision: { por: ADMIN, en: FV.serverTimestamp() }, 'gastos.x': { importe: 1 } }));
  await checkOk('admin marca revisado (módulo)', op(admin, '2026-10', { tipo: 'revisar' }, { legadoPendiente: false }));
  const r2 = (await leer('2026-10')).rev;
  await checkDenied('revisado: no admite cambios de registros (escritura directa)', ref.update({ rev: r2 + 1, actualizadoEn: FV.serverTimestamp(), 'gastos.x': { importe: 1, concepto: 'x' } }));
  await checkOk('revisado → abierto (módulo)', op(admin, '2026-10', { tipo: 'volverAbierto' }));
  await checkOk('abierto → revisado otra vez', op(admin, '2026-10', { tipo: 'revisar' }, { legadoPendiente: false }));

  // ---- cierre
  const doc = FR.normalizarDocMes(await leer('2026-10'), '2026-10');
  const snapshot = FR.construirSnapshot({ mes: '2026-10', doc, legado: null, especiales: { empleados: [], actividades: [] }, estadistica: { total: { facturacion: 1000 } }, modelo: 'registro_real' });
  const r3 = (await leer('2026-10')).rev;
  await checkDenied('cerrar sin fotografía rechazado', ref.update({ rev: r3 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'cerrado', cierre: { cerradoPor: ADMIN, cerradoEn: FV.serverTimestamp() } }));
  await checkDenied('cerrar con hora del cliente rechazado', ref.update({ rev: r3 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'cerrado', cierre: { cerradoPor: ADMIN, cerradoEn: new Date(), snapshot: {} } }));
  await checkOk('admin cierra con fotografía (módulo)', op(admin, '2026-10', { tipo: 'cerrar', snapshot }));
  const cerrado = await leer('2026-10');
  check('cerrado: estado, autor y resultado congelado', [cerrado.estado, cerrado.cierre.cerradoPor, cerrado.cierre.snapshot.resumen.resultado], ['cerrado', ADMIN, snapshot.resumen.resultado]);
  const r4 = cerrado.rev;
  const refC = admin.collection(COL).doc('2026-10');
  await checkDenied('cerrado: un admin no puede añadir un gasto (escritura directa, p. ej. versión antigua)', refC.update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), 'gastos.nuevo': { importe: 5, concepto: 'x' } }));
  await checkDenied('cerrado: no se puede editar un cobro', refC.update(new FP('ingresosEntrenadores', id1, 'importe'), 1, 'rev', r4 + 1, 'actualizadoEn', FV.serverTimestamp()));
  await checkDenied('cerrado: no se puede reescribir la fotografía', refC.update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), 'cierre.snapshot': {} }));
  await checkDenied('cerrado: no se puede sobrescribir el documento entero', refC.set({ mes: '2026-10', estado: 'abierto', rev: r4 + 1, actualizadoEn: FV.serverTimestamp() }));
  await checkDenied('cerrado → revisado no permitido', refC.update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'revisado' }));
  let error = null;
  try { await op(admin, '2026-10', { tipo: 'crear', coleccion: 'gastos', datos: { categoria: 'Otros', concepto: 'x', fecha: '2026-10-09', importe: 1 } }); } catch (e) { error = e.code || e.message; }
  check('cerrado: el módulo lo rechaza antes de escribir', error, 'mes-cerrado');

  // ---- reapertura
  await checkDenied('reabrir sin motivo rechazado', refC.update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'abierto', ultimaReapertura: { por: ADMIN, en: FV.serverTimestamp(), motivo: 'no' } }));
  await checkDenied('reabrir a nombre de otro rechazado', refC.update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'abierto', ultimaReapertura: { por: 'otro@x.com', en: FV.serverTimestamp(), motivo: 'Corregir un cobro' } }));
  await checkDenied('reabrir y a la vez cambiar un registro rechazado', refC.update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'abierto', ultimaReapertura: { por: ADMIN, en: FV.serverTimestamp(), motivo: 'Corregir un cobro' }, 'gastos.x': { importe: 1 } }));
  await checkDenied('PT no puede reabrir', pt.collection(COL).doc('2026-10').update({ rev: r4 + 1, actualizadoEn: FV.serverTimestamp(), estado: 'abierto', ultimaReapertura: { por: PT, en: FV.serverTimestamp(), motivo: 'Corregir un cobro' } }));
  await checkOk('admin reabre con motivo (módulo)', op(admin, '2026-10', { tipo: 'reabrir', motivo: 'Corregir un cobro mal registrado' }));
  const reab = await leer('2026-10');
  check('reabierto: motivo, autor, historial y fotografía anterior conservada', [reab.estado, reab.ultimaReapertura.por, reab.ultimaReapertura.motivo, reab.historialEstados.length, !!reab.cierre.snapshot], ['abierto', ADMIN, 'Corregir un cobro mal registrado', 5, true]);
  const id2 = Object.keys(d1.ingresosEntrenadores).find(k => k !== id1);
  await checkOk('reabierto: vuelve a admitir cambios', op(admin, '2026-10', { tipo: 'editar', coleccion: 'ingresosEntrenadores', id: id2, datos: { observaciones: 'corregido' } }));

  // ---- importación de heredados y otros meses independientes
  await checkOk('traspaso de heredados en noviembre (crea el mes)', op(admin, '2026-11', { tipo: 'importarLegado', legado: { gastos: [{ categoria: 'Software', concepto: 'Licencia', importe: 40 }], otrosIngresos: [] } }));
  const nov = await leer('2026-11');
  check('noviembre independiente de octubre', [nov.rev, Object.keys(nov.gastos), nov.legadoImportado && !!nov.legadoImportado.en], [1, ['her_gas_202611_0'], true]);
  check('octubre no cambia por noviembre', (await leer('2026-10')).rev, reab.rev + 1);

  await testEnv.cleanup();
  console.log(`\n${pass} PASS · ${fail} FAIL`);
  if (fail) { console.log('Fallos:\n - ' + fails.join('\n - ')); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
