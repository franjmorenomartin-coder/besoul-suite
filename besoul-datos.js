// BESOUL V1 — Capa de datos de la Agenda sobre documentos independientes (ARQ-V1-MIGRACION-IMPL).
//
// Sustituye al documento monolítico besoulSuite/agenda (límite de 1 MiB, contención, todo el
// gimnasio en cada lectura). Mantiene EXACTAMENTE la forma en memoria que ya usa toda la app
// ({clientes, agenda, pruebasCRM, disponibilidadReservas, historicoClientes, notas,
// trainerActividades}) para no tocar la lógica de negocio: solo cambia dónde y cómo se guarda.
//
// Colecciones (ver docs/arquitectura-firestore/06_IMPLEMENTACION.md):
//   besoulAgendaSemanas/{tk}__{lunes}   sesiones, pruebas CRM, excepciones y slots ocultos de UNA
//                                       semana de UN entrenador (tamaño acotado por los huecos físicos)
//   besoulClientes/{clientId}           una ficha (lápida "eliminado" en vez de borrar)
//   besoulTrainers/{tk}                 disponibilidad semanal/configuración y actividades
//   besoulHistoricoClientes/{tk}__{cid}__{mes}  resumen mensual congelado de un cliente
//   besoulNotas/{clave}                 una nota de hueco ("tk__fecha_HH:MM")
//   besoulAgendaLegado/raiz             campos raíz sueltos del documento antiguo (solo admin)
//
// Todos los documentos llevan trainerKey (aislamiento por reglas), rev (control de versión,
// exigido por reglas: rev nuevo = rev anterior + 1) y actualizadoEn = hora del SERVIDOR (exigido
// por reglas). Gracias a actualizadoEn, cada dispositivo descarga solo lo que ha cambiado desde
// su última sincronización (sincronización incremental), en vez de todo el histórico.
//
// UMD: se carga con <script> en el navegador (window.BesoulDatos) y con require() en Node (tests
// y migrador). No depende del SDK: recibe la instancia de Firestore y las clases que necesita.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.BesoulDatos = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COL = {
    semanas: 'besoulAgendaSemanas',
    clientes: 'besoulClientes',
    trainers: 'besoulTrainers',
    historico: 'besoulHistoricoClientes',
    notas: 'besoulNotas',
    legado: 'besoulAgendaLegado',
    config: 'besoulAgendaConfig',
  };
  // Configuración global de actividades (Finanzas la escribe, la Agenda la lee también para PT).
  const CAMPOS_CONFIG = ['catalogoActividades', 'tarifasActividadVersiones', 'repartoActividadVersiones'];
  const COLECCIONES_SINCRONIZADAS = ['semanas', 'clientes', 'trainers', 'historico', 'notas'];
  const ESQUEMA = 1;
  const CAMPOS_RAIZ_CONOCIDOS = ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes', 'notas', 'trainerActividades', 'catalogoActividades', 'tarifasActividadVersiones', 'repartoActividadVersiones'];
  const SUBMAPAS_DIA = ['excepciones', 'bloqueos'];
  const RE_CLAVE = /^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})$/;
  const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

  // ---------------------------------------------------------------- utilidades puras
  const esPlano = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const esTimestamp = v => !!v && typeof v === 'object' && typeof v.toMillis === 'function';
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (esTimestamp(v)) return { __ts: v.toMillis() };
    if (v && typeof v === 'object' && v._methodName) return `<FieldValue:${v._methodName}>`;
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) o[k] = canon(v[k]); }); return o; }
    return v;
  }
  const igual = (a, b) => JSON.stringify(canon(a === undefined ? null : a)) === JSON.stringify(canon(b === undefined ? null : b));
  const copia = v => (v === undefined ? undefined : clonar(v));
  function clonar(v) {
    if (Array.isArray(v)) return v.map(clonar);
    if (esPlano(v)) { const o = {}; Object.keys(v).forEach(k => { o[k] = clonar(v[k]); }); return o; }
    return v;
  }

  function lunesDe(fecha) {
    const [y, m, d] = String(fecha).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  }
  const fechaDeClave = clave => { const m = RE_CLAVE.exec(clave); return m ? m[1] : null; };
  const idSeguro = s => String(s).replace(/%/g, '%25').replace(/\//g, '%2F');
  const idSemana = (tk, lunes) => `${idSeguro(tk)}__${lunes}`;
  const idHistorico = (tk, cid, mes) => `${idSeguro(tk)}__${idSeguro(cid)}__${idSeguro(mes)}`;
  const idCliente = cid => idSeguro(cid);
  const idNota = clave => idSeguro(clave);
  function trainerDeNota(clave) {
    const i = String(clave).indexOf('__');
    return i > 0 ? String(clave).slice(0, i) : null;
  }

  // ---------------------------------------------------------------- legado -> documentos
  // Partes de UN entrenador (lo que antes eran clientes.<tk>, agenda.<tk>, ...) -> contenidos de
  // documento. Lo usan el migrador y el guardado: una sola definición de la forma de cada documento.
  // leadsPrueba: índice de los leads con prueba CRM en esta semana (para que CRM encuentre sus
  // pruebas con una consulta, sin descargar todas las agendas).
  function leadsPruebaDe(partes) {
    const ids = new Set();
    ['sesiones', 'pruebasCRM'].forEach(k => Object.values(partes[k] || {}).forEach(v => { if (v && typeof v === 'object' && v.leadId && (v.esPruebaCRM === true || k === 'pruebasCRM')) ids.add(String(v.leadId)); }));
    return [...ids].sort();
  }
  function contenidoSemana(tk, lunes, partes) {
    return {
      trainerKey: tk, semana: lunes,
      sesiones: partes.sesiones || {}, pruebasCRM: partes.pruebasCRM || {},
      excepciones: partes.excepciones || {}, bloqueos: partes.bloqueos || {},
      leadsPrueba: leadsPruebaDe(partes),
      esquema: ESQUEMA,
    };
  }
  function contenidoCliente(tk, ficha, orden) { return { trainerKey: tk, clienteId: ficha.id, leadId: ficha.leadId ? String(ficha.leadId) : null, orden, ficha, eliminado: false, esquema: ESQUEMA }; }
  function contenidoHistorico(tk, cid, mes, datos) { return { trainerKey: tk, clienteId: cid, mes, datos, eliminado: false, esquema: ESQUEMA }; }
  function contenidoNota(clave, texto) { return { clave, trainerKey: trainerDeNota(clave), texto: texto || '', eliminado: !texto, esquema: ESQUEMA }; }

  // Disponibilidad: lo que no es de un día concreto (semanal, recurrenteSemanal, actualizadoEn...)
  // va al documento del entrenador; excepciones[fecha] y bloqueos[fecha] van a su semana.
  function dispGeneral(disp) {
    const g = {};
    Object.keys(disp || {}).forEach(k => { if (!SUBMAPAS_DIA.includes(k) || !esPlano(disp[k])) g[k] = disp[k]; });
    return g;
  }

  function docsDesdeLegado(agenda) {
    const a = agenda || {};
    const docs = [];
    const semanas = new Map();
    const trainers = new Map();
    const noTransformable = [];
    const semana = (tk, fecha) => {
      const lunes = lunesDe(fecha);
      const id = idSemana(tk, lunes);
      if (!semanas.has(id)) semanas.set(id, { tk, lunes, partes: { sesiones: {}, pruebasCRM: {}, excepciones: {}, bloqueos: {} } });
      return semanas.get(id).partes;
    };
    const trainer = tk => {
      if (!trainers.has(tk)) trainers.set(tk, { trainerKey: tk, presencia: {}, disponibilidad: null, submapasDisp: {}, actividades: null, historicoSinMeses: [], esquema: ESQUEMA });
      return trainers.get(tk);
    };
    Object.keys(a.agenda || {}).forEach(tk => {
      trainer(tk).presencia.agenda = true;
      Object.keys(a.agenda[tk] || {}).forEach(clave => {
        const f = fechaDeClave(clave);
        if (!f) { noTransformable.push(`agenda.${tk}.${clave}`); return; }
        semana(tk, f).sesiones[clave] = a.agenda[tk][clave];
      });
    });
    Object.keys(a.pruebasCRM || {}).forEach(tk => {
      trainer(tk).presencia.pruebasCRM = true;
      Object.keys(a.pruebasCRM[tk] || {}).forEach(clave => {
        const f = fechaDeClave(clave);
        if (!f) { noTransformable.push(`pruebasCRM.${tk}.${clave}`); return; }
        semana(tk, f).pruebasCRM[clave] = a.pruebasCRM[tk][clave];
      });
    });
    Object.keys(a.disponibilidadReservas || {}).forEach(tk => {
      const disp = a.disponibilidadReservas[tk] || {};
      const t = trainer(tk);
      t.presencia.disponibilidadReservas = true;
      t.disponibilidad = dispGeneral(disp);
      SUBMAPAS_DIA.forEach(sub => {
        if (!esPlano(disp[sub])) return;
        t.submapasDisp[sub] = true;
        Object.keys(disp[sub]).forEach(fecha => {
          if (!RE_FECHA.test(fecha)) { noTransformable.push(`disponibilidadReservas.${tk}.${sub}.${fecha}`); return; }
          semana(tk, fecha)[sub][fecha] = disp[sub][fecha];
        });
      });
    });
    Object.keys(a.clientes || {}).forEach(tk => {
      trainer(tk).presencia.clientes = true;
      (Array.isArray(a.clientes[tk]) ? a.clientes[tk] : []).forEach((ficha, orden) => {
        if (!ficha || !ficha.id) { noTransformable.push(`clientes.${tk}[${orden}]`); return; }
        docs.push({ col: 'clientes', id: idCliente(ficha.id), data: contenidoCliente(tk, ficha, orden) });
      });
      if (!Array.isArray(a.clientes[tk])) noTransformable.push(`clientes.${tk} (no es una lista)`);
    });
    Object.keys(a.historicoClientes || {}).forEach(tk => {
      const t = trainer(tk);
      t.presencia.historicoClientes = true;
      Object.keys(a.historicoClientes[tk] || {}).forEach(cid => {
        const meses = a.historicoClientes[tk][cid] || {};
        if (!Object.keys(meses).length) t.historicoSinMeses.push(cid);
        Object.keys(meses).forEach(mes => docs.push({ col: 'historico', id: idHistorico(tk, cid, mes), data: contenidoHistorico(tk, cid, mes, meses[mes]) }));
      });
    });
    Object.keys(a.trainerActividades || {}).forEach(tk => {
      const t = trainer(tk);
      t.presencia.trainerActividades = true;
      t.actividades = a.trainerActividades[tk];
    });
    Object.keys(a.notas || {}).forEach(clave => docs.push({ col: 'notas', id: idNota(clave), data: contenidoNota(clave, a.notas[clave]) }));
    semanas.forEach((s, id) => docs.push({ col: 'semanas', id, data: contenidoSemana(s.tk, s.lunes, s.partes) }));
    trainers.forEach((t, tk) => docs.push({ col: 'trainers', id: idSeguro(tk), data: t }));
    const camposConfig = {};
    CAMPOS_CONFIG.forEach(k => { if (k in a) camposConfig[k] = a[k]; });
    docs.push({ col: 'config', id: 'global', data: { campos: camposConfig, esquema: ESQUEMA } });
    const camposRaiz = {};
    Object.keys(a).forEach(k => { if (!CAMPOS_RAIZ_CONOCIDOS.includes(k)) camposRaiz[k] = a[k]; });
    if (!a.notas) camposRaiz.__sinNotas = true;
    // Campos raíz clásicos que el documento original NO tenía (para reconstruirlo exactamente).
    const ausentes = ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes', 'trainerActividades'].filter(k => !(k in a));
    if (ausentes.length) camposRaiz.__ausentes = ausentes;
    docs.push({ col: 'legado', id: 'raiz', data: { camposRaiz, esquema: ESQUEMA } });
    return { docs, noTransformable };
  }

  // ---------------------------------------------------------------- documentos -> legado
  // docs: { semanas: {id: data}, clientes: {...}, trainers, historico, notas, legado }
  function legadoDesdeDocs(docs, opciones) {
    const op = opciones || {};
    const d = docs || {};
    const out = { clientes: {}, agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, historicoClientes: {}, notas: {}, trainerActividades: {} };
    const asegurar = (campo, tk, vacio) => { if (out[campo][tk] === undefined) out[campo][tk] = vacio; return out[campo][tk]; };
    Object.values(d.trainers || {}).forEach(t => {
      const tk = t.trainerKey;
      const p = t.presencia || {};
      if (p.agenda) asegurar('agenda', tk, {});
      if (p.pruebasCRM) asegurar('pruebasCRM', tk, {});
      if (p.clientes) asegurar('clientes', tk, []);
      if (p.historicoClientes) asegurar('historicoClientes', tk, {});
      (t.historicoSinMeses || []).forEach(cid => { asegurar('historicoClientes', tk, {})[cid] = asegurar('historicoClientes', tk, {})[cid] || {}; });
      if (p.trainerActividades) out.trainerActividades[tk] = copia(t.actividades);
      if (p.disponibilidadReservas || t.disponibilidad) {
        const disp = asegurar('disponibilidadReservas', tk, {});
        Object.assign(disp, copia(t.disponibilidad || {}));
        Object.keys(t.submapasDisp || {}).forEach(sub => { if (t.submapasDisp[sub]) disp[sub] = disp[sub] || {}; });
      }
    });
    Object.values(d.semanas || {}).forEach(s => {
      const tk = s.trainerKey;
      Object.keys(s.sesiones || {}).forEach(clave => { asegurar('agenda', tk, {})[clave] = copia(s.sesiones[clave]); });
      Object.keys(s.pruebasCRM || {}).forEach(clave => { asegurar('pruebasCRM', tk, {})[clave] = copia(s.pruebasCRM[clave]); });
      SUBMAPAS_DIA.forEach(sub => Object.keys(s[sub] || {}).forEach(fecha => {
        const disp = asegurar('disponibilidadReservas', tk, {});
        if (!disp[sub]) disp[sub] = {};
        disp[sub][fecha] = copia(s[sub][fecha]);
      }));
    });
    const porTrainer = {};
    Object.values(d.clientes || {}).forEach(c => {
      if (c.eliminado) return;
      (porTrainer[c.trainerKey] = porTrainer[c.trainerKey] || []).push(c);
    });
    Object.keys(porTrainer).forEach(tk => {
      porTrainer[tk].sort((x, y) => (x.orden - y.orden) || String(x.clienteId).localeCompare(String(y.clienteId)));
      out.clientes[tk] = porTrainer[tk].map(c => copia(c.ficha));
    });
    Object.values(d.historico || {}).forEach(h => {
      if (h.eliminado) return;
      const t = asegurar('historicoClientes', h.trainerKey, {});
      (t[h.clienteId] = t[h.clienteId] || {})[h.mes] = copia(h.datos);
    });
    Object.values(d.notas || {}).forEach(n => { if (!n.eliminado && n.texto) out.notas[n.clave] = n.texto; });
    const config = (d.config || {}).global;
    if (config && config.campos) CAMPOS_CONFIG.forEach(k => { if (k in config.campos) out[k] = copia(config.campos[k]); });
    const legado = (d.legado || {}).raiz;
    if (legado && legado.camposRaiz) {
      Object.keys(legado.camposRaiz).forEach(k => { if (k !== '__sinNotas' && k !== '__ausentes') out[k] = copia(legado.camposRaiz[k]); });
      if (legado.camposRaiz.__sinNotas && !Object.keys(out.notas).length) delete out.notas;
      (legado.camposRaiz.__ausentes || []).forEach(k => { if (out[k] && !Object.keys(out[k]).length) delete out[k]; });
    }
    if (op.soloPresentes) {
      ['trainerActividades'].forEach(k => { if (!Object.keys(out[k]).length && !(legado && 'trainerActividades' in (legado.camposRaiz || {}))) delete out[k]; });
    }
    return out;
  }

  // Agrupa una lista [{col,id,data}] en el mapa por colección que usa legadoDesdeDocs().
  function agrupar(lista) {
    const d = { semanas: {}, clientes: {}, trainers: {}, historico: {}, notas: {}, legado: {}, config: {} };
    lista.forEach(x => { d[x.col][x.id] = x.data; });
    return d;
  }

  // Comparación de integridad: devuelve la lista de diferencias (ruta) entre dos valores.
  function diferencias(a, b, ruta, salida, limite) {
    const out = salida || [];
    const lim = limite || 200;
    if (out.length >= lim) return out;
    if (igual(a, b)) return out;
    const ta = Array.isArray(a) ? 'array' : typeof a, tb = Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb || a === null || b === null || ta !== 'object' && ta !== 'array') { out.push(ruta || '(raíz)'); return out; }
    if (ta === 'array') {
      if (a.length !== b.length) out.push(`${ruta} (longitud ${a.length} != ${b.length})`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) diferencias(a[i], b[i], `${ruta}[${i}]`, out, lim);
      return out;
    }
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => diferencias(a[k], b[k], ruta ? `${ruta}.${k}` : k, out, lim));
    return out;
  }

  // ---------------------------------------------------------------- consumo (instrumentación)
  function crearContador() {
    const c = { lecturas: 0, escrituras: 0, transacciones: 0, consultas: 0, listenersActivos: 0, detalle: {} };
    c.sumar = (tipo, n, etiqueta) => {
      c[tipo] += n;
      if (etiqueta) { const k = `${tipo}:${etiqueta}`; c.detalle[k] = (c.detalle[k] || 0) + n; }
    };
    c.instantanea = () => ({ lecturas: c.lecturas, escrituras: c.escrituras, transacciones: c.transacciones, consultas: c.consultas, listenersActivos: c.listenersActivos, detalle: { ...c.detalle } });
    c.reiniciar = () => { c.lecturas = c.escrituras = c.transacciones = c.consultas = 0; c.detalle = {}; };
    return c;
  }
  const consumo = crearContador();

  // ---------------------------------------------------------------- caché local (solo servidor)
  // Guarda ÚNICAMENTE documentos recibidos del servidor, con su actualizadoEn. Nunca se usa para
  // dar por confirmado nada: la app solo permite guardar tras sincronizar con el servidor.
  function cacheMemoria() {
    const m = new Map();
    return { async leer(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async escribir(k, v) { m.set(k, JSON.stringify(v)); }, async borrar(k) { m.delete(k); }, async borrarTodo() { m.clear(); } };
  }
  function cacheIndexedDB(nombre) {
    const abrir = () => new Promise((ok, ko) => {
      const r = indexedDB.open(nombre || 'besoul-datos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const op = (modo, fn) => abrir().then(db => new Promise((ok, ko) => {
      const tx = db.transaction('kv', modo);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { ok(req && req.result); db.close(); };
      tx.onerror = () => { ko(tx.error); db.close(); };
    }));
    return {
      leer: k => op('readonly', s => s.get(k)).then(v => v || null).catch(() => null),
      escribir: (k, v) => op('readwrite', s => s.put(v, k)).catch(() => null),
      borrar: k => op('readwrite', s => s.delete(k)).catch(() => null),
      borrarTodo: () => op('readwrite', s => s.clear()).catch(() => null),
    };
  }
  // Codificación de valores del SDK para la caché (Timestamp <-> marca serializable).
  function codificar(v) {
    if (Array.isArray(v)) return v.map(codificar);
    if (esTimestamp(v)) return { __bsTs: [v.seconds, v.nanoseconds] };
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = codificar(v[k]); }); return o; }
    return v;
  }
  function decodificar(v, Timestamp) {
    if (Array.isArray(v)) return v.map(x => decodificar(x, Timestamp));
    if (v && typeof v === 'object') {
      if (Array.isArray(v.__bsTs) && Object.keys(v).length === 1) return Timestamp ? new Timestamp(v.__bsTs[0], v.__bsTs[1]) : v;
      const o = {}; Object.keys(v).forEach(k => { o[k] = decodificar(v[k], Timestamp); }); return o;
    }
    return v;
  }
  const millisDe = v => (esTimestamp(v) ? v.toMillis() : 0);

  // ---------------------------------------------------------------- sincronización incremental
  // alcance: { trainerKey } para un PT (o un admin que limita la carga) o { todos: true } (admin).
  // Una consulta por colección: "documentos de mi alcance con actualizadoEn >= última marca".
  // Primera vez en un dispositivo: marca 0 -> todo lo del alcance. Después: solo lo cambiado.
  function crearSincronizador(cfg) {
    const { firestore, Timestamp, alcance, cache, claveCache, onDatos, onEstado, onError } = cfg;
    const contador = cfg.contador || consumo;
    const docs = { semanas: {}, clientes: {}, trainers: {}, historico: {}, notas: {}, legado: {}, config: {} };
    const marcas = { semanas: 0, clientes: 0, trainers: 0, historico: 0, notas: 0 };
    const servidorListo = {};
    let unsubs = [];
    let parado = false;
    let temporizadorCache = null;
    let emitido = false;

    function consulta(col) {
      let q = firestore.collection(COL[col]);
      if (alcance && alcance.trainerKey) q = q.where('trainerKey', '==', alcance.trainerKey);
      return q.where('actualizadoEn', '>=', Timestamp.fromMillis(marcas[col]));
    }
    function persistir() {
      if (!cache || !claveCache) return;
      clearTimeout(temporizadorCache);
      temporizadorCache = setTimeout(() => {
        cache.escribir(claveCache, { version: ESQUEMA, marcas: { ...marcas }, docs: codificar(docs) });
      }, 500);
    }
    function emitir(desdeServidor) {
      const todos = COLECCIONES_SINCRONIZADAS.every(c => servidorListo[c]) && servidorListo.config && (!alcance || !alcance.todos || servidorListo.legado);
      if (desdeServidor && !todos) return;
      if (!desdeServidor && emitido) return;
      if (desdeServidor) emitido = true;
      onDatos && onDatos(legadoDesdeDocs(docs), { desdeServidor, docs });
    }
    async function iniciar() {
      if (cache && claveCache) {
        const guardado = await cache.leer(claveCache);
        if (guardado && guardado.version === ESQUEMA && guardado.docs) {
          const dec = decodificar(guardado.docs, Timestamp);
          Object.keys(docs).forEach(c => Object.assign(docs[c], dec[c] || {}));
          Object.assign(marcas, guardado.marcas || {});
          // Datos de la caché: se pintan como "pendiente de sincronizar", nunca como confirmados.
          emitir(false);
        }
      }
      if (parado) return;
      onEstado && onEstado('sincronizando');
      COLECCIONES_SINCRONIZADAS.forEach(col => {
        contador.sumar('consultas', 1, col);
        contador.listenersActivos++;
        const unsub = consulta(col).onSnapshot({ includeMetadataChanges: true }, snap => {
          if (snap.metadata.fromCache) { onEstado && onEstado('cache'); return; }
          const cambios = snap.docChanges();
          // Facturación de Firestore: cada documento recibido del servidor = 1 lectura; una
          // consulta sin resultados = 1 lectura.
          if (!servidorListo[col]) contador.sumar('lecturas', Math.max(1, cambios.length), `inicial:${col}`);
          else if (cambios.length) contador.sumar('lecturas', cambios.length, `cambio:${col}`);
          cambios.forEach(ch => {
            const data = ch.doc.data();
            if (ch.type === 'removed') return; // actualizadoEn solo crece: no sale de la consulta
            docs[col][ch.doc.id] = data;
            marcas[col] = Math.max(marcas[col], millisDe(data.actualizadoEn));
          });
          const primera = !servidorListo[col];
          servidorListo[col] = true;
          if (cambios.length || primera) { persistir(); if (emitido || primera) emitir(true); }
          onEstado && onEstado('ok');
        }, err => {
          onEstado && onEstado('error');
          onError && onError(err, col);
        });
        unsubs.push(() => { contador.listenersActivos--; unsub(); });
      });
      // Configuración global de actividades: un único documento con listener (1 lectura por cambio).
      contador.sumar('consultas', 1, 'config');
      contador.listenersActivos++;
      const unsubConfig = firestore.collection(COL.config).doc('global').onSnapshot(snap => {
        if (snap.metadata && snap.metadata.fromCache) return;
        contador.sumar('lecturas', 1, servidorListo.config ? 'cambio:config' : 'inicial:config');
        if (snap.exists) docs.config.global = snap.data(); else delete docs.config.global;
        const primera = !servidorListo.config;
        servidorListo.config = true;
        persistir();
        if (emitido || primera) emitir(true);
      }, err => { servidorListo.config = true; onError && onError(err, 'config'); emitir(true); });
      unsubs.push(() => { contador.listenersActivos--; unsubConfig(); });
      if (alcance && alcance.todos) {
        contador.sumar('consultas', 1, 'legado');
        firestore.collection(COL.legado).doc('raiz').get().then(s => {
          contador.sumar('lecturas', 1, 'inicial:legado');
          if (s.exists) docs.legado.raiz = s.data();
          servidorListo.legado = true;
          emitir(true);
        }).catch(err => { servidorListo.legado = true; onError && onError(err, 'legado'); emitir(true); });
      }
    }
    return {
      iniciar,
      parar() { parado = true; unsubs.forEach(u => { try { u(); } catch (e) { /* ya cancelada */ } }); unsubs = []; clearTimeout(temporizadorCache); },
      docs: () => docs,
      listo: () => emitido,
      // Tras una transacción confirmada, sus documentos se incorporan ya (el listener los traerá
      // igualmente; así la pantalla no espera a ese eco para mostrar lo confirmado).
      incorporar(lista) { lista.forEach(x => { docs[x.col][x.id] = x.data; }); },
    };
  }

  // ---------------------------------------------------------------- guardado transaccional
  // Equivalente, con documentos independientes, a la transacción del documento monolítico:
  //   base     = lo que esta pantalla sabía del servidor para ESTE entrenador
  //   local    = memoria (base + cambios de esta pantalla)
  //   servidor = base con los documentos AFECTADOS releídos dentro de la transacción
  // La fusión (fusionarCampoTresVias de la Agenda, la misma de siempre) decide; se escriben solo
  // los documentos cuyo contenido cambia, con rev+1 y hora del servidor. Ningún cambio ajeno ya
  // confirmado se pisa: si otro tocó el MISMO elemento, conflicto y no se escribe nada.
  function mapaPorId(lista) {
    const m = new Map();
    (Array.isArray(lista) ? lista : []).forEach((f, i) => { if (f && f.id) m.set(String(f.id), { f, i }); });
    return m;
  }
  function clavesDistintas(a, b) {
    const s = new Set();
    new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach(k => { if (!igual((a || {})[k], (b || {})[k])) s.add(k); });
    return s;
  }
  function afectadosScope(tk, base, local, notasTocadas) {
    const semanas = new Set(), clientes = new Set(), historico = new Set();
    let trainer = false;
    ['agenda', 'pruebasCRM'].forEach(campo => clavesDistintas(base[campo], local[campo]).forEach(clave => {
      const f = fechaDeClave(clave); if (f) semanas.add(lunesDe(f));
    }));
    const db = base.disponibilidadReservas || {}, dl = local.disponibilidadReservas || {};
    SUBMAPAS_DIA.forEach(sub => clavesDistintas(db[sub], dl[sub]).forEach(f => { if (RE_FECHA.test(f)) semanas.add(lunesDe(f)); }));
    if (!igual(dispGeneral(db), dispGeneral(dl))) trainer = true;
    const mb = mapaPorId(base.clientes), ml = mapaPorId(local.clientes);
    new Set([...mb.keys(), ...ml.keys()]).forEach(id => { if (!igual(mb.has(id) ? mb.get(id).f : null, ml.has(id) ? ml.get(id).f : null)) clientes.add(id); });
    const hb = base.historicoClientes || {}, hl = local.historicoClientes || {};
    new Set([...Object.keys(hb), ...Object.keys(hl)]).forEach(cid => clavesDistintas(hb[cid], hl[cid]).forEach(mes => historico.add(`${cid}\u0000${mes}`)));
    return { semanas, clientes, historico, trainer, notas: new Set(notasTocadas || []) };
  }

  // Sustituye en una vista del entrenador (forma legado de UN tk) las partes de los documentos
  // releídos. Devuelve una vista nueva (no muta la entrada).
  function vistaConDocs(tk, vista, frescos) {
    const v = clonar(vista || {});
    v.agenda = v.agenda || {}; v.pruebasCRM = v.pruebasCRM || {};
    v.disponibilidadReservas = v.disponibilidadReservas || {}; v.historicoClientes = v.historicoClientes || {};
    v.clientes = Array.isArray(v.clientes) ? v.clientes : [];
    frescos.semanas.forEach(({ lunes, data }) => {
      const enSemana = clave => { const f = fechaDeClave(clave); return f && lunesDe(f) === lunes; };
      ['agenda', 'pruebasCRM'].forEach(campo => {
        Object.keys(v[campo]).forEach(clave => { if (enSemana(clave)) delete v[campo][clave]; });
        const origen = data ? (campo === 'agenda' ? data.sesiones : data.pruebasCRM) : null;
        Object.keys(origen || {}).forEach(clave => { v[campo][clave] = clonar(origen[clave]); });
      });
      SUBMAPAS_DIA.forEach(sub => {
        const disp = v.disponibilidadReservas;
        Object.keys(disp[sub] || {}).forEach(f => { if (RE_FECHA.test(f) && lunesDe(f) === lunes) delete disp[sub][f]; });
        Object.keys((data && data[sub]) || {}).forEach(f => { if (!disp[sub]) disp[sub] = {}; disp[sub][f] = clonar(data[sub][f]); });
      });
    });
    if (frescos.trainer) {
      const disp = v.disponibilidadReservas;
      const sub = {}; SUBMAPAS_DIA.forEach(s => { if (disp[s]) sub[s] = disp[s]; });
      const general = frescos.trainer.data ? (frescos.trainer.data.disponibilidad || {}) : {};
      v.disponibilidadReservas = { ...clonar(general), ...sub };
    }
    frescos.clientes.forEach(({ id, data }) => {
      const i = v.clientes.findIndex(f => f && String(f.id) === id);
      const vivo = data && !data.eliminado && data.trainerKey === tk ? clonar(data.ficha) : null;
      if (i >= 0 && vivo) v.clientes[i] = vivo;
      else if (i >= 0) v.clientes.splice(i, 1);
      else if (vivo) v.clientes.push(vivo);
    });
    frescos.historico.forEach(({ cid, mes, data }) => {
      const h = v.historicoClientes;
      if (data && !data.eliminado) { (h[cid] = h[cid] || {})[mes] = clonar(data.datos); }
      else if (h[cid]) { delete h[cid][mes]; }
    });
    return v;
  }

  // Comprueba, para las sesiones que este guardado crea o cambia, que no se solapan con otra
  // sesión no cancelada del mismo día (doble reserva). bloqueSesion(clave, dur) -> claves de 15 min.
  function solapesNuevos(sesionesFinal, sesionesServidor, bloqueSesion) {
    const conflictos = [];
    const activa = s => s && typeof s === 'object' && !s.estadoCancelacion;
    const ocupacion = new Map();
    Object.keys(sesionesFinal).forEach(clave => {
      const s = sesionesFinal[clave];
      if (!activa(s)) return;
      bloqueSesion(clave, Number(s.duracionMin) || 45).forEach(t => { (ocupacion.get(t) || ocupacion.set(t, []).get(t)).push(clave); });
    });
    Object.keys(sesionesFinal).forEach(clave => {
      if (igual(sesionesFinal[clave], (sesionesServidor || {})[clave])) return;
      const s = sesionesFinal[clave];
      if (!activa(s)) return;
      const choca = bloqueSesion(clave, Number(s.duracionMin) || 45).some(t => (ocupacion.get(t) || []).some(o => o !== clave));
      if (choca) conflictos.push(clave);
    });
    return conflictos;
  }

  async function guardarScope(cfg) {
    const { firestore, FieldValue, tk, base, local, notas, notasTocadas, fusionar, limpiarAgenda, bloqueSesion, actor } = cfg;
    const contador = cfg.contador || consumo;
    const af = afectadosScope(tk, base, local, notasTocadas);
    const refSemana = l => firestore.collection(COL.semanas).doc(idSemana(tk, l));
    const refCliente = id => firestore.collection(COL.clientes).doc(idCliente(id));
    const refHist = (cid, mes) => firestore.collection(COL.historico).doc(idHistorico(tk, cid, mes));
    const refTrainer = () => firestore.collection(COL.trainers).doc(idSeguro(tk));
    const refNota = k => firestore.collection(COL.notas).doc(idNota(k));
    const semanas = [...af.semanas], clientes = [...af.clientes], historico = [...af.historico].map(x => x.split('\u0000'));
    const notasLista = [...af.notas];
    const total = semanas.length + clientes.length + historico.length + notasLista.length + (af.trainer ? 1 : 0);
    if (!total) return { escrito: local, docs: [], sinCambios: true };
    if (total > 450) throw Object.assign(new Error(`Demasiados documentos en un solo guardado (${total}).`), { code: 'demasiados-documentos' });
    const escritos = [];
    contador.sumar('transacciones', 1, 'guardar');
    const resultado = await firestore.runTransaction(async tx => {
      escritos.length = 0;
      const leer = ref => tx.get(ref).then(s => { contador.sumar('lecturas', 1, 'tx'); return s.exists ? s.data() : null; });
      const [fSem, fCli, fHis, fNot, fTra] = await Promise.all([
        Promise.all(semanas.map(l => leer(refSemana(l)).then(data => ({ lunes: l, data })))),
        Promise.all(clientes.map(id => leer(refCliente(id)).then(data => ({ id, data })))),
        Promise.all(historico.map(([cid, mes]) => leer(refHist(cid, mes)).then(data => ({ cid, mes, data })))),
        Promise.all(notasLista.map(k => leer(refNota(k)).then(data => ({ k, data })))),
        af.trainer ? leer(refTrainer()).then(data => ({ data })) : Promise.resolve(null),
      ]);
      const servidor = vistaConDocs(tk, base, { semanas: fSem, clientes: fCli, historico: fHis, trainer: fTra });
      const final = {};
      const conflictos = [];
      ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes'].forEach(campo => {
        const limpiar = campo === 'agenda' && limpiarAgenda ? limpiarAgenda : (x => x);
        const r = fusionar(campo, limpiar(base[campo]), limpiar(local[campo]), limpiar(servidor[campo]));
        r.conflictos.forEach(clave => conflictos.push({ campo, clave }));
        final[campo] = r.valor;
      });
      // Notas: una a una; conflicto si otra sesión cambió la misma nota desde la base.
      fNot.forEach(({ k, data }) => {
        const enServidor = data && !data.eliminado ? data.texto : null;
        const enBase = (notas.base || {})[k] || null;
        if ((enServidor || null) !== (enBase || null) && (enServidor || null) !== ((notas.local || {})[k] || null)) conflictos.push({ campo: 'notas', clave: `k:${k}` });
      });
      // Dobles reservas: ninguna sesión creada o cambiada aquí puede solaparse con otra del día.
      if (bloqueSesion) {
        fSem.forEach(({ lunes, data }) => {
          const finalSemana = {};
          Object.keys(final.agenda || {}).forEach(c => { const f = fechaDeClave(c); if (f && lunesDe(f) === lunes) finalSemana[c] = final.agenda[c]; });
          solapesNuevos(finalSemana, data ? data.sesiones : {}, bloqueSesion).forEach(c => conflictos.push({ campo: 'agenda', clave: `k:${c}`, solape: true }));
        });
      }
      if (conflictos.length) throw Object.assign(new Error(`Conflicto de concurrencia para trainerKey=${tk}`), { code: 'conflict', conflictos });

      const meta = rev => ({ rev, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: actor || '' });
      const escribir = (ref, col, id, previo, contenido) => {
        const comparablePrevio = previo ? { ...previo } : null;
        if (comparablePrevio) { delete comparablePrevio.rev; delete comparablePrevio.actualizadoEn; delete comparablePrevio.actualizadoPor; }
        if (comparablePrevio && igual(comparablePrevio, contenido)) return;
        const data = { ...contenido, ...meta(((previo && previo.rev) || 0) + 1) };
        tx.set(ref, data);
        escritos.push({ col, id, data });
      };
      fSem.forEach(({ lunes, data }) => {
        const partes = { sesiones: {}, pruebasCRM: {}, excepciones: {}, bloqueos: {} };
        const meter = (campo, destino) => Object.keys(final[campo] || {}).forEach(c => { const f = fechaDeClave(c); if (f && lunesDe(f) === lunes) partes[destino][c] = final[campo][c]; });
        meter('agenda', 'sesiones'); meter('pruebasCRM', 'pruebasCRM');
        const disp = final.disponibilidadReservas || {};
        SUBMAPAS_DIA.forEach(sub => Object.keys(disp[sub] || {}).forEach(f => { if (RE_FECHA.test(f) && lunesDe(f) === lunes) partes[sub][f] = disp[sub][f]; }));
        escribir(refSemana(lunes), 'semanas', idSemana(tk, lunes), data, contenidoSemana(tk, lunes, partes));
      });
      const mf = mapaPorId(final.clientes);
      fCli.forEach(({ id, data }) => {
        if (mf.has(id)) {
          const orden = data && !data.eliminado && data.trainerKey === tk && typeof data.orden === 'number' ? data.orden : mf.get(id).i;
          escribir(refCliente(id), 'clientes', idCliente(id), data, contenidoCliente(tk, mf.get(id).f, orden));
        } else if (data && !data.eliminado && data.trainerKey === tk) {
          // Lápida (nunca borrado físico): la ficha deja de existir para la app, el dato se conserva.
          escribir(refCliente(id), 'clientes', idCliente(id), data, { ...data, eliminado: true, rev: undefined, actualizadoEn: undefined, actualizadoPor: undefined });
        }
        // Si ya pertenece a OTRO entrenador (traspaso confirmado), no se toca.
      });
      fHis.forEach(({ cid, mes, data }) => {
        const valor = ((final.historicoClientes || {})[cid] || {})[mes];
        if (valor !== undefined) escribir(refHist(cid, mes), 'historico', idHistorico(tk, cid, mes), data, contenidoHistorico(tk, cid, mes, valor));
        else if (data && !data.eliminado) escribir(refHist(cid, mes), 'historico', idHistorico(tk, cid, mes), data, { ...data, eliminado: true, rev: undefined, actualizadoEn: undefined, actualizadoPor: undefined });
      });
      if (fTra) {
        const previo = fTra.data;
        const disp = final.disponibilidadReservas || {};
        const sub = {}; SUBMAPAS_DIA.forEach(s => { sub[s] = esPlano(disp[s]); });
        const contenido = { ...(previo || { trainerKey: tk, presencia: {}, actividades: null, historicoSinMeses: [], esquema: ESQUEMA }) };
        delete contenido.rev; delete contenido.actualizadoEn; delete contenido.actualizadoPor;
        contenido.trainerKey = tk;
        contenido.disponibilidad = dispGeneral(disp);
        contenido.submapasDisp = sub;
        contenido.presencia = { ...(contenido.presencia || {}), disponibilidadReservas: true };
        escribir(refTrainer(), 'trainers', idSeguro(tk), previo, contenido);
      }
      fNot.forEach(({ k, data }) => {
        const texto = (notas.local || {})[k] || '';
        escribir(refNota(k), 'notas', idNota(k), data, contenidoNota(k, texto));
      });
      // Limpieza de campos auxiliares (undefined) de las lápidas antes de que el SDK los vea.
      escritos.forEach(e => Object.keys(e.data).forEach(k => { if (e.data[k] === undefined) delete e.data[k]; }));
      return final;
    });
    contador.sumar('escrituras', escritos.length, 'guardar');
    return { escrito: resultado, docs: escritos.slice() };
  }

  // ---------------------------------------------------------------- transacción sobre documentos concretos
  // Para flujos que operan sobre la forma legado de VARIOS entrenadores a la vez (CRM: pruebas,
  // conversión de leads). Se declaran los documentos a leer (semanas y fichas); mutar() recibe la
  // forma legado de SOLO esos documentos y la modifica con la lógica de siempre; se escriben solo
  // los documentos que cambian (rev+1, hora del servidor). Escribir en una semana no declarada es
  // un error (nunca se sobrescribe un documento que no se ha leído en la transacción).
  async function transaccionLegado(cfg) {
    const { firestore, FieldValue, actor, mutar } = cfg;
    const contador = cfg.contador || consumo;
    const semanas = []; const vistas = new Set();
    (cfg.semanas || []).forEach(x => { const id = idSemana(x.tk, x.lunes); if (!vistas.has(id)) { vistas.add(id); semanas.push({ id, tk: x.tk, lunes: x.lunes }); } });
    const clientes = [...new Set((cfg.clientes || []).filter(Boolean).map(String))];
    contador.sumar('transacciones', 1, 'legado');
    let escritos = [];
    const resultado = await firestore.runTransaction(async tx => {
      escritos = [];
      const leer = ref => tx.get(ref).then(sn => { contador.sumar('lecturas', 1, 'tx'); return sn.exists ? sn.data() : null; });
      const leidosSem = await Promise.all(semanas.map(x => leer(firestore.collection(COL.semanas).doc(x.id)).then(data => ({ ...x, data }))));
      const leidosCli = await Promise.all(clientes.map(id => leer(firestore.collection(COL.clientes).doc(idCliente(id))).then(data => ({ id, data }))));
      const grupo = agrupar([]);
      leidosSem.forEach(x => { if (x.data) grupo.semanas[x.id] = x.data; });
      leidosCli.forEach(x => { if (x.data) grupo.clientes[idCliente(x.id)] = x.data; });
      const antes = legadoDesdeDocs(grupo);
      const despues = clonar(antes);
      const extra = (await mutar(despues, { tx, antes, leer })) || {};
      const nuevos = docsDesdeLegado(despues).docs;
      const meta = rev => ({ rev, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: actor || '' });
      const sinMeta = d => { if (!d) return null; const c = { ...d }; delete c.rev; delete c.actualizadoEn; delete c.actualizadoPor; return c; };
      const escribir = (col, id, previo, contenido) => {
        if (previo && igual(sinMeta(previo), contenido)) return;
        const data = { ...contenido, ...meta(((previo && previo.rev) || 0) + 1) };
        tx.set(firestore.collection(COL[col]).doc(id), data);
        escritos.push({ col, id, data });
      };
      const nuevasSemanas = new Map(nuevos.filter(d => d.col === 'semanas').map(d => [d.id, d.data]));
      nuevasSemanas.forEach((_, id) => { if (!vistas.has(id)) throw Object.assign(new Error(`Semana no declarada en la transacción: ${id}`), { code: 'semana-no-leida' }); });
      leidosSem.forEach(x => {
        const contenido = nuevasSemanas.get(x.id) || contenidoSemana(x.tk, x.lunes, {});
        if (!x.data && !nuevasSemanas.has(x.id)) return;
        escribir('semanas', x.id, x.data, contenido);
      });
      const nuevosCli = new Map(nuevos.filter(d => d.col === 'clientes').map(d => [d.id, d.data]));
      nuevosCli.forEach((_, id) => { if (!clientes.map(idCliente).includes(id)) throw Object.assign(new Error(`Ficha no declarada en la transacción: ${id}`), { code: 'ficha-no-leida' }); });
      leidosCli.forEach(x => {
        const id = idCliente(x.id);
        const nuevo = nuevosCli.get(id);
        if (nuevo) {
          const orden = x.data && !x.data.eliminado && x.data.trainerKey === nuevo.trainerKey && typeof x.data.orden === 'number' ? x.data.orden : Date.now();
          escribir('clientes', id, x.data, { ...nuevo, orden });
        } else if (x.data && !x.data.eliminado) {
          escribir('clientes', id, x.data, { ...sinMeta(x.data), eliminado: true });
        }
      });
      (extra.escrituras || []).forEach(fn => fn(tx));
      return extra.resultado;
    });
    contador.sumar('escrituras', escritos.length, 'legado');
    return { resultado, docs: escritos };
  }

  // Finanzas: actividades autorizadas por entrenador (besoulTrainers/{tk}.actividades) y catálogo
  // global (besoulAgendaConfig/global). payload con las mismas claves que antes escribía en el
  // documento monolítico: {"trainerActividades.<tk>": [...]} o {"catalogoActividades.<id>": {...}}.
  async function actualizarCamposRaiz(cfg) {
    const { firestore, FieldValue, payload, actor } = cfg;
    const contador = cfg.contador || consumo;
    const porTrainer = {}; const porConfig = {};
    Object.keys(payload || {}).forEach(k => {
      const i = k.indexOf('.'); const raizCampo = i < 0 ? k : k.slice(0, i); const resto = i < 0 ? null : k.slice(i + 1);
      if (raizCampo === 'trainerActividades' && resto) porTrainer[resto] = payload[k];
      else if (CAMPOS_CONFIG.includes(raizCampo)) (porConfig[raizCampo] = porConfig[raizCampo] || {})[resto === null ? '__todo' : resto] = payload[k];
      else throw Object.assign(new Error(`Campo no admitido: ${k}`), { code: 'campo-no-admitido' });
    });
    contador.sumar('transacciones', 1, 'camposRaiz');
    let n = 0;
    await firestore.runTransaction(async tx => {
      n = 0;
      const refsT = Object.keys(porTrainer).map(tk => ({ tk, ref: firestore.collection(COL.trainers).doc(idSeguro(tk)) }));
      const refC = Object.keys(porConfig).length ? firestore.collection(COL.config).doc('global') : null;
      const leidosT = await Promise.all(refsT.map(x => tx.get(x.ref).then(sn => ({ ...x, data: sn.exists ? sn.data() : null }))));
      const leidoC = refC ? await tx.get(refC).then(sn => (sn.exists ? sn.data() : null)) : null;
      contador.sumar('lecturas', leidosT.length + (refC ? 1 : 0), 'tx');
      const meta = previo => ({ rev: ((previo && previo.rev) || 0) + 1, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: actor || '' });
      leidosT.forEach(({ tk, ref, data }) => {
        const base = data ? { ...data } : { trainerKey: tk, presencia: {}, disponibilidad: null, submapasDisp: {}, historicoSinMeses: [], esquema: ESQUEMA };
        base.actividades = porTrainer[tk];
        base.presencia = { ...(base.presencia || {}), trainerActividades: true };
        tx.set(ref, { ...base, ...meta(data) }); n++;
      });
      if (refC) {
        const campos = clonar((leidoC && leidoC.campos) || {});
        Object.keys(porConfig).forEach(campo => {
          if ('__todo' in porConfig[campo]) campos[campo] = porConfig[campo].__todo;
          else { campos[campo] = campos[campo] || {}; Object.keys(porConfig[campo]).forEach(k => { campos[campo][k] = porConfig[campo][k]; }); }
        });
        tx.set(refC, { campos, esquema: ESQUEMA, ...meta(leidoC) }); n++;
      }
    });
    contador.sumar('escrituras', n, 'camposRaiz');
  }

  // Semanas que contienen pruebas CRM de un lead (consulta por índice, sin descargar agendas).
  async function semanasConPrueba(firestore, leadId, contador) {
    const c = contador || consumo;
    c.sumar('consultas', 1, 'semanasConPrueba');
    const snap = await firestore.collection(COL.semanas).where('leadsPrueba', 'array-contains', String(leadId)).get();
    c.sumar('lecturas', Math.max(1, snap.size), 'semanasConPrueba');
    return snap.docs.map(d => ({ tk: d.data().trainerKey, lunes: d.data().semana }));
  }
  // Fichas vinculadas a un lead (por leadId o por id de cliente ya convertido).
  async function fichasDeLead(firestore, leadId, idsExtra, contador) {
    const c = contador || consumo;
    c.sumar('consultas', 1, 'fichasDeLead');
    const snap = await firestore.collection(COL.clientes).where('leadId', '==', String(leadId)).get();
    c.sumar('lecturas', Math.max(1, snap.size), 'fichasDeLead');
    return [...new Set([...snap.docs.map(d => d.data().clienteId), ...(idsExtra || []).filter(Boolean)])];
  }

  return {
    COL, ESQUEMA, COLECCIONES_SINCRONIZADAS,
    transaccionLegado, semanasConPrueba, fichasDeLead, leadsPruebaDe, actualizarCamposRaiz, CAMPOS_CONFIG,
    lunesDe, fechaDeClave, idSemana, idCliente, idHistorico, idNota, idSeguro, trainerDeNota,
    docsDesdeLegado, legadoDesdeDocs, agrupar, diferencias, igual, canon,
    contenidoSemana, contenidoCliente, contenidoHistorico, contenidoNota, dispGeneral,
    afectadosScope, vistaConDocs, solapesNuevos, guardarScope,
    crearSincronizador, cacheMemoria, cacheIndexedDB, codificar, decodificar,
    crearContador, consumo,
  };
}));
