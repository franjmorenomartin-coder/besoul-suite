// FIN-GRUPO-02: pruebas reales del motor económico, extrayendo el código REAL de agenda.html
// verbatim (mismo patrón que assistant-tests) -- nunca una reimplementación paralela.
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'finance_extract.js'), 'utf8');

function claveMesVisible() { return '2026-09'; }
function calcularFacturacionActividadFicha() { return { total: 0 }; }
const dbClientes = {};
let entrenadorVisto = 'carmen';

const fn = new Function(
  'dbClientes', 'entrenadorVisto', 'claveMesVisible', 'calcularFacturacionActividadFicha',
  extracted + `
  return {
    TARIFAS_2026, tarifaBaseFicha, multiplicadorFacturacionFicha, obtenerDescuentoFicha,
    aplicarDescuentoImporte, normalizarPorcentajeDescuento, esGrupoAbierto, esFichaMiembroGrupo,
    importeEfectivoCliente, fichasMiembrosGrupo, calcularFacturacionGrupoTotal,
    calcularFacturacionEstadisticaMiembro, calcularFacturacionFicha, sesionesContratadasFicha,
    buscarFichaPorId
  };`
);

const M = fn(dbClientes, entrenadorVisto, claveMesVisible, calcularFacturacionActividadFicha);

let pass = 0, fail = 0;
function check(desc, actual, expected, tol = 0.001) {
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < tol : actual === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function nuevoGrupoConMiembros(miembrosDescuentos, modalidad = 'Grupo Reducido Plan', factor = 1) {
  dbClientes.carmen = [];
  const grupo = {
    id: 'grp_1', tipo: 'grupo', nombre: 'Grupo Test', modalidad, factor,
    tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber',
    descuentoPct: 0, estadoCliente: 'activo',
    integrantesObj: miembrosDescuentos.map((d, i) => ({ id: `m${i}`, nombre: `M${i}`, telefono: '600', email: `m${i}@x.com` }))
  };
  dbClientes.carmen.push(grupo);
  miembrosDescuentos.forEach((d, i) => {
    dbClientes.carmen.push({
      id: `cli_member_grp_1_m${i}`, tipo: 'individual', nombre: `M${i}`, telefono: '600', email: `m${i}@x.com`,
      modalidad: 'Miembro Subordinado', factor, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber',
      descuentoPct: d, estadoCliente: 'activo', vinculacion: 'grp_1', memberId: `m${i}`, grupoNombre: 'Grupo Test'
    });
  });
  return grupo;
}

console.log('=== CASO 1: 3 clientes sin descuento -> total = suma exacta ===');
{
  const grupo = nuevoGrupoConMiembros([0, 0, 0]);
  const base = M.tarifaBaseFicha(grupo); // precio por persona a factor 1
  check('total sin descuentos = 3 x base', M.calcularFacturacionGrupoTotal(grupo), base * 3);
}

console.log('\n=== CASO 2: 1 cliente con descuento -> solo cambia su aportacion ===');
{
  const grupo = nuevoGrupoConMiembros([10, 0, 0]); // A: 10%, B: 0%, C: 0%
  const base = M.tarifaBaseFicha(grupo);
  const total = M.calcularFacturacionGrupoTotal(grupo);
  check('total = A(90%) + B + C', total, base * 0.9 + base + base);
  const fichaB = M.buscarFichaPorId('cli_member_grp_1_m1');
  const fichaC = M.buscarFichaPorId('cli_member_grp_1_m2');
  check('B no cambia (sin descuento)', M.importeEfectivoCliente(fichaB), base);
  check('C no cambia (sin descuento)', M.importeEfectivoCliente(fichaC), base);
  check('tarifa base del grupo no cambia', M.tarifaBaseFicha(grupo), base);
}

console.log('\n=== CASO 3 / B1 (enunciado exacto): 3 descuentos distintos -> total = suma de importes finales ===');
{
  // Ejemplo literal del enunciado: base 60€, descuentos 10/0/20 -> 54+60+48 = 162, NO 180.
  const grupo = nuevoGrupoConMiembros([10, 0, 20], 'Grupo Reducido Plan', 2); // factor 2 -> TARIFAS_2026 = 80 total... se ajusta abajo con base real
  const base = M.tarifaBaseFicha(grupo);
  const esperado = base * 0.9 + base * 1.0 + base * 0.8;
  check('total = suma de importes finales (no tarifa x n)', M.calcularFacturacionGrupoTotal(grupo), esperado);
  check('total != tarifa x n con un solo descuento', M.calcularFacturacionGrupoTotal(grupo) === base * 3, false);
}

console.log('\n=== CASO 6 (B/K): editar telefono/email NO cambia el total economico ===');
{
  const grupo = nuevoGrupoConMiembros([15, 0, 0]);
  const antes = M.calcularFacturacionGrupoTotal(grupo);
  const fichaA = M.buscarFichaPorId('cli_member_grp_1_m0');
  fichaA.telefono = '699999999';
  fichaA.email = 'nuevo@x.com';
  const despues = M.calcularFacturacionGrupoTotal(grupo);
  check('total igual tras cambiar solo telefono/email', despues, antes);
}

console.log('\n=== CASO 7: quitar cliente del grupo -> deja de computar ===');
{
  const grupo = nuevoGrupoConMiembros([0, 20, 0]);
  const base = M.tarifaBaseFicha(grupo);
  const antes = M.calcularFacturacionGrupoTotal(grupo);
  check('antes de quitar: 3 miembros', antes, base + base * 0.8 + base);
  // Simula "quitar cliente del grupo": se retira del roster y de dbClientes (igual que hace
  // sincronizarIntegrantesGrupo cuando el integrante ya no está en integrantesObj).
  grupo.integrantesObj = grupo.integrantesObj.filter(m => m.id !== 'm1');
  dbClientes.carmen = dbClientes.carmen.filter(c => c.memberId !== 'm1');
  const despues = M.calcularFacturacionGrupoTotal(grupo);
  check('despues de quitar: ya no computa ese miembro', despues, base + base);
}

console.log('\n=== PLAN-01 / C: Bono 8 = mismo precio TOTAL que Bono 10 equivalente ===');
{
  check('Bono 8 Individual == Bono 10 Individual (precio total)', M.TARIFAS_2026['Individual Bono 8'][8], M.TARIFAS_2026['Individual Bono'][10]);
  check('Bono 8 Grupo Reducido == Bono 10 Grupo Reducido (precio total, por persona)', M.TARIFAS_2026['Grupo Reducido Bono 8'][8], M.TARIFAS_2026['Grupo Reducido Bono'][10]);

  const fichaBono8Ind = { tipo: 'individual', modalidad: 'Individual Bono 8', factor: 8, tipoCompra: 'Bono', descuentoPct: 0 };
  check('sesionesContratadasFicha Bono 8 Individual = 8', M.sesionesContratadasFicha(fichaBono8Ind), 8);
  const fichaBono10Ind = { tipo: 'individual', modalidad: 'Individual Bono', factor: 10, tipoCompra: 'Bono', descuentoPct: 0 };
  check('sesionesContratadasFicha Bono 10 Individual = 10 (no roto por Bono 8)', M.sesionesContratadasFicha(fichaBono10Ind), 10);
  check('Bono 8 no se comporta como Bono 10 (sesiones distintas)', M.sesionesContratadasFicha(fichaBono8Ind) === M.sesionesContratadasFicha(fichaBono10Ind), false);

  check('facturacion Bono 8 Individual == facturacion Bono 10 Individual (mismo precio total)',
    M.calcularFacturacionFicha(fichaBono8Ind), M.calcularFacturacionFicha(fichaBono10Ind));
}

console.log('\n=== C4/C7: Bono 8 Grupo reducido + descuento individual ===');
{
  dbClientes.carmen = [];
  const grupoBono8 = {
    id: 'grp_bono8', tipo: 'grupo', nombre: 'Grupo Bono8', modalidad: 'Grupo Reducido Bono 8', factor: 8,
    tipoCompra: 'Bono', fechaCompra: '2026-09-01', color: 'amber', descuentoPct: 0, estadoCliente: 'activo',
    integrantesObj: [{ id: 'm0', nombre: 'A', telefono: '600', email: 'a@x.com' }, { id: 'm1', nombre: 'B', telefono: '600', email: 'b@x.com' }]
  };
  dbClientes.carmen.push(grupoBono8);
  dbClientes.carmen.push({ id: 'cli_member_grp_bono8_m0', tipo: 'individual', nombre: 'A', modalidad: 'Miembro Subordinado', factor: 8, tipoCompra: 'Bono', fechaCompra: '2026-09-01', color: 'amber', descuentoPct: 25, estadoCliente: 'activo', vinculacion: 'grp_bono8', memberId: 'm0' });
  dbClientes.carmen.push({ id: 'cli_member_grp_bono8_m1', tipo: 'individual', nombre: 'B', modalidad: 'Miembro Subordinado', factor: 8, tipoCompra: 'Bono', fechaCompra: '2026-09-01', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', vinculacion: 'grp_bono8', memberId: 'm1' });

  const basePersona = M.tarifaBaseFicha(grupoBono8); // precio por persona del Bono 8 grupo reducido == Bono 10 grupo reducido
  const esperado = basePersona * 0.75 + basePersona;
  check('total grupo Bono8 con descuento individual = suma de importes efectivos (no precio teorico)', M.calcularFacturacionGrupoTotal(grupoBono8), esperado);
  check('nunca suma el precio teorico sin descuento', M.calcularFacturacionGrupoTotal(grupoBono8) === basePersona * 2, false);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) process.exitCode = 1;
