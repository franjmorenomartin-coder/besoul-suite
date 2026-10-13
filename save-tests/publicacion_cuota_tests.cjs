// HOTFIX-V1-PUBLICACION-CUOTA-P0 (2026-10-13): pruebas de la publicación del portal extraída verbatim
// de agenda.html. Antes cada guardado republicaba a TODOS los entrenadores (~238 escrituras) y agotaba
// la cuota diaria de escrituras del plan Spark. Ejecutar: node save-tests/publicacion_cuota_tests.cjs
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');
function extraerFuncion(nombre) {
  const m = new RegExp(`(async\\s+)?function\\s+${nombre}\\s*\\(`).exec(html);
  if (!m) throw new Error(`No se encontró ${nombre}`);
  const cuerpo = /\)\s*\{/g; cuerpo.lastIndex = m.index; let i = cuerpo.exec(html).index, prof = 0;
  for (; i < html.length; i++) { if (html[i] === '{') prof++; else if (html[i] === '}' && --prof === 0) { i++; break; } }
  return html.slice(m.index, i);
}

function crearEntorno({ rolActivo, usuarioLogeado, entrenadorVisto, servidor }) {
  const escrituras = [];
  const commits = { n: 0 };
  const fsFalso = {
    collection: col => ({ doc: id => ({ path: `${col}/${id}` }) }),
    batch: () => { const ops = []; return { set: (ref, datos) => ops.push(ref.path), commit: async () => { commits.n++; escrituras.push(...ops); } }; },
  };
  const window = { firebase: true, bsAgendaCloudDocRef: { get: async () => ({ data: () => JSON.parse(JSON.stringify(servidor)) }) } };
  const firebase = { apps: [1], firestore: Object.assign(() => fsFalso, { FieldValue: { serverTimestamp: () => ({ _methodName: 'serverTimestamp' }) } }) };
  const codigo = ['publicarReservasPublicasParaTrainer', 'encolarPublicacionSiCambia', 'publicarReservasPublicas'].map(extraerFuncion).join('\n');
  const vivos = { dbClientes: { vivo: [] }, dbAgenda: {}, dbDisponibilidadReservas: {} };
  const fn = new Function('window', 'firebase', 'rolActivo', 'usuarioLogeado', 'entrenadorVisto', 'localStorage', 'console', 'vivos',
    `let dbClientes = vivos.dbClientes, dbAgenda = vivos.dbAgenda, dbDisponibilidadReservas = vivos.dbDisponibilidadReservas;
     const usuarioFirebaseActual = {}; const dbSolicitudesReservas = {}; const dbCredenciales = {};
     const BS_PUBLIC_SCHEDULE_COLLECTION = 'besoulPublicSchedule', BS_PUBLIC_CLIENTS_COLLECTION = 'besoulPublicClients', CANCELACION_MIN_HORAS_DEFAULT = 24;
     const clavesBloqueSesion = c => [c]; const esGrupoAbierto = () => false; const capacidadGrupoAbierto = () => 0; const asistentesGrupoAbierto = () => [];
     const nombreEntrenador = t => t; const disponibilidadReservasPorDefecto = () => ({}); const estadoReservaActivo = () => true;
     const clienteActivoParaAgenda = () => true; const calcularContadorClases = () => ({}); const sesionesClienteParaPortal = () => ({ proximas: [], recientes: [] });
     const calendarioSesionesClienteParaPortal = () => []; const generarTokenReservaCliente = () => { throw new Error('no debe generar tokens'); };
     ${codigo}
     return { publicar: publicarReservasPublicas, vivos: () => ({ dbClientes, dbAgenda, dbDisponibilidadReservas }) };`);
  const api = fn(window, firebase, rolActivo, usuarioLogeado, entrenadorVisto, { setItem() {} }, { ...console, warn: (...a) => process.env.DEBUG && console.log('WARN', ...a) }, vivos);
  return { ...api, escrituras, commits };
}

let pass = 0, fail = 0;
function check(desc, actual, esperado) {
  const ok = JSON.stringify(actual) === JSON.stringify(esperado);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok ? '' : ` :: got=${JSON.stringify(actual)} expected=${JSON.stringify(esperado)}`}`);
}
const ficha = (id, token, extra) => ({ id, tipo: 'individual', nombre: id, email: 'x@x', telefono: '6', reservaToken: token, ...extra });
const servidorBase = () => ({
  clientes: { a: [ficha('a1', 'ta1'), ficha('a2', 'ta2'), ficha('a3', '')], b: [ficha('b1', 'tb1')] },
  agenda: { a: {}, b: {} }, disponibilidadReservas: { a: { semanal: {} }, b: { semanal: {} } },
});

(async () => {
  {
    const servidor = servidorBase();
    const e = crearEntorno({ rolActivo: 'admin', usuarioLogeado: 'admin', entrenadorVisto: 'a', servidor });
    await e.publicar(['a']);
    check('P1 admin publica SOLO el entrenador pedido (horario + 2 fichas con token)', e.escrituras.sort(), ['besoulPublicClients/ta1', 'besoulPublicClients/ta2', 'besoulPublicSchedule/a']);
    e.escrituras.length = 0;
    await e.publicar(['a']);
    check('P2 sin cambios no escribe nada ni hace commit', [e.escrituras.length, e.commits.n], [0, 1]);
    servidor.clientes.a[0].nombre = 'Cambiado';
    await e.publicar(['a']);
    check('P3 solo se reescribe la ficha pública que cambió', e.escrituras, ['besoulPublicClients/ta1']);
    check('P4 la ficha sin token no se publica ni recibe token inventado', servidor.clientes.a[2].reservaToken, '');
    e.escrituras.length = 0;
    await e.publicar();
    check('P5 sin lista explícita publica solo el entrenador que se está viendo (sin cambios: 0)', e.escrituras.length, 0);
    await e.publicar(['b']);
    check('P6 admin puede publicar otro entrenador pedido', e.escrituras.sort(), ['besoulPublicClients/tb1', 'besoulPublicSchedule/b']);
  }
  {
    const e = crearEntorno({ rolActivo: 'pt', usuarioLogeado: 'a', entrenadorVisto: 'a', servidor: servidorBase() });
    await e.publicar(['a', 'b']);
    check('P7 un PT nunca intenta publicar a otro entrenador (sin rechazos de reglas)', e.escrituras.filter(p => p.endsWith('/b') || p.endsWith('tb1')), []);
    check('P8 ...pero sí lo suyo', e.escrituras.length, 3);
  }
  {
    const e = crearEntorno({ rolActivo: 'admin', usuarioLogeado: 'admin', entrenadorVisto: 'a', servidor: servidorBase() });
    await e.publicar(['a']);
    const v = e.vivos();
    check('P9 el estado vivo de la Agenda se restaura tras publicar', v.dbClientes, { vivo: [] });
  }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
