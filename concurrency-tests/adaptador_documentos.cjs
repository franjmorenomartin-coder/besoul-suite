// ARQ-V1-MIGRACION-IMPL: adaptador para los arneses de pruebas que simulaban el documento único
// (notices-tests, availability-tests). El estado sigue expuesto en la forma clásica para sus
// aserciones, pero las transacciones del guardado nuevo leen y escriben DOCUMENTOS
// INDEPENDIENTES (derivados de ese estado con la misma transformación que usa el migrador).
const D = require('../besoul-datos.js');
const clon = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sinFieldValues = data => JSON.parse(JSON.stringify(data, (k, v) => (v && typeof v === 'object' && v._methodName ? `<${v._methodName}>` : v)));
const colDe = nombre => Object.keys(D.COL).find(k => D.COL[k] === nombre);

function firestoreDeDocumentos(getEstado, setEstado, programar, notificar, consumirFallo) {
  return {
    collection: nombre => ({ doc: id => ({ path: `${nombre}/${id}`, id }) }),
    runTransaction(fn) {
      return new Promise((resolve, reject) => {
        const docs = new Map(D.docsDesdeLegado(getEstado() || {}).docs.map(d => [`${D.COL[d.col]}/${d.id}`, d.data]));
        const pendientes = [];
        const tx = {
          get(ref) { return new Promise(r => programar(() => { const d = docs.get(ref.path); r({ exists: !!d, data: () => clon(d) }); })); },
          set(ref, data) { pendientes.push([ref.path, data]); },
        };
        fn(tx).then(res => {
          if (pendientes.length && consumirFallo && consumirFallo()) {
            const err = new Error('simulated-network-error'); err.code = 'unavailable';
            programar(() => reject(err)); return;
          }
          try {
            if (pendientes.length) {
              pendientes.forEach(([p, data]) => docs.set(p, sinFieldValues(data)));
              const g = { semanas: {}, clientes: {}, trainers: {}, historico: {}, notas: {}, legado: {}, config: {} };
              docs.forEach((data, p) => { const c = colDe(p.slice(0, p.indexOf('/'))); if (c) g[c][p.slice(p.indexOf('/') + 1)] = data; });
              setEstado(D.legadoDesdeDocs(g));
            }
          } catch (e) { programar(() => reject(e)); return; }
          programar(() => { if (pendientes.length) notificar(); resolve(res); });
        }).catch(err => programar(() => reject(err)));
      });
    },
  };
}
module.exports = { firestoreDeDocumentos };
