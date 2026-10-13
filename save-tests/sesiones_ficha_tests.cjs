// HOTFIX-V1-SESIONES-FICHA-P0 (2026-10-13): pruebas de actualizarNombreEnAgendaSiCambia() extraída
// verbatim de agenda.html. Antes sustituía cada sesión por su ficha (pérdida de duracionMin,
// recurrencia y tarifas históricas; demostrado en producción). Ejecutar: node save-tests/sesiones_ficha_tests.cjs
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');

function extraerFuncion(nombre) {
  const m = new RegExp(`function\\s+${nombre}\\s*\\(`).exec(html);
  if (!m) throw new Error(`No se encontró ${nombre}`);
  let i = html.indexOf('{', m.index), prof = 0;
  for (; i < html.length; i++) { if (html[i] === '{') prof++; else if (html[i] === '}' && --prof === 0) { i++; break; } }
  return html.slice(m.index, i);
}
const constante = /const\s+BS_CAMPOS_FICHA_NO_SESION\s*=\s*[^;]+;/.exec(html)[0];

function crear({ dbClientes, dbAgenda, entrenadorVisto, hoy }) {
  let guardados = 0;
  const localStorage = { setItem() {} };
  const RealDate = Date;
  class FechaFija extends RealDate { constructor(...a) { super(...(a.length ? a : [hoy])); } }
  const fn = new Function('dbClientes', 'dbAgenda', 'entrenadorVisto', 'localStorage', 'programarGuardadoNubeAgenda', 'Date',
    `${constante}\n${extraerFuncion('formatoFechaLocal')}\n${extraerFuncion('actualizarNombreEnAgendaSiCambia')}\nreturn actualizarNombreEnAgendaSiCambia;`);
  const f = fn(dbClientes, dbAgenda, entrenadorVisto, localStorage, () => { guardados++; }, FechaFija);
  return { f, guardados: () => guardados };
}

let pass = 0, fail = 0;
function check(desc, actual, esperado) {
  const ok = JSON.stringify(actual) === JSON.stringify(esperado);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok ? '' : ` :: got=${JSON.stringify(actual)} expected=${JSON.stringify(esperado)}`}`);
}

const PORTAL = { contratoCliente: 'texto largo', reservaToken: 'tok', restriccionesReservas: { x: 1 }, reservasBloqueadasTexto: '', reservasOnlineActivas: true };
function escenario() {
  const ficha = { id: 'c1', nombre: 'Nombre Nuevo', telefono: '600', email: 'n@x', modalidad: 'TARIFA_NUEVA', descuentoPct: 10, ...PORTAL };
  const otra = { id: 'c2', nombre: 'Otra', modalidad: 'TARIFA_OTRA' };
  const dbClientes = { a: [ficha, otra] };
  const dbAgenda = { a: {
    '2026-09-01_10:00': { id: 'c1', nombre: 'Nombre Viejo', modalidad: 'TARIFA_ANTIGUA', descuentoPct: 0, duracionMin: 45, recurrente: true, serieRecurrenteId: 'r1' },
    '2026-10-20_10:00': { id: 'c1', nombre: 'Nombre Viejo', modalidad: 'TARIFA_ANTIGUA', duracionMin: 60, estadoCancelacion: 'cancelada_fuera_plazo', asistentesGrupoAbierto: [{ id: 'z' }] },
    '2026-10-13_08:00': { id: 'c1', nombre: 'Nombre Viejo', modalidad: 'TARIFA_ANTIGUA', origenReservaCliente: true, solicitudReservaId: 's1' },
    '2026-09-02_10:00': { id: 'c2', nombre: 'Otra (vieja)', modalidad: 'TARIFA_OTRA_ANTIGUA', duracionMin: 45 },
  } };
  return { dbClientes, dbAgenda };
}

{
  const { dbClientes, dbAgenda } = escenario();
  const s = crear({ dbClientes, dbAgenda, entrenadorVisto: 'a', hoy: '2026-10-13T12:00:00' });
  s.f('c1');
  const pasada = dbAgenda.a['2026-09-01_10:00'];
  const futura = dbAgenda.a['2026-10-20_10:00'];
  const hoy = dbAgenda.a['2026-10-13_08:00'];
  check('F1 pasada: conserva tarifa y descuento de su momento', [pasada.modalidad, pasada.descuentoPct], ['TARIFA_ANTIGUA', 0]);
  check('F2 pasada: conserva duracionMin y recurrencia', [pasada.duracionMin, pasada.recurrente, pasada.serieRecurrenteId], [45, true, 'r1']);
  check('F3 pasada: actualiza nombre/teléfono/email', [pasada.nombre, pasada.telefono, pasada.email], ['Nombre Nuevo', '600', 'n@x']);
  check('F4 futura: recibe tarifa actual (comportamiento previo)', futura.modalidad, 'TARIFA_NUEVA');
  check('F5 futura: conserva campos propios (duración 60, cancelación, asistentes)', [futura.duracionMin, futura.estadoCancelacion, futura.asistentesGrupoAbierto], [60, 'cancelada_fuera_plazo', [{ id: 'z' }]]);
  check('F6 hoy cuenta como no pasada y conserva origen de reserva', [hoy.modalidad, hoy.origenReservaCliente, hoy.solicitudReservaId], ['TARIFA_NUEVA', true, 's1']);
  check('F7 ninguna sesión recibe los 5 campos de portal/contrato', Object.values(dbAgenda.a).flatMap(x => Object.keys(PORTAL).filter(k => k in x)), []);
  check('F8 sesión de OTRA ficha intacta', dbAgenda.a['2026-09-02_10:00'], { id: 'c2', nombre: 'Otra (vieja)', modalidad: 'TARIFA_OTRA_ANTIGUA', duracionMin: 45 });
  check('F9 la sesión no comparte referencia con la ficha', futura === dbClientes.a[0], false);
  check('F10 programa un guardado', s.guardados(), 1);
  dbClientes.a[0].modalidad = 'MUTADA';
  check('F11 mutar la ficha después no altera la sesión', futura.modalidad, 'TARIFA_NUEVA');
}
{
  const { dbClientes, dbAgenda } = escenario();
  const antes = JSON.stringify(dbAgenda);
  const s = crear({ dbClientes, dbAgenda, entrenadorVisto: 'a', hoy: '2026-10-13T12:00:00' });
  s.f();
  check('F12 sin id de ficha no toca nada ni guarda', [JSON.stringify(dbAgenda) === antes, s.guardados()], [true, 0]);
  s.f('c1'); s.f('c1');
  check('F13 idempotente: la segunda llamada no programa otro guardado', s.guardados(), 1);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
