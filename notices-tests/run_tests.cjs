// PORTAL-NOTICES-FIX: reproduce el flujo real de avisos internos PT -> cliente (UI -> memoria ->
// payload -> Firestore -> self-echo/reload) contra el código extraído VERBATIM de agenda.html
// (notices_extract.js), usando el mismo mock de Firestore fiel (dotted-path .update() +
// FieldPath + onSnapshot asíncrono) que availability-tests/. Nunca toca Firestore real.
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'notices_extract.js'), 'utf8');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
class FieldPathFalso { constructor(...segmentos) { this.segmentos = segmentos; } }
function setEnRuta(obj, segmentos, valor) {
  let cursor = obj;
  for (let i = 0; i < segmentos.length - 1; i++) {
    if (typeof cursor[segmentos[i]] !== 'object' || cursor[segmentos[i]] === null) cursor[segmentos[i]] = {};
    cursor = cursor[segmentos[i]];
  }
  cursor[segmentos[segmentos.length - 1]] = valor;
}

function crearFirestoreMock(estadoInicial) {
  let estado = estadoInicial === undefined ? null : deepClone(estadoInicial);
  const listeners = [];
  const microtasksPendientes = [];
  function notificar() {
    const snap = { exists: estado !== null, data: () => deepClone(estado) };
    listeners.forEach(cb => microtasksPendientes.push(() => cb(snap)));
  }
  function aplicarCampo(campo, valor) {
    if (campo instanceof FieldPathFalso) { setEnRuta(estado, campo.segmentos, deepClone(valor)); return; }
    if (typeof campo === 'string' && campo.includes('.')) { setEnRuta(estado, campo.split('.'), deepClone(valor)); return; }
    estado[campo] = deepClone(valor);
  }
  return {
    docRef: {
      update(...args) {
        return new Promise((resolve, reject) => {
          try {
            if (estado === null) { reject(new Error('NOT_FOUND')); return; }
            if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof FieldPathFalso)) {
              Object.keys(args[0]).forEach(clave => aplicarCampo(clave, args[0][clave]));
            } else {
              for (let i = 0; i < args.length; i += 2) aplicarCampo(args[i], args[i + 1]);
            }
            microtasksPendientes.push(() => { notificar(); resolve(); });
          } catch (e) { reject(e); }
        });
      },
      onSnapshot(cb) {
        listeners.push(cb);
        microtasksPendientes.push(() => cb({ exists: estado !== null, data: () => deepClone(estado) }));
        return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
      }
    },
    async flush(maxIter = 200) {
      let i = 0;
      while (microtasksPendientes.length && i < maxIter) { const fn = microtasksPendientes.shift(); await fn(); i++; }
      if (i >= maxIter) throw new Error('flush(): posible bucle infinito');
      for (let k = 0; k < 10; k++) await new Promise(r => setImmediate(r));
      return i;
    },
    estadoActual() { return deepClone(estado); }
  };
}

function crearRelojFalso() {
  let ahora = 0;
  const pendientes = [];
  return {
    setTimeout(fn, ms) { const id = { fn, cuando: ahora + ms, cancelado: false }; pendientes.push(id); return id; },
    clearTimeout(id) { if (id) id.cancelado = true; },
    avanzar(ms) { ahora += ms; pendientes.filter(p => !p.cancelado && p.cuando <= ahora).forEach(p => { p.cancelado = true; p.fn(); }); }
  };
}

function nuevaSesion(firestoreMock, { credencialesIniciales = {}, mensaje = '' } = {}) {
  const reloj = crearRelojFalso();
  const localStorageFalso = (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } }; })();
  const domVals = { 'aviso-multiple-mensaje': { value: mensaje }, 'app-content': { hidden: false } };
  const document = {
    getElementById(id) {
      const v = domVals[id] || {};
      return { value: v.value || '', classList: { contains: () => false, add(){}, remove(){}, toggle(){} } };
    }
  };
  const alerts = [];
  const preamble = `
    const CREDENCIALES_BASE = ${JSON.stringify(credencialesIniciales)};
    function renderListaEnvioAvisoMultiple(){}
    function publicarReservasPublicas(){ return Promise.resolve(); }
    function publicarReservasPublicasDebounced(){}
    function recalcularKPIs(){} function renderClientes(){} function renderAgenda(){} function actualizarLabelsKPIMes(){} function configurarSelectorAdmin(){}
  `;
  const fn = new Function('localStorage', 'document', 'window', 'firebase', 'alert', 'setTimeout', 'clearTimeout',
    preamble + extracted + `
    return {
      get entrenadorVisto() { return entrenadorVisto; }, set entrenadorVisto(v) { entrenadorVisto = v; },
      get dbClientes() { return dbClientes; }, set dbClientes(v) { dbClientes = v; },
      get avisoMultipleEstados() { return avisoMultipleEstados; },
      publicarAvisoPortalCliente, aplicarEstadoNubeAgenda, guardarEstadoNubeAgenda, buscarClientePorIdTrainer
    };`);
  const windowFalso = { bsAgendaCloudDocRef: firestoreMock.docRef, bsAgendaAplicandoNube: false, bsAgendaCloudTimer: null, bsAgendaDisponibilidadCargada: true };
  class FieldValueFalso { constructor(nombre) { this._methodName = nombre; } }
  const firebaseFalso = { firestore: { FieldValue: FieldValueFalso, FieldPath: FieldPathFalso } };
  firebaseFalso.firestore.FieldValue.serverTimestamp = () => new FieldValueFalso('serverTimestamp');
  const M = fn(localStorageFalso, document, windowFalso, firebaseFalso, (msg) => alerts.push(msg), reloj.setTimeout, reloj.clearTimeout);
  M.reloj = reloj;
  M.alerts = alerts;
  firestoreMock.docRef.onSnapshot(snap => { if (snap.exists) M.aplicarEstadoNubeAgenda(snap.data()); });
  return M;
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

const CREDS = { carmen: { nombre: 'Carmen', rol: 'pt', email: 'carmen@x.com', trainerKey: 'carmen', activo: true } };

async function main() {

// ============================================================
console.log('=== CONTROL NEGATIVO (causa raíz del contador inconsistente): el aviso debe sobrevivir un snapshot/reload ===');
// ============================================================
{
  // Reproduce EXACTAMENTE lo reportado: aparece un contador (1) en la card del cliente, pero al
  // abrir "Avisos enviados" (u otro PT/dispositivo, o tras cualquier snapshot no relacionado)
  // muestra "Sin avisos enviados todavía." -- ANTES de este fix, publicarAvisoPortalCliente()
  // nunca llamaba a guardarEstadoNubeAgenda()/programarGuardadoNubeAgenda(): el aviso solo vivía
  // en memoria + localStorage + la proyección pública (besoulPublicClients), nunca en
  // besoulSuite/agenda -- así que CUALQUIER snapshot posterior (aplicarEstadoNubeAgenda hace
  // dbClientes = data.clientes || {}, un reemplazo TOTAL) lo borraba de la vista del propio PT.
  const fsx = crearFirestoreMock({ clientes: { carmen: [{ id: 'c1', nombre: 'Alba', telefono: '600111222' }] }, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { credencialesIniciales: CREDS, mensaje: 'Recuerda tu sesión de mañana.' });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';

  s.avisoMultipleEstados.set('c1', { portal: 'pendiente' });
  s.publicarAvisoPortalCliente('c1');
  check('justo tras enviarlo, el aviso aparece en memoria (contador = 1)', s.dbClientes.carmen[0].avisosPortal?.length, 1);

  await fsx.flush(); // deja que el guardado debounced (programarGuardadoNubeAgenda) dispare y su self-echo llegue
  s.reloj.avanzar(350);
  await fsx.flush();

  check('CONTROL NEGATIVO: el aviso también quedó en el documento remoto (no solo en memoria/localStorage)', fsx.estadoActual().clientes.carmen[0].avisosPortal?.length, 1);

  // Simula lo que antes causaba la desaparición: OTRO snapshot no relacionado (p.ej. una
  // disponibilidad guardada por cualquier PT) reemplaza dbClientes por completo.
  const s2 = nuevaSesion(fsx, { credencialesIniciales: CREDS });
  await fsx.flush();
  s2.entrenadorVisto = 'carmen';
  const clienteTrasReload = s2.buscarClientePorIdTrainer('carmen', 'c1');
  check('tras una recarga/otro snapshot completos, el aviso SIGUE existiendo (el contador ya no miente)', clienteTrasReload?.avisosPortal?.length, 1);
  check('...con el contenido correcto', clienteTrasReload?.avisosPortal?.[0]?.contenido, 'Recuerda tu sesión de mañana.');
}

// ============================================================
console.log('\n=== Varios avisos en el mismo lote se coalescen en un único guardado (debounced) ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: { carmen: [{ id: 'c1', nombre: 'Alba' }, { id: 'c2', nombre: 'Bruno' }] }, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { credencialesIniciales: CREDS, mensaje: 'Aviso para varios.' });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';

  s.publicarAvisoPortalCliente('c1');
  s.publicarAvisoPortalCliente('c2');
  s.reloj.avanzar(350);
  await fsx.flush();

  check('ambos clientes reciben su aviso en el documento remoto', fsx.estadoActual().clientes.carmen.map(c => c.avisosPortal?.length || 0), [1, 1]);
}

// ============================================================
console.log('\n=== Sin mensaje: no se guarda nada (validación real, no solo visual) ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: { carmen: [{ id: 'c1', nombre: 'Alba' }] }, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { credencialesIniciales: CREDS, mensaje: '' });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';
  s.avisoMultipleEstados.set('c1', { portal: 'pendiente' });
  s.publicarAvisoPortalCliente('c1');
  check('un mensaje vacío marca error y no crea ningún aviso', s.avisoMultipleEstados.get('c1').portal, 'error');
  check('...ni en memoria', s.dbClientes.carmen[0].avisosPortal, undefined);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR FATAL EN LA SUITE:', err); process.exitCode = 1; });
