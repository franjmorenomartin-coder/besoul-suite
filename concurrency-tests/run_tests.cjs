// HOTFIX-V1-AGENDA-SYNC-P0 (2026-10-09) -- concurrencia del guardado de Agenda con las funciones
// REALES extraídas de agenda.html (extract.js) contra un mock fiel de Firestore (dotted-path +
// FieldPath + runTransaction con lecturas antes de escrituras). Nunca toca Firestore real.
//
// Semántica comprobada (cambia respecto a HARDENING-PRE-BASELINE-v3.2.1):
//   - Antes: cualquier cambio de OTRA sesión en el mismo entrenador cancelaba el guardado entero.
//     Admin y PT tocando cosas distintas de la misma agenda perdían cambios ("unos se guardan y
//     otros no"). Esos casos (B, F, I, K, L) ahora se FUSIONAN: se guardan los dos.
//   - Conflicto real = el MISMO elemento cambiado por ambos (misma ficha, misma sesión, mismo día
//     de disponibilidad, sesión movida por ambos, sesiones nuevas solapadas): se cancela con un
//     mensaje que nombra el elemento y el cambio ajeno queda intacto (C, C2, G, H, J).
// Pruebas de navegador real con dos usuarios: .review-local/agenda-persistencia/sync.cjs.
const fs = require('fs');
const path = require('path');
const extracted = fs.readFileSync(path.join(__dirname, 'concurrency_extract.js'), 'utf8');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
class FieldPathFalso { constructor(...segmentos) { this.segmentos = segmentos; } }
class FieldValueFalso { constructor(metodo) { this._methodName = metodo; } }
FieldValueFalso.serverTimestamp = () => new FieldValueFalso('serverTimestamp');
FieldValueFalso.delete = () => new FieldValueFalso('delete');

function setEnRuta(obj, segmentos, valor) {
  let cursor = obj;
  for (let i = 0; i < segmentos.length - 1; i++) {
    if (typeof cursor[segmentos[i]] !== 'object' || cursor[segmentos[i]] === null) cursor[segmentos[i]] = {};
    cursor = cursor[segmentos[i]];
  }
  cursor[segmentos[segmentos.length - 1]] = valor instanceof FieldValueFalso ? `<${valor._methodName}>` : deepClone(valor);
}

// Simula el servidor real de Firestore: estado propio, independiente de cualquier copia local.
function crearServidorFirestore(estadoInicial) {
  let estado = deepClone(estadoInicial);
  let escrituras = 0;
  function aplicarCampo(campo, valor) {
    if (campo instanceof FieldPathFalso) { setEnRuta(estado, campo.segmentos, valor); return; }
    if (typeof campo === 'string' && campo.includes('.')) { setEnRuta(estado, campo.split('.'), valor); return; }
    estado[campo] = valor instanceof FieldValueFalso ? `<${valor._methodName}>` : deepClone(valor);
  }
  const firestoreInstance = {
    async runTransaction(fn) {
      const pendientes = [];
      const tx = {
        async get() { return { exists: estado !== null, data: () => deepClone(estado) }; },
        update(ref, ...args) { pendientes.push(args); },
      };
      const r = await fn(tx); // si fn lanza, no se aplica nada (atomicidad)
      pendientes.forEach(args => { escrituras++; for (let i = 0; i < args.length; i += 2) aplicarCampo(args[i], args[i + 1]); });
      return r;
    },
  };
  const ref = { firestore: firestoreInstance, path: 'besoulSuite/agenda', async get() { return { exists: true, data: () => deepClone(estado) }; } };
  return {
    ref,
    estadoActual() { return deepClone(estado); },
    escrituras() { return escrituras; },
    // "Otra sesión" (otra pestaña, el PT, el admin) guarda directamente en el servidor.
    escribirDesdeOtraSesion(campo, trainerKey, valor) {
      if (!estado[campo]) estado[campo] = {};
      estado[campo][trainerKey] = deepClone(valor);
    },
  };
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}
const espera = ms => new Promise(r => setTimeout(r, ms));

function crearSesion({ docRef, dbClientes = {}, dbAgenda = {}, dbPruebasCRM = {}, dbDisponibilidadReservas = {}, dbHistoricoClientes = {}, dbNotas = {}, bsUltimoServidorConocido, entrenadorVisto = '', rolActivo = 'pt' }) {
  const firebase = { firestore: Object.assign(() => {}, { FieldPath: FieldPathFalso, FieldValue: FieldValueFalso }) };
  const window = { bsAgendaCloudDocRef: docRef, bsAgendaAplicandoNube: false, bsUltimoServidorConocido: deepClone(bsUltimoServidorConocido) };
  let publicarLlamado = 0;
  async function publicarReservasPublicas() { publicarLlamado++; }
  const logs = [];
  const consoleFalso = { ...console, log: () => {}, info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };
  const alerts = [];
  const memoria = { dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes };
  // Relectura del servidor tras un fallo: la memoria pasa a ser lo que hay en el servidor.
  function aplicarEstadoNubeAgenda(data) {
    window.bsUltimoServidorConocido = deepClone({ clientes: data.clientes || {}, agenda: data.agenda || {}, pruebasCRM: data.pruebasCRM || {}, disponibilidadReservas: data.disponibilidadReservas || {}, historicoClientes: data.historicoClientes || {} });
    [['clientes', 'dbClientes'], ['agenda', 'dbAgenda'], ['pruebasCRM', 'dbPruebasCRM'], ['disponibilidadReservas', 'dbDisponibilidadReservas'], ['historicoClientes', 'dbHistoricoClientes']].forEach(([campo, v]) => {
      Object.keys(memoria[v]).forEach(k => delete memoria[v][k]);
      Object.assign(memoria[v], deepClone(data[campo] || {}));
    });
  }
  const fn = new Function(
    'window', 'firebase', 'entrenadorVisto', 'rolActivo', 'dbClientes', 'dbAgenda', 'dbPruebasCRM',
    'dbDisponibilidadReservas', 'dbHistoricoClientes', 'dbNotas', 'publicarReservasPublicas', 'console',
    'alert', 'nombreEntrenador', 'aplicarEstadoNubeAgenda', 'escapeHTML',
    extracted + `
    return { guardarEstadoNubeAgenda, fusionarCampoTresVias };`
  );
  const M = fn(window, firebase, entrenadorVisto, rolActivo, dbClientes, dbAgenda, dbPruebasCRM, dbDisponibilidadReservas, dbHistoricoClientes, dbNotas, publicarReservasPublicas, consoleFalso,
    m => alerts.push(m), t => t, aplicarEstadoNubeAgenda, t => String(t));
  return { ...M, publicarLlamado: () => publicarLlamado, logs, alerts, window, memoria };
}

const vacio = t => ({ clientes: { [t]: [] }, agenda: { [t]: {} }, pruebasCRM: { [t]: {} }, disponibilidadReservas: { [t]: {} }, historicoClientes: { [t]: {} } });
const ses = (id, extra) => ({ id, nombre: id, duracionMin: 45, ...extra });

async function main() {

console.log('=== A: sin concurrencia -- guardado normal ===');
{
  const base = { ...vacio('a'), clientes: { a: [{ id: 'ca_v1' }] } };
  const servidor = crearServidorFirestore(base);
  const s = crearSesion({ docRef: servidor.ref, dbClientes: { a: [{ id: 'ca_v1', nombre: 'Editado por esta pestaña' }] }, dbAgenda: { a: {} }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('a');
  check('A: ok:true', r.ok, true);
  check('A: el servidor refleja el cambio', servidor.estadoActual().clientes.a, [{ id: 'ca_v1', nombre: 'Editado por esta pestaña' }]);
  check('A: la publicación del portal ya no bloquea la confirmación (se lanza aparte)', s.publicarLlamado(), 0);
  await espera(900);
  check('A: ...y se publica igualmente justo después', s.publicarLlamado(), 1);
  check('A: la nueva base de concurrencia es lo confirmado', s.window.bsUltimoServidorConocido.clientes.a, [{ id: 'ca_v1', nombre: 'Editado por esta pestaña' }]);
}

console.log('\n=== B: dos pestañas del MISMO PT cambian fichas DISTINTAS -> se guardan las dos ===');
{
  const base = { ...vacio('a'), clientes: { a: [{ id: 'ca_v1' }] } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('clientes', 'a', [{ id: 'ca_v1' }, { id: 'ca_nueva_de_otra_pestana' }]);
  const s = crearSesion({ docRef: servidor.ref, dbClientes: { a: [{ id: 'ca_v1', nombre: 'Editado por pestaña 1' }] }, dbAgenda: { a: {} }, bsUltimoServidorConocido: base, entrenadorVisto: 'a' });
  const r = await s.guardarEstadoNubeAgenda('a');
  check('B: ok:true (cambios compatibles)', r.ok, true);
  check('B: el servidor tiene la edición de esta pestaña Y la ficha nueva de la otra', servidor.estadoActual().clientes.a, [{ id: 'ca_v1', nombre: 'Editado por pestaña 1' }, { id: 'ca_nueva_de_otra_pestana' }]);
  check('B: la memoria de esta pestaña ya muestra la ficha de la otra', s.memoria.dbClientes.a.map(c => c.id), ['ca_v1', 'ca_nueva_de_otra_pestana']);
}

console.log('\n=== C: CONFLICTO REAL Admin/PT -- la MISMA ficha cambiada por ambos ===');
{
  const base = { ...vacio('veronica'), clientes: { veronica: [{ id: 'cv1', nombre: 'Cliente Ficticia' }] } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('clientes', 'veronica', [{ id: 'cv1', nombre: 'Cliente Ficticia', telefono: '600111222' }]);
  const s = crearSesion({ docRef: servidor.ref, dbClientes: { veronica: [{ id: 'cv1', nombre: 'Cliente Ficticia', nota: 'Editado por el admin' }] }, dbAgenda: { veronica: {} }, bsUltimoServidorConocido: base, entrenadorVisto: 'veronica', rolActivo: 'admin' });
  const r = await s.guardarEstadoNubeAgenda('veronica');
  check('C: ok:false', r.ok, false);
  check('C: código conflict', r.err && r.err.code, 'conflict');
  check('C: el cambio de la PT sigue intacto', servidor.estadoActual().clientes.veronica, [{ id: 'cv1', nombre: 'Cliente Ficticia', telefono: '600111222' }]);
  check('C: el mensaje nombra el elemento en conflicto', /la ficha de Cliente Ficticia/.test(r.err.message), true);
  check('C: aviso visible al usuario', s.alerts.length, 1);
  check('C: la pantalla vuelve a lo que hay en el servidor', s.memoria.dbClientes.veronica, [{ id: 'cv1', nombre: 'Cliente Ficticia', telefono: '600111222' }]);
  check('C: los logs NUNCA contienen el teléfono ni el texto editado', JSON.stringify(s.logs).includes('600111222') || JSON.stringify(s.logs).includes('Editado por el admin'), false);
}

console.log('\n=== D: un cambio de OTRO entrenador nunca provoca conflicto ===');
{
  const base = { clientes: { a: [{ id: 'ca1' }], b: [{ id: 'cb1' }] }, agenda: { a: {}, b: {} }, pruebasCRM: { a: {}, b: {} }, disponibilidadReservas: { a: {}, b: {} }, historicoClientes: { a: {}, b: {} } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('clientes', 'b', [{ id: 'cb1', nota: 'cambio de OTRO entrenador' }]);
  const s = crearSesion({ docRef: servidor.ref, dbClientes: { a: [{ id: 'ca1', nombre: 'Editado por el PT a' }] }, dbAgenda: { a: {} }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('a');
  check('D: ok:true', r.ok, true);
  check('D: se aplica lo de "a"', servidor.estadoActual().clientes.a, [{ id: 'ca1', nombre: 'Editado por el PT a' }]);
  check('D: lo de "b" sigue intacto', servidor.estadoActual().clientes.b, [{ id: 'cb1', nota: 'cambio de OTRO entrenador' }]);
}

console.log('\n=== E: sin base conocida (ningún snapshot aplicado) -- bloquea con aviso ===');
{
  const base = { ...vacio('a'), clientes: { a: [{ id: 'ca1' }] } };
  const servidor = crearServidorFirestore(base);
  const s = crearSesion({ docRef: servidor.ref, dbClientes: { a: [{ id: 'ca1', nombre: 'Desde caché' }] }, dbAgenda: { a: {} }, bsUltimoServidorConocido: undefined });
  const r = await s.guardarEstadoNubeAgenda('a');
  check('E: ok:false', r.ok, false);
  check('E: código agenda-no-cargada', r.err && r.err.code, 'agenda-no-cargada');
  check('E: servidor sin tocar', servidor.estadoActual().clientes.a, [{ id: 'ca1' }]);
}

console.log('\n=== F: admin y PT cambian SESIONES distintas de la misma agenda -> las dos ===');
{
  const base = { ...vacio('m'), agenda: { m: { '2026-10-09_10:00': ses('c1'), '2026-10-09_12:00': ses('c2') } } };
  const servidor = crearServidorFirestore(base);
  // el PT movió c1 de 10:00 a 11:00 y ya está guardado
  servidor.escribirDesdeOtraSesion('agenda', 'm', { '2026-10-09_11:00': ses('c1'), '2026-10-09_12:00': ses('c2') });
  // el admin, sin haberlo recibido, mueve c2 de 12:00 a 13:00
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: { '2026-10-09_10:00': ses('c1'), '2026-10-09_13:00': ses('c2') } }, bsUltimoServidorConocido: base, rolActivo: 'admin' });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('F: ok:true', r.ok, true);
  check('F: servidor = movimiento del PT + movimiento del admin', Object.keys(servidor.estadoActual().agenda.m).sort(), ['2026-10-09_11:00', '2026-10-09_13:00']);
  check('F: la pantalla del admin ya coincide con el servidor', Object.keys(s.memoria.dbAgenda.m).sort(), ['2026-10-09_11:00', '2026-10-09_13:00']);
}

console.log('\n=== G: CONFLICTO -- ambos mueven LA MISMA sesión a horas distintas (nunca dos copias) ===');
{
  const base = { ...vacio('m'), agenda: { m: { '2026-10-09_10:00': ses('c1') } } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('agenda', 'm', { '2026-10-09_11:00': ses('c1') });
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: { '2026-10-09_15:00': ses('c1') } }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('G: ok:false conflict', [r.ok, r.err && r.err.code], [false, 'conflict']);
  check('G: el servidor tiene UNA sola sesión (la del otro)', Object.keys(servidor.estadoActual().agenda.m), ['2026-10-09_11:00']);
  check('G: el mensaje nombra la sesión', /sesión del 2026-10-09 10:00/.test(r.err.message), true);
}

console.log('\n=== G2: CONFLICTO -- uno mueve la sesión y el otro la borra ===');
{
  const base = { ...vacio('m'), agenda: { m: { '2026-10-09_10:00': ses('c1') } } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('agenda', 'm', {});
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: { '2026-10-09_15:00': ses('c1') } }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('G2: ok:false conflict (no resucita una sesión borrada por otro)', [r.ok, r.err && r.err.code], [false, 'conflict']);
  check('G2: servidor intacto', servidor.estadoActual().agenda.m, {});
}

console.log('\n=== H: CONFLICTO -- sesiones nuevas solapadas creadas a la vez (10:00 y 10:15) ===');
{
  const base = { ...vacio('m'), agenda: { m: {} } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('agenda', 'm', { '2026-10-09_10:15': ses('c2') });
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: { '2026-10-09_10:00': ses('c1') } }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('H: ok:false conflict (nunca una doble reserva)', [r.ok, r.err && r.err.code], [false, 'conflict']);
  check('H: servidor solo con la sesión del otro', Object.keys(servidor.estadoActual().agenda.m), ['2026-10-09_10:15']);
  // y sin solape (10:00 y 10:45) se fusiona
  const servidor2 = crearServidorFirestore(base);
  servidor2.escribirDesdeOtraSesion('agenda', 'm', { '2026-10-09_10:45': ses('c2') });
  const s2 = crearSesion({ docRef: servidor2.ref, dbAgenda: { m: { '2026-10-09_10:00': ses('c1') } }, bsUltimoServidorConocido: base });
  const r2 = await s2.guardarEstadoNubeAgenda('m');
  check('H: 10:00 + 10:45 (contiguas, sin solape) -> se guardan las dos', [r2.ok, Object.keys(servidor2.estadoActual().agenda.m).sort()], [true, ['2026-10-09_10:00', '2026-10-09_10:45']]);
}

console.log('\n=== I: el PT BLOQUEA un día y el admin cambia la disponibilidad semanal -> se conservan los dos ===');
{
  const disp0 = { semanal: { 1: { activo: true, bloques: [{ inicio: '08:00', fin: '14:00' }] }, 5: { activo: true, bloques: [{ inicio: '08:00', fin: '14:00' }] } }, excepciones: {}, bloqueos: {}, recurrenteSemanal: true, actualizadoEn: 't0' };
  const base = { ...vacio('m'), disponibilidadReservas: { m: disp0 } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('disponibilidadReservas', 'm', { ...disp0, excepciones: { '2026-10-09': { activo: false, bloques: [], override: true } }, actualizadoEn: 't1-pt', actualizadoPor: 'm' });
  const local = deepClone(disp0); local.semanal[1] = { activo: true, bloques: [{ inicio: '09:00', fin: '13:00' }] }; local.actualizadoEn = 't1-admin'; local.actualizadoPor = 'admin';
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: {} }, dbDisponibilidadReservas: { m: local }, bsUltimoServidorConocido: base, rolActivo: 'admin' });
  const r = await s.guardarEstadoNubeAgenda('m');
  const d = servidor.estadoActual().disponibilidadReservas.m;
  check('I: ok:true (actualizadoEn/actualizadoPor no cuentan como conflicto)', r.ok, true);
  check('I: el bloqueo del día del PT SIGUE en el servidor', d.excepciones['2026-10-09'], { activo: false, bloques: [], override: true });
  check('I: el cambio semanal del admin también', d.semanal['1'], { activo: true, bloques: [{ inicio: '09:00', fin: '13:00' }] });
}

console.log('\n=== J: CONFLICTO -- el MISMO día de disponibilidad cambiado por ambos ===');
{
  const disp0 = { semanal: {}, excepciones: {}, bloqueos: {}, recurrenteSemanal: true };
  const base = { ...vacio('m'), disponibilidadReservas: { m: disp0 } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('disponibilidadReservas', 'm', { ...disp0, excepciones: { '2026-10-09': { activo: false, bloques: [], override: true } } });
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: {} }, dbDisponibilidadReservas: { m: { ...disp0, excepciones: { '2026-10-09': { activo: true, bloques: [{ inicio: '10:00', fin: '12:00' }], override: true } } } }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('J: ok:false conflict', [r.ok, r.err && r.err.code], [false, 'conflict']);
  check('J: el bloqueo ajeno sigue intacto', servidor.estadoActual().disponibilidadReservas.m.excepciones['2026-10-09'].activo, false);
  check('J: el mensaje nombra el día', /disponibilidad del día 2026-10-09/.test(r.err.message), true);
}

console.log('\n=== K: slots ocultos de días distintos por cada uno -> los dos ===');
{
  const disp0 = { semanal: {}, excepciones: {}, bloqueos: {}, recurrenteSemanal: true };
  const base = { ...vacio('m'), disponibilidadReservas: { m: disp0 } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('disponibilidadReservas', 'm', { ...disp0, bloqueos: { '2026-10-06': ['19:00'] } });
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: {} }, dbDisponibilidadReservas: { m: { ...disp0, bloqueos: { '2026-10-07': ['20:00'] } } }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('K: ok:true y ambos slots ocultos guardados', [r.ok, servidor.estadoActual().disponibilidadReservas.m.bloqueos], [true, { '2026-10-06': ['19:00'], '2026-10-07': ['20:00'] }]);
}

console.log('\n=== L: borrar una sesión mientras otro crea otra distinta -> las dos operaciones ===');
{
  const base = { ...vacio('m'), agenda: { m: { '2026-10-09_10:00': ses('c1') } } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('agenda', 'm', { '2026-10-09_10:00': ses('c1'), '2026-10-09_17:00': ses('c3') });
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: {} }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('L: ok:true; queda solo la sesión creada por el otro', [r.ok, Object.keys(servidor.estadoActual().agenda.m)], [true, ['2026-10-09_17:00']]);
}

console.log('\n=== M: sin cambios propios no se escribe nada (y nunca se pisa lo ajeno) ===');
{
  const base = { ...vacio('m'), agenda: { m: { '2026-10-09_10:00': ses('c1') } } };
  const servidor = crearServidorFirestore(base);
  servidor.escribirDesdeOtraSesion('agenda', 'm', { '2026-10-09_10:00': ses('c1', { nota: 'otro' }) });
  const s = crearSesion({ docRef: servidor.ref, dbAgenda: { m: deepClone(base.agenda.m) }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  check('M: ok:true, cero escrituras, cambio ajeno intacto', [r.ok, servidor.escrituras(), servidor.estadoActual().agenda.m['2026-10-09_10:00'].nota], [true, 0, 'otro']);
}

console.log('\n=== O: TAMAÑO -- las sesiones se guardan sin las copias de portal/contrato de la ficha ===');
{
  const sesionGorda = { id: 'c1', nombre: 'C1', duracionMin: 45, contratoCliente: { firmado: false, nombreArchivo: '', tipoMime: '', contenidoBase64: '', subidaEn: '' }, restriccionesReservas: { modo: 'bloquear', bloquesTexto: '' }, reservaToken: 'res_x', reservasBloqueadasTexto: '', reservasOnlineActivas: true };
  const fichaC1 = { id: 'c1', nombre: 'C1', reservaToken: 'res_x', contratoCliente: { firmado: true } };
  const base = { ...vacio('m'), clientes: { m: [fichaC1] }, agenda: { m: { '2026-10-09_10:00': sesionGorda } }, otros: 1 };
  base.agenda.otro = { '2026-10-09_10:00': sesionGorda };
  const servidor = crearServidorFirestore(base);
  const s = crearSesion({ docRef: servidor.ref, dbClientes: { m: [fichaC1] }, dbAgenda: { m: { '2026-10-09_10:00': sesionGorda, '2026-10-09_12:00': { ...sesionGorda } } }, bsUltimoServidorConocido: base });
  const r = await s.guardarEstadoNubeAgenda('m');
  const st = servidor.estadoActual();
  check('O: ok:true', r.ok, true);
  check('O: las sesiones (existente y nueva) se guardan sin las copias', Object.values(st.agenda.m).map(x => Object.keys(x).sort()), [['duracionMin', 'id', 'nombre'], ['duracionMin', 'id', 'nombre']]);
  check('O: la ficha conserva token y contrato', st.clientes.m[0], fichaC1);
  check('O: la agenda de otro entrenador no se toca', st.agenda.otro['2026-10-09_10:00'].reservaToken, 'res_x');
  const servidor2 = crearServidorFirestore(base);
  const s2 = crearSesion({ docRef: servidor2.ref, dbClientes: { m: [fichaC1] }, dbAgenda: { m: { '2026-10-09_10:00': sesionGorda } }, bsUltimoServidorConocido: base });
  await s2.guardarEstadoNubeAgenda('m');
  check('O: sin cambios reales no se escribe nada', servidor2.escrituras(), 0);
}

console.log('\n=== N: fusionarCampoTresVias (rebase de un snapshot con cambios pendientes) ===');
{
  const s = crearSesion({ docRef: crearServidorFirestore(vacio('m')).ref, bsUltimoServidorConocido: vacio('m') });
  const b = { 'x_10:00': ses('c1') };
  const l = { 'x_10:00': ses('c1'), 'x_12:00': ses('c2') };          // pendiente propio: crear 12:00
  const sv = { 'x_10:00': ses('c1', { estado: 'otro' }) };             // ajeno: cambio en 10:00
  const r = s.fusionarCampoTresVias('agenda', b, l, sv);
  check('N: sin conflicto se ven ambos cambios', [r.conflictos, Object.keys(r.valor).sort(), r.valor['x_10:00'].estado], [[], ['x_10:00', 'x_12:00'], 'otro']);
  check('N: la nueva base es el servidor', r.baseNueva, sv);
  const r2 = s.fusionarCampoTresVias('agenda', b, { 'x_10:00': ses('c1', { estado: 'mio' }) }, sv);
  check('N: con conflicto se conservan lo local y la base anteriores (el guardado lo volverá a detectar)', [r2.conflictos.length, r2.valor['x_10:00'].estado, r2.baseNueva], [1, 'mio', b]);
  const c = s.fusionarCampoTresVias('clientes', [{ id: 'a' }, { id: 'b' }], [{ id: 'a', n: 1 }, { id: 'b' }, { id: 'c' }], [{ id: 'z' }, { id: 'a' }, { id: 'b', m: 2 }]);
  check('N: fichas: orden del servidor + nuevas propias al final, campos de ambos', c.valor, [{ id: 'z' }, { id: 'a', n: 1 }, { id: 'b', m: 2 }, { id: 'c' }]);
  const dup = s.fusionarCampoTresVias('clientes', [{ id: 'a' }], [{ id: 'a', n: 1 }, { id: 'a' }], [{ id: 'a', m: 2 }]);
  check('N: forma no descomponible (ids duplicados) -> conflicto de campo, nunca fusión a ciegas', dup.conflictos, ['campo:clientes']);
}

// ============================================================
console.log('\n=== HELPERS de diagnóstico (canonicalizarValorDiagnostico / hashEstableDiagnostico / contarElementosDiagnostico) ===');
// ============================================================
{
  const diagFn = new Function(extracted + `
    return { canonicalizarValorDiagnostico, hashEstableDiagnostico, contarElementosDiagnostico };
  `)();

  const objA = { b: 2, a: 1, c: { z: 9, y: 8 } };
  const objAOtroOrden = { c: { y: 8, z: 9 }, a: 1, b: 2 };
  check('canonicalizar: mismo objeto con OTRO orden de claves -> mismo resultado canónico', diagFn.canonicalizarValorDiagnostico(objA), diagFn.canonicalizarValorDiagnostico(objAOtroOrden));
  check('hash: mismo objeto con OTRO orden de claves -> MISMO hash', diagFn.hashEstableDiagnostico(objA), diagFn.hashEstableDiagnostico(objAOtroOrden));
  check('canonicalizar: un array preserva su ORDEN', JSON.stringify(diagFn.canonicalizarValorDiagnostico([{ id: 1 }, { id: 2 }])) === JSON.stringify(diagFn.canonicalizarValorDiagnostico([{ id: 2 }, { id: 1 }])), false);
  check('hash: un cambio REAL de contenido -> hash DISTINTO', diagFn.hashEstableDiagnostico({ a: 1 }) === diagFn.hashEstableDiagnostico({ a: 2 }), false);
  check('contarElementos: array -> length', diagFn.contarElementosDiagnostico([1, 2, 3]), 3);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
