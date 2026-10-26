// IGOR-RESUMEN-ECONOMICO: pruebas reales de la ocultación del RESUMEN económico de la Agenda para
// un usuario con besoulUsers.ocultarResumenEconomico === true. Las funciones se extraen VERBATIM de
// agenda.html y se ejecutan contra un DOM simulado; las funciones de cálculo económico son espías
// para demostrar que, sin permiso, los totales ni siquiera se calculan.
//   node resumen-economico-tests/run_tests.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');

function extractFunction(name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  let i = html.indexOf('{', m.index), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(m.index, i);
}
const codigo = [
  'puedeVerResumenEconomico', 'aplicarVisibilidadResumenEconomico', 'recalcularKPIs',
  'calcularResumenAgendaEntrenador', 'pintarKPIsExtendidosAgenda', 'resumenKPIsMobileHTML',
  'prepararPanelGrupoAbiertoSesion', 'abrirModalNota',
  'emailDocId', 'trainerKeyDesdeEmail', 'sanitizarCredenciales', 'perfilFirestoreAcredencial',
].map(extractFunction).join('\n');

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// --- DOM simulado: solo lo que tocan las funciones probadas.
function crearElemento(id, tarjeta) {
  const clases = new Set();
  return {
    id, innerText: '0.00 €', innerHTML: '', value: '',
    classList: {
      add: c => clases.add(c), remove: c => clases.delete(c), contains: c => clases.has(c),
      toggle: (c, on) => { if (on === undefined ? !clases.has(c) : on) clases.add(c); else clases.delete(c); },
    },
    closest: sel => (sel === '.bs-kpi' ? tarjeta || null : null),
  };
}
function crearDOM() {
  const els = {};
  ['kpi-rentabilidad-total', 'kpi-facturacion-cartera', 'kpi-atletas-activos', 'kpi-sesiones-semana',
    'kpi-ext-previsto', 'kpi-ext-agenda', 'kpi-ext-desviacion', 'kpi-ext-ocupacion'].forEach(id => {
    els[id] = crearElemento(id, crearElemento(`tarjeta-${id}`));
  });
  ['panel-grupo-abierto-sesion', 'grupo-abierto-capacidad-info', 'grupo-abierto-rentabilidad', 'grupo-abierto-cliente-select',
    'grupo-abierto-asistentes-lista', 'modal-nota', 'nota-info-franja', 'nota-info-asignado', 'nota-info-profit', 'txt-nota-contenido']
    .forEach(id => { els[id] = crearElemento(id); });
  return { getElementById: id => els[id] || null, els };
}

// --- Escenario: 1 cliente individual (120 €/mes, 30 €/sesión), 1 cliente de grupo abierto, y una
// sesión normal + una de grupo abierto con 2 asistentes en el mes visible.
function escenario({ rolActivo, perfil }) {
  const dom = crearDOM();
  const llamadas = { facturacion: 0, rentFicha: 0, rentGrupo: 0 };
  const cliA = { id: 'cli_a', nombre: 'Cliente A', tipo: 'individual', estadoCliente: 'activo' };
  const cliB = { id: 'cli_b', nombre: 'Cliente B', tipo: 'individual', estadoCliente: 'activo' };
  const grupoAbierto = { id: 'ga_1', nombre: 'Grupo abierto', grupoAbierto: true, asistentes: [{ id: 'cli_a', nombre: 'Cliente A' }, { id: 'cli_b', nombre: 'Cliente B' }] };
  const entorno = {
    document: dom, rolActivo, perfilFirebaseActual: perfil, entrenadorVisto: 'igor',
    dbClientes: { igor: [cliA, cliB] },
    dbAgenda: { igor: { '2026-10-06_10:00': { id: 'cli_a' }, '2026-10-07_10:00': grupoAbierto } },
    lunesActual: new Date('2026-10-05T00:00:00'),
    inicioMesVisible: () => new Date('2026-10-01T00:00:00'), finMesVisible: () => new Date('2026-11-01T00:00:00'),
    formatoFechaLocal: d => d.toISOString().slice(0, 10),
    actualizarLabelsKPIMes: () => {}, actualizarBadgeAvisosManana: () => {},
    clienteActivoParaAgenda: f => f.estadoCliente === 'activo',
    calcularFacturacionFicha: () => { llamadas.facturacion++; return 120; },
    calcularRentabilidadFicha: () => { llamadas.rentFicha++; return 30; },
    calcularRentabilidadGrupoAbierto: () => { llamadas.rentGrupo++; return 60; },
    buscarFichaPorId: id => [cliA, cliB].find(c => c.id === id) || null,
    buscarClientePorIdTrainer: (tk, id) => [cliA, cliB].find(c => c.id === id) || null,
    esCitaPruebaCRM: () => false, esGrupoAbierto: o => !!(o && o.grupoAbierto),
    asistentesGrupoAbierto: o => (o && o.asistentes) || [], capacidadGrupoAbierto: () => 6,
    clientesElegiblesGrupoAbierto: () => [cliA, cliB, { id: 'cli_c', nombre: 'Cliente C' }],
    resumenHuecosDia: () => ({ capacidadSesiones: 2 }), intervalosOcupadosDia: () => [1],
    escapeHTML: s => String(s), etiquetaFranja45: h => h, obtenerNotaAgenda: () => '',
    prepararPanelRecurrenciaSesion: () => {}, prepararPanelRecuperacionSesion: () => {}, poblarSelectorReprogramarDias: () => {},
  };
  const nombres = Object.keys(entorno);
  const api = new Function(...nombres, `let celdaNotaSeleccionada = '';\n${codigo}\nreturn { puedeVerResumenEconomico, recalcularKPIs, calcularResumenAgendaEntrenador, resumenKPIsMobileHTML, prepararPanelGrupoAbiertoSesion, abrirModalNota, sanitizarCredenciales, perfilFirestoreAcredencial };`)(...nombres.map(n => entorno[n]));
  return { api, dom, llamadas, grupoAbierto };
}
const oculto = el => el.classList.contains('hidden');
const tarjetaOculta = (dom, id) => dom.els[id].closest('.bs-kpi').classList.contains('hidden');
const ECON = ['kpi-rentabilidad-total', 'kpi-facturacion-cartera', 'kpi-ext-previsto', 'kpi-ext-agenda', 'kpi-ext-desviacion'];

const IGOR = { rol: 'pt', trainerKey: 'igor', ocultarResumenEconomico: true };
const OTRO_PT = { rol: 'pt', trainerKey: 'carmen' };
const ADMIN = { rol: 'admin', trainerKey: 'fran' };

console.log('=== 1. Igor (PT con ocultarResumenEconomico): ningún total económico ===');
{
  const { api, dom, llamadas, grupoAbierto } = escenario({ rolActivo: 'pt', perfil: IGOR });
  check('puedeVerResumenEconomico() = false', api.puedeVerResumenEconomico(), false);
  api.recalcularKPIs();
  ECON.forEach(id => {
    check(`${id}: sin importe en el DOM`, dom.els[id].innerText, '');
    check(`${id}: tarjeta oculta`, tarjetaOculta(dom, id), true);
  });
  check('Atletas activos sigue visible y correcto (2)', dom.els['kpi-atletas-activos'].innerText, 2);
  check('Ocupación sigue visible y correcta (1 de 2+1 slots = 33%)', dom.els['kpi-sesiones-semana'].innerText, '33%');
  check('Ocupación ampliada correcta', dom.els['kpi-ext-ocupacion'].innerText, '33%');
  check('Los totales NI SE CALCULAN: 0 llamadas a calcularFacturacionFicha', llamadas.facturacion, 0);
  check('Los totales NI SE CALCULAN: 0 llamadas a calcularRentabilidadFicha/GrupoAbierto en el resumen', llamadas.rentFicha + llamadas.rentGrupo, 0);
  const r = api.calcularResumenAgendaEntrenador();
  check('calcularResumenAgendaEntrenador() devuelve los importes a 0', [r.facturacionPrevista, r.valorAgenda, r.desviacion, r.rentabilidadPromedio], [0, 0, 0, 0]);
  check('...pero sigue contando sesiones (2 asistentes + 1 sesión)', r.sesionesAgendadas, 3);
  const movil = api.resumenKPIsMobileHTML(r);
  check('Resumen móvil: sin ningún "€"', movil.includes('€'), false);
  check('Resumen móvil: sin "Facturación", "Valor agenda" ni "Desviación"', /Facturaci|Valor agenda|Desviaci/.test(movil), false);
  check('Resumen móvil: mantiene Ocupación', movil.includes('Ocupación'), true);

  api.prepararPanelGrupoAbiertoSesion('2026-10-07_10:00', grupoAbierto);
  check('Grupo abierto: total de la sesión oculto', oculto(dom.els['grupo-abierto-rentabilidad']), true);
  check('Grupo abierto: total de la sesión sin importe', dom.els['grupo-abierto-rentabilidad'].innerText, '');
  check('Grupo abierto: importe INDIVIDUAL de cada asistente visible (30.00 €)', (dom.els['grupo-abierto-asistentes-lista'].innerHTML.match(/30\.00 €/g) || []).length, 2);
  check('Grupo abierto: importe por sesión de cada cliente en el selector visible', dom.els['grupo-abierto-cliente-select'].innerHTML.includes('30.00 €/ses.'), true);

  api.abrirModalNota('2026-10-07_10:00', grupoAbierto, 0);
  check('Detalle de sesión de grupo abierto: total sustituido por "—"', dom.els['nota-info-profit'].innerText, '—');
  api.abrirModalNota('2026-10-06_10:00', { id: 'cli_a', nombre: 'Cliente A' }, 30);
  check('Detalle de sesión individual: su importe individual SIGUE visible', dom.els['nota-info-profit'].innerText, '30.00 €');
}

console.log('\n=== 2. Otro PT sin la marca: exactamente igual que hoy ===');
{
  const { api, dom, grupoAbierto } = escenario({ rolActivo: 'pt', perfil: OTRO_PT });
  check('puedeVerResumenEconomico() = true', api.puedeVerResumenEconomico(), true);
  api.recalcularKPIs();
  check('Facturación cartera = 240.00 €', dom.els['kpi-facturacion-cartera'].innerText, '240.00 €');
  check('Rentabilidad promedio = (30+60)/3 = 30.00 €', dom.els['kpi-rentabilidad-total'].innerText, '30.00 €');
  check('Facturación prevista = 240.00 €', dom.els['kpi-ext-previsto'].innerText, '240.00 €');
  check('Valor agenda = 90.00 €', dom.els['kpi-ext-agenda'].innerText, '90.00 €');
  check('Desviación = 150.00 €', dom.els['kpi-ext-desviacion'].innerText, '150.00 €');
  ECON.forEach(id => check(`${id}: tarjeta visible`, tarjetaOculta(dom, id), false));
  check('Resumen móvil con Facturación prevista', api.resumenKPIsMobileHTML(api.calcularResumenAgendaEntrenador()).includes('Facturación prevista'), true);
  api.prepararPanelGrupoAbiertoSesion('2026-10-07_10:00', grupoAbierto);
  check('Grupo abierto: total visible (60.00 €)', dom.els['grupo-abierto-rentabilidad'].innerText, '60.00 €');
  api.abrirModalNota('2026-10-07_10:00', grupoAbierto, 0);
  check('Detalle de sesión de grupo abierto: total visible', dom.els['nota-info-profit'].innerText, '60.00 €');
}

console.log('\n=== 3. Administración viendo la Agenda de Igor ("ver como"): lo ve todo ===');
{
  const { api, dom } = escenario({ rolActivo: 'admin', perfil: ADMIN });
  check('puedeVerResumenEconomico() = true', api.puedeVerResumenEconomico(), true);
  api.recalcularKPIs();
  check('Facturación cartera de Igor visible para admin', dom.els['kpi-facturacion-cartera'].innerText, '240.00 €');
}
{
  // Aunque un admin tuviera la marca por error, la administración nunca pierde el resumen.
  const { api } = escenario({ rolActivo: 'admin', perfil: { ...ADMIN, ocultarResumenEconomico: true } });
  check('Admin con la marca puesta por error: sigue viendo el resumen', api.puedeVerResumenEconomico(), true);
}

console.log('\n=== 4. Falla cerrado: PT sin perfil cargado no ve totales ===');
{
  const { api } = escenario({ rolActivo: 'pt', perfil: null });
  check('PT sin perfil: puedeVerResumenEconomico() = false', api.puedeVerResumenEconomico(), false);
}

console.log('\n=== 5. Las tarjetas vuelven a mostrarse si cambia el permiso en la misma página ===');
{
  const { api, dom } = escenario({ rolActivo: 'pt', perfil: IGOR });
  api.recalcularKPIs();
  check('Con la marca: tarjeta de facturación oculta', tarjetaOculta(dom, 'kpi-facturacion-cartera'), true);
  const { api: api2, dom: dom2 } = escenario({ rolActivo: 'admin', perfil: ADMIN });
  dom2.els['kpi-facturacion-cartera'].closest('.bs-kpi').classList.add('hidden');
  api2.recalcularKPIs();
  check('Admin: una tarjeta que estaba oculta se vuelve a mostrar', tarjetaOculta(dom2, 'kpi-facturacion-cartera'), false);
}

console.log('\n=== 6. La marca viaja con el perfil (y solo si es exactamente true) ===');
{
  const { api } = escenario({ rolActivo: 'pt', perfil: IGOR });
  check('perfilFirestoreAcredencial conserva ocultarResumenEconomico: true', api.perfilFirestoreAcredencial({ email: 'igor@x.com', rol: 'pt', trainerKey: 'igor', ocultarResumenEconomico: true }).ocultarResumenEconomico, true);
  check('Un valor que no es true ("true" texto) NO activa la marca', api.perfilFirestoreAcredencial({ email: 'igor@x.com', rol: 'pt', trainerKey: 'igor', ocultarResumenEconomico: 'true' }).ocultarResumenEconomico, false);
  check('Sin el campo: false', api.perfilFirestoreAcredencial({ email: 'c@x.com', rol: 'pt', trainerKey: 'carmen' }).ocultarResumenEconomico, false);
  check('sanitizarCredenciales conserva la marca', api.sanitizarCredenciales({ igor: { trainerKey: 'igor', rol: 'pt', ocultarResumenEconomico: true } }).igor.ocultarResumenEconomico, true);
}

console.log('\n=== 7. agenda.html sigue siendo JavaScript válido ===');
{
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let errores = 0;
  scripts.forEach((s, i) => { try { new vm.Script(s, { filename: `agenda.html#script${i}` }); } catch (e) { errores++; console.log('  ' + e.message); } });
  check(`${scripts.length} bloques <script> en línea compilan sin errores`, errores, 0);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
