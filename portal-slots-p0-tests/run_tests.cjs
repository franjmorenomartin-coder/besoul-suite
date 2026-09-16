// PORTAL-SLOTS-P0: reproduce la cadena REAL completa -- Agenda (disponibilidad guardada) ->
// publicarReservasPublicas() (agenda.html, extraído verbatim) -> besoulPublicSchedule/
// besoulPublicClients (mock de Firestore con batch/set/commit) -> generador de slots real del
// Portal (portal-cliente.html, extraído verbatim). Objetivo: demostrar mecánicamente por qué un
// cliente puede ver "Sin huecos disponibles" aunque su PT real SÍ tenga disponibilidad guardada
// -- sin acceder a datos reales de producción, y sin inventar la causa: se construye el escenario
// exacto (dos trainerKey para la "misma" persona) y se observa el resultado real del código.
const fs = require('fs');
const path = require('path');

const agendaExtracted = fs.readFileSync(path.join(__dirname, 'agenda_slots_extract.js'), 'utf8');
const portalExtracted = fs.readFileSync(path.join(__dirname, 'portal_slots_extract.js'), 'utf8');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// --- Mock de Firestore: batch().set(ref,payload,{merge}) + commit(), suficiente para
// publicarReservasPublicas() (nunca usa .update() con rutas de punto -- solo .set con merge sobre
// documentos propios de besoulPublicSchedule/besoulPublicClients, ids literales sin punto en la
// práctica salvo el propio trainerKey, que aquí es el ID COMPLETO del documento, no una ruta
// interna -- un punto en un ID de documento NO tiene significado especial en Firestore). ---
function crearFirestoreMock() {
  const colecciones = {}; // nombre -> { docId -> data }
  function coleccion(nombre) {
    if (!colecciones[nombre]) colecciones[nombre] = {};
    return {
      doc(id) {
        return {
          _coleccion: nombre, _id: id,
          async get() { return { exists: id in colecciones[nombre], data: () => deepClone(colecciones[nombre][id]) }; }
        };
      }
    };
  }
  return {
    collection: coleccion,
    batch() {
      const pendientes = [];
      return {
        set(ref, payload, opts) {
          pendientes.push(() => {
            const actual = colecciones[ref._coleccion][ref._id] || {};
            colecciones[ref._coleccion][ref._id] = (opts && opts.merge) ? { ...actual, ...deepClone(payload) } : deepClone(payload);
          });
        },
        async commit() { pendientes.forEach(fn => fn()); }
      };
    },
    leerDoc(coleccionNombre, id) { return deepClone((colecciones[coleccionNombre] || {})[id]); },
    listarDocs(coleccionNombre) { return Object.values(deepClone(colecciones[coleccionNombre] || {})); },
  };
}

function crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda, dbDisponibilidadReservas, firestoreMock, bsAgendaCloudDocRef }) {
  class FieldValueFalso { constructor(m) { this._methodName = m; } }
  FieldValueFalso.serverTimestamp = () => new FieldValueFalso('serverTimestamp');
  const firebaseFalso = { apps: [{}], firestore: Object.assign(() => firestoreMock, { FieldValue: FieldValueFalso }) };
  const windowFalso = { firebase: firebaseFalso };
  if (bsAgendaCloudDocRef) windowFalso.bsAgendaCloudDocRef = bsAgendaCloudDocRef;
  const localStorageFalso = { setItem() {} };
  const preamble = `
    let dbSolicitudesReservas = {};
    let dbHistoricoClientes = {};
    let lunesActual = new Date();
    let entrenadorVisto = '';
    function generarTokenReservaCliente(){ return 'res_test_' + Math.random().toString(36).slice(2); }
    function escapeHTML(v){ return String(v||''); }
  `;
  const fn = new Function('dbCredenciales', 'dbClientes', 'dbAgenda', 'dbDisponibilidadReservas', 'window', 'firebase', 'usuarioFirebaseActual', 'localStorage',
    preamble + agendaExtracted + `
    return { publicarReservasPublicas, construirAuditoriaTrainerKey, normalizarTrainerKey, calcularContadorClases };`);
  return fn(dbCredenciales, dbClientes, dbAgenda, dbDisponibilidadReservas, windowFalso, firebaseFalso, { uid: 'test' }, localStorageFalso);
}

function crearSesionPortal(clientData, scheduleData) {
  const document = { getElementById: () => ({ classList: { contains: () => false, add(){}, remove(){}, toggle(){} } }) };
  const preamble = `function labelFecha(iso){ return iso; }`;
  const fn = new Function(preamble + portalExtracted + `
    return { generarSlotsReserva };`);
  const M = fn();
  // huecosLibresFecha/etc. leen "clientData"/"scheduleData" como variables GLOBALES del script
  // real (portal-cliente.html) -- se inyectan aquí de la misma forma en que init() las asigna
  // tras cargar el token.
  global.clientData = clientData;
  global.scheduleData = scheduleData;
  return M;
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

function isoOffset(dias) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function disponibilidadLunesA(hIni, hFin) {
  const semanal = {}; for (let d = 1; d <= 7; d++) semanal[d] = { activo: false, bloques: [] };
  // Publica disponibilidad para TODOS los días de la semana (simplifica el fixture: no depende de
  // qué día de la semana caiga "hoy" al ejecutar la suite) en vez de solo lunes.
  for (let d = 1; d <= 7; d++) semanal[d] = { activo: true, bloques: [{ inicio: hIni, fin: hFin }] };
  return { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true };
}
function disponibilidadDiasActivos(hIni, hFin, numDiasActivos) {
  const semanal = {};
  for (let d = 1; d <= 7; d++) semanal[d] = d <= numDiasActivos ? { activo: true, bloques: [{ inicio: hIni, fin: hFin }] } : { activo: false, bloques: [] };
  return { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true };
}
function contarDiasActivos(disp) {
  return Object.values(disp?.semanal || {}).filter(d => d && d.activo === true && Array.isArray(d.bloques) && d.bloques.length > 0).length;
}

async function main() {

// ============================================================
console.log('=== ESCENARIO REAL: cliente correctamente asignado ve los huecos de su PT ===');
// ============================================================
{
  const fsx = crearFirestoreMock();
  const dbCredenciales = { miguel_real: { nombre: 'Miguel Fenech', centroId: 'lagunillas', centroNombre: 'Lagunillas' } };
  const dbClientes = { miguel_real: [{ id: 'cliente-test', nombre: 'Cliente Test', tipo: 'individual', email: 'c@test.com', telefono: '600000000' }] };
  const dbAgenda = { miguel_real: {} };
  const dbDisponibilidadReservas = { miguel_real: disponibilidadLunesA('09:00', '13:00') };

  const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda, dbDisponibilidadReservas, firestoreMock: fsx });
  await sesion.publicarReservasPublicas();

  const schedule = fsx.leerDoc('besoulPublicSchedule', 'miguel_real');
  check('se publica el schedule de Miguel bajo SU trainerKey', !!schedule, true);
  check('el schedule publicado tiene disponibilidad real (no vacía)', schedule.disponibilidad.semanal['1'].activo, true);

  const fichaPublica = Object.values(fsx.leerDoc('besoulPublicClients', Object.keys((fsx.batch ? {} : {}))) || {});
  // Recupera el token real generado para el cliente (mutado en dbClientes por publicarReservasPublicas()).
  const token = dbClientes.miguel_real[0].reservaToken;
  const clientData = fsx.leerDoc('besoulPublicClients', token);
  check('la ficha pública del cliente apunta EXACTAMENTE al trainerKey de Miguel', clientData.trainerKey, 'miguel_real');

  const portal = crearSesionPortal(clientData, schedule);
  const slots = portal.generarSlotsReserva();
  check('el Portal genera slots reales de 45 min a partir de la disponibilidad publicada', slots.length > 0, true);
}

// ============================================================
console.log('\n=== CAPACIDAD GENERAL DE LA AUDITORÍA: detecta una identidad trainerKey duplicada SI llegara a existir ===');
// ============================================================
{
  // NOTA (2026-09-16): esto NO reproduce el caso real de Lourdes/Miguel Fenech -- la lectura de
  // producción de solo lectura confirmó que su identidad NO está duplicada (un único trainerKey
  // "lillo" para Miguel Fenech en besoulUsers; "miguel" pertenece a un entrenador real distinto,
  // "Miguel Luna"). Este bloque prueba una capacidad GENERAL, independiente del incidente real:
  // si dos perfiles distintos ("miguel_real" con disponibilidad, "miguel_otro" sin ella)
  // compartieran nombre, la auditoría de solo lectura los señala y un cliente mal asignado al
  // perfil sin disponibilidad vería cero huecos -- útil para cualquier OTRO PT en el futuro, no
  // una afirmación sobre este caso concreto.
  const fsx = crearFirestoreMock();
  const dbCredenciales = {
    miguel_real: { nombre: 'Miguel Fenech', centroId: 'lagunillas', centroNombre: 'Lagunillas' },
    miguel_otro: { nombre: 'Miguel Fenech', centroId: 'lagunillas', centroNombre: 'Lagunillas' },
  };
  const dbClientes = {
    miguel_real: [],
    miguel_otro: [{ id: 'cliente-test', nombre: 'Cliente Test', tipo: 'individual', email: 'c@test.com', telefono: '600000000' }],
  };
  const dbAgenda = { miguel_real: {}, miguel_otro: {} };
  // La disponibilidad REAL está guardada -- correctamente -- bajo "miguel_real". "miguel_otro" no
  // tiene ninguna (disponibilidadReservasPorDefecto(): todos los días inactivos).
  const dbDisponibilidadReservas = { miguel_real: disponibilidadLunesA('09:00', '13:00') };

  const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda, dbDisponibilidadReservas, firestoreMock: fsx });
  await sesion.publicarReservasPublicas();

  const scheduleReal = fsx.leerDoc('besoulPublicSchedule', 'miguel_real');
  check('"miguel_real" (donde SÍ se guardó disponibilidad) publica un schedule con huecos reales', scheduleReal ? scheduleReal.disponibilidad.semanal['1'].activo : false, true);

  const token = dbClientes.miguel_otro[0].reservaToken;
  const clientData = fsx.leerDoc('besoulPublicClients', token);
  check('el cliente de prueba está publicado bajo "miguel_otro" (el perfil SIN disponibilidad)', clientData.trainerKey, 'miguel_otro');

  const scheduleQueVeElCliente = fsx.leerDoc('besoulPublicSchedule', clientData.trainerKey);
  check('el schedule que el Portal realmente consulta (el de "miguel_otro") SÍ existe (no es "sin publicar")', !!scheduleQueVeElCliente, true);
  check('...pero su disponibilidad está vacía (todos los días inactivos)', Object.values(scheduleQueVeElCliente.disponibilidad.semanal).every(d => !d.activo), true);

  const portal = crearSesionPortal(clientData, scheduleQueVeElCliente);
  const slots = portal.generarSlotsReserva();
  check('mecanismo genérico: el Portal del cliente muestra CERO huecos si está mal asignado a un trainerKey "hermano" sin disponibilidad', slots.length, 0);

  // La auditoría de solo lectura debe señalar exactamente este caso.
  const { filas, duplicados } = sesion.construirAuditoriaTrainerKey();
  check('la auditoría detecta el nombre duplicado bajo dos trainerKey distintos', duplicados.length > 0, true);
  const filaOtro = filas.find(f => f.key === 'miguel_otro');
  check('la fila de "miguel_otro" señala "tiene clientes pero sin disponibilidad" -- el diagnóstico exacto', filaOtro.estado, 'Tiene clientes pero SIN disponibilidad activa publicada');
}

// ============================================================
console.log('\n=== PUBLICACIÓN-P0: causa EXACTA confirmada en producción (lectura de solo lectura, campo a campo) ===');
// ============================================================
{
  // Causa raíz EXACTA (no una hipótesis): se comparó, de solo lectura y campo a campo, la
  // disponibilidadReservas.<trainerKey> real (besoulSuite/agenda: 5 días activos,
  // actualizadoEn = <fecha del último guardado real>) contra el besoulPublicSchedule/<trainerKey>
  // publicado (0 días activos). El `disponibilidad.actualizadoEn` publicado NO coincidía con el
  // actualizadoEn real -- coincidía (al segundo) con el propio `updatedAt` de esa publicación. Eso
  // es exactamente lo que produce disponibilidadReservasPorDefecto() (agenda.html): sella
  // `actualizadoEn: new Date().toISOString()` en el momento en que se la invoca. Conclusión: en
  // publicarReservasPublicas(), la expresión `dbDisponibilidadReservas[trainerKey] ||
  // disponibilidadReservasPorDefecto()` cayó al DEFAULT (todo inactivo) porque esa clave
  // sencillamente NO EXISTÍA TODAVÍA en la copia local en memoria de quien disparó esa
  // publicación concreta -- no porque hubiera una copia vieja pero presente. Esto puede pasar
  // porque esta función se dispara automáticamente tras CUALQUIER guardado de CUALQUIER PT/admin
  // (guardarEstadoNubeAgenda -> publicarReservasPublicas), republicando de golpe TODOS los
  // trainerKeys -- y, a diferencia de la UI de edición de disponibilidad (que sí espera a
  // window.bsAgendaDisponibilidadCargada antes de permitir guardar), esta función nunca esperaba a
  // que el snapshot con el dato de OTRO trainerKey hubiera llegado antes de publicar por él.
  // CLASIFICACIÓN: A -- publicarReservasPublicas() RECIBE una disponibilidad vacía/fabricada (el
  // default), no la transforma ni la sobrescribe una segunda operación.
  const fsx = crearFirestoreMock();
  const dbCredenciales = { pt_disponible: { nombre: 'PT con disponibilidad real', centroId: 'centro-1', centroNombre: 'Centro 1' } };
  const dbClientesLocal = { pt_disponible: [{ id: 'cliente-test', nombre: 'Cliente Test', tipo: 'individual', email: 'c@test.com', telefono: '600000000' }] };
  const dbAgendaLocal = { pt_disponible: {} };
  // La clave del trainer NI SIQUIERA EXISTE en la copia local en memoria de quien dispara la
  // publicación (no es "obsoleta pero presente" -- está ausente del todo), tal como se confirmó
  // en producción vía el actualizadoEn fabricado en el momento de publicar.
  const dbDisponibilidadLocalIncompleta = {};
  // Estado REAL en el servidor en el momento de publicar: disponibilidad correcta ya guardada,
  // con su actualizadoEn real (de un guardado anterior, no del instante de la publicación).
  const dispRealDelServidor = { ...disponibilidadLunesA('08:00', '14:00'), actualizadoEn: isoOffset(-20) + 'T12:18:37.684Z', actualizadoPor: 'pt_disponible' };
  const datosFrescosServidor = {
    clientes: dbClientesLocal,
    agenda: dbAgendaLocal,
    disponibilidadReservas: { pt_disponible: dispRealDelServidor },
  };
  const bsAgendaCloudDocRef = { async get(opts) { check('el refetch pide explícitamente los datos del servidor, nunca de caché', opts && opts.source, 'server'); return { data: () => deepClone(datosFrescosServidor) }; } };

  const sesion = crearSesionAgenda({ dbCredenciales, dbClientes: dbClientesLocal, dbAgenda: dbAgendaLocal, dbDisponibilidadReservas: dbDisponibilidadLocalIncompleta, firestoreMock: fsx, bsAgendaCloudDocRef });
  await sesion.publicarReservasPublicas();

  const schedule = fsx.leerDoc('besoulPublicSchedule', 'pt_disponible');
  check('FIX PUBLICACIÓN-P0: pese a que la clave no existía en memoria local, se publica la disponibilidad FRESCA del servidor, no el default fabricado', Object.values(schedule.disponibilidad.semanal).some(d => d.activo === true), true);
  check('el actualizadoEn publicado es el REAL del último guardado, no uno fabricado en el instante de publicar', schedule.disponibilidad.actualizadoEn, dispRealDelServidor.actualizadoEn);

  // Cadena completa post-fix, exactamente como en producción: source (5 días) -> publicación ->
  // besoulPublicSchedule -> Portal cliente -> generarSlotsReserva() -> huecos futuros > 0.
  // (El fix reasigna dbClientes dentro de la función a una copia recién leída del servidor, así
  // que el token real hay que leerlo de lo publicado, no de la variable local ya desconectada.)
  const clientData = fsx.listarDocs('besoulPublicClients')[0];
  check('la ficha pública del cliente apunta al trainerKey correcto', clientData.trainerKey, 'pt_disponible');
  const portal = crearSesionPortal(clientData, schedule);
  const slots = portal.generarSlotsReserva();
  check('CADENA COMPLETA POST-FIX: source con 5 días activos -> publicación -> Portal -> huecos futuros > 0', slots.length > 0, true);
}

// ============================================================
console.log('\n=== MULTI-PT: publicación global, no depende de una sesión parcial ni de un batch compartido ===');
// ============================================================
{
  // Nueva evidencia real (2026-09-16): el fix anterior (releer del servidor) es necesario pero NO
  // suficiente -- una auditoría global de producción mostró 6 de 13 trainerKeys DESINCRONIZADOS
  // simultáneamente, algunos con el mismo updatedAt exacto (mismo batch), lo que demuestra que un
  // solo batch compartido para TODOS los PT puede fallar/quedar obsoleto para varios a la vez. Este
  // bloque reproduce un escenario con 3 PT reales (A=5 días, B=3 días, C=0 días) MÁS un cuarto PT
  // con un punto literal en su trainerKey (verifica que un ID de documento con punto no rompe
  // nada -- un punto en un ID de documento no es una ruta anidada, a diferencia de una key de
  // objeto en .update()). La sesión que dispara la publicación es una sesión de PT NORMAL (no
  // admin): su dbCredenciales SOLO contiene su propia clave ("a") -- exactamente como en
  // producción -- para demostrar que la lista de trainerKeys a publicar YA NO depende de eso.
  const fsx = crearFirestoreMock();
  const dbCredenciales = { a: { nombre: 'PT A' } }; // sesión de PT normal: solo se ve a sí mismo
  const dbClientesLocal = {
    a: [{ id: 'ca', nombre: 'Cliente A', tipo: 'individual', email: 'a@x.com', telefono: '1' }],
    // Cliente B tiene modalidad + una sesión real agendada HOY en dbAgenda.b -- usado más abajo
    // para probar que sesionesUsadas se calcula sobre la agenda REAL de "b", no sobre la de
    // quien dispara la publicación (hallazgo PORTAL-SLOTS-P0 GLOBAL: contarSesionesAgendadas()
    // leía el global entrenadorVisto en vez del trainerKey del cliente que se está publicando).
    b: [{ id: 'cb', nombre: 'Cliente B', tipo: 'individual', email: 'b@x.com', telefono: '2', modalidad: '2x semana' }],
    c: [{ id: 'cc', nombre: 'Cliente C', tipo: 'individual', email: 'c@x.com', telefono: '3' }],
    'pt.con.punto': [{ id: 'cd', nombre: 'Cliente D', tipo: 'individual', email: 'd@x.com', telefono: '4' }],
  };
  const hoyISO = isoOffset(0);
  const dbAgendaLocal = { a: {}, b: { [`${hoyISO}_09:00`]: { id: 'cb', nombre: 'Cliente B' } }, c: {}, 'pt.con.punto': {} };
  const dbDisponibilidadFresca = {
    a: disponibilidadDiasActivos('09:00', '14:00', 5),
    b: disponibilidadDiasActivos('09:00', '14:00', 3),
    c: disponibilidadDiasActivos('09:00', '14:00', 0),
    'pt.con.punto': disponibilidadDiasActivos('09:00', '14:00', 5),
  };
  const datosFrescosServidor = { clientes: dbClientesLocal, agenda: dbAgendaLocal, disponibilidadReservas: dbDisponibilidadFresca };
  const snapshotAntesDePublicar = deepClone(datosFrescosServidor);
  const bsAgendaCloudDocRef = { async get() { return { data: () => deepClone(datosFrescosServidor) }; } };

  const sesion = crearSesionAgenda({ dbCredenciales, dbClientes: dbClientesLocal, dbAgenda: dbAgendaLocal, dbDisponibilidadReservas: dbDisponibilidadFresca, firestoreMock: fsx, bsAgendaCloudDocRef });
  await sesion.publicarReservasPublicas();

  // 1-3: cada PT publica exactamente sus propios días activos.
  const schedA = fsx.leerDoc('besoulPublicSchedule', 'a');
  const schedB = fsx.leerDoc('besoulPublicSchedule', 'b');
  const schedC = fsx.leerDoc('besoulPublicSchedule', 'c');
  const schedPunto = fsx.leerDoc('besoulPublicSchedule', 'pt.con.punto');
  check('MULTI-PT 1: PT A (5 días fuente) publica 5 días', contarDiasActivos(schedA?.disponibilidad), 5);
  check('MULTI-PT 2: PT B (3 días fuente) publica 3 días', contarDiasActivos(schedB?.disponibilidad), 3);
  check('MULTI-PT 3: PT C (0 días fuente) publica 0 días (no fabricado)', contarDiasActivos(schedC?.disponibilidad), 0);
  check('MULTI-PT 7: trainerKey con punto literal en el ID de documento funciona igual (no es una ruta anidada)', contarDiasActivos(schedPunto?.disponibilidad), 5);
  check('MULTI-PT 8: trainerKey normal (A) sigue funcionando igual junto al de punto', !!schedA, true);

  // 4-6, 14: cada cliente ve slots (o no) según SU PT real, nunca el de otro.
  const clienteA = fsx.listarDocs('besoulPublicClients').find(c => c.trainerKey === 'a');
  const clienteB = fsx.listarDocs('besoulPublicClients').find(c => c.trainerKey === 'b');
  const clienteC = fsx.listarDocs('besoulPublicClients').find(c => c.trainerKey === 'c');
  const slotsA = crearSesionPortal(clienteA, schedA).generarSlotsReserva();
  const slotsB = crearSesionPortal(clienteB, schedB).generarSlotsReserva();
  const slotsC = crearSesionPortal(clienteC, schedC).generarSlotsReserva();
  check('MULTI-PT 4: cliente de PT A obtiene huecos reales', slotsA.length > 0, true);
  check('MULTI-PT 5: cliente de PT B obtiene huecos reales', slotsB.length > 0, true);
  check('MULTI-PT 6: cliente de PT C NO obtiene huecos (su PT no tiene disponibilidad)', slotsC.length, 0);
  check('MULTI-PT 14: cliente A nunca recibe el trainerKey de B', clienteA.trainerKey !== clienteB.trainerKey, true);
  check('MULTI-PT 12: ningún PT pisa a otro -- cada cliente publicado bajo su propio trainerKey', [clienteA, clienteB, clienteC].map(c => c.trainerKey).sort(), ['a', 'b', 'c']);

  // Hallazgo adicional (contarSesionesAgendadas/calcularContadorClases): el contador de sesiones
  // publicado para el cliente de "b" debe salir de la agenda REAL de "b" -- la sesión de hoy debe
  // contar como usada -- pese a que quien disparó la publicación tenía dbCredenciales de "a" (y
  // entrenadorVisto en este arnés de pruebas es '' por defecto, distinto de ambos).
  check('CONTADOR-P0: sesionesUsadas del cliente de "b" se calcula sobre la agenda REAL de "b", no sobre la de quien publica', clienteB.sesionesUsadas, 1);

  // 9-10, 15: la sesión que disparó la publicación era de un PT normal (dbCredenciales solo tenía
  // "a") y, aun así, se publicaron TODOS -- la lista sale de la fuente fresca del servidor, no de
  // una sesión parcial del navegador.
  check('MULTI-PT 9/10/15: aunque dbCredenciales local solo tenía "a", se publicaron TODOS los trainerKeys reales de la fuente fresca del servidor', !!(schedA && schedB && schedC && schedPunto), true);

  // 13: la publicación nunca modifica los datos que leyó del servidor.
  check('MULTI-PT 13: publicarReservasPublicas() nunca modifica los datos fuente que releyó', datosFrescosServidor, snapshotAntesDePublicar);

  // 11: dos ejecuciones consecutivas con el mismo estado fuente producen el mismo resultado lógico
  // (mismos días activos publicados, misma asignación de clientes) -- idempotente.
  await sesion.publicarReservasPublicas();
  const schedA2 = fsx.leerDoc('besoulPublicSchedule', 'a');
  const schedB2 = fsx.leerDoc('besoulPublicSchedule', 'b');
  check('MULTI-PT 11: dos ejecuciones consecutivas producen el mismo resultado lógico (idempotente)',
    [contarDiasActivos(schedA2?.disponibilidad), contarDiasActivos(schedB2?.disponibilidad)],
    [contarDiasActivos(schedA?.disponibilidad), contarDiasActivos(schedB?.disponibilidad)]);
}

// ============================================================
console.log('\n=== MULTI-PT NEGATIVE CONTROL: un solo cliente corrupto ya NO bloquea a los demás PT ===');
// ============================================================
{
  // Reproduce el mecanismo real sospechado en producción: un batch ÚNICO compartido para todos los
  // PT hace que un solo registro inválido (aquí, un cliente con un campo `undefined`, que Firestore
  // rechaza al construir el write) aborte la publicación de TODOS los PT a la vez -- incluidos los
  // que no tienen ningún dato corrupto. Con la función canónica actual (un batch POR trainerKey vía
  // Promise.allSettled), el PT con el dato corrupto falla en aislamiento y el resto se publica bien.
  const fsx = crearFirestoreMock();
  // crearFirestoreMock().batch().set() usa JSON.stringify internamente (deepClone) -- un valor
  // `undefined` real desaparece silenciosamente en ese mock, así que para que el mock SÍ reproduzca
  // un fallo real de Firestore (que rechaza `undefined` de forma síncrona) forzamos el error
  // directamente en el propio mock para ese trainerKey concreto.
  const fsxOriginalBatch = fsx.batch.bind(fsx);
  let trainerKeyEnCurso = null;
  fsx.batch = function () {
    const b = fsxOriginalBatch();
    const setOriginal = b.set.bind(b);
    b.set = function (ref, payload, opts) {
      if (ref._coleccion === 'besoulPublicSchedule' && ref._id === 'pt_corrupto') {
        throw new Error('Valor no soportado por Firestore (simulando un campo undefined real)');
      }
      return setOriginal(ref, payload, opts);
    };
    return b;
  };
  const dbCredenciales = { pt_sano_1: { nombre: 'PT Sano 1' } };
  const dbClientesLocal = {
    pt_sano_1: [{ id: 'c1', nombre: 'Cliente Sano 1', tipo: 'individual', email: 'x@x.com', telefono: '1' }],
    pt_corrupto: [{ id: 'c2', nombre: 'Cliente Corrupto', tipo: 'individual', email: 'y@x.com', telefono: '2' }],
    pt_sano_2: [{ id: 'c3', nombre: 'Cliente Sano 2', tipo: 'individual', email: 'z@x.com', telefono: '3' }],
  };
  const dbAgendaLocal = { pt_sano_1: {}, pt_corrupto: {}, pt_sano_2: {} };
  const dbDisponibilidadFresca = {
    pt_sano_1: disponibilidadLunesA('09:00', '13:00'),
    pt_corrupto: disponibilidadLunesA('09:00', '13:00'),
    pt_sano_2: disponibilidadLunesA('09:00', '13:00'),
  };
  const datosFrescosServidor = { clientes: dbClientesLocal, agenda: dbAgendaLocal, disponibilidadReservas: dbDisponibilidadFresca };
  const bsAgendaCloudDocRef = { async get() { return { data: () => deepClone(datosFrescosServidor) }; } };
  const sesion = crearSesionAgenda({ dbCredenciales, dbClientes: dbClientesLocal, dbAgenda: dbAgendaLocal, dbDisponibilidadReservas: dbDisponibilidadFresca, firestoreMock: fsx, bsAgendaCloudDocRef });
  await sesion.publicarReservasPublicas();

  const schedSano1 = fsx.leerDoc('besoulPublicSchedule', 'pt_sano_1');
  const schedSano2 = fsx.leerDoc('besoulPublicSchedule', 'pt_sano_2');
  const schedCorrupto = fsx.leerDoc('besoulPublicSchedule', 'pt_corrupto');
  check('AISLAMIENTO DE FALLO: el PT con el dato corrupto NO se publica (esperado)', !!schedCorrupto, false);
  check('AISLAMIENTO DE FALLO: pese al fallo de pt_corrupto, pt_sano_1 SÍ se publica correctamente', contarDiasActivos(schedSano1?.disponibilidad) > 0, true);
  check('AISLAMIENTO DE FALLO: pese al fallo de pt_corrupto, pt_sano_2 SÍ se publica correctamente', contarDiasActivos(schedSano2?.disponibilidad) > 0, true);
}

// ============================================================
console.log('\n=== NEGATIVE CONTROLS (bloque 8) ===');
// ============================================================
{
  const base = () => ({ dbAgenda: { pt: {} } });

  // trainerKey mayúsculas/minúsculas: normalizarTrainerKey() sigue siendo la única fuente de
  // normalización -- no se introduce una segunda independiente.
  const sesionNorm = crearSesionAgenda({ dbCredenciales: {}, dbClientes: {}, dbAgenda: {}, dbDisponibilidadReservas: {}, firestoreMock: crearFirestoreMock() });
  check('mayúsculas/minúsculas: "Miguel_Fenech" -> "miguel_fenech"', sesionNorm.normalizarTrainerKey('Miguel_Fenech'), 'miguel_fenech');
  check('espacio: "miguel fenech" -> "miguel_fenech"', sesionNorm.normalizarTrainerKey('miguel fenech'), 'miguel_fenech');
  check('punto: "miguel.fenech" se conserva tal cual (ya protegido en el writer real por FieldPath, no aquí)', sesionNorm.normalizarTrainerKey('miguel.fenech'), 'miguel.fenech');
  check('ya normalizado: idempotente', sesionNorm.normalizarTrainerKey('miguel_fenech'), 'miguel_fenech');

  // Cliente de otro PT: publicarReservasPublicas() nunca mezcla clientes entre trainerKeys.
  {
    const fsx = crearFirestoreMock();
    const dbCredenciales = { a: { nombre: 'PT A' }, b: { nombre: 'PT B' } };
    const dbClientes = { a: [{ id: 'ca', nombre: 'Cliente A', tipo: 'individual', email: 'a@x.com', telefono: '1' }], b: [{ id: 'cb', nombre: 'Cliente B', tipo: 'individual', email: 'b@x.com', telefono: '2' }] };
    const dbDisponibilidadReservas = { a: disponibilidadLunesA('09:00', '13:00'), b: disponibilidadLunesA('16:00', '20:00') };
    const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda: { a: {}, b: {} }, dbDisponibilidadReservas, firestoreMock: fsx });
    await sesion.publicarReservasPublicas();
    check('cliente de otro PT: cada cliente queda publicado bajo SU propio PT, nunca mezclado', [dbClientes.a[0].reservaToken, dbClientes.b[0].reservaToken].map(t => fsx.leerDoc('besoulPublicClients', t).trainerKey), ['a', 'b']);
  }

  // PT sin disponibilidad: publica un schedule vacío (comportamiento correcto -- no fabricar huecos).
  {
    const fsx = crearFirestoreMock();
    const dbCredenciales = { sindisp: { nombre: 'Sin Disponibilidad' } };
    const dbClientes = { sindisp: [{ id: 'c1', nombre: 'Cliente', tipo: 'individual', email: 'c@x.com', telefono: '1' }] };
    const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda: { sindisp: {} }, dbDisponibilidadReservas: {}, firestoreMock: fsx });
    await sesion.publicarReservasPublicas();
    const token = dbClientes.sindisp[0].reservaToken;
    const cd = fsx.leerDoc('besoulPublicClients', token);
    const sched = fsx.leerDoc('besoulPublicSchedule', cd.trainerKey);
    const portal = crearSesionPortal(cd, sched);
    check('PT sin disponibilidad configurada: el Portal muestra 0 huecos (correcto, no fabricado)', portal.generarSlotsReserva().length, 0);
  }

  // Disponibilidad solo en el pasado: no debe ofrecer huecos futuros fabricados.
  {
    const fsx = crearFirestoreMock();
    const dbCredenciales = { pt: { nombre: 'PT' } };
    const dbClientes = { pt: [{ id: 'c1', nombre: 'Cliente', tipo: 'individual', email: 'c@x.com', telefono: '1' }] };
    // "excepciones" con override:true en fechas YA PASADAS y ningún día de la semana activo --
    // no debería generar ningún hueco futuro real.
    const dbDisponibilidadReservas = { pt: { semanal: (() => { const s = {}; for (let d = 1; d <= 7; d++) s[d] = { activo: false, bloques: [] }; return s; })(), excepciones: { [isoOffset(-10)]: { activo: true, override: true, bloques: [{ inicio: '09:00', fin: '13:00' }] } }, bloqueos: {}, recurrenteSemanal: true } };
    const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda: { pt: {} }, dbDisponibilidadReservas, firestoreMock: fsx });
    await sesion.publicarReservasPublicas();
    const token = dbClientes.pt[0].reservaToken;
    const cd = fsx.leerDoc('besoulPublicClients', token);
    const sched = fsx.leerDoc('besoulPublicSchedule', cd.trainerKey);
    const portal = crearSesionPortal(cd, sched);
    check('disponibilidad solo en el pasado: 0 huecos futuros (no se fabrica ninguno)', portal.generarSlotsReserva().length, 0);
  }

  // Bloqueo: un slot explícitamente ocultado no aparece aunque esté dentro de la franja activa.
  {
    const fsx = crearFirestoreMock();
    const dbCredenciales = { pt: { nombre: 'PT' } };
    const dbClientes = { pt: [{ id: 'c1', nombre: 'Cliente', tipo: 'individual', email: 'c@x.com', telefono: '1' }] };
    const disp = disponibilidadLunesA('09:00', '09:45'); // ventana de EXACTAMENTE 45 min: un único inicio posible (09:00)
    const fechaObjetivo = isoOffset(1);
    disp.bloqueos[fechaObjetivo] = ['09:00'];
    const dbDisponibilidadReservas = { pt: disp };
    const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda: { pt: {} }, dbDisponibilidadReservas, firestoreMock: fsx });
    await sesion.publicarReservasPublicas();
    const token = dbClientes.pt[0].reservaToken;
    const cd = fsx.leerDoc('besoulPublicClients', token);
    const sched = fsx.leerDoc('besoulPublicSchedule', cd.trainerKey);
    const portal = crearSesionPortal(cd, sched);
    const slotsEnFecha = portal.generarSlotsReserva().filter(s => s.iso === fechaObjetivo);
    check('bloqueo: el único slot posible de esa franja corta queda oculto (0 huecos ese día)', slotsEnFecha.length, 0);
  }

  // Sesión existente: un cliente ya agendado ocupa su franja -- el generador la excluye.
  {
    const fsx = crearFirestoreMock();
    const dbCredenciales = { pt: { nombre: 'PT' } };
    const dbClientes = { pt: [{ id: 'c1', nombre: 'Cliente', tipo: 'individual', email: 'c@x.com', telefono: '1' }] };
    const disp = disponibilidadLunesA('09:00', '09:45');
    const fechaObjetivo = isoOffset(1);
    const dbAgenda = { pt: { [`${fechaObjetivo}_09:00`]: { id: 'otro-cliente', nombre: 'Otro Cliente' } } };
    const dbDisponibilidadReservas = { pt: disp };
    const sesion = crearSesionAgenda({ dbCredenciales, dbClientes, dbAgenda, dbDisponibilidadReservas, firestoreMock: fsx });
    await sesion.publicarReservasPublicas();
    const token = dbClientes.pt[0].reservaToken;
    const cd = fsx.leerDoc('besoulPublicClients', token);
    const sched = fsx.leerDoc('besoulPublicSchedule', cd.trainerKey);
    const portal = crearSesionPortal(cd, sched);
    const slotsEnFecha = portal.generarSlotsReserva().filter(s => s.iso === fechaObjetivo);
    check('sesión existente: la franja ya ocupada por otro cliente no se ofrece de nuevo', slotsEnFecha.length, 0);
  }
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR FATAL EN LA SUITE:', err); process.exitCode = 1; });
