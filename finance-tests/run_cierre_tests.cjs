// QA-BESOUL-MEGA-V3-CONT: "closed months immutable" -- un mes cerrado (dbFinanzas.historico[key]
// existe) bloquea toda mutación de gastos/otros ingresos salvo que se reabra explícitamente
// (mesCerradoEditando === key). Extraído VERBATIM de finanzas.html (cierre_extract.js). Sin
// datos reales, sin Firestore -- guardarConfigFinanzas() se sustituye por un contador local.
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'cierre_extract.js'), 'utf8');

function nuevoSandbox() {
  let guardados = 0;
  const alerts = [];
  const preamble = `
    function etiquetaMes(key){ return key; }
    function parseNum(v){ const n = parseFloat(String(v ?? '').replace(',','.')); return Number.isNaN(n) ? 0 : n; }
    const usuarioFinanzasEmail = 'test@besoul.local';
    function guardarConfigFinanzas(){ _guardar(); }
  `;
  const fn = new Function('alert', 'confirm', '_guardar', preamble + extracted + `
    return {
      set dbFinanzas(v) { dbFinanzas = v; },
      get dbFinanzas() { return dbFinanzas; },
      set mesCerradoEditando(v) { mesCerradoEditando = v; },
      set mesSeleccionadoFinanzas(v) { mesSeleccionadoFinanzas = v; },
      mesEstaCerrado, mesEnEdicion, puedeEditarMes, obtenerMesGastos, obtenerMesIngresos,
      asegurarGastosMes, agregarGasto, editarGasto, borrarGasto,
      asegurarOtrosIngresosMes, agregarOtroIngreso
    };`);
  const M = fn((msg) => alerts.push(msg), () => true, () => { guardados++; });
  return { M, alerts, get guardados() { return guardados; } };
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// ============================================================
console.log('=== Mes abierto: gastos/otros ingresos se pueden crear y editar con normalidad ===');
// ============================================================
{
  const { M } = nuevoSandbox();
  M.dbFinanzas = { historico: {}, gastos: {}, otrosIngresos: {} };
  M.mesSeleccionadoFinanzas = '2026-09';
  check('un mes sin cierre en histórico no está cerrado', M.mesEstaCerrado('2026-09'), false);
  M.agregarGasto();
  check('se puede añadir un gasto en un mes abierto', (M.dbFinanzas.gastos['2026-09'] || []).length, 1);
  M.editarGasto(0, 'importe', '150');
  check('se puede editar el importe de un gasto en un mes abierto', M.dbFinanzas.gastos['2026-09'][0].importe, 150);
}

// ============================================================
console.log('\n=== Mes CERRADO: ninguna mutación se aplica salvo que se reabra explícitamente ===');
// ============================================================
{
  const sandbox = nuevoSandbox();
  const { M, alerts } = sandbox;
  M.dbFinanzas = { historico: { '2026-08': { total: { facturacion: 1000 } } }, gastos: { '2026-08': [{ categoria: 'Otros', concepto: 'Original', tipo: 'fijo', importe: 100 }] }, otrosIngresos: {} };
  M.mesSeleccionadoFinanzas = '2026-08';
  check('el mes queda marcado como cerrado', M.mesEstaCerrado('2026-08'), true);

  const antesGastos = JSON.parse(JSON.stringify(M.dbFinanzas.gastos['2026-08']));
  M.agregarGasto();
  check('agregarGasto() en un mes cerrado NO añade nada', M.dbFinanzas.gastos['2026-08'], antesGastos);
  M.editarGasto(0, 'importe', '999999');
  check('editarGasto() en un mes cerrado NO modifica el importe original', M.dbFinanzas.gastos['2026-08'][0].importe, 100);
  M.borrarGasto(0);
  check('borrarGasto() en un mes cerrado NO borra el gasto original', M.dbFinanzas.gastos['2026-08'].length, 1);
  M.agregarOtroIngreso();
  check('agregarOtroIngreso() en un mes cerrado NO añade nada', (M.dbFinanzas.otrosIngresos['2026-08'] || []).length, 0);
  check('ninguna de las mutaciones bloqueadas llegó a disparar un guardado (nunca se escribió nada)', sandbox.guardados, 0);
  check('el PT/admin recibe aviso explícito de que el mes está bloqueado', alerts.some(a => /cerrado y bloqueado/i.test(a)), true);
}

// ============================================================
console.log('\n=== Mes CERRADO pero REABIERTO explícitamente: las mutaciones sí se aplican ===');
// ============================================================
{
  const sandbox = nuevoSandbox();
  const { M } = sandbox;
  M.dbFinanzas = { historico: { '2026-08': { total: { facturacion: 1000 } } }, gastos: { '2026-08': [{ categoria: 'Otros', concepto: 'Original', tipo: 'fijo', importe: 100 }] }, otrosIngresos: {} };
  M.mesSeleccionadoFinanzas = '2026-08';
  M.mesCerradoEditando = '2026-08';
  check('mesEnEdicion() reconoce la reapertura explícita de ESTE mes', M.mesEnEdicion('2026-08'), true);
  M.editarGasto(0, 'importe', '250');
  check('con el mes reabierto, editarGasto() SÍ aplica el cambio', M.dbFinanzas.gastos['2026-08'][0].importe, 250);
  check('la edición permitida sí dispara un guardado', sandbox.guardados, 1);

  check('reabrir el mes 2026-08 NO reabre ningún otro mes cerrado', M.mesEnEdicion('2026-07'), false);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
