// FINANZAS-EMPLEADO: pruebas del modelo de empleado (Igor Carvalho) con el código REAL de
// finanzas.html (todas sus funciones de nivel superior y sus constantes, extraídas verbatim; ninguna
// se ejecuta al extraerlas) y, si se pasa, un respaldo real de producción como datos de partida.
//   node finance-tests/run_empleado_tests.cjs [<respaldo.json>]
// Sin respaldo usa solo datos sintéticos. El respaldo se lee de disco; nada se escribe en él ni en
// Firestore. Las pruebas no imprimen nombres de clientes.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'finanzas.html'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(RAIZ, 'dashboard.html'), 'utf8');
const Guardado = require(path.join(RAIZ, 'besoul-finanzas-guardado.js'));
const Datos = require(path.join(RAIZ, 'besoul-datos.js'));

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}
const r2 = n => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- código real
// El script principal de finanzas.html completo, tal cual. Su única sentencia con efectos al cargar
// es la llamada final inicializar() (Firebase/autenticación), que se quita; todo lo demás son
// declaraciones. Los "let" de estado se sobrescriben tras cargar, con los datos de cada prueba.
const scriptsFinanzas = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const principal = scriptsFinanzas.find(s => s.includes('function construirCalculoVivo'));
if (!/\n    inicializar\(\);\s*$/.test(principal)) throw new Error('No se encontró la llamada final inicializar() en finanzas.html');
const codigoFinanzas = principal.replace(/\n    inicializar\(\);\s*$/, '\n');

function crearFinanzas({ dbFinanzas, agendaData, perfilesUsuarios, mes }) {
  const registro = { alertas: [], confirmaciones: [], guardados: 0 };
  const entorno = {
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} }, navigator: {}, firebase: { apps: [] },
    alert: t => registro.alertas.push(String(t)),
    confirm: t => { registro.confirmaciones.push(String(t)); return registro.respuestaConfirm !== undefined ? registro.respuestaConfirm : true; },
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const nombres = Object.keys(entorno);
  const cuerpo = `
    ${codigoFinanzas}
    usuarioFinanzasEmail = 'admin@test';
    dbFinanzas = __estado.dbFinanzas; agendaData = __estado.agendaData; perfilesUsuarios = __estado.perfilesUsuarios;
    mesSeleccionadoFinanzas = __estado.mes;
    // Sustitutos de lo que toca red o DOM (declarados después: ganan a los originales).
    function guardarConfigFinanzas(){ __registro.guardados++; return Promise.resolve({ ok:true }); }
    function pintarTodo(){ calculoActual = construirCalculoActual(); }
    return {
      get dbFinanzas(){ return dbFinanzas; }, set dbFinanzas(v){ dbFinanzas = v; },
      get agendaData(){ return agendaData; }, set agendaData(v){ agendaData = v; },
      set mes(v){ mesSeleccionadoFinanzas = v; }, set mesCerradoEditando(v){ mesCerradoEditando = v; },
      get calculoActual(){ return calculoActual; },
      refrescar(){ calculoActual = construirCalculoActual(); return calculoActual; },
      construirCalculoVivo, editarTrainer, settingsTrainerParaMes, calcularComisionAvanzada, calcularCanonCentroYAsignar,
      calcularIncentivoEmpleado, analisisEmpleado, registrarGastoEmpleado, editarGasto, totalGastosMes, calcularAvisosCarrera,
      SISTEMAS_PAGO, GASTO_CATEGORIAS,
    };`;
  const api = new Function('__estado', '__registro', ...nombres, cuerpo)({ dbFinanzas, agendaData, perfilesUsuarios, mes }, registro, ...nombres.map(n => entorno[n]));
  return { api, registro };
}

// ---------------------------------------------------------------- datos sintéticos
function fichaIndividual(id, extra) { return { id, nombre: 'Cliente ' + id, tipo: 'individual', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', descuentoPct: 0, estadoCliente: 'activo', fechaAlta: '2026-01-01', ...extra }; }
function fichaGrupo(id, n, extra) { return { id, nombre: 'Grupo ' + id, tipo: 'grupo', modalidad: 'Grupo Reducido Plan', factor: 1, tipoCompra: 'Mensualidad', descuentoPct: 0, estadoCliente: 'activo', fechaAlta: '2026-01-01', integrantesObj: Array.from({ length: n }, (_, i) => ({ id: `${id}_m${i}`, nombre: 'M' + i })), ...extra }; }
function finanzasVacias() {
  return { centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {} };
}

console.log('=== 1. Reparto: un empleado no aplica tramos ni canon sobre su facturación ===');
{
  const { api } = crearFinanzas({ dbFinanzas: finanzasVacias(), agendaData: { clientes: {}, agenda: {} }, perfilesUsuarios: [], mes: '2026-10' });
  const res = api.calcularComisionAvanzada(1500, { sistemaPago: 'empleado', pactoEspecial: true, fechaAlta: '2020-01-01', canonFijoIndependiente: 500 }, { key: 'igor', centroId: 'inacua' });
  check('Empleado: BESOUL se queda el 100 % (1500)', res.bs, 1500);
  check('Empleado: parte del PT = 0', res.pt, 0);
  check('Empleado: ni pacto especial ni rango cambian el reparto', res.sistemaEfectivo, 'empleado');
  check('Empleado: sin bonus de coordinación', [res.bonus, res.coordinacionBonus], [0, 0]);
  const autonomo = api.calcularComisionAvanzada(1500, { sistemaPago: 'rango1', fechaAlta: '2026-01-01' }, { key: 'x', centroId: 'inacua' });
  check('Un autónomo sigue repartiendo por tramos (PT > 0)', autonomo.pt > 0 && autonomo.bs < 1500, true);
  check('Opción "Empleado" disponible en el selector de sistema de pago', api.SISTEMAS_PAGO.empleado, 'Empleado BESOUL · 100 % facturación BESOUL');
  check('Categoría "Incentivos" disponible en Gastos', api.GASTO_CATEGORIAS.includes('Incentivos'), true);
  // La copia de dashboard.html da exactamente lo mismo.
  // Script principal de dashboard.html completo; su única sentencia al cargar es un addEventListener.
  const dash = [...dashboardHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function calcularComisionAvanzada'));
  const fd = new Function('console', 'window', 'document', 'localStorage', `${dash}\nreturn calcularComisionAvanzada;`)(
    { log() {}, warn() {}, error() {}, info() {} }, { addEventListener() {} }, { getElementById: () => null }, { getItem: () => null, setItem() {} });
  const resD = fd(1500, { sistemaPago: 'empleado', pactoEspecial: true }, { key: 'igor', centroId: 'inacua' });
  check('dashboard.html: mismo reparto de empleado (bs 1500, pt 0)', [resD.bs, resD.pt, resD.sistemaEfectivo], [1500, 0, 'empleado']);
}

console.log('\n=== 2. Canon de Inacua: 11 entrenadores → 200 € atribuidos a cada uno, contado una sola vez ===');
{
  const { api } = crearFinanzas({ dbFinanzas: finanzasVacias(), agendaData: { clientes: {}, agenda: {} }, perfilesUsuarios: [], mes: '2026-10' });
  const c = { id: 'inacua', canonFijo: 1200, ptsIncluidos: 6, canonPt: 200, canonPtReducidoDesde: 12, canonPtReducido: 60, trainers: Array.from({ length: 11 }, (_, i) => ({ key: i === 0 ? 'igor' : 't' + i, bsBruto: 0, computaCanonCentro: true })) };
  api.calcularCanonCentroYAsignar(c);
  check('Canon total del centro con 11 PT (configuración actual) = 2.200,00 €', r2(c.canon), 2200);
  check('Canon atribuido a Igor = 200,00 €', r2(c.trainers[0].canonCentroShare), 200);
  check('Suma de lo atribuido = canon total (no se duplica)', r2(c.trainers.reduce((s, t) => s + t.canonCentroShare, 0)), r2(c.canon));
}

console.log('\n=== 3. Incentivo Opción B: (5 € × C) + (10 € × G), una vez por ficha y mes ===');
{
  const clientesIgor = [
    fichaIndividual('i1'), fichaIndividual('i2'),
    fichaIndividual('i2'),                                    // la misma ficha repetida: cuenta una vez
    fichaIndividual('i3', { estadoCliente: 'baja' }),         // no activo
    fichaIndividual('i4', { modalidad: 'Inexistente' }),      // sin facturación en el mes
    fichaGrupo('g3', 3), fichaGrupo('g4', 4), fichaGrupo('g2', 2),
    fichaIndividual('m1', { modalidad: 'Miembro Subordinado', vinculacion: 'g3' }), // integrante: no cuenta aparte
    fichaIndividual('a1', { actividadEspecialId: 'pilates_maquina' }),
  ];
  const db = finanzasVacias();
  db.trainerSettings.igor = { sistemaPago: 'empleado', incentivoModelo: 'opcion_b' };
  const { api } = crearFinanzas({ dbFinanzas: db, agendaData: { clientes: { igor: clientesIgor }, agenda: {} }, perfilesUsuarios: [{ email: 'igor@x', rol: 'pt', trainerKey: 'igor', activo: true }], mes: '2026-10' });
  const inc = api.calcularIncentivoEmpleado('igor', '2026-10');
  check('C = 2 clientes individuales elegibles (i1, i2)', inc.individuales.map(x => x.id), ['i1', 'i2']);
  check('G = 2 grupos de 3 o más (g3, g4)', inc.grupos.map(x => x.id), ['g3', 'g4']);
  check('Incentivo = 5×2 + 10×2 = 30 €', inc.importe, 30);
  check('No se multiplica por sesiones: con más sesiones agendadas el importe es el mismo', (() => {
    const agenda = { igor: {} }; for (let d = 1; d <= 20; d++) agenda.igor[`2026-10-${String(d).padStart(2, '0')}_10:00`] = { id: 'i1' };
    const { api: a2 } = crearFinanzas({ dbFinanzas: db, agendaData: { clientes: { igor: clientesIgor }, agenda }, perfilesUsuarios: [], mes: '2026-10' });
    return a2.calcularIncentivoEmpleado('igor', '2026-10').importe;
  })(), 30);
  check('Fuera del criterio provisional y listado como pendiente: grupo de 2 y actividad especial', inc.fueraDeCriterio.map(x => x.id).sort(), ['a1', 'g2']);
  const sinModelo = finanzasVacias(); sinModelo.trainerSettings.igor = { sistemaPago: 'empleado' };
  const { api: a3 } = crearFinanzas({ dbFinanzas: sinModelo, agendaData: { clientes: { igor: clientesIgor }, agenda: {} }, perfilesUsuarios: [], mes: '2026-10' });
  check('Sin modelo de incentivos configurado: 0 € (pendiente de confirmación)', a3.calcularIncentivoEmpleado('igor', '2026-10').importe, 0);
}

function prueba4() {
  console.log('\n=== 4. Configurar como empleado DESDE un mes no cambia los meses anteriores (sin retroactividad) ===');
  const db = finanzasVacias(); // como producción hoy: trainerSettings vacío
  const perfiles = [{ email: 'igor@x', rol: 'pt', trainerKey: 'igor', activo: true }];
  const { api, registro } = crearFinanzas({ dbFinanzas: db, agendaData: { clientes: { igor: [fichaIndividual('i1')] }, agenda: {} }, perfilesUsuarios: perfiles, mes: '2026-10' });
  const septAntes = api.construirCalculoVivo('2026-09').trainers.find(t => t.key === 'igor');
  registro.respuestaConfirm = false; // Cancelar = "desde este mes en adelante"
  return Promise.resolve()
    .then(() => api.editarTrainer('igor', 'sistemaPago', 'empleado'))
    .then(() => api.editarTrainer('igor', 'costeEmpresaMensual', '970,90'))
    .then(() => api.editarTrainer('igor', 'incentivoModelo', 'opcion_b'))
    .then(() => {
      check('Octubre: sistema de Igor = empleado', api.settingsTrainerParaMes('igor', '2026-10').sistemaPago, 'empleado');
      check('Octubre: coste empresa = 970,90 €', api.settingsTrainerParaMes('igor', '2026-10').costeEmpresaMensual, 970.9);
      check('Noviembre (en adelante): sigue siendo empleado', api.settingsTrainerParaMes('igor', '2026-11').sistemaPago, 'empleado');
      check('Septiembre: SIN sistema configurado (antes del cambio)', api.settingsTrainerParaMes('igor', '2026-09').sistemaPago, null);
      check('Septiembre: sin coste empresa ni incentivo', [api.settingsTrainerParaMes('igor', '2026-09').costeEmpresaMensual, api.settingsTrainerParaMes('igor', '2026-09').incentivoModelo], [null, null]);
      const septDespues = api.construirCalculoVivo('2026-09').trainers.find(t => t.key === 'igor');
      check('Septiembre: reparto de Igor idéntico al de antes del cambio', [septDespues.ptNeto, septDespues.bsBruto, septDespues.sistemaAplicado], [septAntes.ptNeto, septAntes.bsBruto, septAntes.sistemaAplicado]);
      check('Septiembre: sin incentivo calculado (no retroactivo)', api.calcularIncentivoEmpleado('igor', '2026-09').importe, 0);
      const oct = api.construirCalculoVivo('2026-10').trainers.find(t => t.key === 'igor');
      check('Octubre: BESOUL bruto de Igor = su facturación', [oct.bsBruto, oct.ptNeto], [oct.facturacion, 0]);
    });
}

function conRespaldo(ruta) {
  console.log('\n=== 5. Con el respaldo real: integración en Finanzas sin duplicar partidas ===');
  const r = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const E = r.estructuraNueva;
  const lista = [];
  [['semanas', 'besoulAgendaSemanas'], ['clientes', 'besoulClientes'], ['trainers', 'besoulTrainers'], ['historico', 'besoulHistoricoClientes'], ['notas', 'besoulNotas']]
    .forEach(([col, nombre]) => (E[nombre] || []).forEach(d => lista.push({ col, id: d.id, data: d.data })));
  const agendaData = Datos.legadoDesdeDocs(Datos.agrupar(lista));
  const perfiles = (r.besoulUsers || []).map(u => ({ ...u.data, email: u.id })).filter(p => p.activo !== false);
  // Igual que normalizarFinanzas(): defaults solo para los mapas ausentes.
  const raw = r.besoulSuite.finanzas;
  const dbFinanzas = { centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {}, ...JSON.parse(JSON.stringify(raw)) };
  const base = Guardado.crearBase(raw, x => ({ centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {}, ...x }));
  const { api, registro } = crearFinanzas({ dbFinanzas, agendaData, perfilesUsuarios: perfiles, mes: '2026-10' });

  const antes = api.construirCalculoVivo('2026-10');
  const igorAntes = antes.trainers.find(t => t.key === 'igor');
  const otrosAntes = JSON.stringify(antes.trainers.filter(t => t.key !== 'igor').map(t => [t.key, t.facturacion, t.ptNeto, t.bsBruto]));
  const septAntes = JSON.stringify(api.construirCalculoVivo('2026-09').total);
  check('Igor está en el cálculo de octubre', !!igorAntes, true);
  console.log(`       Igor (octubre, hoy): facturación ${r2(igorAntes.facturacion)} € · PT ${r2(igorAntes.ptNeto)} € · BESOUL ${r2(igorAntes.bsBruto)} € · ${igorAntes.sistemaAplicado} · canon atribuido ${r2(igorAntes.canonCentroShare)} € · centro ${igorAntes.centroId}`);

  const inacua = antes.centros.inacua || { trainers: [] };
  const computan = inacua.trainers.filter(t => t.computaCanonCentro !== false).map(t => t.key);
  console.log(`       Inacua hoy en Finanzas: canon ${r2(inacua.canon)} € · ${computan.length} entrenadores computan (${computan.join(', ')})`);

  registro.respuestaConfirm = false;
  return Promise.resolve()
    .then(() => api.editarTrainer('igor', 'sistemaPago', 'empleado'))
    .then(() => api.editarTrainer('igor', 'costeEmpresaMensual', '970.90'))
    .then(() => api.editarTrainer('igor', 'incentivoModelo', 'opcion_b'))
    .then(() => api.editarTrainer('igor', 'canonAtribuidoMensual', '200'))
    .then(() => {
      const despues = api.construirCalculoVivo('2026-10');
      const igor = despues.trainers.find(t => t.key === 'igor');
      check('Igor: BESOUL bruto = 100 % de su facturación', r2(igor.bsBruto), r2(igor.facturacion));
      check('Igor: neto PT = 0', igor.ptNeto, 0);
      check('Facturación total de BESOUL: igual (la de Igor se cuenta una sola vez)', r2(despues.total.facturacion), r2(antes.total.facturacion));
      check('BESOUL bruto: sube exactamente lo que antes se quedaba Igor como PT', r2(despues.total.bsBruto), r2(antes.total.bsBruto + igorAntes.ptNeto));
      check('Cánones: iguales (el canon no se suma otra vez)', r2(despues.total.canones), r2(antes.total.canones));
      check('Gastos: iguales hasta registrar la nómina', r2(despues.total.gastos), r2(antes.total.gastos));
      check('Resto de entrenadores: sin ningún cambio', JSON.stringify(despues.trainers.filter(t => t.key !== 'igor').map(t => [t.key, t.facturacion, t.ptNeto, t.bsBruto])), otrosAntes);
      check('Septiembre (mes anterior abierto): totales sin ningún cambio', JSON.stringify(api.construirCalculoVivo('2026-09').total), septAntes);

      api.refrescar();
      const a0 = api.analisisEmpleado(igor, '2026-10');
      check('Antes de registrar: nómina pendiente (970,90 € previstos), 0 € contabilizados', [a0.nominaPendiente, a0.costeLaboralPrevisto, a0.costeLaboral], [true, 970.9, 0]);
      console.log(`       Incentivo calculado (criterio provisional): C=${a0.incentivoCalculado.individuales.length} · G=${a0.incentivoCalculado.grupos.length} · ${a0.incentivoCalculado.importe} € · fuera de criterio ${a0.incentivoCalculado.fueraDeCriterio.length}`);

      registro.respuestaConfirm = true;
      api.registrarGastoEmpleado('igor', 'nomina');
      api.refrescar();
      api.registrarGastoEmpleado('igor', 'nomina'); // segundo intento: no duplica
      const gastosOct = api.dbFinanzas.gastos['2026-10'];
      const nominas = gastosOct.filter(g => g.trainerKey === 'igor' && g.categoria === 'Sueldos');
      check('Nómina registrada una sola vez (el segundo intento se rechaza)', nominas.length, 1);
      check('Nómina: 970,90 €, fija, categoría Sueldos, atribuida a Igor', [nominas[0].importe, nominas[0].tipo, nominas[0].categoria, nominas[0].trainerKey], [970.9, 'fijo', 'Sueldos', 'igor']);
      check('Aviso de que ya estaba registrada', registro.alertas.some(t => /Ya hay una nómina/.test(t)), true);

      const incCalc = api.analisisEmpleado(api.calculoActual.trainers.find(t => t.key === 'igor'), '2026-10').incentivoCalculado.importe;
      if (incCalc > 0) { api.registrarGastoEmpleado('igor', 'incentivo'); api.refrescar(); api.registrarGastoEmpleado('igor', 'incentivo'); }
      const incentivos = api.dbFinanzas.gastos['2026-10'].filter(g => g.trainerKey === 'igor' && g.categoria === 'Incentivos');
      check('Incentivo registrado como mucho una vez', incentivos.length, incCalc > 0 ? 1 : 0);

      const fin = api.construirCalculoVivo('2026-10');
      const igorFin = fin.trainers.find(t => t.key === 'igor');
      const incentivo = incentivos.reduce((s, g) => s + g.importe, 0);
      check('Total gastos = antes + nómina + incentivo (cada uno una vez)', r2(fin.total.gastos), r2(antes.total.gastos + 970.9 + incentivo));
      check('Beneficio BESOUL = antes + parte que era del PT − nómina − incentivo (canon sin duplicar)', r2(fin.total.beneficio), r2(antes.total.beneficio + igorAntes.ptNeto - 970.9 - incentivo));
      const a = api.analisisEmpleado(igorFin, '2026-10');
      check('Canon atribuido a Igor = 200 € acordados (no el reparto automático)', [a.canonAtribuido, a.canonAcordado], [200, true]);
      check('...el reparto automático del centro se sigue enseñando aparte', r2(a.canonCalculado), r2(igorFin.canonCentroShare));
      check('...y el total de cánones de BESOUL no cambia por la atribución', r2(fin.total.canones), r2(antes.total.canones));
      check('Resultado Igor = facturación − 970,90 − 200 − incentivos − otros', r2(a.resultado), r2(igorFin.facturacion - 970.9 - 200 - incentivo - a.otrosGastos));
      check('Coste total atribuible = 970,90 + 200 + incentivos + otros (fijo 1.170,90 €)', r2(a.costeTotal), r2(1170.9 + incentivo + a.otrosGastos));
      check('Septiembre: sin canon acordado (no retroactivo)', api.settingsTrainerParaMes('igor', '2026-09').canonAtribuidoMensual, null);
      check('Ya no queda nómina pendiente', a.nominaPendiente, false);
      console.log(`       Resultado Igor octubre: facturación ${r2(a.facturacion)} − nómina ${r2(a.costeLaboral)} − canon ${r2(a.canonAtribuido)} − incentivos ${r2(a.incentivo)} − otros ${r2(a.otrosGastos)} = ${r2(a.resultado)} €`);

      // Guardado seguro: solo se escriben las rutas de Igor y de los gastos de octubre, y el
      // servidor (validarOperaciones, misma comprobación que las reglas) no ve ningún vaciado.
      const ops = Guardado.calcularOperaciones(base.norm, api.dbFinanzas);
      const rutas = ops.map(o => (o.clave === null ? o.campo : `${o.campo}.${o.clave}`)).sort();
      check('Guardado seguro: solo trainerSettings.igor, trainerSettingsVersiones.igor y gastos.2026-10', rutas, ['gastos.2026-10', 'trainerSettings.igor', 'trainerSettingsVersiones.igor']);
      let errorValidacion = null;
      try { Guardado.validarOperaciones(JSON.parse(JSON.stringify(raw)), base.raw, ops); } catch (e) { errorValidacion = e.code; }
      check('Guardado seguro: el servidor acepta las operaciones (sin conflicto, sin vaciado)', errorValidacion, null);
      const gastosAntesOct = (raw.gastos['2026-10'] || []).map(g => JSON.stringify(g));
      const gastosOp = ops.find(o => o.campo === 'gastos').valor;
      check('Los gastos que ya había en octubre se conservan intactos', gastosAntesOct.every(g => gastosOp.some(x => JSON.stringify(x) === g)), true);
      check('Los demás meses de gastos no se tocan', ops.filter(o => o.campo === 'gastos').length, 1);

      // Atribuir un gasto ya existente a Igor no cambia el total (solo la atribución).
      const idxOtro = gastosOct.findIndex(g => !g.trainerKey);
      const totalAntesAtrib = api.totalGastosMes('2026-10');
      api.editarGasto(idxOtro, 'trainerKey', 'igor');
      check('Atribuir un gasto existente a Igor: total de gastos sin cambios', r2(api.totalGastosMes('2026-10')), r2(totalAntesAtrib));
      check('...y pasa a "otros gastos atribuidos" de Igor', r2(api.analisisEmpleado(igorFin, '2026-10').otrosGastos), r2(gastosOct[idxOtro].importe));
      api.editarGasto(idxOtro, 'trainerKey', '');
      check('Quitar la atribución elimina el campo (forma original del gasto)', 'trainerKey' in gastosOct[idxOtro], false);

      // Un mes cerrado no admite registrar nómina ni incentivo.
      api.dbFinanzas.historico = { '2026-10': JSON.parse(JSON.stringify(fin)) };
      api.dbFinanzas.gastos['2026-10'] = api.dbFinanzas.gastos['2026-10'].filter(g => g.trainerKey !== 'igor');
      api.refrescar();
      const nAntes = api.dbFinanzas.gastos['2026-10'].length;
      api.registrarGastoEmpleado('igor', 'nomina');
      check('Mes cerrado: no se registra la nómina', api.dbFinanzas.gastos['2026-10'].length, nAntes);
      check('Avisos de carrera (rangos) no se generan para un empleado', api.calcularAvisosCarrera().some(x => String(x.id).startsWith('igor_')), false);
    });
}

console.log('\n=== 6. finanzas.html y dashboard.html siguen siendo JavaScript válido ===');
[['finanzas.html', html], ['dashboard.html', dashboardHtml]].forEach(([n, h]) => {
  const scripts = [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let errores = 0;
  scripts.forEach((s, i) => { try { new vm.Script(s, { filename: `${n}#${i}` }); } catch (e) { errores++; console.log('  ' + e.message); } });
  check(`${n}: ${scripts.length} bloques <script> compilan`, errores, 0);
});

// Las pruebas 4 y 5 son asíncronas (editarTrainer espera al guardado simulado).
Promise.resolve()
  .then(prueba4)
  .then(() => (process.argv[2] ? conRespaldo(process.argv[2]) : console.log('\n(sin respaldo: se omiten las pruebas con datos reales)')))
  .then(() => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    if (fail) { fails.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
  })
  .catch(e => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
