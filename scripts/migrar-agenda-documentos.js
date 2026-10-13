// ARQ-V1-MIGRACION-IMPL — MIGRADOR besoulSuite/agenda -> documentos independientes, y RECUPERACIÓN
// inversa. Se ejecuta en la consola del navegador con sesión de ADMINISTRADOR, durante la ventana de
// mantenimiento (reglas de congelación desplegadas: nadie puede escribir en besoulSuite/agenda).
// No se carga desde ninguna página de la app.
//
//   0) Pegar besoul-datos.js en la consola (define window.BesoulDatos), y después este archivo.
//   1) await migrarAgendaBesoul()                      -> SIMULACIÓN: lee, transforma, verifica. No escribe.
//   2) await migrarAgendaBesoul({ ejecutar: true })    -> escribe los documentos nuevos (solo con autorización).
//   3) await verificarMigracionBesoul()                -> relee TODO del servidor y compara con el original.
//   MODO CONTINGENCIA (si la app nueva falla; ver docs/arquitectura-firestore/07_CORTE_Y_RECUPERACION.md):
//   6) await prepararContingenciaBesoul({ desde: 'AAAA-MM-DD' })           -> SIMULACIÓN (tamaño, recuentos)
//   7) await prepararContingenciaBesoul({ desde: 'AAAA-MM-DD', ejecutar: true }) -> crea besoulSuite/agendaContingencia
//   8) await reincorporarContingenciaBesoul()                              -> SIMULACIÓN del plan de vuelta
//   9) await reincorporarContingenciaBesoul({ ejecutar: true })            -> devuelve lo cambiado a los documentos nuevos
//   Recuperación antigua por documento único (NO recomendada: el original está casi lleno):
//   4) await reconstruirAgendaBesoul()                 -> SIMULACIÓN del documento único desde los nuevos.
//   5) await reconstruirAgendaBesoul({ ejecutar: true })-> lo escribe en besoulSuite/agenda (requiere
//                                                         las reglas anteriores, ver docs/.../06).
//
// Garantías:
//  - Nada se borra ni se modifica en besoulSuite/agenda (la migración solo lee de él).
//  - Antes de escribir: ida y vuelta EXACTA en memoria (original == reconstruido) y comprobación de
//    que los documentos destino no existen o son idénticos (idempotente: repetirla no cambia nada;
//    si alguno existe con contenido distinto, NO escribe nada).
//  - El documento original se relee al final: si cambió durante la migración, se informa como fallo.
//  - Informe sin datos de clientes (solo recuentos, huellas y rutas).
(function () {
  const D = window.BesoulDatos;
  if (!D) { console.error('Falta besoul-datos.js: pégalo antes en la consola.'); return; }
  const fs = firebase.firestore();
  const agendaRef = fs.collection('besoulSuite').doc('agenda');
  const enc = new TextEncoder();
  async function huella(v) {
    const b = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(D.canon(v))));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const sinMeta = d => { if (!d) return d; const c = { ...d }; delete c.rev; delete c.actualizadoEn; delete c.actualizadoPor; return c; };
  async function leerColeccion(col) {
    const snap = await fs.collection(D.COL[col]).get({ source: 'server' });
    const out = {}; snap.docs.forEach(d => { out[d.id] = d.data(); });
    return out;
  }
  async function leerTodoNuevo() {
    const d = {};
    for (const col of ['semanas', 'clientes', 'trainers', 'historico', 'notas', 'legado', 'config']) d[col] = await leerColeccion(col);
    return d;
  }
  function recuento(agenda) {
    const n = o => Object.values(o || {}).reduce((a, x) => a + Object.keys(x || {}).length, 0);
    return {
      sesiones: n(agenda.agenda), pruebasCRM: n(agenda.pruebasCRM),
      fichas: Object.values(agenda.clientes || {}).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0),
      mesesHistorico: Object.values(agenda.historicoClientes || {}).reduce((a, t) => a + Object.values(t || {}).reduce((b, m) => b + Object.keys(m || {}).length, 0), 0),
      diasConExcepcion: Object.values(agenda.disponibilidadReservas || {}).reduce((a, x) => a + Object.keys((x || {}).excepciones || {}).length, 0),
      diasConSlotsOcultos: Object.values(agenda.disponibilidadReservas || {}).reduce((a, x) => a + Object.keys((x || {}).bloqueos || {}).length, 0),
      notas: Object.keys(agenda.notas || {}).length,
      entrenadores: new Set([...Object.keys(agenda.clientes || {}), ...Object.keys(agenda.agenda || {}), ...Object.keys(agenda.disponibilidadReservas || {})]).size,
    };
  }

  window.migrarAgendaBesoul = async function ({ ejecutar = false } = {}) {
    const t0 = Date.now();
    const snap = await agendaRef.get({ source: 'server' });
    if (!snap.exists) throw new Error('besoulSuite/agenda no existe.');
    const original = snap.data();
    const updateTimeInicio = snap.updateTime ? snap.updateTime.toMillis() : null;
    const { docs, noTransformable } = D.docsDesdeLegado(original);
    const informe = { modo: ejecutar ? 'EJECUCIÓN' : 'SIMULACIÓN (no se escribe nada)', recuento: recuento(original), documentos: {}, noTransformable };
    docs.forEach(d => { informe.documentos[d.col] = (informe.documentos[d.col] || 0) + 1; });
    if (noTransformable.length) throw Object.assign(new Error('Hay datos que no se pueden transformar sin ambigüedad. No se escribe nada.'), { informe });
    const reconstruido = D.legadoDesdeDocs(D.agrupar(docs));
    const difs = D.diferencias(original, reconstruido, '', [], 50);
    if (difs.length) throw Object.assign(new Error('La ida y vuelta en memoria NO es exacta. No se escribe nada.'), { informe, difs });
    informe.huellaOriginal = await huella(original);
    informe.idaYVueltaExacta = true;
    // Estado de destino (idempotencia).
    const existentes = await leerTodoNuevo();
    let iguales = 0, nuevos = 0; const distintos = [];
    docs.forEach(d => {
      const e = existentes[d.col][d.id];
      if (!e) nuevos++;
      else if (D.igual(sinMeta(e), d.data)) iguales++;
      else distintos.push(`${d.col}/${d.id}`);
    });
    const sobrantes = [];
    Object.keys(existentes).forEach(col => Object.keys(existentes[col]).forEach(id => { if (!docs.some(d => d.col === col && d.id === id)) sobrantes.push(`${col}/${id}`); }));
    informe.destino = { nuevos, yaIdenticos: iguales, distintos: distintos.length, sobrantes: sobrantes.length };
    if (distintos.length || sobrantes.length) {
      informe.detalleDestino = { distintos: distintos.slice(0, 20), sobrantes: sobrantes.slice(0, 20) };
      throw Object.assign(new Error('El destino ya contiene documentos distintos o sobrantes. No se escribe nada (revisar antes).'), { informe });
    }
    if (ejecutar) {
      const pendientes = docs.filter(d => !existentes[d.col][d.id]);
      const actor = (firebase.auth().currentUser || {}).email || 'migracion';
      for (let i = 0; i < pendientes.length; i += 100) {
        const batch = fs.batch();
        pendientes.slice(i, i + 100).forEach(d => batch.set(fs.collection(D.COL[d.col]).doc(d.id), { ...d.data, rev: 1, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(), actualizadoPor: `migracion:${actor}` }));
        await batch.commit();
        console.log(`[MIGRACIÓN] escritos ${Math.min(i + 100, pendientes.length)}/${pendientes.length}`);
      }
      informe.escritos = pendientes.length;
      const fin = await agendaRef.get({ source: 'server' });
      informe.originalIntacto = (fin.updateTime ? fin.updateTime.toMillis() : null) === updateTimeInicio;
      if (!informe.originalIntacto) console.error('[MIGRACIÓN] ATENCIÓN: besoulSuite/agenda cambió durante la migración. DETENER y repetir con las reglas de congelación.');
      Object.assign(informe, await window.verificarMigracionBesoul({ original }));
    }
    informe.duracionMs = Date.now() - t0;
    console.log('[MIGRACIÓN AGENDA]', informe);
    return informe;
  };

  // Relee del SERVIDOR todos los documentos nuevos, reconstruye el documento único y lo compara con
  // el original (por defecto, el besoulSuite/agenda actual, que está congelado).
  window.verificarMigracionBesoul = async function ({ original } = {}) {
    const orig = original || (await agendaRef.get({ source: 'server' })).data();
    const nuevo = await leerTodoNuevo();
    const reconstruido = D.legadoDesdeDocs(nuevo);
    const difs = D.diferencias(orig, reconstruido, '', [], 50);
    const r = {
      verificacionServidor: difs.length === 0 ? 'IDÉNTICO' : 'DIFERENCIAS',
      huellaOriginal: await huella(orig), huellaReconstruida: await huella(reconstruido),
      recuentoOriginal: recuento(orig), recuentoReconstruido: recuento(reconstruido),
      diferencias: difs.slice(0, 20),
      documentosLeidos: Object.fromEntries(Object.keys(nuevo).map(c => [c, Object.keys(nuevo[c]).length])),
    };
    console.log('[VERIFICACIÓN MIGRACIÓN]', r);
    return r;
  };

  // RECUPERACIÓN: documento único reconstruido desde los documentos nuevos (incluye todo lo guardado
  // después del corte). Solo escribe con ejecutar:true y si cabe holgadamente en 1 MiB.
  // quitarCincoCamposRedundantes: SOLO con autorización expresa. El documento original ya ocupa
  // ~1.032 KB (13-oct); si hay que volver al documento único, puede no caber sin quitar de las
  // SESIONES los 5 campos de portal/contrato (demostrado que nunca se leen desde una sesión; la
  // ficha los conserva). Sin esta opción, la reconstrucción se rechaza si no cabe.
  window.reconstruirAgendaBesoul = async function ({ ejecutar = false, quitarCincoCamposRedundantes = false } = {}) {
    const nuevo = await leerTodoNuevo();
    const legado = D.legadoDesdeDocs(nuevo);
    if (quitarCincoCamposRedundantes) {
      const CINCO = ['contratoCliente', 'restriccionesReservas', 'reservaToken', 'reservasBloqueadasTexto', 'reservasOnlineActivas'];
      Object.values(legado.agenda || {}).forEach(m => Object.values(m || {}).forEach(ses => { if (ses && typeof ses === 'object') CINCO.forEach(k => { delete ses[k]; }); }));
    }
    const bytes = enc.encode(JSON.stringify(legado)).length;
    const r = { modo: ejecutar ? 'EJECUCIÓN' : 'SIMULACIÓN (no se escribe nada)', recuento: recuento(legado), bytesAprox: bytes, huella: await huella(legado) };
    if (bytes > 950000) { r.error = 'El documento reconstruido no cabe con seguridad en 1 MiB: recuperación por documento único NO posible; usar la recuperación selectiva.'; console.error(r); return r; }
    if (ejecutar) {
      await agendaRef.set({ ...legado, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(), ultimaActualizacionLocal: new Date().toISOString() });
      r.escrito = true;
    }
    console.log('[RECONSTRUCCIÓN AGENDA]', r);
    return r;
  };
  // ---------------------------------------------------------------- MODO CONTINGENCIA
  const contRef = fs.collection('besoulSuite').doc('agendaContingencia');
  function tamanoFirestore(v) {
    if (v === null || v === undefined || typeof v === 'boolean') return 1;
    if (typeof v === 'number') return 8;
    if (typeof v === 'string') return enc.encode(v).length + 1;
    if (typeof v.toMillis === 'function') return 8;
    if (Array.isArray(v)) return v.reduce((a, x) => a + tamanoFirestore(x), 0);
    return Object.keys(v).reduce((a, k) => a + enc.encode(k).length + 1 + tamanoFirestore(v[k]), 0);
  }
  window.prepararContingenciaBesoul = async function ({ desde, ejecutar = false } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) throw new Error('Indica desde: "AAAA-MM-DD" (p. ej. el día 1 del mes en curso).');
    const nuevo = await leerTodoNuevo();
    const cont = D.construirContingencia(nuevo, desde);
    const bytes = tamanoFirestore(cont) + 80;
    const plan = D.planReincorporacion(nuevo, cont);
    const r = { modo: ejecutar ? 'EJECUCIÓN' : 'SIMULACIÓN (no se escribe nada)', desde, bytes, margenBytes: 1048576 - bytes, recuento: recuento(cont), idaYVueltaSinCambios: plan.length === 0, huella: await huella(cont) };
    if (plan.length) { r.error = 'La contingencia no se puede reincorporar sin cambios (plan no vacío): NO se crea.'; console.error(r); return r; }
    if (bytes > 900000) { r.error = 'Demasiado grande: elige una fecha "desde" más reciente.'; console.error(r); return r; }
    const existente = await contRef.get({ source: 'server' });
    if (existente.exists) { r.error = 'Ya existe besoulSuite/agendaContingencia: revisar antes (no se sobrescribe).'; console.error(r); return r; }
    if (ejecutar) {
      await contRef.set({ ...cont, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(), ultimaActualizacionLocal: new Date().toISOString() });
      const leido = (await contRef.get({ source: 'server' })).data();
      delete leido.actualizadoEn; delete leido.ultimaActualizacionLocal;
      r.verificacionServidor = D.diferencias(cont, leido, '', [], 10).length === 0 ? 'IDÉNTICO' : 'DIFERENCIAS';
    }
    console.log('[CONTINGENCIA]', r);
    return r;
  };
  window.reincorporarContingenciaBesoul = async function ({ ejecutar = false } = {}) {
    const sc = await contRef.get({ source: 'server' });
    if (!sc.exists) throw new Error('No existe besoulSuite/agendaContingencia.');
    const cont = sc.data(); delete cont.actualizadoEn; delete cont.ultimaActualizacionLocal;
    const nuevo = await leerTodoNuevo();
    const plan = D.planReincorporacion(nuevo, cont);
    const r = { modo: ejecutar ? 'EJECUCIÓN' : 'SIMULACIÓN (no se escribe nada)', documentosACambiar: plan.length, porColeccion: plan.reduce((m, p) => { m[p.col] = (m[p.col] || 0) + 1; return m; }, {}) };
    if (ejecutar && plan.length) {
      const actor = (firebase.auth().currentUser || {}).email || 'reincorporacion';
      for (let i = 0; i < plan.length; i += 100) {
        const batch = fs.batch();
        plan.slice(i, i + 100).forEach(p => batch.set(fs.collection(D.COL[p.col]).doc(p.id), { ...p.data, rev: ((p.previo && p.previo.rev) || 0) + 1, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(), actualizadoPor: `reincorporacion:${actor}` }));
        await batch.commit();
      }
      const despues = D.planReincorporacion(await leerTodoNuevo(), cont);
      r.verificacionServidor = despues.length === 0 ? 'IDÉNTICO A LA CONTINGENCIA' : `QUEDAN ${despues.length} DIFERENCIAS`;
    }
    console.log('[REINCORPORACIÓN]', r);
    return r;
  };

  console.log('Migrador listo: await migrarAgendaBesoul() · await migrarAgendaBesoul({ ejecutar: true }) · await verificarMigracionBesoul() · await reconstruirAgendaBesoul()');
})();
