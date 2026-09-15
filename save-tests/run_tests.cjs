// HOTFIX-CLIENT-SAVE-V2: pruebas reales de guardarCliente() contra un DOM simulado, extraido
// verbatim de agenda.html (mismo patron que assistant-tests/finance-tests). Detectan si el
// objeto ficha que se envia hacia Firestore (via guardarEstadoNubeAgenda) contiene
// undefined/NaN/funciones/referencias circulares en cualquier profundidad -- exactamente lo que
// Firestore .update() rechaza, causando el "No se ha podido guardar la ficha en el servidor".
//
// CAUSA RAIZ REAL (encontrada por el escenario H de este archivo, antes de este hotfix): el
// bloque CLIENT-08 de guardarCliente() (guardar un integrante de grupo directamente) copiaba 8
// campos de fichaAnterior SIN valor de respaldo (factor/tipoCompra/fechaCompra/color/memberId/
// grupoNombre/estadoCliente/fechaEstado/observacionesEstado). Una ficha de integrante real a la
// que le faltara cualquiera de esos campos (dato de produccion plausible: nunca antes existia
// una via para abrir y guardar la ficha de un integrante por separado) dejaba esa clave como
// `undefined` explicito en el payload completo (dbClientes.<trainer>, se envia entero) --
// Firestore rechazaba la escritura ENTERA, con el mismo mensaje generico para cualquier cliente
// de ese entrenador.
const fs = require('fs');
const path = require('path');
const extracted = fs.readFileSync(path.join(__dirname, 'guardar_extract.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(desc, ok, detalle) {
  if (ok) pass++; else { fail++; fails.push(`${desc}${detalle ? ' :: ' + detalle : ''}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${detalle ? ' :: ' + detalle : ''}`);
}

function valoresProblematicos(obj, pathStr = '', seen = new Set(), out = []) {
  if (obj === undefined) { out.push(`${pathStr} = undefined`); return out; }
  if (typeof obj === 'number' && Number.isNaN(obj)) { out.push(`${pathStr} = NaN`); return out; }
  if (typeof obj === 'function') { out.push(`${pathStr} = <function>`); return out; }
  if (obj === null || typeof obj !== 'object') return out;
  if (seen.has(obj)) { out.push(`${pathStr} = <circular>`); return out; }
  if (obj instanceof Date) return out;
  seen.add(obj);
  if (Array.isArray(obj)) obj.forEach((v, i) => valoresProblematicos(v, `${pathStr}[${i}]`, seen, out));
  else for (const k of Object.keys(obj)) valoresProblematicos(obj[k], `${pathStr}.${k}`, seen, out);
  return out;
}

function makeElement(initial = {}) {
  return {
    _value: initial.value ?? '', _checked: initial.checked ?? false, _disabled: false,
    get value() { return this._value; },
    set value(v) { if (initial.options && !initial.options.includes(v)) return; this._value = v; }, // <select> sin <option> coincidente -> no-op silencioso, comportamiento real del DOM
    get checked() { return this._checked; }, set checked(v) { this._checked = v; },
    get disabled() { return this._disabled; }, set disabled(v) { this._disabled = v; },
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    innerHTML: '', innerText: '', textContent: '',
    scrollIntoView(){}, focus(){}, click(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
  };
}

// NO usar JSON.stringify/parse para clonar el resultado: eso ELIMINA en silencio cualquier clave
// con valor undefined -- exactamente lo que Firestore NO hace (Firestore rechaza la escritura
// entera). Un clon via JSON habria ocultado el propio bug que este archivo prueba.
function clonarPreservandoUndefined(v, seen = new Map()) {
  if (v === null || typeof v !== 'object' || v instanceof Date) return v;
  if (seen.has(v)) return seen.get(v);
  if (Array.isArray(v)) { const out = []; seen.set(v, out); v.forEach((x, i) => out[i] = clonarPreservandoUndefined(x, seen)); return out; }
  const out = {}; seen.set(v, out);
  Object.keys(v).forEach(k => out[k] = clonarPreservandoUndefined(v[k], seen));
  return out;
}

async function ejecutarGuardarCliente({ tabFichaActiva, idFichaEditando, dom, dbClientesIniciales, filasMiembro = [] }) {
  const elementos = {};
  Object.keys(dom).forEach(id => elementos[id] = makeElement(dom[id]));
  const document = {
    getElementById: (id) => elementos[id] || null,
    querySelectorAll: (sel) => sel === '.member-row' ? filasMiembro.map(f => ({
      dataset: { memberId: f.memberId },
      querySelector: (s) => s === '.mem-name' ? { value: f.nombre } : s === '.mem-phone' ? { value: f.telefono } : s === '.mem-email' ? { value: f.email } : null,
    })) : [],
    querySelector: () => null,
  };
  const dbClientes = { carmen: JSON.parse(JSON.stringify(dbClientesIniciales)) };
  let capturedPayload = null;
  async function guardarEstadoNubeAgenda(scope) { capturedPayload = clonarPreservandoUndefined(dbClientes[scope]); return { ok: true }; }

  const localStorage = { setItem(){}, getItem(){ return null; } };
  const window = { crypto: global.crypto };
  function formatoFechaLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  const fn = new Function(
    'document', 'dbClientes', 'entrenadorVisto', 'dbCatalogoActividades', 'contratoTemporalFicha',
    'tabFichaActiva', 'idFichaEditando', 'guardarEstadoNubeAgenda', 'cerrarModal', 'recalcularKPIs',
    'renderClientes', 'renderAgenda', 'actualizarNombreEnAgendaSiCambia', 'alert', 'console', 'localStorage', 'window', 'formatoFechaLocal',
    extracted + '\nreturn guardarCliente();'
  );
  await fn(
    document, dbClientes, 'carmen', {}, null, tabFichaActiva, idFichaEditando,
    guardarEstadoNubeAgenda, ()=>{}, ()=>{}, ()=>{}, ()=>{}, ()=>{}, ()=>{}, console,
    localStorage, window, formatoFechaLocal
  );
  return { dbClientesFinal: dbClientes.carmen, payload: capturedPayload };
}

const MOD_OPTIONS = ['Individual Plan','Individual Suelta','Individual Bono 8','Individual Bono','Pareja','Trío','Grupo Reducido Plan','Grupo Reducido Suelta','Grupo Reducido Bono 8','Grupo Reducido Bono','Grupo Aire Libre'];
const FACTOR_1_5 = ['1','2','3','4','5'];

(async () => {

  console.log('=== 1. Guardar cliente individual existente ===');
  {
    const { payload } = await ejecutarGuardarCliente({
      tabFichaActiva: 'individual', idFichaEditando: 'cli_1',
      dbClientesIniciales: [{ id: 'cli_1', tipo: 'individual', nombre: 'Marta', telefono: '600111222', email: 'marta@x.com', modalidad: 'Individual Plan', factor: 2, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', fechaAlta: '2026-01-01', reservaToken: 'res_abc123', reservasOnlineActivas: true }],
      dom: {
        'cust-name': { value: 'Marta' }, 'cust-phone': { value: '600999888' }, 'cust-email': { value: 'marta@x.com' },
        'cust-mod': { value: 'Individual Plan', options: MOD_OPTIONS }, 'cust-factor': { value: '2', options: FACTOR_1_5 },
        'cust-purchase-type': { value: 'Mensualidad' }, 'cust-bono-date': { value: '' }, 'cust-color': { value: 'amber' },
        'cust-discount': { value: '0' }, 'cust-status': { value: 'activo' }, 'cust-start-date': { value: '2026-01-01' },
      }
    });
    const malos = valoresProblematicos(payload, 'payload');
    check('individual existente: guardado sin valores problematicos', malos.length === 0, malos.join('; '));
    check('individual existente: telefono actualizado', payload[0].telefono === '600999888');
  }

  console.log('\n=== 2. Guardar integrante de grupo (produccion-like, campos completos) ===');
  {
    const grupo = { id: 'grp1', tipo: 'grupo', nombre: 'Familia Perez', modalidad: 'Grupo Reducido Plan', factor: 1, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', fechaEstado: '', observacionesEstado: '', integrantesObj: [{ id: 'm0', nombre: 'Ana', telefono: '600111111', email: 'ana@x.com' }, { id: 'm1', nombre: 'Bruno', telefono: '600222222', email: 'bruno@x.com' }] };
    const ana = { id: 'cli_member_grp1_m0', tipo: 'individual', nombre: 'Ana', telefono: '600111111', email: 'ana@x.com', modalidad: 'Miembro Subordinado', factor: 1, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', fechaEstado: '', observacionesEstado: '', vinculacion: 'grp1', memberId: 'm0', grupoNombre: 'Familia Perez', facturacionEstadistica: 22.5, notaFacturacion: 'x' };
    const bruno = { id: 'cli_member_grp1_m1', tipo: 'individual', nombre: 'Bruno', telefono: '600222222', email: 'bruno@x.com', modalidad: 'Miembro Subordinado', factor: 1, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', fechaEstado: '', observacionesEstado: '', vinculacion: 'grp1', memberId: 'm1', grupoNombre: 'Familia Perez', facturacionEstadistica: 22.5, notaFacturacion: 'x' };
    const { dbClientesFinal, payload } = await ejecutarGuardarCliente({
      tabFichaActiva: 'individual', idFichaEditando: 'cli_member_grp1_m0',
      dbClientesIniciales: [grupo, ana, bruno],
      dom: {
        'cust-name': { value: 'Ana' }, 'cust-phone': { value: '600111111' }, 'cust-email': { value: 'ana@x.com' },
        'cust-mod': { value: 'Individual Plan', options: MOD_OPTIONS }, 'cust-factor': { value: '1', options: FACTOR_1_5 },
        'cust-purchase-type': { value: 'Mensualidad' }, 'cust-bono-date': { value: '' }, 'cust-color': { value: 'amber' },
        'cust-discount': { value: '15' }, 'cust-status': { value: 'activo' }, 'cust-start-date': { value: '' },
      }
    });
    const malos = valoresProblematicos(payload, 'payload');
    check('integrante de grupo: guardado sin valores problematicos', malos.length === 0, malos.join('; '));
    const anaFinal = dbClientesFinal.find(c => c.id === 'cli_member_grp1_m0');
    check('integrante con descuento: descuentoPct = 15', anaFinal.descuentoPct === 15);
    check('integrante con descuento: vinculacion preservada', anaFinal.vinculacion === 'grp1');
    check('integrante con descuento: memberId preservado', anaFinal.memberId === 'm0');
    check('integrante con descuento: modalidad sigue siendo Miembro Subordinado', anaFinal.modalidad === 'Miembro Subordinado');
    const brunoFinal = dbClientesFinal.find(c => c.id === 'cli_member_grp1_m1');
    check('grupo intacto: Bruno NO cambia (su descuento sigue en 0)', brunoFinal.descuentoPct === 0);
    const grupoFinal = dbClientesFinal.find(c => c.id === 'grp1');
    check('grupo intacto: sigue teniendo 2 integrantes en el roster', grupoFinal.integrantesObj.length === 2);
  }

  console.log('\n=== 3. CAUSA RAIZ: integrante LEGACY sin grupoNombre/fechaEstado/observacionesEstado/color/tipoCompra/factor/memberId/estadoCliente ===');
  {
    const grupoLegacy = { id: 'grp5', tipo: 'grupo', nombre: 'Grupo Legacy', modalidad: 'Grupo Reducido Plan', factor: 1, tipoCompra: 'Mensualidad', estadoCliente: 'activo', integrantesObj: [{ id: 'm0', nombre: 'Vieja Ficha', telefono: '600999999', email: 'vieja@x.com' }] };
    // Claves que literalmente NO EXISTEN en el objeto (no es que valgan '' -- no estan).
    const miembroLegacy = { id: 'cli_member_grp5_m0', tipo: 'individual', nombre: 'Vieja Ficha', telefono: '600999999', email: 'vieja@x.com', modalidad: 'Miembro Subordinado', descuentoPct: 0, vinculacion: 'grp5' };
    const { dbClientesFinal, payload } = await ejecutarGuardarCliente({
      tabFichaActiva: 'individual', idFichaEditando: 'cli_member_grp5_m0',
      dbClientesIniciales: [grupoLegacy, miembroLegacy],
      dom: {
        'cust-name': { value: 'Vieja Ficha' }, 'cust-phone': { value: '600999999' }, 'cust-email': { value: 'vieja@x.com' },
        'cust-mod': { value: 'Individual Plan', options: MOD_OPTIONS }, 'cust-factor': { value: '1', options: FACTOR_1_5 },
        'cust-purchase-type': { value: 'Mensualidad' }, 'cust-bono-date': { value: '' }, 'cust-color': { value: 'amber' },
        'cust-discount': { value: '10' }, 'cust-status': { value: 'activo' }, 'cust-start-date': { value: '' },
      }
    });
    const malos = valoresProblematicos(payload, 'payload');
    check('integrante legacy (campos ausentes): guardado SIN undefined/NaN -- este es el caso que fallaba antes del hotfix', malos.length === 0, malos.join('; '));
    const final = dbClientesFinal.find(c => c.id === 'cli_member_grp5_m0');
    check('integrante legacy: descuentoPct aplicado (10)', final.descuentoPct === 10);
    check('integrante legacy: vinculacion preservada', final.vinculacion === 'grp5');
    check('integrante legacy: campos ausentes reciben fallback seguro, no undefined', final.grupoNombre === '' && final.fechaEstado === '' && final.observacionesEstado === '' && final.color === 'amber' && final.tipoCompra === 'Mensualidad' && final.factor === 1 && final.memberId === '' && final.estadoCliente === 'activo');
  }

  console.log('\n=== 4. Payload realmente serializable por Firestore (JSON.stringify no pierde nada inesperado) ===');
  {
    const grupo = { id: 'grpX', tipo: 'grupo', nombre: 'Grupo X', modalidad: 'Grupo Reducido Bono 8', factor: 8, tipoCompra: 'Bono', fechaCompra: '2026-09-01', color: 'cyan', descuentoPct: 0, estadoCliente: 'activo', fechaEstado: '', observacionesEstado: '', integrantesObj: [{ id: 'm0', nombre: 'X', telefono: '600', email: 'x@x.com' }] };
    const miembro = { id: 'cli_member_grpX_m0', tipo: 'individual', nombre: 'X', telefono: '600', email: 'x@x.com', modalidad: 'Miembro Subordinado', factor: 8, tipoCompra: 'Bono', fechaCompra: '2026-09-01', color: 'cyan', descuentoPct: 30, estadoCliente: 'activo', fechaEstado: '', observacionesEstado: '', vinculacion: 'grpX', memberId: 'm0', grupoNombre: 'Grupo X', facturacionEstadistica: 0, notaFacturacion: 'x' };
    const { payload } = await ejecutarGuardarCliente({
      tabFichaActiva: 'individual', idFichaEditando: 'cli_member_grpX_m0',
      dbClientesIniciales: [grupo, miembro],
      dom: {
        'cust-name': { value: 'X' }, 'cust-phone': { value: '600' }, 'cust-email': { value: 'x@x.com' },
        'cust-mod': { value: 'Individual Plan', options: MOD_OPTIONS }, 'cust-factor': { value: '1', options: FACTOR_1_5 },
        'cust-purchase-type': { value: 'Mensualidad' }, 'cust-bono-date': { value: '' }, 'cust-color': { value: 'amber' },
        'cust-discount': { value: '30' }, 'cust-status': { value: 'activo' }, 'cust-start-date': { value: '' },
      }
    });
    let serializado;
    let ok = true;
    try { serializado = JSON.stringify(payload); if (typeof serializado !== 'string') ok = false; } catch (e) { ok = false; }
    check('payload Bono 8 + descuento: JSON.stringify no lanza (serializable)', ok);
    check('payload Bono 8 + descuento: no se pierden claves al serializar (mismo nº de claves antes/despues)', JSON.stringify(Object.keys(payload[1]).sort()) === JSON.stringify(Object.keys(JSON.parse(serializado)[1]).sort()));
  }

  console.log('\n=== 5. valorInvalidoParaFirestore(): detecta ANTES de intentar persistir (HOTFIX-CLIENT-SAVE-V2, red de seguridad) ===');
  {
    const sandbox = new Function(extracted + '\nreturn { valorInvalidoParaFirestore };')();
    const v = sandbox.valorInvalidoParaFirestore;
    check('detecta undefined anidado y da la ruta exacta', v({ a: { b: [1, undefined, 3] } })?.ruta === 'a.b[1]');
    check('detecta NaN', v({ x: NaN })?.motivo === 'NaN');
    check('detecta funciones', v({ f: function () {} })?.motivo === 'función');
    check('detecta referencias circulares', (() => { const o = {}; o.self = o; return v(o)?.motivo === 'referencia circular'; })());
    check('payload valido (sin problemas) -> null, no bloquea nada', v({ a: 1, b: 'x', c: [1, 2, { d: null }], e: new Date() }) === null);
    check('NO elimina ni "arregla" nada -- solo detecta (no muta el objeto de entrada)', (() => { const o = { a: undefined, b: 1 }; const copia = JSON.stringify(Object.keys(o)); v(o); return JSON.stringify(Object.keys(o)) === copia; })());
  }

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
