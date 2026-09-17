// FIELDPATH-P0: prueba los dos writers de besoulSuite/agenda que compartían el hallazgo real ya
// corregido en agenda.html (una clave de punto dentro de un string de .update()/tx.update() se
// interpreta como ruta anidada real de Firestore) -- finanzas.html/guardarCatalogoActividadesNube
// y crm.html/sincronizarPruebaAgendaDesdeLead. Mismo mock de Firestore fiel (dotted-path +
// FieldPath + FieldValue.delete + onSnapshot) que availability-tests/. Nunca toca Firestore real.
const fs = require('fs');
const path = require('path');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
class FieldPathFalso { constructor(...segmentos) { this.segmentos = segmentos; } }
class FieldValueFalso { constructor(metodo) { this._methodName = metodo; } }
const DELETE_SENTINEL = new FieldValueFalso('delete');
FieldValueFalso.delete = () => DELETE_SENTINEL;
FieldValueFalso.serverTimestamp = () => new FieldValueFalso('serverTimestamp');

function setEnRuta(obj, segmentos, valor) {
  let cursor = obj;
  for (let i = 0; i < segmentos.length - 1; i++) {
    if (typeof cursor[segmentos[i]] !== 'object' || cursor[segmentos[i]] === null) cursor[segmentos[i]] = {};
    cursor = cursor[segmentos[i]];
  }
  if (valor instanceof FieldValueFalso && valor._methodName === 'delete') { delete cursor[segmentos[segmentos.length - 1]]; return; }
  cursor[segmentos[segmentos.length - 1]] = deepClone(valor);
}

function crearFirestoreMock(estadoInicial) {
  let estado = estadoInicial === undefined ? null : deepClone(estadoInicial);
  function aplicarCampo(campo, valor) {
    if (campo instanceof FieldPathFalso) { setEnRuta(estado, campo.segmentos, valor); return; }
    if (typeof campo === 'string' && campo.includes('.')) { setEnRuta(estado, campo.split('.'), valor); return; }
    if (valor instanceof FieldValueFalso && valor._methodName === 'delete') { delete estado[campo]; return; }
    estado[campo] = deepClone(valor);
  }
  function aplicarUpdate(args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof FieldPathFalso)) {
      Object.keys(args[0]).forEach(clave => aplicarCampo(clave, args[0][clave]));
    } else {
      for (let i = 0; i < args.length; i += 2) aplicarCampo(args[i], args[i + 1]);
    }
  }
  const ref = {
    update(...args) { aplicarUpdate(args); return Promise.resolve(); },
    get() { return Promise.resolve({ exists: estado !== null, data: () => deepClone(estado) }); },
    // besoulLeads/{leadId}.set(...) tras la transacción no es lo que este test verifica (solo
    // marca agendaPruebaVisible en el LEAD, no en besoulSuite/agenda) -- se acepta sin efecto.
    set() { return Promise.resolve(); }
  };
  return {
    collection() { return { doc() { return ref; } }; },
    async runTransaction(fn) {
      const tx = { get: (r) => r.get(), update: (r, ...args) => aplicarUpdate(args) };
      return fn(tx);
    },
    estadoActual() { return deepClone(estado); }
  };
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

async function main() {

// ============================================================
console.log('=== finanzas.html: guardarCatalogoActividadesNube() -- trainerKey con punto ===');
// ============================================================
{
  const extracted = fs.readFileSync(path.join(__dirname, 'finanzas_fieldpath_extract.js'), 'utf8');
  const mockDb = crearFirestoreMock({ trainerActividades: {}, catalogoActividades: {} });
  const refReal = mockDb.collection('besoulSuite').doc('agenda');
  const firebase = { firestore: { FieldPath: FieldPathFalso, FieldValue: FieldValueFalso } };
  const alerts = [];
  const fn = new Function('agendaRef', 'firebase', 'alert', extracted + `
    return { guardarCatalogoActividadesNube };`);
  const M = fn(refReal, firebase, (m) => alerts.push(m));

  const trainerKeyConPunto = 'fran.jmorenomartin';
  M.guardarCatalogoActividadesNube({ [`trainerActividades.${trainerKeyConPunto}`]: ['ciclo_indoor', 'pilates_maquina'] });
  await new Promise(r => setImmediate(r));

  check('sin alerta de error', alerts, []);
  check('trainerActividades["fran.jmorenomartin"] queda como clave PLANA (no anidada en 2 niveles)', mockDb.estadoActual().trainerActividades[trainerKeyConPunto], ['ciclo_indoor', 'pilates_maquina']);
  check('"fran" NO se ha convertido en un mapa anidado fantasma', mockDb.estadoActual().trainerActividades.fran, undefined);
}

// ============================================================
console.log('\n=== crm.html: sincronizarPruebaAgendaDesdeLead() -- trainerKey con punto no se parte ===');
// ============================================================
{
  const extracted = fs.readFileSync(path.join(__dirname, 'crm_fieldpath_extract.js'), 'utf8');
  const mockDb = crearFirestoreMock({ agenda: {}, pruebasCRM: {} });
  const firebase = { firestore: { FieldPath: FieldPathFalso, FieldValue: FieldValueFalso } };
  const preamble = `
    function textoTrainer(k){ return k || ''; }
    function textoCentro(k){ return k || ''; }
  `;
  const fn = new Function('db', 'firebase', preamble + extracted + `
    return { sincronizarPruebaAgendaDesdeLead };`);
  const M = fn(mockDb, firebase);

  const trainerKeyConPunto = 'fran.jmorenomartin';
  const leadData = { estado: 'Prueba agendada', fechaPrueba: new Date('2026-10-05T10:00:00').toISOString(), trainerKey: trainerKeyConPunto, nombre: 'Lead de prueba' };
  const resultado = await M.sincronizarPruebaAgendaDesdeLead('lead1', leadData, false);

  check('la prueba se marca como visible en Agenda', resultado.visible, true);
  const remoto = mockDb.estadoActual();
  check('agenda["fran.jmorenomartin"] existe como clave PLANA (2 niveles: agenda -> trainerKey -> clave)', typeof remoto.agenda[trainerKeyConPunto], 'object');
  check('la cita se guardó bajo agenda["fran.jmorenomartin"][clave], no en un mapa "fran" anidado', remoto.agenda.fran, undefined);
  check('pruebasCRM["fran.jmorenomartin"] también queda plano', remoto.pruebasCRM.fran, undefined);
  check('la clave real de la cita coincide con la calculada', Object.keys(remoto.agenda[trainerKeyConPunto] || {})[0], resultado.clave);

  // Control: un trainerKey normal (sin puntos) sigue funcionando exactamente igual que antes.
  const mockDb2 = crearFirestoreMock({ agenda: {}, pruebasCRM: {} });
  const fn2 = new Function('db', 'firebase', preamble + extracted + `
    return { sincronizarPruebaAgendaDesdeLead };`);
  const M2 = fn2(mockDb2, firebase);
  const resultado2 = await M2.sincronizarPruebaAgendaDesdeLead('lead2', { estado: 'Prueba agendada', fechaPrueba: new Date('2026-10-06T11:00:00').toISOString(), trainerKey: 'carmen', nombre: 'Lead normal' }, false);
  check('trainerKey normal (sin puntos) sigue funcionando igual', resultado2.visible, true);
  check('...con su clave bajo agenda.carmen directamente', typeof mockDb2.estadoActual().agenda.carmen, 'object');

  // Borrado: si se re-sincroniza el MISMO lead con una fecha distinta, la cita anterior (bajo el
  // trainerKey con punto) debe borrarse limpiamente sin dejar residuo en un mapa mal anidado.
  const leadData2 = { ...leadData, fechaPrueba: new Date('2026-10-07T12:00:00').toISOString() };
  const resultado3 = await M.sincronizarPruebaAgendaDesdeLead('lead1', leadData2, false);
  const remoto2 = mockDb.estadoActual();
  check('al re-sincronizar, la cita antigua bajo el trainerKey con punto se borra de verdad', Object.keys(remoto2.agenda[trainerKeyConPunto] || {}).length, 1);
  check('...y es la nueva clave, no la antigua', Object.keys(remoto2.agenda[trainerKeyConPunto])[0], resultado3.clave);
}

// ============================================================
console.log('\n=== HARDENING-PRE-BASELINE-v3.2.1: crearEntrenador() rechaza el punto SOLO para claves NUEVAS ===');
// ============================================================
{
  const agendaHtml = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');
  const m = /if \(!(\/\^\[a-z0-9_-\]\+\$\/)\.test\(user\)\)/.exec(agendaHtml);
  check('crearEntrenador() usa el regex endurecido (sin punto) para validar trainerKeys NUEVOS', !!m, true);
  const regexNuevaClave = m ? new RegExp(m[1].slice(1, -1)) : /^$/;

  check('clave nueva SIN punto: aceptada', regexNuevaClave.test('miguel_luna'), true);
  check('clave nueva CON punto: rechazada (causa raíz cerrada para altas nuevas)', regexNuevaClave.test('miguel.luna'), false);

  // normalizarTrainerKey() en sí NO debe tocarse -- se sigue usando para normalizar/comparar
  // trainerKeys YA EXISTENTES con punto (auditoría de duplicados, construirAuditoriaTrainerKey()),
  // y trainerKeyDesdeEmail()/el resto de la app deben seguir reconociendo "fran.jmorenomartin"
  // sin ninguna migración. Verifica que el propio normalizador sigue aceptando el punto.
  const mNorm = /function normalizarTrainerKey\(valor\) \{[\s\S]*?replace\(\/\[\^a-z0-9\._-\]\/g, ''\)/.exec(agendaHtml);
  check('normalizarTrainerKey() en sí sigue aceptando el punto (no se toca, compatibilidad con claves existentes)', !!mNorm, true);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
}

main().catch(err => { console.error('ERROR FATAL EN LA SUITE:', err); process.exitCode = 1; });
