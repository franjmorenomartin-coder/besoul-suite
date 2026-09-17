// HARDENING-PRE-BASELINE-v3.2.1: prueba real de la detección de conflicto de concurrencia
// same-trainerKey en guardarEstadoNubeAgenda() (extraído verbatim de agenda.html), contra un mock
// fiel de Firestore (dotted-path + FieldPath + runTransaction con lecturas antes de escrituras,
// igual que el SDK real). Nunca toca Firestore real. Cubre exactamente los escenarios 18/19 de la
// matriz de tests pedida: concurrencia PT/PT (dos pestañas del mismo entrenador) y concurrencia
// Admin/PT (admin viendo-como + el propio PT editando a la vez).
const fs = require('fs');
const path = require('path');
const extracted = fs.readFileSync(path.join(__dirname, 'concurrency_extract.js'), 'utf8');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
class FieldPathFalso { constructor(...segmentos) { this.segmentos = segmentos; } }
class FieldValueFalso { constructor(metodo) { this._methodName = metodo; } }
FieldValueFalso.serverTimestamp = () => new FieldValueFalso('serverTimestamp');

function setEnRuta(obj, segmentos, valor) {
  let cursor = obj;
  for (let i = 0; i < segmentos.length - 1; i++) {
    if (typeof cursor[segmentos[i]] !== 'object' || cursor[segmentos[i]] === null) cursor[segmentos[i]] = {};
    cursor = cursor[segmentos[i]];
  }
  cursor[segmentos[segmentos.length - 1]] = deepClone(valor);
}

// Simula el servidor real de Firestore: estado propio, independiente de cualquier copia local.
function crearServidorFirestore(estadoInicial) {
  let estado = deepClone(estadoInicial);
  function aplicarCampo(campo, valor) {
    if (campo instanceof FieldPathFalso) { setEnRuta(estado, campo.segmentos, valor); return; }
    if (typeof campo === 'string' && campo.includes('.')) { setEnRuta(estado, campo.split('.'), valor); return; }
    estado[campo] = deepClone(valor);
  }
  function aplicarUpdate(args) {
    for (let i = 0; i < args.length; i += 2) aplicarCampo(args[i], args[i + 1]);
  }
  const firestoreInstance = {
    async runTransaction(fn) {
      // Igual que el SDK real para lo que este test necesita: la función recibe un snapshot
      // consistente en el momento de tx.get(), y cualquier tx.update() se aplica atómicamente
      // solo si la función no lanza. No se simula reintento automático por contención real
      // (aquí no hay escrituras concurrentes DENTRO de la misma llamada a runTransaction) --
      // lo que se prueba es que el propio callback detecta el conflicto y lanza.
      const tx = {
        async get(ref) { return { exists: estado !== null, data: () => deepClone(estado) }; },
        update(ref, ...args) { aplicarUpdate(args); },
      };
      return fn(tx);
    },
  };
  const ref = { firestore: firestoreInstance };
  return {
    ref,
    estadoActual() { return deepClone(estado); },
    // Simula que "otra sesión" escribe directamente en el servidor, fuera de esta transacción --
    // exactamente lo que representa una segunda pestaña/PT/admin guardando entre medias.
    escribirDesdeOtraSesion(campo, trainerKey, valor) {
      if (!estado[campo]) estado[campo] = {};
      estado[campo][trainerKey] = deepClone(valor);
    },
  };
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

function crearSesion({ docRef, dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes, dbNotas, bsUltimoServidorConocido, entrenadorVisto = '', rolActivo = 'pt' }) {
  const firebase = { firestore: Object.assign(() => {}, { FieldPath: FieldPathFalso, FieldValue: FieldValueFalso }) };
  const window = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido };
  let publicarLlamado = 0;
  async function publicarReservasPublicas() { publicarLlamado++; }
  const warnLog = [];
  const consoleFalso = { ...console, warn: (...args) => { warnLog.push(args); } };
  const fn = new Function(
    'window', 'firebase', 'entrenadorVisto', 'rolActivo', 'dbClientes', 'dbAgenda', 'dbPruebasCRM',
    'dbDisponibilidadReservas', 'dbHistoricoClientes', 'dbNotas', 'publicarReservasPublicas', 'console',
    extracted + `
    return { guardarEstadoNubeAgenda };`
  );
  const M = fn(window, firebase, entrenadorVisto, rolActivo, dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes, dbNotas, publicarReservasPublicas, consoleFalso);
  return { ...M, publicarLlamado: () => publicarLlamado, warnLog };
}

async function main() {

// ============================================================
console.log('=== ESCENARIO A: sin conflicto -- guardado normal funciona exactamente igual que antes ===');
// ============================================================
{
  const estadoServidor = { clientes: { a: [{ id: 'ca_v1' }] }, agenda: { a: {} }, pruebasCRM: { a: {} }, disponibilidadReservas: { a: {} }, historicoClientes: { a: {} } };
  const servidor = crearServidorFirestore(estadoServidor);
  const dbClientes = { a: [{ id: 'ca_v2', nombre: 'Editado por esta pestaña' }] };
  const bsUltimoServidorConocido = deepClone(estadoServidor); // esta pestaña sincronizó justo este estado
  const sesion = crearSesion({ docRef: servidor.ref, dbClientes, dbAgenda: { a: {} }, dbPruebasCRM: { a: {} }, dbDisponibilidadReservas: { a: {} }, dbHistoricoClientes: { a: {} }, dbNotas: {}, bsUltimoServidorConocido });

  const resultado = await sesion.guardarEstadoNubeAgenda('a');
  check('sin conflicto: ok:true', resultado.ok, true);
  check('sin conflicto: el servidor refleja el cambio de esta pestaña', servidor.estadoActual().clientes.a, [{ id: 'ca_v2', nombre: 'Editado por esta pestaña' }]);
  check('sin conflicto: publicarReservasPublicas() se invoca tras guardar', sesion.publicarLlamado(), 1);
}

// ============================================================
console.log('\n=== ESCENARIO B: CONFLICTO PT/PT (dos pestañas del MISMO entrenador) -- guardado se cancela, NO se pisa ===');
// ============================================================
{
  const estadoBase = { clientes: { a: [{ id: 'ca_v1' }] }, agenda: { a: {} }, pruebasCRM: { a: {} }, disponibilidadReservas: { a: {} }, historicoClientes: { a: {} } };
  const servidor = crearServidorFirestore(estadoBase);
  const bsUltimoServidorConocido = deepClone(estadoBase); // ambas pestañas partían de este mismo estado

  // Pestaña 2 (la "otra sesión") guarda PRIMERO, directamente contra el servidor -- simula que su
  // propio guardado (con su propia detección de conflicto, que pasó porque ELLA sí estaba al día)
  // ya se aplicó.
  servidor.escribirDesdeOtraSesion('clientes', 'a', [{ id: 'ca_v1' }, { id: 'ca_nueva_de_otra_pestana' }]);

  // Pestaña 1 (esta sesión) NUNCA se enteró de ese cambio -- su bsUltimoServidorConocido sigue
  // siendo el estado base antiguo -- e intenta guardar SU PROPIA edición, que sobrescribiría por
  // completo clientes.a si no se detectara el conflicto.
  const dbClientes1 = { a: [{ id: 'ca_v1', nombre: 'Editado por pestaña 1, sin saber de la otra', telefono: '699888777', email: 'pii-real@x.com' }] };
  const sesion1 = crearSesion({ docRef: servidor.ref, dbClientes: dbClientes1, dbAgenda: { a: {} }, dbPruebasCRM: { a: {} }, dbDisponibilidadReservas: { a: {} }, dbHistoricoClientes: { a: {} }, dbNotas: {}, bsUltimoServidorConocido, entrenadorVisto: 'a', rolActivo: 'pt' });

  const resultado = await sesion1.guardarEstadoNubeAgenda('a');
  check('conflicto PT/PT: guardado devuelve ok:false', resultado.ok, false);
  check('conflicto PT/PT: código de error = conflict', resultado.err && resultado.err.code, 'conflict');
  check('conflicto PT/PT: el cambio de la OTRA pestaña sigue intacto en el servidor (NO se pisó)', servidor.estadoActual().clientes.a, [{ id: 'ca_v1' }, { id: 'ca_nueva_de_otra_pestana' }]);
  check('conflicto PT/PT: publicarReservasPublicas() NUNCA se llama si el guardado se cancela', sesion1.publicarLlamado(), 0);

  // QA 2026-09-17: [BESOUL CONFLICT DIAG] -- se emite exactamente una vez, con la forma esperada,
  // y SIN NINGÚN dato personal del payload (nombre/teléfono/email de arriba nunca deben aparecer).
  check('DIAG: se emite exactamente un [BESOUL CONFLICT DIAG]', sesion1.warnLog.filter(a => a[0] === '[BESOUL CONFLICT DIAG]').length, 1);
  const diag1 = sesion1.warnLog.find(a => a[0] === '[BESOUL CONFLICT DIAG]')[1];
  check('DIAG: trainerKeyScope correcto', diag1.trainerKeyScope, 'a');
  check('DIAG: entrenadorVisto correcto', diag1.entrenadorVisto, 'a');
  check('DIAG: rolActivo correcto', diag1.rolActivo, 'pt');
  check('DIAG: appBuild presente', typeof diag1.appBuild === 'string' && diag1.appBuild.length > 0, true);
  check('DIAG: conflictFields incluye "clientes"', diag1.conflictFields.includes('clientes'), true);
  check('DIAG: campos.clientes.same === false', diag1.campos.clientes.same, false);
  check('DIAG: campos.clientes trae hashes cortos, no el contenido', typeof diag1.campos.clientes.baselineHash === 'string' && diag1.campos.clientes.baselineHash.length <= 8, true);
  const diagStr1 = JSON.stringify(diag1);
  check('DIAG: NUNCA contiene el nombre real', diagStr1.includes('Editado por pestaña 1'), false);
  check('DIAG: NUNCA contiene el teléfono real', diagStr1.includes('699888777'), false);
  check('DIAG: NUNCA contiene el email real', diagStr1.includes('pii-real@x.com'), false);
}

// ============================================================
console.log('\n=== ESCENARIO C: CONFLICTO Admin/PT (admin viendo-como + el propio PT editando a la vez) ===');
// ============================================================
{
  const estadoBase = { clientes: { veronica: [{ id: 'cv1' }] }, agenda: { veronica: {} }, pruebasCRM: { veronica: {} }, disponibilidadReservas: { veronica: {} }, historicoClientes: { veronica: {} } };
  const servidor = crearServidorFirestore(estadoBase);
  const bsUltimoServidorConocido = deepClone(estadoBase);

  // El PT real (Verónica) guarda un cambio propio primero.
  servidor.escribirDesdeOtraSesion('clientes', 'veronica', [{ id: 'cv1', telefono: '600111222 (actualizado por Verónica)' }]);

  // El admin, con "ver como Verónica" abierto desde antes, guarda una edición suya sin haber
  // recibido todavía ese cambio.
  const dbClientesAdmin = { veronica: [{ id: 'cv1', nota: 'Editado por el admin viendo-como Verónica' }] };
  const sesionAdmin = crearSesion({ docRef: servidor.ref, dbClientes: dbClientesAdmin, dbAgenda: { veronica: {} }, dbPruebasCRM: { veronica: {} }, dbDisponibilidadReservas: { veronica: {} }, dbHistoricoClientes: { veronica: {} }, dbNotas: {}, bsUltimoServidorConocido, entrenadorVisto: 'veronica', rolActivo: 'admin' });

  const resultado = await sesionAdmin.guardarEstadoNubeAgenda('veronica');
  check('conflicto Admin/PT: guardado devuelve ok:false', resultado.ok, false);
  check('conflicto Admin/PT: el cambio real de la PT sigue intacto (NO lo pisa el admin)', servidor.estadoActual().clientes.veronica, [{ id: 'cv1', telefono: '600111222 (actualizado por Verónica)' }]);

  const diag2 = sesionAdmin.warnLog.find(a => a[0] === '[BESOUL CONFLICT DIAG]')[1];
  check('DIAG (admin): rolActivo === "admin"', diag2.rolActivo, 'admin');
  check('DIAG (admin): entrenadorVisto === "veronica"', diag2.entrenadorVisto, 'veronica');
  const diagStr2 = JSON.stringify(diag2);
  check('DIAG (admin): NUNCA contiene el teléfono real de Verónica', diagStr2.includes('600111222'), false);
  check('DIAG (admin): NUNCA contiene el texto de la nota del admin', diagStr2.includes('Editado por el admin'), false);
}

// ============================================================
console.log('\n=== ESCENARIO D: un cambio en OTRO trainerKey NUNCA provoca un falso conflicto ===');
// ============================================================
{
  const estadoBase = { clientes: { a: [{ id: 'ca1' }], b: [{ id: 'cb1' }] }, agenda: { a: {}, b: {} }, pruebasCRM: { a: {}, b: {} }, disponibilidadReservas: { a: {}, b: {} }, historicoClientes: { a: {}, b: {} } };
  const servidor = crearServidorFirestore(estadoBase);
  const bsUltimoServidorConocido = deepClone(estadoBase);

  // Otro PT (b) guarda algo completamente ajeno mientras tanto.
  servidor.escribirDesdeOtraSesion('clientes', 'b', [{ id: 'cb1', nota: 'cambio de OTRO entrenador' }]);

  const dbClientesA = { a: [{ id: 'ca1', nombre: 'Editado por el PT a' }] };
  const sesionA = crearSesion({ docRef: servidor.ref, dbClientes: dbClientesA, dbAgenda: { a: {} }, dbPruebasCRM: { a: {} }, dbDisponibilidadReservas: { a: {} }, dbHistoricoClientes: { a: {} }, dbNotas: {}, bsUltimoServidorConocido });

  const resultado = await sesionA.guardarEstadoNubeAgenda('a');
  check('sin falso conflicto cross-trainer: ok:true', resultado.ok, true);
  check('sin falso conflicto cross-trainer: el guardado de "a" se aplica igualmente', servidor.estadoActual().clientes.a, [{ id: 'ca1', nombre: 'Editado por el PT a' }]);
  check('sin falso conflicto cross-trainer: el cambio de "b" sigue intacto', servidor.estadoActual().clientes.b, [{ id: 'cb1', nota: 'cambio de OTRO entrenador' }]);
}

// ============================================================
console.log('\n=== ESCENARIO E: sin baseline conocido (primer guardado de la sesión) -- no bloquea, comportamiento previo ===');
// ============================================================
{
  const estadoBase = { clientes: { a: [{ id: 'ca1' }] }, agenda: { a: {} }, pruebasCRM: { a: {} }, disponibilidadReservas: { a: {} }, historicoClientes: { a: {} } };
  const servidor = crearServidorFirestore(estadoBase);
  const dbClientes = { a: [{ id: 'ca1', nombre: 'Primer guardado, sin snapshot previo aplicado' }] };
  const sesion = crearSesion({ docRef: servidor.ref, dbClientes, dbAgenda: { a: {} }, dbPruebasCRM: { a: {} }, dbDisponibilidadReservas: { a: {} }, dbHistoricoClientes: { a: {} }, dbNotas: {}, bsUltimoServidorConocido: undefined });

  const resultado = await sesion.guardarEstadoNubeAgenda('a');
  check('sin baseline: ok:true (no bloquea el primer guardado real)', resultado.ok, true);
}

// ============================================================
console.log('\n=== HELPERS de diagnóstico (canonicalizarValorDiagnostico / hashEstableDiagnostico / contarElementosDiagnostico) ===');
// ============================================================
{
  const diagFn = new Function(extracted + `
    return { canonicalizarValorDiagnostico, hashEstableDiagnostico, contarElementosDiagnostico };
  `)();

  const objA = { b: 2, a: 1, c: { z: 9, y: 8 } };
  const objAOtroOrden = { c: { y: 8, z: 9 }, a: 1, b: 2 };
  check('canonicalizar: mismo objeto con OTRO orden de claves -> mismo resultado canónico', diagFn.canonicalizarValorDiagnostico(objA), diagFn.canonicalizarValorDiagnostico(objAOtroOrden));
  check('hash: mismo objeto con OTRO orden de claves -> MISMO hash', diagFn.hashEstableDiagnostico(objA), diagFn.hashEstableDiagnostico(objAOtroOrden));

  const arr1 = [{ id: 1 }, { id: 2 }];
  const arr2 = [{ id: 2 }, { id: 1 }];
  check('canonicalizar: un array preserva su ORDEN (no se reordena como si fuera un objeto)', JSON.stringify(diagFn.canonicalizarValorDiagnostico(arr1)) === JSON.stringify(diagFn.canonicalizarValorDiagnostico(arr2)), false);

  check('hash: un cambio REAL de contenido -> hash DISTINTO', diagFn.hashEstableDiagnostico({ a: 1 }) === diagFn.hashEstableDiagnostico({ a: 2 }), false);
  check('hash: null y {} son distintos (no colisionan)', diagFn.hashEstableDiagnostico(null) === diagFn.hashEstableDiagnostico({}), false);
  check('hash: siempre devuelve un string corto (8 hex), nunca el contenido', /^[0-9a-f]{8}$/.test(diagFn.hashEstableDiagnostico({ nombre: 'Alguien Real', telefono: '600123123' })), true);

  check('contarElementos: array -> length', diagFn.contarElementosDiagnostico([1, 2, 3]), 3);
  check('contarElementos: objeto -> nº de claves top-level', diagFn.contarElementosDiagnostico({ x: 1, y: 2 }), 2);
  check('contarElementos: null -> 0', diagFn.contarElementosDiagnostico(null), 0);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
