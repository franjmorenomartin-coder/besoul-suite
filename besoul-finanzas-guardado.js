// BESOUL V1 — Guardado seguro de besoulSuite/finanzas (FIX-FINANZAS-GUARDADO-SEGURO, 2026-10-23).
//
// Incidente del 10-10-2026 (docs/FINANZAS_GUARDADO_SEGURO.md): finanzas.html enviaba TODO dbFinanzas
// con set(...,{merge:true}). Una pestaña que todavía no había recibido el documento del servidor
// guardó su estado inicial; el SDK trata un mapa vacío como "sustituir el campo entero", así que
// trainerSettings, trainerSettingsVersiones, centrosVersiones, otrosIngresos e historico quedaron
// vacíos, y el guardado siguiente escribió centros con los valores por defecto del código.
//
// Este módulo sustituye ese guardado por:
//  - escrituras DIRIGIDAS: solo las rutas campo.clave que esta pestaña ha cambiado respecto a lo
//    último que recibió del servidor (nunca el documento completo, nunca valores normalizados);
//  - transacción con comparación a tres bandas por ruta: si otro usuario cambió esa misma ruta
//    desde que esta pestaña la leyó, no se escribe nada (conflicto) -- cambios en rutas distintas
//    se conservan los dos;
//  - bloqueo de vaciado: ningún guardado puede dejar vacío un mapa crítico que tenía contenido, ni
//    borrar más de una entrada de configuración de una vez;
//  - marca de versión (guardadoSeguroEn = hora del servidor) en cada escritura: firestore.rules solo
//    acepta escrituras que la llevan, así que una versión antigua de la página en caché (que envía
//    el documento completo) no puede escribir en absoluto.
// La misma defensa existe en firestore.rules (finanzasEscrituraSegura), para clientes antiguos en caché.
//
// Concurrencia dentro de la propia pestaña (revisión previa al despliegue): las operaciones se
// calculan sobre una COPIA del estado tomada al empezar el guardado (las ediciones que lleguen
// durante la transacción quedan para el guardado siguiente, no se dan por guardadas), la base solo
// avanza con lo que esta pestaña ha escrito (nunca con cambios del servidor que la pestaña no ha
// mostrado), y rebasar() conserva las ediciones locales pendientes cuando llega un snapshot.
//
// UMD: <script> en el navegador (window.BesoulFinanzasGuardado) y require() en Node (pruebas). No
// depende del SDK: recibe la instancia de Firestore y las clases que necesita.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.BesoulFinanzasGuardado = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Metadatos de escritura: nunca se comparan ni se copian desde la pestaña.
  const CAMPOS_META = ['actualizadoEn', 'actualizadoPor', 'guardadoSeguroEn'];
  // Campo que firestore.rules exige en cada escritura (== request.time). Las versiones antiguas de
  // la página no lo envían.
  const CAMPO_MARCA = 'guardadoSeguroEn';
  // Mapas que un guardado nunca puede dejar vacíos si tenían contenido.
  const CAMPOS_CRITICOS = ['trainerSettings', 'trainerSettingsVersiones', 'centros', 'centrosVersiones', 'otrosIngresos', 'gastos', 'historico'];
  // Configuración en la que un guardado no puede borrar más de una entrada (los borrados
  // legítimos de la interfaz -- eliminar un centro personalizado -- son siempre de uno en uno).
  const CAMPOS_SIN_BORRADO_MASIVO = ['trainerSettings', 'trainerSettingsVersiones', 'centros', 'centrosVersiones'];

  function esMapa(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function';
  }
  // Copia de comparación (los Timestamp pasan a {seconds,nanoseconds}, como en JSON).
  function clonar(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function ordenar(v) {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = ordenar(v[k]); }); return o; }
    return v;
  }
  // Copia del valor de una operación (que no cambie si la pestaña sigue editando), conservando
  // los Timestamp del SDK tal cual.
  function clonarValor(v) {
    if (Array.isArray(v)) return v.map(clonarValor);
    if (esMapa(v) && Object.getPrototypeOf(v) === Object.prototype) { const o = {}; Object.keys(v).forEach(k => { o[k] = clonarValor(v[k]); }); return o; }
    return v;
  }
  function canon(v) { return v === undefined ? '__ausente__' : JSON.stringify(ordenar(clonar(v))); }
  function igual(a, b) { return canon(a) === canon(b); }
  // Valor listo para Firestore: sin undefined (que el SDK rechaza), conservando Timestamp y demás.
  function limpiar(v) {
    if (Array.isArray(v)) return v.map(x => (x === undefined ? null : limpiar(x)));
    if (esMapa(v) && Object.getPrototypeOf(v) === Object.prototype) {
      const o = {}; Object.keys(v).forEach(k => { if (v[k] !== undefined) o[k] = limpiar(v[k]); }); return o;
    }
    return v;
  }

  // Lo último recibido del servidor: el documento tal cual (raw, para detectar conflictos) y su
  // versión normalizada por la página (norm, para saber qué ha cambiado ESTA pestaña sin confundir
  // la normalización -- p.ej. centros por defecto -- con un cambio del usuario).
  function crearBase(raw, normalizar) {
    return { raw: clonar(raw) || {}, norm: clonar(normalizar(clonar(raw) || {})) || {} };
  }

  // Operaciones {campo, clave|null, valor | borrar:true}: segundo nivel (gastos.2026-10,
  // trainerSettings.igor, centros.inacua...) cuando base y actual son mapas; campo entero si no.
  function calcularOperaciones(baseNorm, actual) {
    const ops = [];
    const campos = new Set([...Object.keys(baseNorm || {}), ...Object.keys(actual || {})]);
    campos.forEach(campo => {
      if (CAMPOS_META.includes(campo)) return;
      const b = (baseNorm || {})[campo], a = (actual || {})[campo];
      if (igual(a, b)) return;
      if (a === undefined) { ops.push({ campo, clave: null, borrar: true }); return; }
      if (esMapa(a) && esMapa(b) && Object.keys(a).length) {
        new Set([...Object.keys(b), ...Object.keys(a)]).forEach(clave => {
          if (igual(a[clave], b[clave])) return;
          ops.push(a[clave] === undefined ? { campo, clave, borrar: true } : { campo, clave, valor: clonarValor(a[clave]) });
        });
        return;
      }
      ops.push({ campo, clave: null, valor: clonarValor(a) });
    });
    return ops;
  }

  function leerRuta(doc, op) {
    const v = (doc || {})[op.campo];
    if (op.clave === null) return v;
    return esMapa(v) ? v[op.clave] : undefined;
  }
  // Mismo efecto que tx.update() con esas rutas (una ruta anidada sobre un campo que no es mapa lo
  // convierte en mapa con solo esa clave).
  function aplicarOperaciones(doc, ops) {
    const r = clonar(doc) || {};
    ops.forEach(op => {
      if (op.clave === null) { if (op.borrar) delete r[op.campo]; else r[op.campo] = clonar(op.valor); return; }
      if (!esMapa(r[op.campo])) r[op.campo] = {};
      if (op.borrar) delete r[op.campo][op.clave]; else r[op.campo][op.clave] = clonar(op.valor);
    });
    return r;
  }
  // La base avanza SOLO con lo que esta pestaña ha escrito: así un cambio de otra sesión que la
  // pestaña todavía no ha recibido sigue contando como conflicto si se edita la misma ruta.
  function avanzarBase(base, ops) {
    return { raw: aplicarOperaciones(base.raw, ops), norm: aplicarOperaciones(base.norm, ops) };
  }
  // Llega un snapshot nuevo del servidor: se conservan las ediciones locales todavía no confirmadas
  // (pendientes respecto a la base anterior), salvo las de rutas que el servidor ha cambiado entre
  // medias con otro valor (conflicto: gana el servidor y se informa). Devuelve { actual, descartadas }.
  function rebasar(baseAnterior, actual, baseNueva) {
    const pendientes = baseAnterior ? calcularOperaciones(baseAnterior.norm, actual) : [];
    const descartadas = [], conservadas = [];
    pendientes.forEach(op => {
      const antes = leerRuta(baseAnterior.raw, op), ahora = leerRuta(baseNueva.raw, op);
      const nuevo = op.borrar ? undefined : op.valor;
      if (igual(antes, ahora) || igual(ahora, nuevo)) conservadas.push(op); else descartadas.push(nombreRuta(op));
    });
    return { actual: aplicarOperaciones(baseNueva.norm, conservadas), descartadas };
  }
  // Guardado rechazado: las rutas de ese guardado vuelven al último valor confirmado (base), para
  // que la pestaña no siga mostrando ni reintentando un cambio que no está en el servidor.
  function revertirRutas(actual, base, ops) {
    const deshacer = (ops || []).map(op => {
      const v = leerRuta(base.norm, op);
      return v === undefined ? { campo: op.campo, clave: op.clave, borrar: true } : { campo: op.campo, clave: op.clave, valor: v };
    });
    return aplicarOperaciones(actual, deshacer);
  }
  function error(code, mensaje, detalle) { return Object.assign(new Error(mensaje), { code, detalle }); }
  function nombreRuta(op) { return op.clave === null ? op.campo : `${op.campo}.${op.clave}`; }

  // Valida las operaciones contra el estado ACTUAL del servidor. Devuelve el documento resultante.
  function validarOperaciones(servidor, baseRaw, ops) {
    const conflictos = ops.filter(op => {
      const enServidor = leerRuta(servidor, op), leido = leerRuta(baseRaw, op);
      const nuevo = op.borrar ? undefined : op.valor;
      return !igual(enServidor, leido) && !igual(enServidor, nuevo);
    });
    if (conflictos.length) throw error('conflicto-concurrencia', `Otro usuario ha cambiado los mismos datos desde que se abrió Finanzas: ${conflictos.map(nombreRuta).join(', ')}`, conflictos.map(nombreRuta));
    const resultado = aplicarOperaciones(servidor, ops);
    const tocaHistoricoBorrado = ops.some(op => op.campo === 'historicoBorrado');
    CAMPOS_CRITICOS.forEach(campo => {
      const antes = servidor[campo], despues = resultado[campo];
      if (!esMapa(antes) || !Object.keys(antes).length) return;
      if (esMapa(despues) && Object.keys(despues).length) return;
      // Borrar el último cierre es legítimo cuando se mueve a la papelera (historicoBorrado).
      if (campo === 'historico' && tocaHistoricoBorrado) return;
      throw error('vaciado-bloqueado', `Guardado bloqueado: dejaría vacío "${campo}", que tiene ${Object.keys(antes).length} entrada(s) en el servidor.`, [campo]);
    });
    CAMPOS_SIN_BORRADO_MASIVO.forEach(campo => {
      const antes = esMapa(servidor[campo]) ? Object.keys(servidor[campo]) : [];
      const despues = esMapa(resultado[campo]) ? resultado[campo] : {};
      const borradas = antes.filter(k => !(k in despues));
      if (borradas.length > 1) throw error('borrado-masivo-bloqueado', `Guardado bloqueado: borraría ${borradas.length} entradas de "${campo}" a la vez.`, borradas.map(k => `${campo}.${k}`));
    });
    return resultado;
  }

  // Guarda en una transacción solo lo que esta pestaña ha cambiado. cfg: { firestore, ref,
  // FieldValue, FieldPath, base, actual, actor }. Devuelve { sinCambios, ops, rutas, nuevaBase }.
  async function guardarCambios(cfg) {
    const { firestore, ref, FieldValue, FieldPath, base, actual, actor } = cfg;
    if (!base || !base.raw || !base.norm) throw error('finanzas-no-cargada', 'Finanzas todavía no ha recibido los datos del servidor.');
    // Las operaciones se calculan (y sus valores se copian) AHORA: lo que la pestaña edite durante la
    // transacción no entra en este guardado ni se da por guardado -- lo recoge el siguiente.
    const ops = calcularOperaciones(base.norm, actual);
    if (!ops.length) return { sinCambios: true, ops, rutas: [], nuevaBase: base };
    try {
      await firestore.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw error('documento-inexistente', 'El documento de Finanzas no existe en el servidor.');
        validarOperaciones(clonar(snap.data()), base.raw, ops);
        const args = [];
        ops.forEach(op => {
          args.push(op.clave === null ? new FieldPath(op.campo) : new FieldPath(op.campo, op.clave));
          args.push(op.borrar ? FieldValue.delete() : limpiar(op.valor));
        });
        args.push(new FieldPath('actualizadoEn'), FieldValue.serverTimestamp(), new FieldPath('actualizadoPor'), actor || '');
        args.push(new FieldPath(CAMPO_MARCA), FieldValue.serverTimestamp());
        tx.update(ref, ...args);
      });
    } catch (e) { if (e && typeof e === 'object' && !e.ops) e.ops = ops; throw e; }
    return { sinCambios: false, ops, rutas: ops.map(nombreRuta), nuevaBase: avanzarBase(base, ops) };
  }

  return {
    CAMPOS_META, CAMPOS_CRITICOS, CAMPOS_SIN_BORRADO_MASIVO, CAMPO_MARCA,
    esMapa, clonar, canon, igual, limpiar,
    crearBase, calcularOperaciones, aplicarOperaciones, validarOperaciones, guardarCambios,
    avanzarBase, rebasar, revertirRutas,
  };
}));
