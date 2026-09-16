// FIX-GROUP-MEMBER-ECONOMICS: pruebas reales del PREVIEW del modal (autoCalcularTarifa /
// actualizarPreviewContadorModal), extraidas verbatim de agenda.html, simulando el DOM real --
// incluido el hecho de que <select id="cust-mod"> NUNCA tiene una <option value="Miembro
// Subordinado"> (por eso, para un integrante, su .value queda en '' -- comportamiento REAL del
// DOM, no una suposicion).
//
// CAUSA RAIZ (confirmada, no un bug del motor economico): autoCalcularTarifa() y
// actualizarPreviewContadorModal() leen cust-mod/cust-factor DIRECTAMENTE del DOM. Para un
// integrante de grupo esos campos estan deshabilitados (CLIENT-08) Y su <select> nunca tuvo una
// <option> que encajara con 'Miembro Subordinado' -- el value queda vacio, TARIFAS_2026[''] es
// undefined, y el preview mostraba 0,00 € en precio base/facturacion/rentabilidad, y "-0.00 €"
// de descuento por mucho que se pusiera un 50%. El importe REALMENTE GUARDADO
// (facturacionEstadistica, via importeEfectivoCliente -> tarifaBaseFicha(fichaGrupo)) NUNCA leyo
// el DOM, asi que siempre fue correcto -- por eso Agenda mostraba 80€ (real) mientras la ficha
// mostraba 0€ (bug de preview, no del dato).
const fs = require('fs');
const path = require('path');
const extracted = fs.readFileSync(path.join(__dirname, 'group_extract.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
// check(desc, actual, expected): compara por IGUALDAD ESTRICTA -- nunca "actual es truthy". Un
// string no vacio (p.ej. una etiqueta con el valor INCORRECTO) es truthy pero no debe pasar.
function check(desc, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else { fail++; fails.push(`${desc} :: esperado=${JSON.stringify(expected)} obtenido=${JSON.stringify(actual)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}`);
}

function makeSelect(value, options) {
  return {
    _value: options.includes(value) ? value : '', // COMPORTAMIENTO REAL DEL DOM: value sin <option> coincidente -> ''
    get value() { return this._value; },
    set value(v) { this._value = options.includes(v) ? v : ''; },
  };
}
function makeInput(value) {
  return { _value: value, get value() { return this._value; }, set value(v) { this._value = v; } };
}

const MOD_OPTIONS = ['Individual Plan','Individual Suelta','Individual Bono 8','Individual Bono','Pareja','Trío','Grupo Reducido Plan','Grupo Reducido Suelta','Grupo Reducido Bono 8','Grupo Reducido Bono','Grupo Aire Libre'];
const FACTOR_1_5 = ['1','2','3','4','5'];

// Ejecuta autoCalcularTarifa()+actualizarPreviewContadorModal() reales contra un DOM simulado
// que reproduce EXACTAMENTE el estado del modal cuando se edita un integrante: cust-mod/
// cust-factor muestran '' (sin <option> coincidente, ya deshabilitados por CLIENT-08),
// cust-discount es el unico campo editable real.
function ejecutarPreview({ dbClientesIniciales, idFichaEditando, entrenadorVisto = 'carmen', descuentoInput = '0', tabFichaActiva = 'individual' }) {
  const dbClientes = { [entrenadorVisto]: JSON.parse(JSON.stringify(dbClientesIniciales)) };
  const labels = {};
  const elementos = {
    'cust-mod': makeSelect('', MOD_OPTIONS), // '' reproduce fielmente el <select> tras el intento fallido de fijar 'Miembro Subordinado'
    'cust-factor': makeSelect('', FACTOR_1_5),
    'cust-discount': makeInput(descuentoInput),
    'cust-purchase-type': makeSelect('Mensualidad', ['Mensualidad', 'Bono']),
    'cust-bono-date': makeInput(''),
    'lbl-tarifa-calculada': { set innerText(v) { labels['lbl-tarifa-calculada'] = v; }, get innerText() { return labels['lbl-tarifa-calculada']; } },
    'lbl-precio-base': { set innerText(v) { labels['lbl-precio-base'] = v; }, get innerText() { return labels['lbl-precio-base']; } },
    'lbl-descuento-aplicado': { set innerText(v) { labels['lbl-descuento-aplicado'] = v; }, get innerText() { return labels['lbl-descuento-aplicado']; } },
    'lbl-rentabilidad-sesion': { set innerText(v) { labels['lbl-rentabilidad-sesion'] = v; }, get innerText() { return labels['lbl-rentabilidad-sesion']; } },
    'lbl-contador-preview': { set innerHTML(v) { labels['lbl-contador-preview'] = v; }, get innerHTML() { return labels['lbl-contador-preview']; } },
  };
  const document = { getElementById: (id) => elementos[id] || null, querySelectorAll: () => [] };
  const lunesActual = new Date('2026-09-15T00:00:00'); // lunesActual es un Date real en agenda.html, no una funcion
  function sumarMeses(d) { return d; }
  function formatoFechaCorta(d) { return String(d); }

  const fn = new Function(
    'document', 'dbClientes', 'entrenadorVisto', 'idFichaEditando', 'tabFichaActiva', 'lunesActual', 'sumarMeses', 'formatoFechaCorta',
    extracted + '\nautoCalcularTarifa();\nreturn true;'
  );
  fn(document, dbClientes, entrenadorVisto, idFichaEditando, tabFichaActiva, lunesActual, sumarMeses, formatoFechaCorta);
  return labels;
}

// ============================================================
console.log('=== NEGATIVE CONTROL: reproduce el bug reportado tal cual (Agenda 80€, ficha 0€) ===');
// ============================================================
{
  const grupo = { id: 'grp_los100', tipo: 'grupo', nombre: 'LOS 100', modalidad: 'Grupo Reducido Plan', factor: 2, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', integrantesObj: [{ id: 'm_juan', nombre: 'Juan', telefono: '600', email: 'juan@x.com' }] };
  const juan = { id: 'cli_member_los100_juan', tipo: 'individual', nombre: 'Juan', telefono: '600', email: 'juan@x.com', modalidad: 'Miembro Subordinado', factor: 2, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', vinculacion: 'grp_los100', memberId: 'm_juan', grupoNombre: 'LOS 100', facturacionEstadistica: 80 };

  const labels = ejecutarPreview({ dbClientesIniciales: [grupo, juan], idFichaEditando: 'cli_member_los100_juan', descuentoInput: '0' });
  check('CON EL FIX: precio base de Juan = 80,00 € (coincide con Agenda/facturacionEstadistica, NO 0,00 €)', labels['lbl-precio-base'], '80.00 €');
  check('CON EL FIX: facturación total de Juan sin descuento = 80,00 €', labels['lbl-tarifa-calculada'], '80.00 €');
  check('CON EL FIX: rentabilidad/sesión de Juan > 0 (no 0,00 €)', parseFloat(labels['lbl-rentabilidad-sesion']) > 0, true);

  const labelsConDescuento = ejecutarPreview({ dbClientesIniciales: [grupo, juan], idFichaEditando: 'cli_member_los100_juan', descuentoInput: '50' });
  check('CON EL FIX: descuento 50% sobre 80€ = -40,00 € (NO -0.00 €)', labelsConDescuento['lbl-descuento-aplicado'], 'Descuento: 50% · -40.00 €');
  check('CON EL FIX: facturación efectiva con 50% = 40,00 €', labelsConDescuento['lbl-tarifa-calculada'], '40.00 €');
}

// ============================================================
console.log('\n=== Miembro SIN descuento ===');
// ============================================================
{
  const grupo = { id: 'g1', tipo: 'grupo', nombre: 'G1', modalidad: 'Grupo Reducido Plan', factor: 1, tipoCompra: 'Mensualidad', integrantesObj: [{ id: 'm0', nombre: 'A' }] };
  const miembro = { id: 'cm1', tipo: 'individual', nombre: 'A', modalidad: 'Miembro Subordinado', factor: 1, vinculacion: 'g1', memberId: 'm0', descuentoPct: 0 };
  const labels = ejecutarPreview({ dbClientesIniciales: [grupo, miembro], idFichaEditando: 'cm1', descuentoInput: '0' });
  check('sin descuento: precio base = tarifa factor 1 (45,00 €)', labels['lbl-precio-base'], '45.00 €');
  check('sin descuento: facturación total = 45,00 €', labels['lbl-tarifa-calculada'], '45.00 €');
}

// ============================================================
console.log('\n=== Varios miembros con descuentos DIFERENTES -- editar uno no afecta al preview de otro ===');
// ============================================================
{
  const grupo = { id: 'g2', tipo: 'grupo', nombre: 'G2', modalidad: 'Grupo Reducido Plan', factor: 3, tipoCompra: 'Mensualidad', integrantesObj: [{ id: 'm0', nombre: 'A' }, { id: 'm1', nombre: 'B' }, { id: 'm2', nombre: 'C' }] };
  const a = { id: 'cm_a', tipo: 'individual', nombre: 'A', modalidad: 'Miembro Subordinado', factor: 3, vinculacion: 'g2', memberId: 'm0', descuentoPct: 10 };
  const b = { id: 'cm_b', tipo: 'individual', nombre: 'B', modalidad: 'Miembro Subordinado', factor: 3, vinculacion: 'g2', memberId: 'm1', descuentoPct: 0 };
  const c = { id: 'cm_c', tipo: 'individual', nombre: 'C', modalidad: 'Miembro Subordinado', factor: 3, vinculacion: 'g2', memberId: 'm2', descuentoPct: 20 };
  const base = 110; // TARIFAS_2026['Grupo Reducido Plan'][3]

  const labelsA = ejecutarPreview({ dbClientesIniciales: [grupo, a, b, c], idFichaEditando: 'cm_a', descuentoInput: '10' });
  check('A (10%): precio base = 110,00 € (tarifa del grupo, no cambia por su descuento)', labelsA['lbl-precio-base'], `${base.toFixed(2)} €`);
  check('A (10%): facturación efectiva = 99,00 €', labelsA['lbl-tarifa-calculada'], `${(base * 0.9).toFixed(2)} €`);

  const labelsB = ejecutarPreview({ dbClientesIniciales: [grupo, a, b, c], idFichaEditando: 'cm_b', descuentoInput: '0' });
  check('B (0%): precio base sigue siendo 110,00 € (igual que A, tarifa compartida)', labelsB['lbl-precio-base'], `${base.toFixed(2)} €`);
  check('B (0%): facturación efectiva = 110,00 € (el descuento de A NO le afecta)', labelsB['lbl-tarifa-calculada'], `${base.toFixed(2)} €`);

  const labelsC = ejecutarPreview({ dbClientesIniciales: [grupo, a, b, c], idFichaEditando: 'cm_c', descuentoInput: '20' });
  check('C (20%): facturación efectiva = 88,00 €', labelsC['lbl-tarifa-calculada'], `${(base * 0.8).toFixed(2)} €`);

  // TOTAL GRUPO = suma de importes efectivos (99 + 110 + 88 = 297), nunca 110*3=330
  const M = new Function(extracted + '\nreturn { calcularFacturacionGrupoTotal, buscarFichaPorId };')();
  // Nota: buscarFichaPorId usa entrenadorVisto/dbClientes como variables GLOBALES dentro del
  // sandbox extraido -- para probarlo aqui se inyectan igual que en finance-tests.
  const totalTest = new Function('dbClientes', 'entrenadorVisto', extracted + `
    entrenadorVisto = 'carmen';
    return calcularFacturacionGrupoTotal(buscarFichaPorId('g2'));
  `)({ carmen: [grupo, a, b, c] }, 'carmen');
  check('TOTAL GRUPO = suma de importes efectivos (99+110+88=297), NUNCA tarifa×3 (330)', totalTest, base * 0.9 + base + base * 0.8);
  check('TOTAL GRUPO explícitamente distinto de tarifa×integrantes', totalTest !== base * 3, true);
}

// ============================================================
console.log('\n=== Bono 8 grupo / Bono 10 grupo / Mensualidad grupo -- preview correcto en los 3 ===');
// ============================================================
{
  const casos = [
    ['Grupo Reducido Plan', 1, 45, 'Mensualidad'],
    ['Grupo Reducido Bono', 10, 105, 'Bono'],
    ['Grupo Reducido Bono 8', 8, 105, 'Bono'], // mismo precio TOTAL que Bono 10 (PLAN-01)
  ];
  casos.forEach(([modalidad, factor, esperado, tipoCompra]) => {
    const grupo = { id: 'gX', tipo: 'grupo', nombre: 'GX', modalidad, factor, tipoCompra, integrantesObj: [{ id: 'm0', nombre: 'Z' }] };
    const miembro = { id: 'cmX', tipo: 'individual', nombre: 'Z', modalidad: 'Miembro Subordinado', factor, tipoCompra, vinculacion: 'gX', memberId: 'm0', descuentoPct: 0 };
    const labels = ejecutarPreview({ dbClientesIniciales: [grupo, miembro], idFichaEditando: 'cmX', descuentoInput: '0' });
    check(`${modalidad}: precio base del miembro = ${esperado.toFixed(2)} €`, labels['lbl-precio-base'], `${esperado.toFixed(2)} €`);
  });
}

// ============================================================
console.log('\n=== Miembro LEGACY (campos ausentes) -- preview no revienta y usa la tarifa real del grupo ===');
// ============================================================
{
  const grupo = { id: 'gL', tipo: 'grupo', nombre: 'Legacy', modalidad: 'Grupo Reducido Plan', factor: 1, integrantesObj: [{ id: 'm0', nombre: 'Old' }] };
  const miembroLegacy = { id: 'cmL', tipo: 'individual', nombre: 'Old', modalidad: 'Miembro Subordinado', vinculacion: 'gL', descuentoPct: 0 }; // sin factor/tipoCompra/etc
  const labels = ejecutarPreview({ dbClientesIniciales: [grupo, miembroLegacy], idFichaEditando: 'cmL', descuentoInput: '0' });
  check('legacy: precio base = tarifa real del grupo (45,00 €), no 0,00 €', labels['lbl-precio-base'], '45.00 €');
}

// ============================================================
console.log('\n=== Cliente INDIVIDUAL normal (no grupo) -- preview sin cambios, sigue leyendo el DOM normal ===');
// ============================================================
{
  const elementosIndividual = { dbClientesIniciales: [{ id: 'ind1', tipo: 'individual', nombre: 'Indi', modalidad: 'Individual Plan', factor: 2, descuentoPct: 0 }], idFichaEditando: 'ind1' };
  // Para un individual normal, esFichaMiembroGrupo=false -> debe seguir leyendo cust-mod/cust-factor
  // del DOM tal cual (aqui vacios porque el mock no fija ningun valor real) -- confirma que la
  // rama nueva NO se activa fuera de un integrante de grupo.
  const dbClientes = { carmen: elementosIndividual.dbClientesIniciales };
  const M = new Function('dbClientes', 'entrenadorVisto', 'idFichaEditando', extracted + `
    entrenadorVisto = 'carmen';
    return esFichaMiembroGrupo(dbClientes.carmen.find(c => c.id === idFichaEditando));
  `)(dbClientes, 'carmen', 'ind1');
  check('cliente individual normal: esFichaMiembroGrupo = false (rama del fix no se activa)', M, false);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
