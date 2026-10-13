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
// ARQ-V1-MIGRACION-IMPL: con documentos independientes, el trainerKey va en el ID del documento y
// en un campo, nunca dentro de una ruta de campo con puntos: el riesgo original desaparece. Se
// comprueba con las funciones REALES que hoy escriben esos datos (besoul-datos.js), contra el
// servidor falso de documentos, para un trainerKey con punto real ("fran.jmorenomartin").
const D = require('../besoul-datos.js');
const { crearServidorDocumentos } = require('../concurrency-tests/almacen_documentos.cjs');
const FV = { serverTimestamp: () => ({ _methodName: 'serverTimestamp' }) };
const tkPunto = 'fran.jmorenomartin';

console.log('=== Finanzas: actividades autorizadas de un trainerKey con punto ===');
{
  const srv = crearServidorDocumentos({ clientes: {}, agenda: {}, trainerActividades: {} });
  await D.actualizarCamposRaiz({ firestore: srv.ref.firestore, FieldValue: FV, payload: { [`trainerActividades.${tkPunto}`]: ['pilates_maquina'] }, actor: 'test' });
  const estado = srv.estadoActual();
  check('trainerActividades["fran.jmorenomartin"] queda como clave PLANA', estado.trainerActividades[tkPunto], ['pilates_maquina']);
  check('"fran" NO se ha convertido en un mapa anidado fantasma', estado.trainerActividades.fran, undefined);
  check('el documento es besoulTrainers/fran.jmorenomartin', Object.keys(srv.documentos().trainers), [tkPunto]);
}

console.log('\n=== CRM: prueba de un lead para un trainerKey con punto ===');
{
  const srv = crearServidorDocumentos({ clientes: {}, agenda: {}, pruebasCRM: {} });
  const clave = '2026-10-21_10:00';
  const cita = { id: 'crm_trial_L1', tipoCita: 'pruebaCRM', esPruebaCRM: true, leadId: 'L1', nombre: 'Lead' };
  await D.transaccionLegado({ firestore: srv.ref.firestore, FieldValue: FV, actor: 'test', semanas: [{ tk: tkPunto, lunes: D.lunesDe('2026-10-21') }], mutar: ag => {
    ag.agenda[tkPunto] = { [clave]: cita }; ag.pruebasCRM[tkPunto] = { [clave]: cita };
  } });
  const estado = srv.estadoActual();
  check('agenda["fran.jmorenomartin"][clave] existe como clave PLANA', !!(estado.agenda[tkPunto] || {})[clave], true);
  check('la cita no está en un mapa "fran" anidado', estado.agenda.fran, undefined);
  check('pruebasCRM["fran.jmorenomartin"] también queda plano', !!(estado.pruebasCRM[tkPunto] || {})[clave], true);
  check('el documento de semana lleva el trainerKey completo en su ID', Object.keys(srv.documentos().semanas), [`${tkPunto}__2026-10-19`]);
  check('la semana queda indexada por el lead (CRM la encuentra sin descargar agendas)', Object.values(srv.documentos().semanas).filter(s => (s.leadsPrueba || []).includes('L1')).length, 1);
  // Re-sincronizar: la prueba antigua se borra de verdad (antes set({merge:true}) la dejaba).
  await D.transaccionLegado({ firestore: srv.ref.firestore, FieldValue: FV, actor: 'test', semanas: [{ tk: tkPunto, lunes: '2026-10-19' }], mutar: ag => {
    delete ag.agenda[tkPunto][clave]; delete ag.pruebasCRM[tkPunto][clave];
  } });
  const fin = srv.estadoActual();
  check('al quitar la prueba, desaparece de verdad de la agenda y de pruebasCRM', [Object.keys(fin.agenda[tkPunto] || {}).length, Object.keys(fin.pruebasCRM[tkPunto] || {}).length], [0, 0]);
  let errorNoDeclarada = null;
  try { await D.transaccionLegado({ firestore: srv.ref.firestore, FieldValue: FV, semanas: [], mutar: ag => { ag.agenda[tkPunto] = { '2026-11-02_10:00': cita }; } }); } catch (e) { errorNoDeclarada = e.code; }
  check('escribir en una semana no leída en la transacción se rechaza (nunca se sobrescribe a ciegas)', errorNoDeclarada, 'semana-no-leida');
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
