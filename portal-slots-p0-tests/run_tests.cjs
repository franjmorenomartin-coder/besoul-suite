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
    function calcularContadorClases(){ return { contratadas:0, usadas:0, restantes:0, periodo:'', tipo:'', caducidad:'' }; }
    function generarTokenReservaCliente(){ return 'res_test_' + Math.random().toString(36).slice(2); }
    function escapeHTML(v){ return String(v||''); }
  `;
  const fn = new Function('dbCredenciales', 'dbClientes', 'dbAgenda', 'dbDisponibilidadReservas', 'window', 'firebase', 'usuarioFirebaseActual', 'localStorage',
    preamble + agendaExtracted + `
    return { publicarReservasPublicas, construirAuditoriaTrainerKey, normalizarTrainerKey };`);
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
console.log('\n=== CAUSA RAÍZ DEMOSTRADA: identidad trainerKey duplicada -- cliente ve CERO huecos aunque "la misma persona" SÍ tiene disponibilidad ===');
// ============================================================
{
  // Reproduce mecánicamente el incidente real ya documentado (Miguel Fenech con más de un
  // trainerKey a la vez, ver BESOUL_WORK_STATE.md): dos perfiles para la misma persona --
  // "miguel_real" (donde de verdad abre "+ Disponibilidad" y guarda) y "miguel_otro" (un segundo
  // perfil/clave, vacío de disponibilidad). El cliente de prueba está asignado al perfil
  // EQUIVOCADO.
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
  check('CAUSA RAÍZ DEMOSTRADA: el Portal del cliente muestra CERO huecos aunque "Miguel Fenech" SÍ tenga disponibilidad real (bajo el OTRO trainerKey)', slots.length, 0);

  // La auditoría de solo lectura debe señalar exactamente este caso.
  const { filas, duplicados } = sesion.construirAuditoriaTrainerKey();
  check('la auditoría detecta el nombre duplicado bajo dos trainerKey distintos', duplicados.length > 0, true);
  const filaOtro = filas.find(f => f.key === 'miguel_otro');
  check('la fila de "miguel_otro" señala "tiene clientes pero sin disponibilidad" -- el diagnóstico exacto', filaOtro.estado, 'Tiene clientes pero SIN disponibilidad activa publicada');
}

// ============================================================
console.log('\n=== PUBLICACIÓN-P0: causa REAL confirmada en producción (lectura de solo lectura) ===');
// ============================================================
{
  // Confirmado con datos reales de producción (solo lectura, sin PII): besoulPublicSchedule/lillo
  // (Miguel Fenech, ÚNICO trainerKey real -- la identidad NO está duplicada) tenía 0 días activos
  // publicados con un updatedAt POSTERIOR al último guardado real de su disponibilidad (que sí
  // tiene 5 días activos en besoulSuite/agenda). Esto solo se explica por una publicación
  // disparada con una copia local (dbDisponibilidadReservas) obsoleta -- publicarReservasPublicas()
  // republica TODOS los trainerKeys ante CUALQUIER guardado de CUALQUIER PT/admin, usando lo que
  // hubiera en memoria del navegador que disparó esa acción. Este test reproduce exactamente esa
  // mecánica: la sesión que dispara la publicación tiene en memoria una copia YA OBSOLETA (sin
  // disponibilidad) de "lillo", mientras el servidor real ya tiene la disponibilidad correcta
  // guardada -- y confirma que, tras el fix, se publica la fresca del servidor, nunca la obsoleta.
  const fsx = crearFirestoreMock();
  const dbCredenciales = { lillo: { nombre: 'Miguel Fenech', centroId: 'lagunillas', centroNombre: 'Lagunillas' } };
  // Copia local OBSOLETA en memoria de quien dispara la publicación: sin disponibilidad activa.
  const dbClientesObsoleto = { lillo: [{ id: 'cliente-test', nombre: 'Cliente Test', tipo: 'individual', email: 'c@test.com', telefono: '600000000' }] };
  const dbAgendaObsoleto = { lillo: {} };
  const dbDisponibilidadObsoleta = { lillo: (() => { const s = {}; for (let d = 1; d <= 7; d++) s[d] = { activo: false, bloques: [] }; return s; })() && { semanal: (() => { const s = {}; for (let d = 1; d <= 7; d++) s[d] = { activo: false, bloques: [] }; return s; })(), excepciones: {}, bloqueos: {}, recurrenteSemanal: true } };
  // Estado REAL en el servidor en el momento de publicar: disponibilidad correcta ya guardada.
  const datosFrescosServidor = {
    clientes: dbClientesObsoleto,
    agenda: dbAgendaObsoleto,
    disponibilidadReservas: { lillo: disponibilidadLunesA('09:00', '13:00') },
  };
  const bsAgendaCloudDocRef = { async get(opts) { check('el refetch pide explícitamente los datos del servidor, nunca de caché', opts && opts.source, 'server'); return { data: () => deepClone(datosFrescosServidor) }; } };

  const sesion = crearSesionAgenda({ dbCredenciales, dbClientes: dbClientesObsoleto, dbAgenda: dbAgendaObsoleto, dbDisponibilidadReservas: dbDisponibilidadObsoleta, firestoreMock: fsx, bsAgendaCloudDocRef });
  await sesion.publicarReservasPublicas();

  const schedule = fsx.leerDoc('besoulPublicSchedule', 'lillo');
  check('FIX PUBLICACIÓN-P0: se publica la disponibilidad FRESCA del servidor, no la copia obsoleta en memoria', Object.values(schedule.disponibilidad.semanal).some(d => d.activo === true), true);
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
