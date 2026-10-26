// FIX-FINANZAS-GUARDADO-SEGURO: pruebas REALES del guardado de Finanzas contra el emulador de
// Firestore con las reglas del repo (firestore.rules). Ejecuta el <script> principal REAL de
// finanzas.html (no una reimplementación) con un DOM mínimo, y escribe como un admin autenticado,
// así que las reglas se aplican igual que en producción. Datos SINTÉTICOS con la misma forma que el
// documento real (nunca datos de clientes).
//
//   firebase emulators:exec --only firestore --project demo-besoul-finanzas "node finance-save-tests/run_guardado_seguro.cjs"
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const NM = path.join(RAIZ, 'rules-tests', 'node_modules');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require(path.join(NM, '@firebase/rules-unit-testing'));
const firebaseCompat = require(path.join(NM, 'firebase/compat/app'));
require(path.join(NM, 'firebase/compat/firestore'));
const BesoulDatos = require(path.join(RAIZ, 'besoul-datos.js'));
const BesoulFinanzasGuardado = require(path.join(RAIZ, 'besoul-finanzas-guardado.js'));
const G = BesoulFinanzasGuardado;

const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
const ADMIN = 'admin@x.com', PT = 'pta@x.com';

let pass = 0, fail = 0; const fallos = [];
function check(desc, ok, detalle = '') { if (ok) pass++; else { fail++; fallos.push(desc); } console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${!ok && detalle ? ' :: ' + detalle : ''}`); }
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await esperar(25); } return false; }

// ---------------------------------------------------------------- documento sintético
function documentoSemilla() {
  const centro = (id, nombre, extra = {}) => ({ id, nombre, orden: 1, canonFijo: 0, ptsIncluidos: 0, canonPt: 0, canonPtReducidoDesde: 0, canonPtReducido: 0, activo: true, visibleCRM: true, visibleAgenda: true, visibleReservas: true, visibleQR: true, ...extra });
  return {
    centros: {
      alfa_prime: centro('alfa_prime', 'ALFA PRIME', { canonFijo: 300, canonPt: 200 }),
      inacua: centro('inacua', 'INACUA', { orden: 3, canonFijo: 1200, ptsIncluidos: 6, canonPt: 200, canonPtReducidoDesde: 12, canonPtReducido: 60.5, reglaCanon: 'inacua_2026_v1' }),
      fantasy: centro('fantasy', 'FANTASY', { canonFijo: 200 }),
      lagunillas: centro('lagunillas', 'LAGUNILLAS', { canonFijo: 1010 }),
      capuchinos: centro('capuchinos', 'Capuchinos', { economiaConfigurada: false }),
      c1: centro('c1', 'Centro antiguo', { activo: false }),
      c2: centro('c2', 'Centro antiguo 2', { activo: false }),
    },
    trainerSettings: {
      pt_a: { sistemaPago: 'rango3', canonFijoIndependiente: 800, fechaAlta: '2023-01-01' },
      pt_b: { sistemaPago: 'rango3', canonFijoIndependiente: 600, fechaAlta: '2023-01-01', centroId: 'fantasy' },
      pt_c: { centroId: 'alfa_prime', computaCanonCentro: false },
    },
    trainerSettingsVersiones: { pt_a: [{ desde: '0000-01', canonFijoIndependiente: 700, _legacy: true }, { desde: '2026-09', canonFijoIndependiente: 800 }] },
    centrosVersiones: { inacua: [{ desde: '0000-01', canonFijo: 1233.82, _legacy: true }, { desde: '2026-09', canonFijo: 1200 }] },
    otrosIngresos: { '2026-07': [{ categoria: 'Merchandising', concepto: 'Toalla', importe: 16 }], '2026-08': [{ categoria: 'Otros', concepto: 'Ajuste', importe: 25 }] },
    gastos: {
      '2026-08': [{ categoria: 'Administración', concepto: 'Gestoría', tipo: 'fijo', importe: 200 }],
      '2026-09': [{ categoria: 'Administración', concepto: 'Gestoría', tipo: 'fijo', importe: 200 }, { categoria: 'Publicidad', concepto: 'Campaña', tipo: 'variable', importe: 355 }],
    },
    historico: {},
    auditoriaCierres: {},
    pts: { 'pt-1': { nombre: 'Legado', clientes: 0 } },
    meses: { '2026-08': { total: { facturacion: 1 } } },
    ultimaActualizacionLocal: '2026-07-09T12:07:54.003Z',
  };
}
const CAMPOS = ['centros', 'trainerSettings', 'trainerSettingsVersiones', 'centrosVersiones', 'otrosIngresos', 'gastos', 'historico', 'auditoriaCierres', 'pts', 'meses', 'ultimaActualizacionLocal'];
function camposDistintos(a, b, ignorar = []) { return CAMPOS.filter(k => !ignorar.includes(k) && !G.igual(a[k], b[k])); }

// ---------------------------------------------------------------- finanzas.html real
const html = fs.readFileSync(path.join(RAIZ, 'finanzas.html'), 'utf8');
const SCRIPT = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function guardarConfigFinanzas'));

function domFalso() {
  const banner = { innerText: '', className: '', clases: new Set(), classList: null };
  banner.classList = { add: c => banner.clases.add(c), remove: c => banner.clases.delete(c), toggle() {}, contains: c => banner.clases.has(c) };
  const inertes = new Set();
  const hijo = (tag, id) => ({ tagName: tag, id, setAttribute: a => { if (a === 'inert') inertes.add(id); }, removeAttribute: a => { if (a === 'inert') inertes.delete(id); } });
  const app = { children: [hijo('HEADER', 'h'), banner && hijo('DIV', 'finanzas-estado-carga'), hijo('MAIN', 'contenido'), hijo('NAV', 'nav')] };
  const comodin = new Proxy(function () {}, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => '' : p === 'length' ? 0 : p === 'children' ? [] : comodin),
    set: () => true, apply: () => comodin,
  });
  const document = new Proxy({}, {
    get: (t, p) => {
      if (p === 'getElementById') return id => (id === 'finanzas-estado-carga' ? banner : id === 'app-content' ? app : comodin);
      if (p === 'querySelectorAll') return () => [];
      return comodin;
    },
  });
  return { document, banner, inertes };
}

function abrirPagina(db, email) {
  const { document, banner, inertes } = domFalso();
  const alertas = [];
  let respuestaPrompt = 'motivo de prueba';
  const fsFn = () => db;
  fsFn.FieldValue = firebaseCompat.firestore.FieldValue;
  fsFn.FieldPath = firebaseCompat.firestore.FieldPath;
  fsFn.Timestamp = firebaseCompat.firestore.Timestamp;
  const firebase = { apps: [1], initializeApp() {}, firestore: fsFn, auth: () => ({ onAuthStateChanged() {}, currentUser: { email }, signOut: async () => {} }) };
  const window = {};
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const consola = { log() {}, warn() {}, error() {} };
  const fabrica = new Function('document', 'window', 'firebase', 'alert', 'confirm', 'prompt', 'localStorage', 'navigator', 'BesoulDatos', 'BesoulFinanzasGuardado', 'indexedDB', 'console',
    SCRIPT + '\n;return { ev: codigo => eval(codigo) };');
  const pagina = fabrica(document, window, firebase, m => alertas.push(String(m)), () => true, () => respuestaPrompt, localStorage, {}, BesoulDatos, BesoulFinanzasGuardado, undefined, consola);
  pagina.alertas = alertas; pagina.banner = banner; pagina.inertes = inertes;
  pagina.responderPrompt = r => { respuestaPrompt = r; };
  // Ejecuta `alFinal` dentro de la PRIMERA transacción de guardado, después de que la página haya
  // preparado su escritura y antes del commit: simula ediciones o escrituras ajenas "durante" el guardado.
  pagina.durantePrimeraTransaccion = alFinal => {
    let hecho = false;
    const real = db;
    pagina.__envoltorio = { collection: (...a) => real.collection(...a), runTransaction: fn => real.runTransaction(async tx => { const r = await fn(tx); if (!hecho) { hecho = true; await alFinal(); } return r; }) };
    globalThis.__envoltorioFinanzas = pagina.__envoltorio;
    pagina.ev('firestore = globalThis.__envoltorioFinanzas');
  };
  pagina.__db = db;
  pagina.ev(`firestore = firebase.firestore(); finanzasRef = firestore.collection('besoulSuite').doc('finanzas'); usuarioFinanzasEmail = ${JSON.stringify(email)}; mesSeleccionadoFinanzas = '2026-10';`);
  pagina.suscribir = () => pagina.ev('finanzasUnsub = suscribirFinanzas(finanzasRef)');
  pagina.parar = () => pagina.ev('finanzasUnsub && finanzasUnsub()');
  pagina.estado = () => pagina.ev('estadoCargaFinanzas');
  pagina.guardar = opts => pagina.ev(`guardarConfigFinanzas(${JSON.stringify(opts || {})})`);
  return pagina;
}

async function main() {
  const env = await initializeTestEnvironment({
    projectId: 'demo-besoul-finanzas',
    firestore: { rules: fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8'), host: HOST, port: Number(PORT) },
  });
  const admin = env.authenticatedContext('uid_admin', { email: ADMIN }).firestore();
  const pt = env.authenticatedContext('uid_pta', { email: PT }).firestore();
  async function sembrar(doc = documentoSemilla()) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await db.collection('besoulUsers').doc(ADMIN).set({ nombre: 'Admin', rol: 'admin', trainerKey: 'admin', activo: true, email: ADMIN });
      await db.collection('besoulUsers').doc(PT).set({ nombre: 'PT A', rol: 'pt', trainerKey: 'pt_a', activo: true, email: PT });
      if (doc) await db.collection('besoulSuite').doc('finanzas').set(doc);
    });
  }
  async function leer() { let d = null; await env.withSecurityRulesDisabled(async c => { const s = await c.firestore().collection('besoulSuite').doc('finanzas').get(); d = s.exists ? s.data() : null; }); return d; }
  const ref = db => db.collection('besoulSuite').doc('finanzas');
  const paginas = [];
  const abrir = (db, email) => { const p = abrirPagina(db, email); paginas.push(p); return p; };
  const cerrarPaginas = () => { while (paginas.length) { try { paginas.pop().parar(); } catch (e) {} } };

  console.log('=== 1. Incidente 10-10: guardar antes de recibir los datos del servidor ===');
  {
    await sembrar(); const antes = await leer();
    const p = abrir(admin, ADMIN); // pestaña sin snapshot todavía: dbFinanzas en estado inicial
    check('estado inicial = cargando', p.estado() === 'cargando');
    p.ev('agregarGasto()'); // misma acción que el 10-10 (añadir un gasto de octubre)
    const r = await p.ev('bsGuardadoFinanzasEnCurso');
    await esperar(300);
    const despues = await leer();
    check('el guardado se rechaza en el cliente (finanzas-no-cargada)', p.alertas.some(a => a.includes('todavía no ha recibido los datos del servidor')), JSON.stringify(p.alertas));
    check('el documento del servidor queda INTACTO (todos los campos)', camposDistintos(antes, despues).length === 0, camposDistintos(antes, despues).join(','));
    check('trainerSettings sigue con 3 entradas', Object.keys(despues.trainerSettings).length === 3);
    void r; cerrarPaginas();
  }

  console.log('\n=== 2. Carga correcta: estado listo, contenido interactivo, sin escrituras ===');
  {
    await sembrar(); const antes = await leer();
    const p = abrir(admin, ADMIN);
    p.suscribir(); // inicializar() lo llama justo al mostrar el contenido; el snapshot llega después
    check('contenido inerte mientras carga (cabecera y navegación siguen activas)', p.estado() === 'cargando' && p.inertes.has('contenido') && !p.inertes.has('h') && !p.inertes.has('nav'));
    check('llega a "listo" con datos del servidor', await hasta(() => p.estado() === 'listo'));
    check('contenido deja de estar inerte y el aviso se oculta', !p.inertes.has('contenido') && p.banner.clases.has('hidden'));
    check('cargar no escribe nada (documento idéntico)', camposDistintos(antes, await leer()).length === 0);
    const r = await p.guardar(); // "Guardar" sin cambios
    check('guardar sin cambios: ok y sin escrituras', r.ok === true && camposDistintos(antes, await leer()).length === 0);
    cerrarPaginas();
  }

  console.log('\n=== 3. Gastos: añadir, modificar y eliminar (escritura dirigida) ===');
  {
    await sembrar(); const antes = await leer();
    const p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.ev('agregarGasto()'); let r = await p.ev('bsGuardadoFinanzasEnCurso');
    let d = await leer();
    check('añadir: ok', r.ok === true, JSON.stringify(r.err && r.err.message));
    check('añadir: gastos.2026-10 tiene 1 gasto', Array.isArray(d.gastos['2026-10']) && d.gastos['2026-10'].length === 1);
    check('añadir: solo cambia "gastos" (centros normalizados NO se escriben)', camposDistintos(antes, d, ['gastos']).length === 0, camposDistintos(antes, d, ['gastos']).join(','));
    check('añadir: gastos de agosto y septiembre intactos', G.igual(d.gastos['2026-08'], antes.gastos['2026-08']) && G.igual(d.gastos['2026-09'], antes.gastos['2026-09']));
    check('añadir: centros conserva los 7 centros y sus cánones', Object.keys(d.centros).length === 7 && d.centros.lagunillas.canonFijo === 1010 && d.centros.inacua.canonPtReducido === 60.5);
    check('añadir: actualizadoPor y actualizadoEn del servidor', d.actualizadoPor === ADMIN && d.actualizadoEn && typeof d.actualizadoEn.toMillis === 'function');
    await hasta(() => p.ev("(dbFinanzas.gastos['2026-10']||[]).length === 1"));
    p.ev("editarGasto(0, 'concepto', 'Flyers')"); await p.ev('bsGuardadoFinanzasEnCurso');
    p.ev("editarGasto(0, 'importe', '400')"); r = await p.ev('bsGuardadoFinanzasEnCurso');
    d = await leer();
    check('modificar (dos ediciones seguidas): ok', r.ok === true);
    check('modificar: concepto e importe guardados', d.gastos['2026-10'][0].concepto === 'Flyers' && d.gastos['2026-10'][0].importe === 400);
    p.ev('agregarGasto()'); await p.ev('bsGuardadoFinanzasEnCurso');
    p.ev('borrarGasto(0)'); r = await p.ev('bsGuardadoFinanzasEnCurso');
    d = await leer();
    check('eliminar: ok y queda 1 gasto (el nuevo)', r.ok === true && d.gastos['2026-10'].length === 1 && d.gastos['2026-10'][0].concepto === 'Nuevo gasto');
    p.ev('borrarGasto(0)'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('eliminar el último gasto del mes: ok (el mes queda como lista vacía)', r.ok === true && Array.isArray(d.gastos['2026-10']) && d.gastos['2026-10'].length === 0);
    p.ev("mesSeleccionadoFinanzas = '2026-11'"); p.ev('crearMesGastosVacio()'); await p.ev('bsGuardadoFinanzasEnCurso');
    p.ev("mesSeleccionadoFinanzas = '2026-10'"); p.ev('copiarGastosFijosMesAnterior()'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('crear mes vacío y copiar fijos del mes anterior: ok', r.ok === true && Array.isArray(d.gastos['2026-11']) && d.gastos['2026-10'].length === 1 && d.gastos['2026-10'][0].copiadoDe === '2026-09' && d.gastos['2026-10'][0].concepto === 'Gestoría');
    p.ev("mesSeleccionadoFinanzas = '2026-10'"); p.ev('agregarOtroIngreso()'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('otros ingresos: añadir ok sin tocar julio/agosto', r.ok === true && d.otrosIngresos['2026-10'].length === 1 && G.igual(d.otrosIngresos['2026-07'], antes.otrosIngresos['2026-07']));
    check('tras todo el flujo, configuración intacta', camposDistintos(antes, d, ['gastos', 'otrosIngresos']).length === 0, camposDistintos(antes, d, ['gastos', 'otrosIngresos']).join(','));
    cerrarPaginas();
  }

  console.log('\n=== 4. Error de carga y documento inexistente: nada se sustituye por valores por defecto ===');
  {
    await sembrar();
    const p = abrir(pt, PT); p.suscribir(); // un PT no puede leer Finanzas -> permission-denied
    check('error de lectura -> estado "error"', await hasta(() => p.estado() === 'error'));
    check('aviso visible en rojo con el código', p.banner.innerText.includes('No se han podido cargar') && p.banner.innerText.includes('permission-denied') && /rose/.test(p.banner.className));
    check('contenido inerte tras el error', p.inertes.has('contenido'));
    check('dbFinanzas NO se rellena con centros por defecto', p.ev('Object.keys(dbFinanzas.centros).length') === 0);
    p.ev('agregarGasto()'); await p.ev('bsGuardadoFinanzasEnCurso');
    check('guardar tras error: rechazado en el cliente', p.alertas.some(a => a.includes('todavía no ha recibido')));
    cerrarPaginas();
    await sembrar(null);
    const q = abrir(admin, ADMIN); q.suscribir();
    check('documento inexistente -> estado "sin_documento"', await hasta(() => q.estado() === 'sin_documento'));
    q.ev('agregarGasto()'); await q.ev('bsGuardadoFinanzasEnCurso');
    check('documento inexistente: no se crea ninguno con valores por defecto', (await leer()) === null);
    cerrarPaginas();
  }

  console.log('\n=== 5. Concurrencia entre dos pestañas ===');
  {
    await sembrar();
    const a = abrir(admin, ADMIN), b = abrir(admin, ADMIN);
    a.suscribir(); b.suscribir(); await hasta(() => a.estado() === 'listo' && b.estado() === 'listo');
    b.parar(); // B se queda con una copia antigua (no recibe lo que guarde A)
    a.ev('agregarGasto()'); await a.ev('bsGuardadoFinanzasEnCurso');
    b.ev('agregarGasto()'); const rb = await b.ev('bsGuardadoFinanzasEnCurso');
    let d = await leer();
    check('misma ruta cambiada por las dos: B se rechaza por conflicto', rb.ok === false && rb.err && rb.err.code === 'conflicto-concurrencia', JSON.stringify(rb.err && rb.err.code));
    check('misma ruta: se conserva el gasto de A, sin duplicar ni perder', d.gastos['2026-10'].length === 1);
    b.ev("delete dbFinanzas.gastos['2026-10']"); // B descarta su cambio rechazado (equivale a recargar)
    b.ev("mesSeleccionadoFinanzas = '2026-09'"); b.ev('agregarOtroIngreso()'); const rb2 = await b.ev('bsGuardadoFinanzasEnCurso');
    d = await leer();
    check('rutas distintas: B guarda su ingreso y se conserva el gasto de A', rb2.ok === true && d.otrosIngresos['2026-09'].length === 1 && d.gastos['2026-10'].length === 1, JSON.stringify(rb2.err && rb2.err.message));
    cerrarPaginas();
  }

  console.log('\n=== 6. Protección en el cliente contra vaciado y borrado masivo ===');
  {
    await sembrar(); const antes = await leer();
    const p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.ev('dbFinanzas.trainerSettings = {}'); let r = await p.guardar({ silencioso: true });
    check('vaciar trainerSettings: bloqueado (vaciado-bloqueado)', r.ok === false && r.err.code === 'vaciado-bloqueado', JSON.stringify(r.err && r.err.code));
    p.ev("dbFinanzas.trainerSettings = JSON.parse(JSON.stringify(bsFinanzasBase.norm.trainerSettings)); delete dbFinanzas.centros.c1; delete dbFinanzas.centros.c2;");
    r = await p.guardar({ silencioso: true });
    check('borrar 2 centros a la vez: bloqueado (borrado-masivo-bloqueado)', r.ok === false && r.err.code === 'borrado-masivo-bloqueado', JSON.stringify(r.err && r.err.code));
    check('el servidor sigue intacto', camposDistintos(antes, await leer()).length === 0);
    check('tras el rechazo, la pestaña vuelve a mostrar los 2 centros (no reintenta el borrado)', p.ev("!!dbFinanzas.centros.c1 && !!dbFinanzas.centros.c2"));
    p.ev("delete dbFinanzas.centros.c1;");
    r = await p.guardar({ silencioso: true }); const d = await leer();
    check('borrar 1 centro personalizado: permitido', r.ok === true && !('c1' in d.centros) && 'c2' in d.centros, JSON.stringify(r.err && r.err.message));
    p.ev("dbFinanzas.trainerSettings.pt_a.canonFijoIndependiente = 850"); r = await p.guardar({ silencioso: true });
    const d2 = await leer();
    check('editar un PT: solo cambia trainerSettings.pt_a', r.ok === true && d2.trainerSettings.pt_a.canonFijoIndependiente === 850 && G.igual(d2.trainerSettings.pt_b, antes.trainerSettings.pt_b));
    cerrarPaginas();
  }

  console.log('\n=== 7. Cierre y borrado del último cierre (papelera) ===');
  {
    await sembrar();
    const p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.ev("mesSeleccionadoFinanzas = '2026-08'"); p.ev('cerrarMesActual()'); let r = await p.ev('bsGuardadoFinanzasEnCurso');
    let d = await leer();
    check('cerrar un mes (acción manual del admin): ok', r.ok === true && !!d.historico['2026-08']);
    await hasta(() => p.ev("!!dbFinanzas.historico['2026-08']"));
    p.ev("borrarHistorico('2026-08')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('borrar el único cierre lo mueve a la papelera: permitido (cliente y reglas)', r.ok === true && Object.keys(d.historico).length === 0 && d.historicoBorrado['2026-08'].length === 1, JSON.stringify(r.err && r.err.message));
    cerrarPaginas();
  }

  console.log('\n=== 8. Reglas (defensa en servidor, también frente a versiones antiguas en caché) ===');
  {
    await sembrar(); const semilla = documentoSemilla();
    const FV = firebaseCompat.firestore.FieldValue;
    // M = marca de la versión nueva (guardadoSeguroEn = hora del servidor). Las escrituras CON marca
    // comprueban la protección contra vaciado; las SIN marca, que una versión antigua no escribe.
    const M = () => ({ guardadoSeguroEn: FV.serverTimestamp() });
    const inicialVieja = { centros: {}, trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, gastos: { '2026-10': [{ concepto: 'Fantasy', importe: 615.98 }] }, otrosIngresos: {}, historico: {}, auditoriaCierres: {} };
    await assertFails(ref(admin).set({ ...inicialVieja, actualizadoPor: ADMIN }, { merge: true })).then(() => check('versión antigua: set merge con estado inicial (incidente) -> DENEGADO', true)).catch(e => check('versión antigua: set merge con estado inicial -> DENEGADO', false, e.message));
    await assertFails(ref(admin).set({ ...semilla, gastos: { ...semilla.gastos, '2026-10': [] }, actualizadoEn: FV.serverTimestamp() }, { merge: true })).then(() => check('versión antigua SANA (set merge con datos completos, sin marca) -> DENEGADO: no hay ventana para pestañas antiguas', true)).catch(e => check('versión antigua sana sin marca -> DENEGADO', false, e.message));
    await assertFails(ref(admin).update({ 'gastos.2026-10': [{ concepto: 'x', importe: 1 }] })).then(() => check('escritura dirigida SIN marca -> DENEGADO', true)).catch(e => check('escritura dirigida sin marca -> DENEGADO', false, e.message));
    await assertFails(ref(admin).update({ 'gastos.2026-10': [], guardadoSeguroEn: firebaseCompat.firestore.Timestamp.fromMillis(Date.now()) })).then(() => check('marca con una hora del cliente (no del servidor) -> DENEGADO', true)).catch(e => check('marca con hora del cliente -> DENEGADO', false, e.message));
    const centrosPorDefecto = { alfa_prime: semilla.centros.alfa_prime, inacua: semilla.centros.inacua, fantasy: semilla.centros.fantasy, lagunillas: semilla.centros.lagunillas, capuchinos: semilla.centros.capuchinos };
    await assertFails(ref(admin).update({ centros: centrosPorDefecto, ...M() })).then(() => check('con marca: sustituir centros quitando 2 a la vez -> DENEGADO', true)).catch(e => check('sustituir centros quitando 2 -> DENEGADO', false, e.message));
    for (const campo of ['trainerSettings', 'trainerSettingsVersiones', 'centrosVersiones', 'otrosIngresos', 'gastos']) {
      await assertFails(ref(admin).update({ [campo]: {}, ...M() })).then(() => check(`con marca: vaciar ${campo} -> DENEGADO`, true)).catch(e => check(`vaciar ${campo} -> DENEGADO`, false, e.message));
    }
    await assertFails(ref(admin).update({ trainerSettings: FV.delete(), ...M() })).then(() => check('con marca: borrar el campo trainerSettings entero -> DENEGADO', true)).catch(e => check('borrar trainerSettings entero -> DENEGADO', false, e.message));
    await assertFails(ref(admin).delete()).then(() => check('borrar el documento de Finanzas -> DENEGADO', true)).catch(e => check('borrar el documento -> DENEGADO', false, e.message));
    await assertSucceeds(ref(admin).update({ 'gastos.2026-10': [{ concepto: 'x', importe: 1 }], ...M() })).then(() => check('escritura dirigida normal (gastos.2026-10) con marca -> PERMITIDO', true)).catch(e => check('escritura dirigida normal -> PERMITIDO', false, e.message));
    await assertSucceeds(ref(admin).update({ 'gastos.2026-10': [], ...M() })).then(() => check('dejar un mes de gastos como lista vacía -> PERMITIDO', true)).catch(e => check('mes de gastos vacío -> PERMITIDO', false, e.message));
    await assertSucceeds(ref(admin).update({ 'centros.c1': FV.delete(), ...M() })).then(() => check('eliminar 1 centro -> PERMITIDO', true)).catch(e => check('eliminar 1 centro -> PERMITIDO', false, e.message));
    await assertSucceeds(ref(admin).update({ 'historico.2026-08': { total: { facturacion: 1 } }, ...M() })).then(() => check('crear un cierre -> PERMITIDO', true)).catch(e => check('crear un cierre -> PERMITIDO', false, e.message));
    await assertFails(ref(admin).update({ historico: {}, ...M() })).then(() => check('vaciar historico sin papelera -> DENEGADO', true)).catch(e => check('vaciar historico sin papelera -> DENEGADO', false, e.message));
    await assertSucceeds(ref(admin).update({ historico: {}, 'historicoBorrado.2026-08': [{ snapshot: { total: {} } }], ...M() })).then(() => check('vaciar historico moviéndolo a la papelera -> PERMITIDO', true)).catch(e => check('vaciar historico con papelera -> PERMITIDO', false, e.message));
    await assertFails(ref(pt).get()).then(() => check('PT: leer Finanzas -> DENEGADO', true)).catch(e => check('PT leer -> DENEGADO', false, e.message));
    await assertFails(ref(pt).update({ 'gastos.2026-10': [], ...M() })).then(() => check('PT: escribir Finanzas (aun con marca) -> DENEGADO', true)).catch(e => check('PT escribir -> DENEGADO', false, e.message));
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => { await c.firestore().collection('besoulUsers').doc(ADMIN).set({ rol: 'admin', activo: true, email: ADMIN }); });
    await assertFails(ref(admin).set({ centros: {}, trainerSettings: {}, gastos: {} })).then(() => check('versión antigua: crear el documento vacío si no existe -> DENEGADO', true)).catch(e => check('crear sin marca -> DENEGADO', false, e.message));
    await assertSucceeds(ref(admin).set({ ...semilla, ...M() })).then(() => check('admin: crear el documento con marca (solo scripts de recuperación) -> PERMITIDO', true)).catch(e => check('admin crear -> PERMITIDO', false, e.message));
  }

  console.log('\n=== 9. Concurrencia dentro de la pestaña y con otras sesiones (revisión previa al despliegue) ===');
  {
    const externo = async datos => env.withSecurityRulesDisabled(async c => { await c.firestore().collection('besoulSuite').doc('finanzas').update(datos); });
    // 9.1 Edición mientras la transacción del guardado anterior está en curso.
    await sembrar();
    let p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.durantePrimeraTransaccion(async () => { p.ev("editarGasto(0, 'importe', '123')"); });
    p.ev('agregarGasto()');
    await hasta(() => p.ev('bsGuardadoFinanzasEnCurso') && false, 300); await p.ev('bsGuardadoFinanzasEnCurso'); await esperar(200); await p.ev('bsGuardadoFinanzasEnCurso');
    let d = await leer();
    check('editar durante la transacción del guardado anterior: la edición se guarda (no se da por guardada sin escribirla)', d.gastos['2026-10'] && d.gastos['2026-10'][0].importe === 123, JSON.stringify(d.gastos['2026-10']));
    cerrarPaginas();

    // 9.2 Llega un snapshot (cambio de otra sesión) con una edición local en cola: se conservan las dos.
    await sembrar();
    p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.durantePrimeraTransaccion(async () => {
      p.ev("editarGasto(0, 'concepto', 'Editado en cola')"); // queda en cola detrás del guardado en curso
      await externo({ 'otrosIngresos.2026-09': [{ concepto: 'Otra sesión', importe: 5 }] });
      await hasta(() => p.ev("!!(dbFinanzas.otrosIngresos['2026-09'])"), 3000); // el snapshot ajeno ya ha llegado a la pestaña
    });
    p.ev('agregarGasto()');
    for (let i = 0; i < 4; i++) { await p.ev('bsGuardadoFinanzasEnCurso'); await esperar(150); }
    d = await leer();
    check('snapshot ajeno con una edición local en cola: se guarda la edición local', d.gastos['2026-10'] && d.gastos['2026-10'][0] && d.gastos['2026-10'][0].concepto === 'Editado en cola', JSON.stringify(d.gastos['2026-10']));
    check('snapshot ajeno con una edición local en cola: se conserva el cambio de la otra sesión', d.otrosIngresos['2026-09'] && d.otrosIngresos['2026-09'][0].concepto === 'Otra sesión');
    check('la pestaña muestra los dos cambios', p.ev("(dbFinanzas.gastos['2026-10'] || [])[0]?.concepto === 'Editado en cola' && (dbFinanzas.otrosIngresos['2026-09'] || [])[0]?.concepto === 'Otra sesión'"));
    cerrarPaginas();

    // 9.3 Cambio de otra sesión que la pestaña todavía NO ha mostrado, en la misma ruta que luego edita.
    await sembrar();
    p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.parar(); // la pestaña deja de recibir snapshots (simula el retraso de red)
    await externo({ 'trainerSettings.pt_a.canonFijoIndependiente': 999 });
    p.ev('agregarGasto()'); let r = await p.ev('bsGuardadoFinanzasEnCurso'); // guardado de otra ruta: ve el cambio ajeno en el servidor
    check('guardado de otra ruta con un cambio ajeno no visto: ok', r.ok === true);
    p.ev('dbFinanzas.trainerSettings.pt_a.canonFijoIndependiente = 850'); r = await p.guardar({ silencioso: true });
    d = await leer();
    check('editar después la ruta cambiada por la otra sesión: conflicto (no se pisa su cambio)', r.ok === false && r.err.code === 'conflicto-concurrencia' && d.trainerSettings.pt_a.canonFijoIndependiente === 999, JSON.stringify(r.err && r.err.code) + ' ' + d.trainerSettings.pt_a.canonFijoIndependiente);
    check('tras el conflicto, la pestaña descarta su cambio rechazado', p.ev('dbFinanzas.trainerSettings.pt_a.canonFijoIndependiente') !== 850 && r.revertido === true);
    p.ev('agregarGasto()'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('el guardado siguiente no reintenta el cambio rechazado', r.ok === true && d.trainerSettings.pt_a.canonFijoIndependiente === 999 && d.gastos['2026-10'].length === 2, JSON.stringify(r.err && r.err.message));
    cerrarPaginas();

    // 9.4 rebasar(): reglas puras.
    const baseA = G.crearBase({ gastos: { m1: [1] }, trainerSettings: { a: { x: 1 }, b: { x: 1 } } }, x => x);
    const local = { gastos: { m1: [1, 2] }, trainerSettings: { a: { x: 2 }, b: { x: 1 } } };
    const baseB = G.crearBase({ gastos: { m1: [1] }, trainerSettings: { a: { x: 3 }, b: { x: 5 } } }, x => x);
    const rb = G.rebasar(baseA, local, baseB);
    check('rebasar: conserva la edición local de una ruta no tocada por el servidor', G.igual(rb.actual.gastos.m1, [1, 2]));
    check('rebasar: adopta el cambio ajeno en una ruta no editada localmente', rb.actual.trainerSettings.b.x === 5);
    check('rebasar: misma ruta cambiada en los dos lados -> gana el servidor y se informa', rb.actual.trainerSettings.a.x === 3 && G.igual(rb.descartadas, ['trainerSettings.a']));
  }

  console.log('\n=== 10. Operaciones legítimas con las reglas nuevas (interfaz real) ===');
  {
    const pub = async () => { let v = null; await env.withSecurityRulesDisabled(async c => { const s = await c.firestore().collection('besoulPublicConfig').doc('centros').get(); v = s.exists ? s.data() : null; }); return v; };
    const semilla = documentoSemilla();
    // Mes único en gastos y en otros ingresos: borrar su último registro no puede dejar el mapa vacío.
    await sembrar({ ...semilla, gastos: { '2026-10': [{ categoria: 'Otros', concepto: 'Único', tipo: 'variable', importe: 10 }] }, otrosIngresos: { '2026-10': [{ concepto: 'Único', importe: 5 }] } });
    const p = abrir(admin, ADMIN); p.suscribir(); await hasta(() => p.estado() === 'listo');
    p.ev('borrarGasto(0)'); let r = await p.ev('bsGuardadoFinanzasEnCurso'); let d = await leer();
    check('eliminar el último gasto del único mes: permitido (el mes queda como lista vacía)', r.ok === true && G.igual(d.gastos, { '2026-10': [] }), JSON.stringify(r.err && r.err.message));
    p.ev("mesSeleccionadoFinanzas = '2026-10'"); p.ev('borrarOtroIngreso(0)'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('eliminar el último otro ingreso del único mes: permitido', r.ok === true && G.igual(d.otrosIngresos, { '2026-10': [] }), JSON.stringify(r.err && r.err.message));

    // Condiciones de un entrenador (campo no temporal y campo temporal con vigencia).
    r = await p.ev("editarTrainer('pt_b', 'notas', 'Revisar en noviembre')"); d = await leer();
    check('editar condiciones de un entrenador (no temporal): permitido, solo cambia ese entrenador', d.trainerSettings.pt_b.notas === 'Revisar en noviembre' && G.igual(d.trainerSettings.pt_a, semilla.trainerSettings.pt_a) && p.alertas.every(a => !a.includes('No se ha podido guardar')), JSON.stringify(p.alertas.slice(-1)));
    await p.ev("editarTrainer('pt_a', 'canonFijoIndependiente', '900')"); d = await leer();
    check('editar condiciones con vigencia ("solo este mes"): permitido, registra la versión', Array.isArray(d.trainerSettingsVersiones.pt_a) && d.trainerSettingsVersiones.pt_a.length > semilla.trainerSettingsVersiones.pt_a.length && p.alertas.every(a => !a.includes('No se ha podido guardar')));
    await p.ev("editarTrainer('pt_nuevo', 'notas', 'Alta')"); d = await leer();
    check('dar de alta las condiciones de un entrenador nuevo: permitido', d.trainerSettings.pt_nuevo && d.trainerSettings.pt_nuevo.notas === 'Alta');

    // Centros: público solo cuando cambia lo publicado.
    await env.withSecurityRulesDisabled(async c => { await c.firestore().collection('besoulPublicConfig').doc('centros').delete(); });
    await p.ev("editarCentro('inacua', 'canonFijo', '1300')"); d = await leer();
    check('editar el canon de un centro (con vigencia): permitido', Array.isArray(d.centrosVersiones.inacua) && d.centrosVersiones.inacua.length === 3, JSON.stringify(d.centrosVersiones.inacua));
    check('cambio de canon: NO escribe besoulPublicConfig/centros (no cambia lo publicado)', (await pub()) === null);
    await p.ev("editarCentro('fantasy', 'nombre', 'Fantasy Gym')"); await esperar(200);
    let pb = await pub();
    check('cambio de nombre de un centro: sí sincroniza besoulPublicConfig/centros', !!pb && pb.centros.some(c => c.id === 'fantasy' && c.nombre === 'Fantasy Gym'));
    p.responderPrompt('Centro Norte'); p.ev('agregarCentro()'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer(); await esperar(200); pb = await pub();
    check('crear un centro: permitido y publicado', r.ok === true && !!d.centros.centro_norte && pb.centros.some(c => c.id === 'centro_norte'), Object.keys(d.centros).join(','));
    p.ev("desactivarCentro('centro_norte')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('desactivar un centro: permitido', r.ok === true && d.centros.centro_norte.activo === false);
    p.ev("eliminarCentro('centro_norte')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('eliminar un centro personalizado: permitido', r.ok === true && !d.centros.centro_norte);
    const escriturasPub = (await pub()).actualizadoEn.toMillis();
    p.ev("editarGasto(0, 'concepto', 'x')"); await p.ev('bsGuardadoFinanzasEnCurso');
    check('guardado sin cambios en centros: no toca besoulPublicConfig/centros', (await pub()).actualizadoEn.toMillis() === escriturasPub);

    // Cerrar, reabrir, recalcular, quitar a la papelera y restaurar un cierre.
    p.ev("mesSeleccionadoFinanzas = '2026-09'"); p.ev('cerrarMesActual()'); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('cerrar un mes: permitido', r.ok === true && !!d.historico['2026-09']);
    await hasta(() => p.ev("!!dbFinanzas.historico['2026-09']"));
    p.ev("reabrirMesCerradoParaEdicion('2026-09')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('reabrir un mes para edición: permitido (queda auditado)', r.ok === true && (d.auditoriaCierres['2026-09'] || []).some(a => a.accion === 'reapertura_edicion'));
    p.ev("recalcularCierreMes('2026-09')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('recalcular y volver a cerrar: permitido', r.ok === true && (d.auditoriaCierres['2026-09'] || []).some(a => a.accion === 'recalculo_cierre'));
    p.ev("borrarHistorico('2026-09')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('quitar el único cierre a la papelera: permitido', r.ok === true && !d.historico['2026-09'] && d.historicoBorrado['2026-09'].length === 1);
    await hasta(() => p.ev("!dbFinanzas.historico['2026-09']"));
    p.ev("restaurarHistoricoBorrado('2026-09')"); r = await p.ev('bsGuardadoFinanzasEnCurso'); d = await leer();
    check('restaurar el cierre desde la papelera: permitido', r.ok === true && !!d.historico['2026-09'] && d.historicoBorrado['2026-09'].length === 0);
    check('ninguna operación legítima ha mostrado un error de guardado', !p.alertas.some(a => /No se ha podido guardar|rechazado|Guardado bloqueado|Error guardando/.test(a)), JSON.stringify(p.alertas.filter(a => /No se ha podido guardar|rechazado|Guardado bloqueado|Error guardando/.test(a))));
    check('cada escritura de la página lleva la marca guardadoSeguroEn del servidor', d.guardadoSeguroEn && typeof d.guardadoSeguroEn.toMillis === 'function');
    cerrarPaginas();
  }

  cerrarPaginas();
  await env.cleanup();
  console.log(`\nRESULTADO: ${pass} PASS · ${fail} FAIL`);
  if (fail) { console.log('Fallos:\n - ' + fallos.join('\n - ')); process.exit(1); }
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
else module.exports = { abrirPagina, hasta, esperar };
