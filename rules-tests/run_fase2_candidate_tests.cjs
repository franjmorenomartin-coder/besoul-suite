// HARDENING-PRE-BASELINE-v3.2.1 -- Section 19: determina FASE2_READY empíricamente, contra el
// Emulator Suite real, NUNCA solo por lectura de código. Construye en memoria la variante FASE 2
// del bloque besoulSuite/{docId} ya escrita y comentada en firestore.rules (activándola tal cual
// está, sin reescribirla) -- el archivo real del repo NO se toca; esto es un candidato de prueba.
//
// Ejecutar (desde la raiz del repo):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_fase2_candidate_tests.cjs"

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

function construirRulesConFase2Activa() {
  const original = fs.readFileSync(RULES_PATH, 'utf8');
  const lineaActual = `      allow read, write: if isActiveUser() && docId == 'agenda';`;
  if (!original.includes(lineaActual)) throw new Error('No se encontró la línea activa esperada de besoulSuite/agenda -- firestore.rules ha cambiado desde que se escribió este test, revisar antes de confiar en el resultado.');

  // Descomenta EXACTAMENTE el bloque ya escrito en el propio archivo (líneas 144-156), quitando
  // solo el prefijo "// " de cada línea de regla -- no se reescribe ninguna condición a mano.
  const bloqueComentadoRe = /\/\/ allow read: if isActiveUser\(\) && docId == 'agenda';\r?\n([\s\S]*?)\/\/ \);/;
  const m = bloqueComentadoRe.exec(original);
  if (!m) throw new Error('No se encontró el bloque FASE 2 comentado -- revisar firestore.rules.');
  const bloqueDescomentado = original.slice(m.index, m.index + m[0].length)
    .split(/\r?\n/)
    .map(l => l.replace(/^(\s*)\/\/ ?/, '$1'))
    .join('\n');

  return original.replace(lineaActual, bloqueDescomentado);
}

let pass = 0, fail = 0;
const fails = [];
async function checkOk(desc, promise) {
  try { await assertSucceeds(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba PERMITIDO, fue DENEGADO`); }
}
async function checkDenied(desc, promise) {
  try { await assertFails(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc); console.log(`FAIL -- ${desc} :: esperaba DENEGADO, fue PERMITIDO`); }
}

async function main() {
  const rulesFase2 = construirRulesConFase2Activa();
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: rulesFase2, host: '127.0.0.1', port: 8080 },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('pta@x.com').set({ nombre: 'PT A', rol: 'pt', trainerKey: 'pta', activo: true, email: 'pta@x.com' });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ nombre: 'PT B', rol: 'pt', trainerKey: 'ptb', activo: true, email: 'ptb@x.com' });
    await db.collection('besoulUsers').doc('admin@x.com').set({ nombre: 'Admin', rol: 'admin', trainerKey: 'admin', activo: true, email: 'admin@x.com' });
    await db.collection('besoulSuite').doc('agenda').set({
      clientes: { pta: [{ id: 'ca1', nombre: 'Cliente de A' }], ptb: [{ id: 'cb1', nombre: 'Cliente de B' }] },
      agenda: { pta: {}, ptb: {} }, pruebasCRM: { pta: {}, ptb: {} },
      disponibilidadReservas: { pta: {}, ptb: {} }, historicoClientes: { pta: {}, ptb: {} }, notas: {},
    });
  });

  const ptA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
  const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();

  console.log('\n=== FASE 2 candidata: el HALLAZGO P0 queda cerrado ===');
  await checkDenied(
    'FASE2: PT A YA NO puede escribir clientes.ptb (el hallazgo P0 de la auditoría queda cerrado)',
    ptA.collection('besoulSuite').doc('agenda').update({ 'clientes.ptb': [{ id: 'hackeado' }] })
  );

  console.log('\n=== FASE 2 candidata: los escritores REALES (payload dirigido, FieldPath-safe) siguen funcionando ===');
  // Reproduce EXACTAMENTE la forma del payload que payloadParaUpdateFirestore()/
  // guardarEstadoNubeAgenda() ya envían hoy en producción (ruta punteada dirigida a la propia
  // trainerKey) -- no una aproximación.
  await checkOk(
    'FASE2: PT A sigue pudiendo escribir su propia clientes.pta (payload real de guardarEstadoNubeAgenda)',
    ptA.collection('besoulSuite').doc('agenda').update({
      'clientes.pta': [{ id: 'ca1', nombre: 'Editado por A, payload real' }],
      'agenda.pta': {}, 'pruebasCRM.pta': {}, 'disponibilidadReservas.pta': {}, 'historicoClientes.pta': {},
      notas: {}, ultimaActualizacionLocal: new Date().toISOString(),
    })
  );
  await checkOk(
    'FASE2: ADMIN conserva escritura TOTAL (viendo-como cualquier PT), sin cambio de comportamiento',
    admin.collection('besoulSuite').doc('agenda').update({ 'clientes.ptb': [{ id: 'cb1', nombre: 'Editado por admin viendo-como B' }] })
  );
  await checkOk(
    'FASE2: lectura del documento completo NO cambia (sigue siendo por-documento, no por-trainer -- limitación arquitectónica ya documentada, no la resuelve FASE 2)',
    ptA.collection('besoulSuite').doc('agenda').get()
  );

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); }
  console.log(`\nFASE2_READY = ${fail === 0 ? 'YES' : 'NO'}`);

  await testEnv.cleanup();
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
