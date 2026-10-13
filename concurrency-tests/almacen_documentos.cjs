// ARQ-V1-MIGRACION-IMPL: servidor Firestore FALSO de documentos independientes, para que las
// baterías de concurrencia existentes (escritas para el documento único) validen el guardado
// nuevo (besoul-datos.js guardarScope) con los MISMOS escenarios. Transacciones con control
// optimista real: si un documento leído cambia antes del commit, la transacción se repite con los
// datos nuevos (como Firestore). El estado se expone en la forma clásica para las aserciones.
const D = require('../besoul-datos.js');
const clon = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function crearServidorDocumentos(estadoInicialLegado) {
  const docs = new Map(); // "col/id" -> { data, version }
  let version = 0;
  let escrituras = 0;
  const colDe = nombre => Object.keys(D.COL).find(k => D.COL[k] === nombre);
  function cargarLegado(legado) {
    const nuevos = D.docsDesdeLegado(legado || {}).docs;
    const vistos = new Set();
    nuevos.forEach(d => {
      const k = `${D.COL[d.col]}/${d.id}`; vistos.add(k);
      const previo = docs.get(k);
      if (!previo || !D.igual(previo.data, d.data)) docs.set(k, { data: clon(d.data), version: ++version });
    });
    docs.forEach((v, k) => { if (!vistos.has(k)) docs.delete(k); });
  }
  cargarLegado(estadoInicialLegado);
  function agrupados() {
    const g = { semanas: {}, clientes: {}, trainers: {}, historico: {}, notas: {}, legado: {}, config: {} };
    docs.forEach((v, k) => { const [nombre, id] = [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1)]; const c = colDe(nombre); if (c) g[c][id] = clon(v.data); });
    return g;
  }
  const quitarFieldValues = data => JSON.parse(JSON.stringify(data, (k, v) => (v && typeof v === 'object' && v._methodName ? `<${v._methodName}>` : v)));
  const firestore = {
    collection: nombre => ({ doc: id => ({ path: `${nombre}/${id}`, id }) }),
    async runTransaction(fn) {
      for (let intento = 0; intento < 5; intento++) {
        const leidos = new Map(); const pendientes = [];
        const tx = {
          async get(ref) { const v = docs.get(ref.path); leidos.set(ref.path, v ? v.version : 0); return { exists: !!v, data: () => clon(v && v.data) }; },
          set(ref, data) { pendientes.push([ref.path, data]); },
          update(ref, data) { pendientes.push([ref.path, data]); },
        };
        const r = await fn(tx);
        await Promise.resolve();
        const cambiado = [...leidos].some(([p, ver]) => { const v = docs.get(p); return (v ? v.version : 0) !== ver; });
        if (cambiado) continue; // otro guardó entre medias: repetir con los datos nuevos
        pendientes.forEach(([p, data]) => { docs.set(p, { data: quitarFieldValues(data), version: ++version }); });
        if (pendientes.length) escrituras++;
        return r;
      }
      throw Object.assign(new Error('aborted'), { code: 'aborted' });
    },
  };
  const sincronizador = { listo: () => true, docs: () => agrupados() };
  return {
    ref: { arquitectura: 'documentos', firestore, sincronizador, path: 'besoulSuite/agenda' },
    estadoActual() { return clon(D.legadoDesdeDocs(agrupados())); },
    escrituras() { return escrituras; },
    // "Otra sesión" guarda directamente (en la forma clásica de un entrenador).
    escribirDesdeOtraSesion(campo, trainerKey, valor) {
      const legado = D.legadoDesdeDocs(agrupados());
      if (!legado[campo]) legado[campo] = {};
      legado[campo][trainerKey] = clon(valor);
      cargarLegado(legado);
    },
    documentos: () => agrupados(),
  };
}
module.exports = { crearServidorDocumentos };
