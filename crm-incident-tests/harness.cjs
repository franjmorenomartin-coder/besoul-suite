// HOTFIX-CRM-DUPLICADOS-FECHA-ALTA -- harness de pruebas. Ejecuta el <script> REAL de crm.html
// (no una copia) dentro de un vm de Node, con:
//   - un DOM falso mínimo (getElementById/createElement persistentes),
//   - un reloj controlable (Date falso; todo el código -- incluido besoul-identidad.js -- lo usa),
//   - un Firestore en memoria fiel en lo que importa aquí: ids reservados con doc(), set con/sin
//     merge, transacciones con lectura previa, FieldPath/rutas con punto en update(), batch con el
//     límite REAL de 500 escrituras, y fallos inyectables (latencia, error, "commit hecho pero la
//     respuesta se perdió").
// Nunca toca Firestore real.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// ---------------------------------------------------------------- Firestore en memoria ----------
class FieldPathFalso { constructor(...s) { this.segmentos = s; } }
class FieldValueFalso { constructor(m) { this._methodName = m; } }

function crearFirestore(opts = {}) {
  const store = new Map(); // "col/id" -> data
  const fallos = []; // { coincide(op, ruta) -> bool, tipo: 'error'|'perderRespuesta', veces }
  let latenciaMs = 0;
  let idSeq = 0;
  const stats = { batches: [], transacciones: 0 };

  const esperar = () => new Promise(r => setTimeout(r, latenciaMs));
  function consumirFallo(op, ruta) {
    const f = fallos.find(x => x.veces > 0 && x.coincide(op, ruta));
    if (!f) return null;
    f.veces -= 1;
    return f.tipo;
  }
  function setRuta(obj, segs, valor) {
    let c = obj;
    for (let i = 0; i < segs.length - 1; i++) { if (typeof c[segs[i]] !== 'object' || c[segs[i]] === null) c[segs[i]] = {}; c = c[segs[i]]; }
    if (valor instanceof FieldValueFalso && valor._methodName === 'delete') { delete c[segs[segs.length - 1]]; return; }
    c[segs[segs.length - 1]] = valor instanceof FieldValueFalso ? '__serverTimestamp__' : deepClone(valor);
  }
  function limpiarSentinelas(o) {
    if (o instanceof FieldValueFalso) return '__serverTimestamp__';
    if (Array.isArray(o)) return o.map(limpiarSentinelas);
    if (o && typeof o === 'object') { const r = {}; Object.keys(o).forEach(k => { r[k] = limpiarSentinelas(o[k]); }); return r; }
    return o;
  }
  function aplicarSet(ruta, data, opciones) {
    const limpio = limpiarSentinelas(deepClone(data));
    if (opciones && opciones.merge && store.has(ruta)) store.set(ruta, { ...store.get(ruta), ...limpio });
    else store.set(ruta, limpio);
  }
  function aplicarUpdate(ruta, args) {
    const actual = deepClone(store.get(ruta) || {});
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof FieldPathFalso)) {
      Object.keys(args[0]).forEach(k => setRuta(actual, k.split('.'), args[0][k]));
    } else {
      for (let i = 0; i < args.length; i += 2) {
        const campo = args[i];
        const segs = campo instanceof FieldPathFalso ? campo.segmentos : String(campo).split('.');
        setRuta(actual, segs, args[i + 1]);
      }
    }
    store.set(ruta, actual);
  }
  function snapshot(ruta) {
    const existe = store.has(ruta);
    const id = ruta.split('/').pop();
    return { exists: existe, id, data: () => (existe ? deepClone(store.get(ruta)) : undefined) };
  }
  function docRef(col, id) {
    const ruta = `${col}/${id}`;
    return {
      id, _ruta: ruta, firestore: null,
      async get() { await esperar(); return snapshot(ruta); },
      async set(data, opciones) {
        await esperar();
        const f = consumirFallo('set', ruta);
        if (f === 'error') throw Object.assign(new Error('unavailable (inyectado)'), { code: 'unavailable' });
        aplicarSet(ruta, data, opciones);
        if (f === 'perderRespuesta') throw Object.assign(new Error('deadline-exceeded (commit hecho, respuesta perdida)'), { code: 'deadline-exceeded' });
      },
      async update(...args) { await esperar(); aplicarUpdate(ruta, args); },
    };
  }
  function colRef(col) {
    return {
      doc(id) { return docRef(col, id || `auto_${(++idSeq).toString(36)}_${Math.random().toString(36).slice(2, 8)}`); },
      async add(data) { const ref = this.doc(); await ref.set(data); return ref; },
      where() { return this; },
      onSnapshot() { return () => {}; },
      async get() { await esperar(); const docs = [...store.keys()].filter(k => k.startsWith(col + '/')).map(k => ({ id: k.split('/').pop(), data: () => deepClone(store.get(k)) })); return { docs, forEach: fn => docs.forEach(fn) }; },
    };
  }
  const db = {
    collection: colRef,
    batch() {
      const ops = [];
      return {
        set(ref, data, opciones) { ops.push([ref._ruta, data, opciones]); },
        async commit() {
          // Límite REAL de Firestore: un batch con más de 500 escrituras se rechaza entero.
          if (ops.length > 500) throw Object.assign(new Error('INVALID_ARGUMENT: maximum 500 writes allowed per request'), { code: 'invalid-argument' });
          await esperar();
          ops.forEach(([ruta, data, opciones]) => aplicarSet(ruta, data, opciones));
          stats.batches.push(ops.length);
        },
      };
    },
    async runTransaction(fn) {
      stats.transacciones += 1;
      const escrituras = [];
      const tx = {
        async get(ref) { await esperar(); return snapshot(ref._ruta); },
        set(ref, data, opciones) { escrituras.push(() => aplicarSet(ref._ruta, data, opciones)); },
        update(ref, ...args) { escrituras.push(() => aplicarUpdate(ref._ruta, args)); },
      };
      const resultado = await fn(tx);
      const rutas = escrituras.length ? ['tx'] : [];
      const f = consumirFallo('transaction', rutas.join());
      if (f === 'error') throw Object.assign(new Error('aborted (inyectado)'), { code: 'aborted' });
      escrituras.forEach(w => w());
      if (f === 'perderRespuesta') throw Object.assign(new Error('deadline-exceeded (commit hecho, respuesta perdida)'), { code: 'deadline-exceeded' });
      return resultado;
    },
  };
  return {
    db, store, stats,
    setLatencia(ms) { latenciaMs = ms; },
    fallar(op, tipo, veces = 1, filtro = () => true) { fallos.push({ coincide: (o, r) => o === op && filtro(r), tipo, veces }); },
    docs(col) { return [...store.keys()].filter(k => k.startsWith(col + '/')).map(k => ({ id: k.split('/').pop(), ...deepClone(store.get(k)) })); },
    put(col, id, data) { store.set(`${col}/${id}`, deepClone(data)); },
    get(col, id) { return deepClone(store.get(`${col}/${id}`)); },
  };
}

// ---------------------------------------------------------------- DOM falso -----------------------
function crearElemento(id) {
  const clases = new Set(['hidden']);
  const attrs = {};
  const el = {
    id, value: '', innerText: '', innerHTML: '', textContent: '', disabled: false, onclick: null, style: {}, dataset: {},
    parentElement: { style: {}, classList: { add() {}, remove() {} } },
    children: [],
    classList: {
      add: (...c) => c.forEach(x => clases.add(x)),
      remove: (...c) => c.forEach(x => clases.delete(x)),
      contains: c => clases.has(c),
      toggle: (c, on) => { if (on === undefined ? !clases.has(c) : on) clases.add(c); else clases.delete(c); },
    },
    get className() { return [...clases].join(' '); },
    set className(v) { clases.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => clases.add(x)); },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return attrs[k]; },
    appendChild(c) { el.children.push(c); return c; }, remove() {},
    scrollIntoView() {}, focus() {}, closest() { return null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    click() { if (typeof el.onclick === 'function') return el.onclick(); return undefined; },
  };
  return el;
}

// ---------------------------------------------------------------- Carga de crm.html ---------------
function cargarCRM({ ahoraISO = '2026-10-01T08:00:00.000Z', perfil = { email: 'admin@besoul.test', rol: 'admin', nombre: 'Sandra (admin)', activo: true }, fs: fsMock } = {}) {
  const mock = fsMock || crearFirestore();
  const elementos = new Map();
  const document = {
    getElementById(id) { if (!elementos.has(id)) elementos.set(id, crearElemento(id)); return elementos.get(id); },
    createElement() { return crearElemento(null); },
    addEventListener() {}, querySelectorAll() { return []; }, body: crearElemento('body'),
  };
  const alertas = [];
  const confirmaciones = [];
  const abiertos = [];
  let confirmar = true;
  let ahora = new Date(ahoraISO).getTime();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(ahora); else super(...a); }
    static now() { return ahora; }
  }
  const firebase = {
    firestore: Object.assign(() => mock.db, { FieldValue: { serverTimestamp: () => new FieldValueFalso('serverTimestamp'), delete: () => new FieldValueFalso('delete') }, FieldPath: FieldPathFalso }),
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    document, window: null, firebase, Date: FakeDate, Intl, Math, JSON, Promise, setTimeout, clearTimeout, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class { constructor(partes, o) { this.partes = partes; this.type = o && o.type; } },
    alert: m => { alertas.push(String(m)); },
    confirm: m => { confirmaciones.push(String(m)); return confirmar; },
    prompt: () => null,
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: '', pathname: '/crm.html' },
  };
  ctx.window = ctx;
  ctx.window.open = (url) => { abiertos.push(url); };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'besoul-identidad.js'), 'utf8'), ctx, { filename: 'besoul-identidad.js' });
  const html = fs.readFileSync(path.join(ROOT, 'crm.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const principal = scripts.find(s => s.includes('function guardarLead'));
  // Acceso de prueba a las variables `let` de nivel superior del propio script (mismo ámbito).
  const puente = '\n;globalThis.__get = (n) => eval(n); globalThis.__set = (n, v) => { eval(n + " = __v__"); }; ';
  vm.runInContext(principal.replace(/window\.addEventListener\('DOMContentLoaded', initFirebase\);/, '') + puente.replace('__v__', 'globalThis.__valor'), ctx, { filename: 'crm.html' });
  const set = (n, v) => { ctx.__valor = v; ctx.__set(n, v); };
  set('db', mock.db);
  set('perfil', perfil);
  set('usuario', { email: perfil.email });
  set('centros', { centro_a: { id: 'centro_a', nombre: 'Centro A' }, centro_b: { id: 'centro_b', nombre: 'Centro B' } });
  set('usuariosBesoul', [{ trainerKey: 'pta', nombre: 'Laura' }, { trainerKey: 'ptb', nombre: 'Carlos' }]);
  return {
    ctx, mock, document, alertas, confirmaciones, abiertos,
    el: id => document.getElementById(id),
    get: n => ctx.__get(n),
    set,
    setAhora(iso) { ahora = new RealDate(iso).getTime(); },
    setConfirmar(v) { confirmar = v; },
    /** Simula el onSnapshot de leads: refresca `leads` desde el store y re-aplica filtros. */
    refrescarLeads() { set('leads', mock.docs('besoulLeads')); ctx.aplicarFiltros(); },
  };
}

/** Rellena el formulario de "Nuevo lead" tal como lo haría una persona. */
function rellenarNuevoLead(h, datos = {}) {
  h.ctx.abrirModalLead();
  const d = { nombre: 'Marta Pérez', telefono: '612 345 678', email: 'marta@example.com', centro: 'centro_a', fuente: 'Instagram', estado: 'Nuevo lead', trainer: 'pta', ...datos };
  h.el('lead-nombre').value = d.nombre;
  h.el('lead-telefono').value = d.telefono;
  h.el('lead-email').value = d.email;
  h.el('lead-centro').value = d.centro;
  h.el('lead-fuente').value = d.fuente;
  h.el('lead-estado').value = d.estado;
  h.el('lead-trainer').value = d.trainer;
  if (d.fechaAltaReal) h.el('lead-fecha-alta-real').value = d.fechaAltaReal;
  if (d.fechaPrueba) h.el('lead-fecha-prueba').value = d.fechaPrueba;
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

module.exports = { crearFirestore, cargarCRM, rellenarNuevoLead, esperar, crearElemento, FieldPathFalso, FieldValueFalso, ROOT };
