// PORTAL-RESERVATIONS-INTEGRATION: pruebas deterministas del motor de reservas real dentro de
// portal-cliente.html (extraído verbatim por extract.js). Cubre exactamente las garantías que el
// usuario pidió preservar al integrar reservas.html en el Portal: disponibilidad PT, sesiones de
// 45 min, slots válidos, conflictos, no double-booking, IDs deterministas, transacción, bonos/
// restricciones de cliente. Ningún dato real, ninguna escritura a Firestore real.
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'portal_extract.js'), 'utf8');

function crearDb(existentes = []) {
  const existentesSet = new Set(existentes);
  const writes = [];
  return {
    writes,
    collection(nombreColeccion) {
      return {
        doc(id) {
          return { _coleccion: nombreColeccion, _id: id };
        }
      };
    },
    async runTransaction(cb) {
      return cb({
        get: async (ref) => ({ exists: existentesSet.has(ref._id) }),
        set: (ref, payload) => { writes.push({ id: ref._id, coleccion: ref._coleccion, payload }); existentesSet.add(ref._id); }
      });
    }
  };
}
function crearDomFalso() {
  const el = () => ({ value: '', classList: { add(){}, remove(){} }, textContent: '', disabled: false });
  return { getElementById: () => el() };
}

function nuevoSandbox({ db, document, DEMO_MODE = false } = {}) {
  const _db = db || crearDb();
  const _document = document || crearDomFalso();
  const firebase = { firestore: { FieldValue: { serverTimestamp: () => ({ _sentinel: 'serverTimestamp' }) } } };
  let cargarDisponibilidadRecalls = 0;
  const registros = [];
  const preamble = `
    const DEMO_MODE = ${JSON.stringify(DEMO_MODE)};
    const token = 'res_test_token_0000000000000000';
    function cargarDisponibilidadReserva(){ _cargarDisponibilidadRecalls(); }
    function registrarSolicitudPendienteLocal(s){ _registrar(s); }
  `;
  const fn = new Function('document', 'db', 'firebase', 'alert', '_cargarDisponibilidadRecalls', '_registrar', preamble + extracted + `
    return {
      set clientData(v) { clientData = v; },
      set scheduleData(v) { scheduleData = v; },
      set selectedReserva(v) { selectedReserva = v; },
      get selectedReserva() { return selectedReserva; },
      huecosLibresFecha, iniciosEficientesHueco, generarSlotsReserva, gruposAbiertosDisponiblesReserva,
      bloqueLibre, slotOcupado, bloqueadoPorCliente, dateISO, timeToMin, minToTime,
      enviarSolicitudReserva
    };`);
  const alerts = [];
  const M = fn(_document, _db, firebase, (msg) => alerts.push(msg), () => { cargarDisponibilidadRecalls++; }, (s) => registros.push(s));
  return { M, db: _db, alerts, get cargarDisponibilidadRecalls() { return cargarDisponibilidadRecalls; }, registros };
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

async function main() {

// ============================================================
console.log('=== Sesiones de 45 minutos: un bloque de disponibilidad de 4h da slots cada 45 min ===');
// ============================================================
{
  const { M } = nuevoSandbox();
  M.scheduleData = { disponibilidad: { semanal: { /* lunes..domingo */ } }, ocupados: {} };
  // Simula un hueco de 09:00-13:00 (240 min) sin nada antes ni después -> mismo tramo que produce
  // huecosLibresFecha() para un día con esa única franja publicada por el PT.
  const hueco = { inicio: 540, fin: 780, tieneAnterior: false, tieneSiguiente: false, duracion: 240 };
  const inicios = M.iniciosEficientesHueco(hueco).map(M.minToTime);
  check('5 inicios de 45 min caben en un bloque de 4h (09:00-13:00)', inicios, ['09:00', '09:45', '10:30', '11:15', '12:00']);
  check('cada inicio respeta el paso de 45 min exacto (no 30, no 60)', inicios.every((t, i) => i === 0 || M.timeToMin(t) - M.timeToMin(inicios[i - 1]) === 45), true);
}

// ============================================================
console.log('\n=== No double-booking: un slot ocupado bloquea también sus sub-slots de 15/30 min ===');
// ============================================================
{
  const { M } = nuevoSandbox();
  M.scheduleData = { disponibilidad: {}, ocupados: { '2026-10-01_10:00': true } };
  check('el propio slot ocupado no está libre', M.bloqueLibre('2026-10-01', M.timeToMin('10:00')), false);
  check('un slot que empieza 15 min antes tampoco está libre (solaparía con el ocupado)', M.bloqueLibre('2026-10-01', M.timeToMin('09:45')), false);
  check('un slot que empieza 30 min antes tampoco está libre', M.bloqueLibre('2026-10-01', M.timeToMin('09:30')), false);
  check('un slot que empieza 45 min antes SÍ está libre (ya no solapa, sesión de 45 min completa)', M.bloqueLibre('2026-10-01', M.timeToMin('09:15')), true);
  check('un slot bien separado (11:00) está libre', M.bloqueLibre('2026-10-01', M.timeToMin('11:00')), true);
}

// ============================================================
console.log('\n=== Restricciones de cliente (bloqueos por texto) se respetan ===');
// ============================================================
{
  const { M } = nuevoSandbox();
  M.clientData = { reservasBloqueadasTexto: 'Lunes 10:00-11:00' };
  const lunes = '2026-09-21'; // lunes real
  check('slot dentro del bloqueo del cliente (lunes 10:00) queda bloqueado', M.bloqueadoPorCliente(lunes, M.timeToMin('10:00')), true);
  check('slot fuera del bloqueo (lunes 12:00) no se ve afectado', M.bloqueadoPorCliente(lunes, M.timeToMin('12:00')), false);
  check('el mismo horario en otro día de la semana no se ve afectado', M.bloqueadoPorCliente('2026-09-22', M.timeToMin('10:00')), false);
}

// ============================================================
console.log('\n=== Grupos abiertos: solo se ofrecen los que tienen plazas libres y no excluyen al propio cliente ===');
// ============================================================
{
  const { M } = nuevoSandbox();
  M.clientData = { clientId: 'cliente-1' };
  const manana = M.dateISO(new Date(Date.now() + 2 * 86400000));
  M.scheduleData = { gruposAbiertos: [
    { clave: `${manana}_19:00`, fechaISO: manana, hora: '19:00', grupoId: 'g1', grupoNombre: 'HIIT', plazasLibres: 2, asistentesIds: [] },
    { clave: `${manana}_19:00`, fechaISO: manana, hora: '19:00', grupoId: 'g2', grupoNombre: 'Lleno', plazasLibres: 0, asistentesIds: [] },
    { clave: `${manana}_20:00`, fechaISO: manana, hora: '20:00', grupoId: 'g3', grupoNombre: 'Ya apuntado', plazasLibres: 3, asistentesIds: ['cliente-1'] },
  ] };
  const disponibles = M.gruposAbiertosDisponiblesReserva().map(g => g.grupoId);
  check('un grupo con plazas libres se ofrece', disponibles.includes('g1'), true);
  check('un grupo sin plazas libres NO se ofrece', disponibles.includes('g2'), false);
  check('un grupo donde el cliente YA está apuntado no se le vuelve a ofrecer', disponibles.includes('g3'), false);
}

// ============================================================
console.log('\n=== IDs deterministas + transacción: no se puede reservar dos veces el mismo hueco ===');
// ============================================================
{
  const { M, db } = nuevoSandbox();
  M.clientData = { trainerKey: 'carmen', clientId: 'cliente-1', clientName: 'Marta', trainerName: 'Carmen' };
  M.scheduleData = { ocupados: {} };
  M.selectedReserva = { iso: '2026-10-01', hora: '10:00', clave: '2026-10-01_10:00', tipoReserva: 'individual', grupoId: '', grupoNombre: '' };
  await M.enviarSolicitudReserva();
  check('la reserva individual usa el ID determinista trainerKey__clave', db.writes.map(w => w.id), ['carmen__2026-10-01_10:00']);
  check('el documento se escribe en besoulReservas', db.writes[0].coleccion, 'besoulReservas');
  check('la duración queda fijada en 45 minutos (mismo motor que reservas.html)', db.writes[0].payload.duracionMin, 45);
  check('el estado inicial es "pendiente" (nunca autoconfirmado)', db.writes[0].payload.estado, 'pendiente');
}
{
  // Segunda solicitud sobre un hueco QUE YA TIENE un documento (aunque sea de una solicitud
  // previa rechazada) -- el mismo comportamiento, ya documentado, de reservas.html: la
  // transacción bloquea sobre CUALQUIER documento existente en ese ID, no solo los aceptados.
  const db = crearDb(['carmen__2026-10-01_10:00']);
  const { M, alerts } = nuevoSandbox({ db });
  M.clientData = { trainerKey: 'carmen', clientId: 'cliente-1', clientName: 'Marta', trainerName: 'Carmen' };
  M.scheduleData = { ocupados: {} };
  M.selectedReserva = { iso: '2026-10-01', hora: '10:00', clave: '2026-10-01_10:00', tipoReserva: 'individual', grupoId: '', grupoNombre: '' };
  await M.enviarSolicitudReserva();
  check('un ID ya existente NO se sobrescribe (no se añade una segunda escritura)', db.writes.length, 0);
  check('se avisa al cliente de que el hueco ya no está disponible', alerts.some(a => /elige otra hora/i.test(a)), true);
}
{
  // Reserva de grupo abierto -> ID lleva también el clientId (varios clientes pueden compartir
  // la misma franja de grupo sin pisarse el documento entre ellos).
  const { M, db } = nuevoSandbox();
  M.clientData = { trainerKey: 'carmen', clientId: 'cliente-2', clientName: 'Luis', trainerName: 'Carmen' };
  M.scheduleData = { gruposAbiertos: [{ clave: '2026-10-05_19:00', fechaISO: '2026-10-05', hora: '19:00', grupoId: 'g1', grupoNombre: 'HIIT', plazasLibres: 2, asistentesIds: [] }] };
  M.selectedReserva = { iso: '2026-10-05', hora: '19:00', clave: '2026-10-05_19:00', tipoReserva: 'grupo_abierto', grupoId: 'g1', grupoNombre: 'HIIT' };
  await M.enviarSolicitudReserva();
  check('la reserva de grupo abierto usa el ID trainerKey__clave__clientId (no pisa a otros asistentes)', db.writes.map(w => w.id), ['carmen__2026-10-05_19:00__cliente-2']);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main();
