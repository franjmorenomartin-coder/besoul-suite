// HARDENING-PRE-BASELINE-v3.2.1 (continuación) -- Section 4: prueba EMPÍRICA, no teórica, de si
// "notas" (mapa plano "trainerKey__clave", no anidado) se puede aislar por trainerKey en Rules SIN
// migración de esquema. El lenguaje de Firestore Rules (CEL) NO permite iterar con un predicado
// arbitrario sobre un set de tamaño dinámico como affectedKeys() de forma sencilla -- en vez de
// asumirlo, se prueba directamente contra el emulador con la construcción CEL más prometedora
// (list.all(k, k.matches(...))) y se registra el resultado real (compila o no, permite/deniega lo
// esperado o no). Esto NO se despliega -- es solo un archivo de reglas de prueba, descartable.

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite-notas-probe';

// Regla mínima y aislada (no el archivo completo) -- solo para esta pregunta puntual, evita
// arrastrar el resto de firestore.rules mientras se determina viabilidad.
const REGLA_CANDIDATA = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null && request.auth.token.email != null; }
    function getProfile() { return get(/databases/$(database)/documents/besoulUsers/$(request.auth.token.email)); }
    function isActiveUser() { return signedIn() && exists(/databases/$(database)/documents/besoulUsers/$(request.auth.token.email)) && getProfile().data.activo == true; }
    function isAdmin() { return isActiveUser() && getProfile().data.rol == 'admin'; }
    function myTrainerKey() { return getProfile().data.trainerKey; }

    match /besoulUsers/{email} {
      allow get: if true;
    }

    match /probeDoc/{docId} {
      allow read: if isActiveUser();
      allow write: if isAdmin() || (isActiveUser() &&
        request.resource.data.notas.diff(resource.data.notas).affectedKeys()
          .hasAll([]) &&
        request.resource.data.notas.diff(resource.data.notas).affectedKeys()
          .all(k, k.matches('^' + myTrainerKey() + '__.*'))
      );
    }
  }
}
`;

let pass = 0, fail = 0;
async function checkOk(desc, promise) {
  try { await assertSucceeds(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; console.log(`FAIL -- ${desc} :: ${e.message.split('\n')[0]}`); }
}
async function checkDenied(desc, promise) {
  try { await assertFails(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; console.log(`FAIL -- ${desc} :: esperaba DENEGADO, fue PERMITIDO`); }
}

async function main() {
  let testEnv;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: REGLA_CANDIDATA, host: '127.0.0.1', port: 8080 },
    });
  } catch (e) {
    console.log('RESULTADO: la regla candidata NI SIQUIERA COMPILA -- CEL/.all() sobre affectedKeys() no está soportado tal cual.');
    console.log('Detalle:', e.message.split('\n')[0]);
    console.log('\nNOTAS_AISLABLE_SIN_MIGRACION = NO');
    return;
  }

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('pta@x.com').set({ rol: 'pt', trainerKey: 'pta', activo: true });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ rol: 'pt', trainerKey: 'ptb', activo: true });
    await db.collection('probeDoc').doc('doc1').set({ notas: { 'pta__nota1': 'x', 'ptb__nota1': 'y' } });
  });

  const ptA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();

  await checkOk(
    'la regla candidata SÍ compila y arranca el emulador (buena señal inicial)',
    Promise.resolve()
  );
  await checkOk(
    'PT A puede tocar SU PROPIA nota (pta__...)',
    ptA.collection('probeDoc').doc('doc1').update({ 'notas.pta__nota2': 'nueva de A' })
  );
  await checkDenied(
    'PT A NO puede tocar la nota de PT B (ptb__...) -- esto es lo que se quiere confirmar',
    ptA.collection('probeDoc').doc('doc1').update({ 'notas.ptb__nota1': 'hackeado por A' })
  );

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  console.log(`\nNOTAS_AISLABLE_SIN_MIGRACION = ${fail === 0 ? 'YES' : 'NO (compiló pero no se comporta como se esperaba)'}`);
  await testEnv.cleanup();
}

main().catch(err => {
  console.log('RESULTADO: error al ejecutar la prueba de viabilidad.');
  console.log(err.message.split('\n')[0]);
  console.log('\nNOTAS_AISLABLE_SIN_MIGRACION = NO (no se pudo confirmar)');
});
