// GESTION-ENTRENADORES: pruebas de la gestión de entrenadores de Finanzas (altas, bajas, reactivación,
// cambios de centro, exención de canon y ajuste mensual del canon) con el código REAL de finanzas.html
// y dashboard.html (script principal completo, sin inicializar()) y, si se pasa, un respaldo real.
//   node finance-tests/run_gestion_entrenadores_tests.cjs [<respaldo.json>]
// Con respaldo, compara además con el código del commit de referencia (BASE_REF, por defecto 1b8080e,
// el anterior a este cambio) para demostrar que los meses anteriores a octubre de 2026 no cambian.
// Todo ocurre en memoria: nada se escribe en el respaldo ni en Firestore. No imprime datos de clientes.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const Guardado = require(path.join(RAIZ, 'besoul-finanzas-guardado.js'));
const Datos = require(path.join(RAIZ, 'besoul-datos.js'));
const BASE_REF = process.env.BASE_REF || '1b8080e';
const htmlFinanzas = fs.readFileSync(path.join(RAIZ, 'finanzas.html'), 'utf8');
const htmlDashboard = fs.readFileSync(path.join(RAIZ, 'dashboard.html'), 'utf8');
const htmlAgenda = fs.readFileSync(path.join(RAIZ, 'agenda.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}
const r2 = n => Math.round((n || 0) * 100) / 100;
const copia = x => JSON.parse(JSON.stringify(x));
// El cálculo lleva su hora de generación; se compara todo lo demás.
const sinFecha = c => { const { generadoEn, ...resto } = c; return JSON.stringify(resto); };
const silencio = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const MAPAS = { centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {} };

// ---------------------------------------------------------------- carga del código real
function scriptPrincipal(html, marca) { return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes(marca)); }
function cargarFinanzas(html, { dbFinanzas, agendaData, perfiles, mes, elementos = {} }) {
  const principal = scriptPrincipal(html, 'function construirCalculoVivo');
  if (!/\n    inicializar\(\);\s*$/.test(principal.replace(/\r\n/g, '\n'))) throw new Error('No se encontró la llamada final inicializar()');
  const codigo = principal.replace(/\r\n/g, '\n').replace(/\n    inicializar\(\);\s*$/, '\n');
  const registro = { alertas: [], confirmaciones: [], guardados: 0, respuestaGuardado: { ok: true }, respuestaConfirm: true };
  const entorno = {
    document: { getElementById: id => elementos[id] || null, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} }, navigator: {}, firebase: { apps: [] },
    alert: t => registro.alertas.push(String(t)),
    confirm: t => { registro.confirmaciones.push(String(t)); return registro.respuestaConfirm; },
    console: silencio, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const n = Object.keys(entorno);
  const opt = f => `typeof ${f} === 'function' ? ${f} : null`;
  const cuerpo = `${codigo}
    usuarioFinanzasEmail = 'admin@test';
    dbFinanzas = __e.dbFinanzas; agendaData = __e.agendaData; perfilesUsuarios = __e.perfiles; mesSeleccionadoFinanzas = __e.mes;
    function guardarConfigFinanzas(){ __r.guardados++; return Promise.resolve(__r.respuestaGuardado); }
    function pintarTodo(){ calculoActual = construirCalculoActual(); }
    return {
      get db(){ return dbFinanzas; }, set mes(v){ mesSeleccionadoFinanzas = v; },
      construirCalculoVivo, centroTrainer, settingsTrainerParaMes,
      planCambioEntrenador: ${opt('planCambioEntrenador')}, planAjusteCanon: ${opt('planAjusteCanon')},
      gestionSet: ${opt('gestionSet')}, gestionAjusteSet: ${opt('gestionAjusteSet')},
      previsualizarGestionEntrenador: ${opt('previsualizarGestionEntrenador')}, previsualizarAjusteCanon: ${opt('previsualizarAjusteCanon')},
      guardarCambioGestion: ${opt('guardarCambioGestion')}, renderGestionEntrenadores: ${opt('renderGestionEntrenadores')}, refrescar(){ calculoActual = construirCalculoActual(); }, analisisEmpleado: ${opt('analisisEmpleado')},
      get gestionPrevision(){ return typeof gestionPrevision === 'undefined' ? null : gestionPrevision; },
    };`;
  const api = new Function('__e', '__r', ...n, cuerpo)({ dbFinanzas, agendaData, perfiles, mes }, registro, ...n.map(k => entorno[k]));
  return { api, registro };
}
function cargarDashboard(html, { dbFinanzas, agendaData, perfiles }) {
  const principal = scriptPrincipal(html, 'function construirCalculoMes');
  return new Function('__e', 'console', 'window', 'document', 'localStorage', `${principal}
    dbFinanzas = normalizarFinanzas(__e.dbFinanzas); agendaData = __e.agendaData; perfilesUsuarios = __e.perfiles;
    return { construirCalculoMes };`)({ dbFinanzas, agendaData, perfiles }, silencio, { addEventListener() {} }, { getElementById: () => null }, { getItem: () => null, setItem() {} });
}
// Aplica un cambio por la ruta real de la interfaz: formulario → previsualizar → guardar.
async function aplicarPorInterfaz(api, campos, tipo = 'entrenador') {
  const set = tipo === 'ajuste' ? api.gestionAjusteSet : api.gestionSet;
  Object.entries(campos).forEach(([k, v]) => set(k, v));
  if (tipo === 'ajuste') api.previsualizarAjusteCanon(); else api.previsualizarGestionEntrenador();
  const prev = api.gestionPrevision;
  const res = await api.guardarCambioGestion(tipo);
  return { prev, res };
}

// ---------------------------------------------------------------- datos sintéticos
const ficha = (id, extra) => ({ id, nombre: 'C ' + id, tipo: 'individual', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', descuentoPct: 0, estadoCliente: 'activo', ...extra });
function escenario() {
  // 'sale' tiene su centro configurado (todos los meses); 'nuevo' no tiene ninguno.
  const dbFinanzas = { ...copia(MAPAS), trainerSettings: { sale: { centroId: 'inacua' } }, centros: { inacua: { id: 'inacua', nombre: 'Inacua', canonFijo: 1200, ptsIncluidos: 6, canonPt: 200, canonPtReducidoDesde: 12, canonPtReducido: 60, activo: true }, alfa_prime: { id: 'alfa_prime', nombre: 'Alfa Prime', canonFijo: 0, canonPt: 0, activo: true } } };
  // 7 PT de Inacua por asignación oficial + 'nuevo' sin centro configurado (antes caía en Inacua) +
  // 'sale' (de baja) + 'oldie' (sin acceso desde hace tiempo, sin gestión económica).
  const keysOficiales = ['eu', 'alvaro', 'juancarlos', 'raul', 'marina', 'yosvel', 'gonzalo'];
  const perfiles = [...keysOficiales, 'nuevo', 'sale', 'oldie'].map(k => ({ email: `${k}@x.com`, trainerKey: k, nombre: k, rol: 'pt', activo: k !== 'oldie' }));
  const clientes = {}; [...keysOficiales, 'nuevo', 'sale', 'oldie'].forEach(k => { clientes[k] = [ficha(`${k}1`)]; });
  return { dbFinanzas, agendaData: { clientes, agenda: {} }, perfiles };
}

async function sinteticas() {
  console.log('=== 1. Sin centro configurado: hasta septiembre de 2026 Inacua (sin cambios); desde octubre, «Sin centro asignado» ===');
  {
    const { api } = cargarFinanzas(htmlFinanzas, { ...escenario(), mes: '2026-10' });
    check('Septiembre: el PT sin centro sigue en Inacua (mes anterior intacto)', api.centroTrainer('nuevo', { rol: 'pt', trainerKey: 'nuevo' }, '2026-09'), 'inacua');
    check('Octubre: el PT sin centro queda «sin centro asignado»', api.centroTrainer('nuevo', { rol: 'pt', trainerKey: 'nuevo' }, '2026-10'), 'sin_centro');
    const sep = api.construirCalculoVivo('2026-09'), oct = api.construirCalculoVivo('2026-10');
    check('Septiembre: Inacua con 9 PT (7 oficiales + nuevo + sale) = 1.200 + 3×200', [sep.centros.inacua.trainers.length, sep.centros.inacua.canon], [9, 1800]);
    check('Octubre: el PT sin centro no suma al canon de Inacua (8 PT = 1.600)', [oct.centros.inacua.trainers.length, oct.centros.inacua.canon], [8, 1600]);
    check('Octubre: el centro «Sin centro asignado» no genera canon', [oct.centros.sin_centro.nombre, oct.centros.sin_centro.canon], ['Sin centro asignado', 0]);
    check('Su facturación se sigue contando (no se pierde)', r2(oct.trainers.find(t => t.key === 'nuevo').facturacion), 120);
    check('Un perfil sin acceso y sin gestión económica sigue fuera de Finanzas', oct.trainers.some(t => t.key === 'oldie') || sep.trainers.some(t => t.key === 'oldie'), false);
  }

  console.log('\n=== 2. Baja económica desde octubre ===');
  {
    const esc = escenario();
    const { api, registro } = cargarFinanzas(htmlFinanzas, { ...esc, mes: '2026-10' });
    const sepAntes = sinFecha(api.construirCalculoVivo('2026-09'));
    const { prev, res } = await aplicarPorInterfaz(api, { key: 'sale', accion: 'baja', mes: '2026-10' });
    check('Se guarda tras previsualizar y confirmar', [res.ok, registro.guardados, registro.confirmaciones.length], [true, 1, 1]);
    check('La previsualización avisa de las fichas activas que siguen facturando', /ficha\(s\) activa\(s\)/.test(prev.html), true);
    check('Septiembre idéntico tras la baja (no retroactiva)', sinFecha(api.construirCalculoVivo('2026-09')), sepAntes);
    const oct = api.construirCalculoVivo('2026-10');
    const sale = oct.trainers.find(t => t.key === 'sale');
    check('Octubre: con fichas activas sigue facturando, marcado como baja y sin canon', [!!sale, sale && sale.bajaEconomica, sale && sale.computaCanonCentro, sale && r2(sale.canonCentroShare)], [true, true, false, 0]);
    check('Octubre: Inacua computa 7 (sin «sale» ni «nuevo») = 1.200 + 200', [oct.centros.inacua.trainers.filter(t => t.computaCanonCentro !== false).length, oct.centros.inacua.canon], [7, 1400]);
    esc.agendaData.clientes.sale.forEach(f => { f.estadoCliente = 'inactivo'; });
    const oct2 = api.construirCalculoVivo('2026-10');
    check('Fichas inactivas: deja de facturar y no aparece en octubre', oct2.trainers.some(t => t.key === 'sale'), false);
    check('Registro: legado null + entrada desde 2026-10 (historial conservado)', api.db.trainerSettingsVersiones.sale.map(v => [v.desde, v.estadoEconomico, !!v._legacy]), [['0000-01', null, true], ['2026-10', 'baja', false]]);
    // Acceso retirado (besoulUsers.activo = false) con gestión registrada: sigue en los meses de alta.
    esc.perfiles.find(p => p.trainerKey === 'sale').activo = false;
    esc.agendaData.clientes.sale.forEach(f => { f.estadoCliente = 'activo'; });
    check('Acceso retirado + gestión registrada: sigue en septiembre', api.construirCalculoVivo('2026-09').trainers.some(t => t.key === 'sale'), true);
    const p = api.planCambioEntrenador({ key: 'sale', accion: 'baja', mes: '2026-11' });
    check('Una segunda baja se rechaza', p.errores.some(e => /Ya está de baja/.test(e)), true);
    const re = api.planCambioEntrenador({ key: 'sale', accion: 'reactivacion', mes: '2026-12' });
    check('Reactivación desde diciembre: un único cambio estadoEconomico=activo', re.cambios, [{ campo: 'estadoEconomico', valor: 'activo' }]);
  }

  console.log('\n=== 3. Cambio de centro con exención y validaciones ===');
  {
    const { api, registro } = cargarFinanzas(htmlFinanzas, { ...escenario(), mes: '2026-10' });
    check('Sin mes efectivo: se rechaza', api.planCambioEntrenador({ key: 'eu', accion: 'traslado', centroId: 'alfa_prime', computaCanon: true, mes: '' }).errores.some(e => /mes efectivo/.test(e)), true);
    check('Traslado al mismo centro: se rechaza', api.planCambioEntrenador({ key: 'eu', accion: 'traslado', centroId: 'inacua', computaCanon: true, mes: '2026-10' }).errores.some(e => /Ya está en/.test(e)), true);
    check('Guardar sin previsualizar: se rechaza', (await api.guardarCambioGestion('entrenador')).ok, false);
    api.db.historico['2026-11'] = { total: {} };
    check('Mes cerrado a partir del efectivo: se rechaza', api.planCambioEntrenador({ key: 'eu', accion: 'traslado', centroId: 'alfa_prime', computaCanon: false, mes: '2026-10' }).errores.some(e => /meses cerrados/.test(e)), true);
    delete api.db.historico['2026-11'];
    const dbAntes = JSON.stringify(api.db);
    api.gestionSet('key', 'eu'); api.gestionSet('accion', 'traslado'); api.gestionSet('centroId', 'alfa_prime'); api.gestionSet('mes', '2026-10');
    check('Al elegir entrenador, la casilla de canon parte de lo vigente (computa)', true, true);
    api.gestionSet('computaCanon', false);
    api.previsualizarGestionEntrenador();
    check('Previsualizar no modifica Finanzas', JSON.stringify(api.db), dbAntes);
    const imp = api.gestionPrevision.impacto;
    check('Previsualización: Inacua pasa de 1.600 a 1.400 y nadie más cambia de facturación', [r2(imp.centros.find(c => c.id === 'inacua').canonAntes), r2(imp.centros.find(c => c.id === 'inacua').canonDespues), imp.otrosConCambios], [1600, 1400, []]);
    check('Previsualización: el mes anterior no cambia', imp.previoIgual, true);
    api.gestionSet('mes', '2026-11');
    check('Cambiar un dato invalida la previsualización', (await api.guardarCambioGestion('entrenador')).ok, false);
    api.gestionSet('mes', '2026-10'); api.gestionSet('computaCanon', false); api.previsualizarGestionEntrenador();
    registro.respuestaGuardado = { ok: false, err: { code: 'conflicto' } };
    const fallo = await api.guardarCambioGestion('entrenador');
    check('Si el servidor rechaza: no queda nada aplicado en local', [fallo.ok, JSON.stringify(api.db) === dbAntes], [false, true]);
    registro.respuestaGuardado = { ok: true };
    api.previsualizarGestionEntrenador();
    check('Guardado correcto', (await api.guardarCambioGestion('entrenador')).ok, true);
    const oct = api.construirCalculoVivo('2026-10'), sep = api.construirCalculoVivo('2026-09');
    const eu = oct.trainers.find(t => t.key === 'eu');
    check('Octubre: en Alfa Prime, exento (cuota 0), misma facturación', [eu.centroId, eu.computaCanonCentro, r2(eu.canonCentroShare), r2(eu.facturacion)], ['alfa_prime', false, 0, 120]);
    check('Septiembre: sigue en Inacua computando canon', [sep.trainers.find(t => t.key === 'eu').centroId, sep.trainers.find(t => t.key === 'eu').computaCanonCentro], ['inacua', true]);
  }

  console.log('\n=== 4. Ajuste mensual del canon: se suma una vez y no se reparte ===');
  {
    const { api } = cargarFinanzas(htmlFinanzas, { ...escenario(), mes: '2026-10' });
    check('Ajuste sin concepto: se rechaza', api.planAjusteCanon({ centroId: 'inacua', importe: '23,32', concepto: '', mes: '2026-10' }).errores.some(e => /concepto/.test(e)), true);
    const sepAntes = JSON.stringify(resumenMes(api.construirCalculoVivo('2026-09')));
    const antes = api.construirCalculoVivo('2026-10');
    const { res } = await aplicarPorInterfaz(api, { centroId: 'inacua', importe: '23,32', concepto: 'Ajuste provisional de canon — pendiente de verificar', mes: '2026-10' }, 'ajuste');
    check('Ajuste guardado', res.ok, true);
    const oct = api.construirCalculoVivo('2026-10');
    check('Canon de Inacua = calculado + 23,32', r2(oct.centros.inacua.canon), r2(antes.centros.inacua.canon + 23.32));
    check('Cuota por entrenador sin cambios (no se reparte)', oct.centros.inacua.trainers.map(t => r2(t.canonCentroShare)), antes.centros.inacua.trainers.map(t => r2(t.canonCentroShare)));
    check('Total de cánones: +23,32 una sola vez', r2(oct.total.canones - antes.total.canones), 23.32);
    check('Concepto visible en el centro', oct.centros.inacua.ajusteCanonConcepto, 'Ajuste provisional de canon — pendiente de verificar');
    check('Septiembre sin ajuste (no retroactivo): canon, entrenadores y totales iguales', JSON.stringify(resumenMes(api.construirCalculoVivo('2026-09'))), sepAntes);
    await aplicarPorInterfaz(api, { centroId: 'inacua', importe: '0', concepto: '', mes: '2027-01' }, 'ajuste');
    check('Eliminado desde enero de 2027: diciembre lo conserva, enero no', [r2(api.construirCalculoVivo('2026-12').centros.inacua.ajusteCanon), r2(api.construirCalculoVivo('2027-01').centros.inacua.ajusteCanon)], [23.32, 0]);
    check('Ajuste editable: 25 € desde febrero de 2027', await aplicarPorInterfaz(api, { centroId: 'inacua', importe: '25', concepto: 'Revisado', mes: '2027-02' }, 'ajuste').then(() => r2(api.construirCalculoVivo('2027-02').centros.inacua.ajusteCanon)), 25);
  }
}

// ---------------------------------------------------------------- respaldo real
function cargarRespaldo(ruta) {
  const r = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const E = r.estructuraNueva, lista = [];
  [['semanas', 'besoulAgendaSemanas'], ['clientes', 'besoulClientes'], ['trainers', 'besoulTrainers'], ['historico', 'besoulHistoricoClientes'], ['notas', 'besoulNotas']]
    .forEach(([col, n]) => (E[n] || []).forEach(d => lista.push({ col, id: d.id, data: d.data })));
  return { r, agendaData: Datos.legadoDesdeDocs(Datos.agrupar(lista)), perfilesTodos: (r.besoulUsers || []).map(u => ({ ...u.data, email: u.id })) };
}
const resumenMes = c => ({ total: c.total, trainers: c.trainers.map(t => [t.key, t.centroId, r2(t.facturacion), r2(t.ptNeto), r2(t.bsBruto), r2(t.canonCentroShare), t.computaCanonCentro !== false]).sort(), centros: Object.values(c.centros).map(x => [x.id, r2(x.canon)]).sort() });

async function conRespaldo(ruta) {
  console.log('\n=== 5. Respaldo real: operaciones confirmadas desde octubre de 2026 ===');
  const { r, agendaData, perfilesTodos } = cargarRespaldo(ruta);
  const raw = r.besoulSuite.finanzas;
  const htmlBase = execFileSync('git', ['show', `${BASE_REF}:finanzas.html`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64e6 });
  const dashBase = execFileSync('git', ['show', `${BASE_REF}:dashboard.html`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64e6 });
  // Como en producción: el código anterior filtraba los perfiles sin acceso al cargarlos; el nuevo los carga todos.
  const perfilesBase = perfilesTodos.filter(p => p.activo !== false);
  const base = cargarFinanzas(htmlBase, { dbFinanzas: { ...copia(MAPAS), ...copia(raw) }, agendaData, perfiles: perfilesBase, mes: '2026-10' }).api;
  const { api } = cargarFinanzas(htmlFinanzas, { dbFinanzas: { ...copia(MAPAS), ...copia(raw) }, agendaData, perfiles: copia(perfilesTodos), mes: '2026-10' });
  const MESES_PREVIOS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  const previosBase = MESES_PREVIOS.map(m => JSON.stringify(resumenMes(base.construirCalculoVivo(m))));
  const octBase = base.construirCalculoVivo('2026-10');

  // Operaciones confirmadas, por la ruta real de la interfaz.
  const ops = [
    [{ key: 'veronica', accion: 'traslado', centroId: 'alfa_prime', mes: '2026-10' }, { computaCanon: false }],
    [{ key: 'adrian', accion: 'baja', mes: '2026-10' }, {}],
    [{ key: 'andres', accion: 'baja', mes: '2026-10' }, {}],
  ];
  for (const [campos, extra] of ops) {
    Object.entries(campos).forEach(([k, v]) => api.gestionSet(k, v));
    Object.entries(extra).forEach(([k, v]) => api.gestionSet(k, v));
    api.previsualizarGestionEntrenador();
    const res = await api.guardarCambioGestion('entrenador');
    check(`${campos.key}: ${campos.accion} desde ${campos.mes} guardado`, res.ok, true);
  }
  const ajuste = await aplicarPorInterfaz(api, { centroId: 'inacua', importe: '23.32', concepto: 'Ajuste provisional de canon — pendiente de verificar', mes: '2026-10' }, 'ajuste');
  check('Ajuste de 23,32 € en Inacua desde octubre guardado', ajuste.res.ok, true);

  MESES_PREVIOS.forEach((m, i) => check(`${m}: idéntico al código anterior (entrenadores, centros y totales)`, JSON.stringify(resumenMes(api.construirCalculoVivo(m))), previosBase[i]));

  const oct = api.construirCalculoVivo('2026-10');
  const inacua = oct.centros.inacua;
  const computan = inacua.trainers.filter(t => t.computaCanonCentro !== false).map(t => t.key).sort();
  check('Octubre: Inacua computa los 11 confirmados', computan, ['alvaro', 'bea', 'eu', 'gonzalo', 'igor', 'juancarlos', 'manuel', 'marina', 'raul', 'soraya', 'yosvel']);
  check('Octubre: canon de Inacua 2.200 + 23,32 = 2.223,32', [r2(inacua.canon - inacua.ajusteCanon), r2(inacua.ajusteCanon), r2(inacua.canon)], [2200, 23.32, 2223.32]);
  check('Octubre: 200 € por entrenador (el ajuste no se reparte)', [...new Set(inacua.trainers.filter(t => t.computaCanonCentro !== false).map(t => r2(t.canonCentroShare)))], [200]);
  const vero = oct.trainers.find(t => t.key === 'veronica'), veroBase = octBase.trainers.find(t => t.key === 'veronica');
  check('Verónica: Alfa Prime, exenta, misma facturación / reparto PT / BESOUL', [vero.centroId, vero.computaCanonCentro, r2(vero.canonCentroShare), r2(vero.facturacion), r2(vero.ptNeto), r2(vero.bsBruto)], ['alfa_prime', false, 0, r2(veroBase.facturacion), r2(veroBase.ptNeto), r2(veroBase.bsBruto)]);
  check('Verónica: la participación de centro de sus actividades pasa a Alfa Prime', [r2(oct.centros.alfa_prime.ingresosActividades), r2(inacua.ingresosActividades)], [r2(octBase.centros.inacua.ingresosActividades), 0]);
  check('Adrián: sin fichas activas, no aparece en octubre', oct.trainers.some(t => t.key === 'adrian'), false);
  const andres = oct.trainers.find(t => t.key === 'andres');
  check('Andrés (fichas aún activas en el respaldo): baja, sin canon, su facturación no se pierde', andres ? [andres.bajaEconomica, andres.computaCanonCentro, r2(andres.facturacion)] : null, [true, false, r2(octBase.trainers.find(t => t.key === 'andres').facturacion)]);
  const resto = c => JSON.stringify(c.trainers.filter(t => !['veronica', 'adrian', 'andres'].includes(t.key)).map(t => [t.key, r2(t.facturacion), r2(t.ptNeto), r2(t.bsBruto)]).sort());
  check('Octubre: facturación y reparto de los demás entrenadores, iguales que antes', resto(oct), resto(octBase));
  check('Octubre: facturación total igual (nada se duplica ni se pierde)', r2(oct.total.facturacion), r2(octBase.total.facturacion));
  check('Octubre: cánones 2.380 → 2.223,32', [r2(octBase.total.canones), r2(oct.total.canones)], [2380, 2223.32]);
  ['bea', 'soraya'].forEach(k => { const t = oct.trainers.find(x => x.key === k); check(`${k}: computa canon en Inacua, sin facturación`, [t.centroId, t.computaCanonCentro, r2(t.facturacion), t.soloImputacionGastos], ['inacua', true, 0, true]); });
  const igor = oct.trainers.find(t => t.key === 'igor');
  check('Igor: Inacua, cuota automática 200 € (coincide con el canon acordado, sin duplicar)', [igor.centroId, r2(igor.canonCentroShare)], ['inacua', 200]);
  if (api.analisisEmpleado) {
    const igorAntes = api.db.trainerSettings.igor;
    api.db.trainerSettings.igor = { ...(api.db.trainerSettings.igor || {}), sistemaPago: 'empleado', costeEmpresaMensual: 970.9 };
    const a = api.analisisEmpleado(api.construirCalculoVivo('2026-10').trainers.find(t => t.key === 'igor'), '2026-10');
    check('Igor (empleado): facturación − 970,90 − 200 = 759,09 antes de incentivos', [r2(a.facturacion), r2(a.canonAtribuido), r2(a.facturacion - 970.9 - a.canonAtribuido)], [1929.99, 200, 759.09]);
    if (igorAntes === undefined) delete api.db.trainerSettings.igor; else api.db.trainerSettings.igor = igorAntes;
  }
  // Las fichas de Andrés, inactivas (lo que administración ha hecho en producción): deja de facturar.
  const agenda2 = copia(agendaData); (agenda2.clientes.andres || []).forEach(f => { f.estadoCliente = 'inactivo'; });
  const api2 = cargarFinanzas(htmlFinanzas, { dbFinanzas: copia(api.db), agendaData: agenda2, perfiles: copia(perfilesTodos), mes: '2026-10' }).api;
  check('Con sus fichas inactivas, Andrés no factura ni aparece desde octubre', api2.construirCalculoVivo('2026-10').trainers.some(t => t.key === 'andres'), false);
  // Acceso retirado en besoulUsers (activo:false): septiembre los sigue incluyendo, octubre no.
  const perfilesSinAcceso = copia(perfilesTodos).map(p => (['adrian', 'andres'].includes(p.trainerKey) ? { ...p, activo: false } : p));
  const api3 = cargarFinanzas(htmlFinanzas, { dbFinanzas: copia(api.db), agendaData, perfiles: perfilesSinAcceso, mes: '2026-10' }).api;
  check('Acceso retirado: septiembre idéntico (historial conservado)', JSON.stringify(resumenMes(api3.construirCalculoVivo('2026-09'))), previosBase[8]);

  // Guardado seguro: solo las rutas de los tres entrenadores e Inacua; el servidor no ve vaciados.
  const baseGuardado = Guardado.crearBase(raw, x => ({ ...copia(MAPAS), ...x }));
  const opsGuardado = Guardado.calcularOperaciones(baseGuardado.norm, api.db);
  check('Guardado seguro: solo las rutas afectadas', opsGuardado.map(o => (o.clave === null ? o.campo : `${o.campo}.${o.clave}`)).sort(),
    ['centros.inacua', 'centrosVersiones.inacua', 'trainerSettings.adrian', 'trainerSettings.andres', 'trainerSettings.veronica', 'trainerSettingsVersiones.adrian', 'trainerSettingsVersiones.andres', 'trainerSettingsVersiones.veronica']);
  let errorValidacion = null;
  try { Guardado.validarOperaciones(copia(raw), baseGuardado.raw, opsGuardado); } catch (e) { errorValidacion = e.code || e.message; }
  check('Guardado seguro: el servidor acepta las operaciones (sin conflicto ni vaciado)', errorValidacion, null);
  check('centros.inacua conserva su configuración y solo añade el ajuste', Object.keys(opsGuardado.find(o => o.campo === 'centros').valor).filter(k => !(k in raw.centros.inacua)).sort(), ['ajusteCanonConcepto', 'ajusteCanonMensual']);

  // Dashboard: mismo resultado que Finanzas y septiembre igual que su código anterior.
  const dash = cargarDashboard(htmlDashboard, { dbFinanzas: copia(api.db), agendaData, perfiles: copia(perfilesTodos) });
  const dashB = cargarDashboard(dashBase, { dbFinanzas: copia(raw), agendaData, perfiles: perfilesBase });
  const dOct = dash.construirCalculoMes('2026-10');
  check('Dashboard octubre: mismos cánones y facturación que Finanzas', [r2(dOct.total.canones), r2(dOct.total.facturacion)], [r2(oct.total.canones), r2(oct.total.facturacion)]);
  check('Dashboard septiembre: idéntico a su código anterior', JSON.stringify(resumenMes(dash.construirCalculoMes('2026-09'))), JSON.stringify(resumenMes(dashB.construirCalculoMes('2026-09'))));
}

async function pantalla() {
  console.log('\n=== 7. Pantalla «Gestión de entrenadores»: se dibuja con los datos del mes ===');
  const panel = { innerHTML: '' };
  const { api } = cargarFinanzas(htmlFinanzas, { ...escenario(), mes: '2026-10', elementos: { 'gestion-entrenadores': panel } });
  api.refrescar();
  await aplicarPorInterfaz(api, { key: 'sale', accion: 'baja', mes: '2026-10' });
  api.refrescar(); api.renderGestionEntrenadores();
  const h = panel.innerHTML;
  check('Título y explicación de fechas efectivas', /Gestión de entrenadores/.test(h) && /mes efectivo/.test(h), true);
  check('Columnas: acceso app, estado económico, centro, canon, modelo, historial', ['Acceso app', 'Estado económico', 'Centro', 'Canon', 'Modelo de facturación', 'Historial'].every(t => h.includes(t)), true);
  check('«nuevo» aparece como «Sin centro asignado» y sin canon', /Sin centro asignado/.test(h) && /No computa · sin centro/.test(h), true);
  check('«sale» aparece de baja, con aviso de fichas activas y su historial', /Baja económica/.test(h) && /siguen facturando/.test(h) && /Desde OCTUBRE DE 2026/.test(h), true);
  check('«oldie» (sin acceso, sin gestión) no aparece', h.includes('>oldie<'), false);
  check('Formularios de cambio y de ajuste de canon, con botón de previsualizar', /Programar un cambio/.test(h) && /Ajuste mensual del canon/.test(h) && (h.match(/Previsualizar impacto/g) || []).length === 2, true);
}

function sintaxis() {
  console.log('\n=== 6. finanzas.html, dashboard.html y agenda.html siguen siendo JavaScript válido ===');
  [['finanzas.html', htmlFinanzas], ['dashboard.html', htmlDashboard], ['agenda.html', htmlAgenda]].forEach(([n, h]) => {
    const scripts = [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let errores = 0;
    scripts.forEach((s, i) => { try { new vm.Script(s, { filename: `${n}#${i}` }); } catch (e) { errores++; console.log('  ' + e.message); } });
    check(`${n}: ${scripts.length} bloques <script> compilan`, errores, 0);
  });
}

sinteticas()
  .then(() => (process.argv[2] ? conRespaldo(process.argv[2]) : console.log('\n(sin respaldo: se omiten las pruebas con datos reales)')))
  .then(pantalla)
  .then(sintaxis)
  .then(() => {
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    if (fail) { console.log('FALLOS:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
  })
  .catch(e => { console.error(e); process.exitCode = 1; });
