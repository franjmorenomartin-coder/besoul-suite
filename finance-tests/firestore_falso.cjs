// Firestore en memoria para pruebas: lo justo que usan besoul-finanzas-real.js (transacciones con
// get/set/update con FieldPath) y las suscripciones de las páginas. Imita las dos reglas que importan
// aquí: update() falla si el documento no existe y serverTimestamp() se resuelve a una hora.
'use strict';
class FieldPath { constructor(...segmentos) { this.segmentos = segmentos; } }
const SERVER_TS = { __serverTimestamp: true };
const FieldValue = { serverTimestamp: () => SERVER_TS, delete: () => ({ __delete: true }) };
const copia = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function resolverHora(v, ahora) {
  if (v === SERVER_TS || (v && v.__serverTimestamp)) return { __ts: ahora };
  if (Array.isArray(v)) return v.map(x => resolverHora(x, ahora));
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = resolverHora(v[k], ahora); }); return o; }
  return v;
}
// Como Firestore real: un mapa no puede tener claves vacías ni reservadas (__x__) ni valores undefined.
function validarCampos(v, ruta) {
  if (v === undefined) { const e = new Error(`Valor undefined en ${ruta}`); e.code = 'invalid-argument'; throw e; }
  if (v && typeof v === 'object' && !(v instanceof FieldPath)) Object.keys(v).forEach(k => {
    if (k === '' || /^__.*__$/.test(k) && !['__serverTimestamp', '__delete'].includes(k)) { const e = new Error(`Document fields must not be empty / reservado en ${ruta}`); e.code = 'invalid-argument'; throw e; }
    validarCampos(v[k], `${ruta}.${k}`);
  });
}
function crearFirestore(opciones) {
  const datos = {}; // 'coleccion/doc' -> objeto
  const o = opciones || {};
  let escrituras = 0;
  const api = {
    datos, get escrituras() { return escrituras; },
    // Hook opcional: (ruta, nuevo, anterior) => lanza para simular un rechazo de reglas.
    reglas: o.reglas || null,
    collection(col) {
      return {
        doc(id) {
          const ruta = `${col}/${id}`;
          return { id, ruta, async get() { return snap(ruta, id); } };
        },
        async get() { return { docs: Object.keys(datos).filter(r => r.startsWith(col + '/')).map(r => snap(r, r.slice(col.length + 1))) }; },
      };
    },
    async runTransaction(fn) {
      const pendientes = [];
      const tx = {
        async get(ref) { return snap(ref.ruta, ref.id); },
        set(ref, valor) { validarCampos(valor, ref.ruta); pendientes.push({ tipo: 'set', ref, valor }); },
        update(ref, ...args) { for (let i = 1; i < args.length; i += 2) validarCampos(args[i], ref.ruta); pendientes.push({ tipo: 'update', ref, args }); },
      };
      const r = await fn(tx);
      const ahora = new Date().toISOString();
      pendientes.forEach(p => {
        const anterior = datos[p.ref.ruta] ? copia(datos[p.ref.ruta]) : null;
        let nuevo;
        if (p.tipo === 'set') nuevo = resolverHora(copia(p.valor), ahora);
        else {
          if (!anterior) { const e = new Error('No document to update'); e.code = 'not-found'; throw e; }
          nuevo = copia(anterior);
          for (let i = 0; i < p.args.length; i += 2) {
            const ruta = p.args[i] instanceof FieldPath ? p.args[i].segmentos : String(p.args[i]).split('.');
            const valor = p.args[i + 1];
            let obj = nuevo;
            for (let j = 0; j < ruta.length - 1; j++) { if (!obj[ruta[j]] || typeof obj[ruta[j]] !== 'object') obj[ruta[j]] = {}; obj = obj[ruta[j]]; }
            if (valor && valor.__delete) delete obj[ruta[ruta.length - 1]];
            else obj[ruta[ruta.length - 1]] = resolverHora(copia(valor), ahora);
          }
        }
        if (api.reglas) api.reglas(p.ref.ruta, nuevo, anterior);
        datos[p.ref.ruta] = nuevo; escrituras++;
      });
      return r;
    },
  };
  function snap(ruta, id) { const d = datos[ruta]; return { id, exists: !!d, data: () => copia(d) }; }
  return api;
}
module.exports = { crearFirestore, FieldPath, FieldValue };
