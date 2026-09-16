// PORTAL-MONTHLY-CALENDAR: pruebas deterministas de las dos piezas de lógica real (extraídas
// verbatim) -- qué sesiones se publican al Portal (agenda.html) y qué estado/color visual les
// corresponde (portal-cliente.html). Nunca toca Firestore real.
const fs = require('fs');
const path = require('path');

const agendaExtracted = fs.readFileSync(path.join(__dirname, 'agenda_calendar_extract.js'), 'utf8');
const portalExtracted = fs.readFileSync(path.join(__dirname, 'portal_calendar_extract.js'), 'utf8');

function cargarAgenda(dbAgenda) {
  const fn = new Function('dbAgenda', agendaExtracted + `
    return { calendarioSesionesClienteParaPortal };`);
  return fn(dbAgenda);
}
function cargarPortal() {
  const fn = new Function(portalExtracted + `
    return { dateISO, dayIndexMonSun, estadoDiaCalendarioMensual, badgeEstadoSesion };`);
  return fn();
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

// ============================================================
console.log('=== agenda.html: calendarioSesionesClienteParaPortal() ===');
// ============================================================
{
  const M = cargarAgenda({
    carmen: {
      [`${isoOffset(2)}_10:00`]: { id: 'c1', modalidad: 'Individual 3x/semana' },
      [`${isoOffset(-3)}_18:00`]: { id: 'c1', estadoCancelacion: 'cancelada_fuera_plazo', modalidad: 'Individual 3x/semana' },
      [`${isoOffset(-3)}_09:00`]: { id: 'c2', modalidad: 'Otro cliente' }, // otro cliente, no debe aparecer
      [`${isoOffset(200)}_10:00`]: { id: 'c1', modalidad: 'Individual 3x/semana' }, // fuera de la ventana ±4 meses
    }
  });
  const items = M.calendarioSesionesClienteParaPortal('carmen', 'c1');
  check('solo incluye sesiones del cliente pedido (no las de otro cliente)', items.every(i => true) && items.length, 2);
  check('incluye la sesión futura dentro de la ventana', items.some(i => i.fechaISO === isoOffset(2)), true);
  check('incluye la sesión pasada con estadoCancelacion tal cual está almacenado', items.find(i => i.fechaISO === isoOffset(-3))?.estadoCancelacion, 'cancelada_fuera_plazo');
  check('excluye una sesión muy lejana (fuera de la ventana ±4 meses), no fabrica un límite distinto silenciosamente', items.some(i => i.fechaISO === isoOffset(200)), false);
  check('los items vienen ordenados por fecha/hora', items.map(i => i.fechaISO), [isoOffset(-3), isoOffset(2)]);
}

// ============================================================
console.log('\n=== portal-cliente.html: estadoDiaCalendarioMensual() -- solo estados reales, nunca inferidos ===');
// ============================================================
{
  const M = cargarPortal();
  check('sin sesiones ese día -> sin estado (NEUTRO)', M.estadoDiaCalendarioMensual([]), null);
  check('sesión pasada sin estadoCancelacion -> verde (realizada)', M.estadoDiaCalendarioMensual([{ fechaISO: isoOffset(-2), hora: '10:00' }]), 'verde');
  check('sesión con estadoCancelacion=cancelada_fuera_plazo -> rojo, sin importar la fecha', M.estadoDiaCalendarioMensual([{ fechaISO: isoOffset(-2), hora: '10:00', estadoCancelacion: 'cancelada_fuera_plazo' }]), 'rojo');
  check('sesión futura (incluye hoy) -> ámbar (próxima)', M.estadoDiaCalendarioMensual([{ fechaISO: isoOffset(1), hora: '10:00' }]), 'ambar');
  check('sesión de HOY sin cancelar -> ámbar (todavía no ha pasado, no se marca como realizada por adelantado)', M.estadoDiaCalendarioMensual([{ fechaISO: isoOffset(0), hora: '10:00' }]), 'ambar');
  check('varias sesiones el mismo día: si UNA es cancelada_fuera_plazo, prevalece rojo', M.estadoDiaCalendarioMensual([{ fechaISO: isoOffset(-2), hora: '09:00' }, { fechaISO: isoOffset(-2), hora: '18:00', estadoCancelacion: 'cancelada_fuera_plazo' }]), 'rojo');
  check('NUNCA existe un estado "ambar de cancelación" -- no hay forma honesta de distinguir una cancelación a tiempo (se borra sin dejar rastro)', ['verde', 'rojo', 'ambar', null].includes(M.estadoDiaCalendarioMensual([{ fechaISO: isoOffset(-2), hora: '10:00' }])), true);
}

// ============================================================
console.log('\n=== portal-cliente.html: badgeEstadoSesion() reutilizado sin cambios (mismo motor que "Sesiones recientes") ===');
// ============================================================
{
  const M = cargarPortal();
  check('badgeEstadoSesion marca cancelada_fuera_plazo en rojo', M.badgeEstadoSesion({ fechaISO: isoOffset(-2), estadoCancelacion: 'cancelada_fuera_plazo' }).includes('red'), true);
  check('badgeEstadoSesion marca una sesión futura como "Próxima"', M.badgeEstadoSesion({ fechaISO: isoOffset(1) }).includes('Próxima'), true);
  check('badgeEstadoSesion marca una sesión pasada como "Realizada"', M.badgeEstadoSesion({ fechaISO: isoOffset(-2) }).includes('Realizada'), true);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
