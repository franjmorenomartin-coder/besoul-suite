// FIX-PT-AVAILABILITY-PERSISTENCE: reproduce el flujo REAL (UI -> memoria -> payload -> Firestore
// -> carga posterior -> render) usando el código extraído VERBATIM de agenda.html
// (availability_extract.js) contra un mock de Firestore que replica de verdad la semántica de
// `.update()` con rutas de punto (solo toca la ruta exacta, nunca pisa hermanos) y el
// comportamiento real de onSnapshot (se dispara de forma asíncrona tras cada escritura, incluidas
// las propias -- "self-echo"). Nunca toca Firestore real.
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'availability_extract.js'), 'utf8');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function setEnRuta(obj, rutaConPuntos, valor) {
  const partes = rutaConPuntos.split('.');
  let cursor = obj;
  for (let i = 0; i < partes.length - 1; i++) {
    if (typeof cursor[partes[i]] !== 'object' || cursor[partes[i]] === null) cursor[partes[i]] = {};
    cursor = cursor[partes[i]];
  }
  cursor[partes[partes.length - 1]] = valor;
}

// --- Mock de Firestore: replica fielmente `.update()` con FieldPath de puntos + onSnapshot
// asíncrono (incluye el "self-echo" de los propios escritores, como el SDK real). ---
function crearFirestoreMock(estadoInicial) {
  let estado = estadoInicial === undefined ? null : deepClone(estadoInicial);
  let numeroDeEscrituras = 0;
  const listeners = [];
  const microtasksPendientes = [];
  function notificar() {
    const snap = { exists: estado !== null, data: () => deepClone(estado) };
    listeners.forEach(cb => microtasksPendientes.push(() => cb(snap)));
  }
  return {
    docRef: {
      update(payload) {
        return new Promise((resolve, reject) => {
          try {
            if (estado === null) { reject(new Error('NOT_FOUND (update sobre documento inexistente)')); return; }
            Object.keys(payload).forEach(clave => {
              if (clave.includes('.')) setEnRuta(estado, clave, deepClone(payload[clave]));
              else estado[clave] = deepClone(payload[clave]);
            });
            numeroDeEscrituras++;
            microtasksPendientes.push(() => { notificar(); resolve(); });
          } catch (e) { reject(e); }
        });
      },
      onSnapshot(cb, errCb) {
        listeners.push(cb);
        microtasksPendientes.push(() => cb({ exists: estado !== null, data: () => deepClone(estado) }));
        return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
      }
    },
    // Avanza la cola de "microtareas" simuladas (equivalente a awaits reales de red) hasta que no
    // quede ninguna pendiente -- determinista, sin relojes reales.
    async flush(maxIter = 200) {
      let i = 0;
      while (microtasksPendientes.length && i < maxIter) { const fn = microtasksPendientes.shift(); await fn(); i++; }
      if (i >= maxIter) throw new Error('flush(): posible bucle infinito de escrituras (más de ' + maxIter + ' iteraciones) -- ver normalizarCredenciales()/programarGuardadoNubeAgenda()');
      return i;
    },
    estadoActual() { return deepClone(estado); },
    setEstado(nuevo) { estado = deepClone(nuevo); },
    get numeroDeEscrituras() { return numeroDeEscrituras; }
  };
}

// --- Mock de temporizador determinista (para programarGuardadoNubeAgenda, debounce 350ms) ---
function crearRelojFalso() {
  let ahora = 0;
  const pendientes = [];
  return {
    setTimeout(fn, ms) { const id = { fn, cuando: ahora + ms, cancelado: false }; pendientes.push(id); return id; },
    clearTimeout(id) { if (id) id.cancelado = true; },
    avanzar(ms) {
      ahora += ms;
      const disparan = pendientes.filter(p => !p.cancelado && p.cuando <= ahora);
      disparan.forEach(p => { p.cancelado = true; p.fn(); });
    }
  };
}

function crearDomFalso(valores = {}) {
  return {
    getElementById(id) {
      const v = valores[id];
      return { checked: !!(v && v.checked), value: (v && v.value) || '', classList: { contains: () => false, add(){}, remove(){}, toggle(){} } };
    }
  };
}

// Construye una sesión completa (equivalente a "abrir la app") con su propio estado en memoria,
// enganchada a un Firestore mock compartido -- exactamente como dos pestañas/dos cargas de página
// distintas comparten el mismo documento remoto pero tienen su propia copia en memoria.
function nuevaSesion(firestoreMock, { domValores = {}, credencialesIniciales = {} } = {}) {
  const reloj = crearRelojFalso();
  const localStorageFalso = (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } }; })();
  const document = crearDomFalso(domValores);
  const alerts = [];
  const preamble = `
    const CREDENCIALES_BASE = ${JSON.stringify(credencialesIniciales)};
    function esCitaPruebaCRM(){ return false; }
    // Renderizado de UI real -- fuera del alcance de este harness (no hay DOM real), se stubea
    // como no-op; no participa en la persistencia de disponibilidad que se está probando aquí.
    function recalcularKPIs(){}
    function renderClientes(){}
    function renderAgenda(){}
    function actualizarLabelsKPIMes(){}
    function configurarSelectorAdmin(){}
    // Efecto colateral de publicación al Portal -- fuera del alcance de este harness (se prueba
    // aparte en portal-tests/); no participa en la persistencia interna de disponibilidad.
    function publicarReservasPublicas(){ return Promise.resolve(); }
    function publicarReservasPublicasDebounced(){}
    function cerrarModalDisponibilidadReservas(){}
  `;
  const fn = new Function('localStorage', 'document', 'window', 'firebase', 'alert', 'setTimeout', 'clearTimeout',
    preamble + extracted + `
    return {
      get entrenadorVisto() { return entrenadorVisto; }, set entrenadorVisto(v) { entrenadorVisto = v; },
      get dbCredenciales() { return dbCredenciales; }, set dbCredenciales(v) { dbCredenciales = v; },
      get dbDisponibilidadReservas() { return dbDisponibilidadReservas; }, set dbDisponibilidadReservas(v) { dbDisponibilidadReservas = v; },
      get dbClientes() { return dbClientes; }, set dbClientes(v) { dbClientes = v; },
      get dbAgenda() { return dbAgenda; },
      guardarDisponibilidadReservas, guardarEstadoNubeAgenda, aplicarEstadoNubeAgenda,
      disponibilidadTrainerActual, disponibilidadReservasPorDefecto, normalizarTrainerKey,
      disponibilidadTrainerLectura, bloquesDisponibilidadFecha, asegurarDisponibilidadTrainerEditable,
      disponibilidadListaParaEditar
    };`);
  const windowFalso = { bsAgendaCloudDocRef: firestoreMock.docRef, bsAgendaAplicandoNube: false, bsAgendaCloudTimer: null };
  class FieldValueFalso { constructor(nombre) { this._methodName = nombre; } }
  const firebaseFalso = { firestore: { FieldValue: FieldValueFalso } };
  firebaseFalso.firestore.FieldValue.serverTimestamp = () => new FieldValueFalso('serverTimestamp');
  const M = fn(localStorageFalso, document, windowFalso, firebaseFalso, (msg) => alerts.push(msg), reloj.setTimeout, reloj.clearTimeout);
  M.window = windowFalso;
  M.reloj = reloj;
  M.alerts = alerts;
  // Engancha esta sesión al Firestore compartido: onSnapshot -> aplicarEstadoNubeAgenda, igual
  // que iniciarSincronizacionNubeAgenda() en el código real.
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

const CREDS_2PT = { carmen: { nombre: 'Carmen', rol: 'pt', email: 'carmen@x.com', trainerKey: 'carmen', activo: true }, lillo: { nombre: 'Lillo', rol: 'pt', email: 'lillo@x.com', trainerKey: 'lillo', activo: true } };

function domDisponibilidad({ lunesActivo = true, b1 = ['09:00', '13:00'], recurrente = true } = {}) {
  const v = { 'disp-recurrente-semanal': { checked: recurrente } };
  for (let d = 1; d <= 7; d++) {
    v[`disp-active-${d}`] = { checked: d === 1 ? lunesActivo : false };
    v[`disp-${d}-b1-start`] = { value: d === 1 ? b1[0] : '' };
    v[`disp-${d}-b1-end`] = { value: d === 1 ? b1[1] : '' };
    v[`disp-${d}-b2-start`] = { value: '' };
    v[`disp-${d}-b2-end`] = { value: '' };
  }
  return v;
}

async function main() {

// ============================================================
console.log('=== CONTROL NEGATIVO: guardar disponibilidad, recargar la app -> debe seguir ahí ===');
// ============================================================
{
  const fs1 = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const sesion1 = nuevaSesion(fs1, { domValores: domDisponibilidad({ b1: ['09:00', '13:00'] }), credencialesIniciales: CREDS_2PT });
  await fs1.flush();
  sesion1.entrenadorVisto = 'carmen';
  sesion1.dbCredenciales = { ...CREDS_2PT };

  sesion1.guardarDisponibilidadReservas();
  await fs1.flush();

  // "Cierro/reabro o recargo la aplicación": sesión NUEVA, memoria en blanco, que solo conoce lo
  // que hay en el documento remoto en este momento -- exactamente lo que hace un F5 real.
  const sesion2 = nuevaSesion(fs1, { credencialesIniciales: CREDS_2PT });
  await fs1.flush();
  sesion2.entrenadorVisto = 'carmen';

  const dispTrasReload = sesion2.dbDisponibilidadReservas['carmen'];
  check('CONTROL NEGATIVO: la disponibilidad de Carmen sigue existiendo tras recargar', !!dispTrasReload, true);
  check('CONTROL NEGATIVO: el bloque guardado (09:00-13:00, lunes) persiste tras recargar', dispTrasReload?.semanal?.['1'], { activo: true, bloques: [{ inicio: '09:00', fin: '13:00' }] });
}

// ============================================================
console.log('\n=== 1. PT sin disponibilidad -> guarda la primera disponibilidad ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { domValores: domDisponibilidad(), credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';
  check('antes de guardar, Carmen no tiene disponibilidad previa', s.dbDisponibilidadReservas['carmen'], undefined);
  s.guardarDisponibilidadReservas();
  await fsx.flush();
  check('tras guardar, Carmen tiene su primera disponibilidad en memoria', !!s.dbDisponibilidadReservas['carmen'], true);
  check('el documento remoto realmente contiene la disponibilidad de Carmen', !!fsx.estadoActual().disponibilidadReservas.carmen, true);
}

// ============================================================
console.log('\n=== 2/3. PT existente modifica disponibilidad -> reload -> permanece la NUEVA, no la vieja ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: { carmen: { semanal: { 1: { activo: true, bloques: [{ inicio: '08:00', fin: '12:00' }] } }, excepciones: {}, bloqueos: {}, recurrenteSemanal: true } }, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { domValores: domDisponibilidad({ b1: ['10:00', '15:00'] }), credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';
  check('el estado previo (08:00-12:00) se cargó correctamente', s.dbDisponibilidadReservas['carmen'].semanal['1'].bloques[0], { inicio: '08:00', fin: '12:00' });

  s.guardarDisponibilidadReservas();
  await fsx.flush();

  const s2 = nuevaSesion(fsx, { credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  s2.entrenadorVisto = 'carmen';
  check('tras reload, el bloque NUEVO (10:00-15:00) es el que persiste', s2.dbDisponibilidadReservas['carmen'].semanal['1'].bloques[0], { inicio: '10:00', fin: '15:00' });
}

// ============================================================
console.log('\n=== 4/5. PT A y PT B mantienen disponibilidades independientes; modificar A no cambia B ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const sCarmen = nuevaSesion(fsx, { domValores: domDisponibilidad({ b1: ['09:00', '13:00'] }), credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  sCarmen.entrenadorVisto = 'carmen';
  sCarmen.guardarDisponibilidadReservas();
  await fsx.flush();

  const sLillo = nuevaSesion(fsx, { domValores: domDisponibilidad({ b1: ['16:00', '20:00'] }), credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  sLillo.entrenadorVisto = 'lillo';
  sLillo.guardarDisponibilidadReservas();
  await fsx.flush();

  const sFinal = nuevaSesion(fsx, { credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  check('Carmen conserva su propio bloque (09:00-13:00)', sFinal.dbDisponibilidadReservas['carmen'].semanal['1'].bloques[0], { inicio: '09:00', fin: '13:00' });
  check('Lillo conserva su propio bloque (16:00-20:00), NO el de Carmen', sFinal.dbDisponibilidadReservas['lillo'].semanal['1'].bloques[0], { inicio: '16:00', fin: '20:00' });
}

// ============================================================
console.log('\n=== 9. Guardar disponibilidad de B DESPUÉS de A no borra la de A (mismo documento monolítico) ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const sCarmen = nuevaSesion(fsx, { domValores: domDisponibilidad({ b1: ['09:00', '13:00'] }), credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  sCarmen.entrenadorVisto = 'carmen';
  sCarmen.guardarDisponibilidadReservas();
  await fsx.flush();

  // MISMA sesión que ya tiene a Carmen cargada, pero ahora el admin cambia el selector a Lillo y
  // guarda SU disponibilidad -- el escenario exacto de "PT A guarda, luego B guarda" en una sola
  // pestaña de admin.
  sCarmen.entrenadorVisto = 'lillo';
  sCarmen.guardarDisponibilidadReservas();
  await fsx.flush();

  check('tras guardar la de Lillo, Carmen SIGUE en el documento remoto (sin overwrite del doc completo)', !!fsx.estadoActual().disponibilidadReservas.carmen, true);
  check('la disponibilidad de Carmen en el remoto sigue siendo la suya (09:00-13:00)', fsx.estadoActual().disponibilidadReservas.carmen.semanal['1'].bloques[0], { inicio: '09:00', fin: '13:00' });
}

// ============================================================
console.log('\n=== 6/7/8. Guardar sesión / editar cliente / mover sesión después NO borra disponibilidad ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { domValores: domDisponibilidad({ b1: ['09:00', '13:00'] }), credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';
  s.guardarDisponibilidadReservas();
  await fsx.flush();

  // Simula guardarCliente()/mover sesión: mutan dbClientes/dbAgenda del MISMO scope y disparan
  // guardarEstadoNubeAgenda(scope) -- el mismo mecanismo que usa el guardado real de clientes.
  s.dbClientes['carmen'] = [{ id: 'c1', nombre: 'Cliente de prueba' }];
  const pGuardarCliente = s.guardarEstadoNubeAgenda('carmen'); // no await: el .update() solo resuelve cuando flush() drena su cola
  await fsx.flush();
  await pGuardarCliente;

  check('tras "guardar cliente" para el mismo PT, su disponibilidad remota sigue intacta', fsx.estadoActual().disponibilidadReservas.carmen.semanal['1'].bloques[0], { inicio: '09:00', fin: '13:00' });

  const s2 = nuevaSesion(fsx, { credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  check('...y sigue ahí también tras una recarga completa', s2.dbDisponibilidadReservas['carmen']?.semanal?.['1']?.bloques?.[0], { inicio: '09:00', fin: '13:00' });
}

// ============================================================
console.log('\n=== 10. trainerKey en mayúsculas/minúsculas se normaliza correctamente ===');
// ============================================================
{
  const s = nuevaSesion(crearFirestoreMock(null), {});
  check('normalizarTrainerKey("Lillo") -> "lillo"', s.normalizarTrainerKey('Lillo'), 'lillo');
  check('normalizarTrainerKey("MIGUEL FENECH") -> "miguel_fenech"', s.normalizarTrainerKey('MIGUEL FENECH'), 'miguel_fenech');

  // Reproduce el bug histórico exacto: un perfil llega con trainerKey mal capitalizado
  // ("Lillo") -- sanitizarCredenciales() (ya existente, ejecutado en cada aplicarEstadoNubeAgenda)
  // debe dejarlo normalizado en dbCredenciales para que coincida con la clave que usa
  // disponibilidadReservas/dbClientes/dbAgenda en todo lo demás.
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const sesion = nuevaSesion(fsx, { credencialesIniciales: { Lillo: { nombre: 'Lillo', rol: 'pt', email: 'lillo@x.com', trainerKey: 'Lillo', activo: true } } });
  await fsx.flush();
  check('un trainerKey mal capitalizado en el perfil queda normalizado en dbCredenciales', Object.keys(sesion.dbCredenciales), ['lillo']);
}

// ============================================================
console.log('\n=== 11/12/13. Días vacíos, bloqueo parcial y múltiples franjas permanecen tal cual ===');
// ============================================================
{
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const dom = domDisponibilidad({ b1: ['09:00', '13:00'] });
  // Añade una 2ª franja el mismo lunes.
  dom['disp-1-b2-start'] = { value: '16:00' }; dom['disp-1-b2-end'] = { value: '20:00' };
  const s = nuevaSesion(fsx, { domValores: dom, credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  s.entrenadorVisto = 'carmen';
  s.guardarDisponibilidadReservas();
  await fsx.flush();

  const s2 = nuevaSesion(fsx, { credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  const dispCarmen = s2.dbDisponibilidadReservas['carmen'];
  check('lunes conserva SUS DOS franjas tras reload', dispCarmen.semanal['1'].bloques, [{ inicio: '09:00', fin: '13:00' }, { inicio: '16:00', fin: '20:00' }]);
  check('martes (nunca activado) permanece intencionadamente vacío, no hereda nada del lunes', dispCarmen.semanal['2'], { activo: false, bloques: [] });

  // Bloqueo parcial de un slot concreto.
  s2.entrenadorVisto = 'carmen';
  const disp = s2.asegurarDisponibilidadTrainerEditable('carmen');
  disp.bloqueos['2026-10-05'] = ['10:00'];
  const pBloqueo = s2.guardarEstadoNubeAgenda('carmen');
  await fsx.flush();
  await pBloqueo;
  const s3 = nuevaSesion(fsx, { credencialesIniciales: CREDS_2PT });
  await fsx.flush();
  check('el bloqueo parcial de un slot concreto persiste tras reload', s3.dbDisponibilidadReservas['carmen'].bloqueos['2026-10-05'], ['10:00']);
}

// ============================================================
console.log('\n=== CONTROL NEGATIVO (causa raíz): guardar disponibilidad ANTES de que llegue el primer snapshot NUNCA debe poder pisar datos reales ===');
// ============================================================
{
  // Condición de carrera real: el PT ya tiene disponibilidad guardada de una sesión anterior
  // (Lunes 09:00-13:00 + Martes 16:00-20:00), recarga la app, y pulsa "+ Disponibilidad"
  // INMEDIATAMENTE -- antes de que el listener onSnapshot() (async, red) haya entregado el primer
  // documento. ANTES DEL FIX: disponibilidadTrainerActual()/guardarDisponibilidadReservas() no
  // distinguían "todavía no ha llegado la respuesta de red" de "este PT realmente no tiene
  // disponibilidad", así que fabricaban un default vacío, lo escribían en memoria, y un guardado
  // en ese instante sustituía PERMANENTEMENTE los datos reales por ese default + lo que se hubiera
  // tocado -- confirmado (ver historial de este archivo): contra f95a64d este mismo test fallaba,
  // perdiendo el bloque del martes. DESPUÉS DEL FIX: disponibilidadListaParaEditar() (comprobado
  // aquí a través de guardarDisponibilidadReservas(), que lo invoca como guardián) bloquea
  // cualquier guardado mientras window.bsAgendaDisponibilidadCargada siga siendo false, así que la
  // carrera ya no puede ganar: no se escribe nada hasta que se conoce el estado real.
  const dispPrevia = { semanal: { 1: { activo: true, bloques: [{ inicio: '09:00', fin: '13:00' }] }, 2: { activo: true, bloques: [{ inicio: '16:00', fin: '20:00' }] } }, excepciones: {}, bloqueos: {}, recurrenteSemanal: true };
  for (let d = 3; d <= 7; d++) dispPrevia.semanal[d] = { activo: false, bloques: [] };
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: { carmen: dispPrevia }, notas: {}, historicoClientes: {} });

  // Sesión nueva (recarga) SIN flush todavía -- el snapshot real está "en camino" pero no ha
  // llegado (exactamente como una petición de red que tarda unos cientos de ms).
  const s = nuevaSesion(fsx, { domValores: domDisponibilidad({ b1: ['10:00', '14:00'] }), credencialesIniciales: CREDS_2PT });
  s.entrenadorVisto = 'carmen';

  check('ANTES de que llegue el snapshot real, Carmen todavía no tiene nada en memoria (esperado)', s.dbDisponibilidadReservas['carmen'], undefined);
  check('disponibilidadListaParaEditar() detecta que todavía NO se puede editar con garantías', s.disponibilidadListaParaEditar(), false);

  // El PT pulsa "Guardar" en ese instante (modal abierto sobre un formulario que, de haberse
  // renderizado, habría mostrado un default vacío en vez de sus datos reales). NО se hace flush()
  // todavía a propósito -- comprobar el efecto INMEDIATO y SÍNCRONO del guardián, antes de que el
  // snapshot real (ya en camino desde que se creó la sesión) tenga ocasión de llegar.
  s.guardarDisponibilidadReservas();
  check('CONTROL NEGATIVO: el guardado durante la carrera NO ha escrito nada en Firestore', fsx.numeroDeEscrituras, 0);
  check('...ni tampoco ha fabricado/persistido un default vacío en memoria', s.dbDisponibilidadReservas['carmen'], undefined);
  check('...y el PT ha sido avisado de que debe esperar', s.alerts.some(a => /cargando la disponibilidad/i.test(a)), true);

  // Ahora SÍ llega el snapshot real (la red responde, con retraso) -- y a partir de aquí, guardar
  // funciona con normalidad y con los datos reales como base.
  await fsx.flush();
  check('tras llegar el snapshot real, Carmen recupera su disponibilidad real intacta (incluye el martes)', s.dbDisponibilidadReservas['carmen'].semanal['2'], { activo: true, bloques: [{ inicio: '16:00', fin: '20:00' }] });
  s.guardarDisponibilidadReservas();
  await fsx.flush();
  check('un guardado posterior (con los datos reales ya cargados) SÍ persiste el nuevo lunes que el PT quiso cambiar', fsx.estadoActual().disponibilidadReservas.carmen.semanal['1'].bloques[0], { inicio: '10:00', fin: '14:00' });
}

// ============================================================
console.log('\n=== VERIFICACIÓN: normalizarCredenciales() NO desencadena un bucle de escrituras automáticas ===');
// ============================================================
{
  // Hipótesis descartada explícitamente durante esta auditoría (no se presupone, se demuestra):
  // aplicarEstadoNubeAgenda() llama incondicionalmente a normalizarCredenciales(), que a su vez
  // llama a programarGuardadoNubeAgenda() -- en un primer análisis esto parecía poder
  // reprogramar un guardado automático en cada snapshot, para siempre. Comprobado contra el
  // código real: programarGuardadoNubeAgenda() comprueba window.bsAgendaAplicandoNube, que sigue
  // siendo true durante TODA la ejecución síncrona de aplicarEstadoNubeAgenda() (incluida la
  // llamada a normalizarCredenciales()) y solo pasa a false en su bloque finally -- por lo que esa
  // reprogramación es SIEMPRE un no-op. No hay bucle. Se deja este test para que quede constancia
  // de que la hipótesis se investigó y se descartó con una prueba real, no una suposición.
  const fsx = crearFirestoreMock({ clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, notas: {}, historicoClientes: {} });
  const s = nuevaSesion(fsx, { credencialesIniciales: CREDS_2PT });
  await fsx.flush(5); // solo la carga inicial
  const escriturasTrasCarga = fsx.numeroDeEscrituras;

  s.reloj.avanzar(350); // si programarGuardadoNubeAgenda() hubiera programado algo, dispararía aquí
  await fsx.flush(5);
  check('cargar la página sin que el usuario toque nada NO provoca ninguna escritura automática', fsx.numeroDeEscrituras, escriturasTrasCarga);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR FATAL EN LA SUITE:', err); process.exitCode = 1; });
