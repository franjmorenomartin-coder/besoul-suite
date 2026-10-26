// FIX-FINANZAS-GUARDADO-SEGURO (2026-10-23) -- RESTAURACIÓN SELECTIVA de besoulSuite/finanzas tras el
// incidente del 10-10-2026 (docs/FINANZAS_GUARDADO_SEGURO.md). PREPARADO, NO EJECUTADO: ejecutarlo en
// producción requiere autorización expresa. Consola del navegador con sesión de ADMINISTRADOR (sin
// claves de servicio, plan Spark). No se carga desde ninguna página de la app.
//
//   1) Respaldo nuevo:          await respaldoBesoul()            (scripts/corte/respaldo-navegador.js)
//   2) Pegar este archivo en la consola de finanzas.html (admin).
//   3) Cargar los dos respaldos: const origen = await cargarRespaldoFinanzas()      // el del 09-10
//                                const actual = await cargarRespaldoFinanzas()      // el del paso 1
//   4) SIMULACIÓN (no escribe):  const plan = await restauracionFinanzas.planificar({ origen, actualizado: actual, rutasAprobadas: [...] })
//   5) EJECUCIÓN (autorizada):   const r = await restauracionFinanzas.ejecutar({ plan, confirmacion: 'RESTAURAR FINANZAS', motivo: '...' })
//                                -> descarga besoul-reversion-<id>.json (guárdalo)
//   6) REVERSIÓN (si hace falta): await restauracionFinanzas.revertir({ reversion: <json>, confirmacion: 'REVERTIR RESTAURACION', motivo: '...' })
//
// Garantías:
//  - Solo escribe rutas de segundo nivel (trainerSettings.<pt>, centros.<id>, ...) que estén en
//    rutasAprobadas: nada se restaura "por defecto". gastos y cualquier otro campo no se tocan nunca.
//  - Una ruta solo se escribe si en el servidor está AUSENTE (perdida en el incidente); si tiene otro
//    valor (p.ej. centros con valores por defecto, o una configuración reintroducida después) queda
//    "requiere_decision" y solo se escribe si además está en sobrescribir.
//  - Si una ruta cambió en el servidor desde el respaldo actualizado, o el documento cambió entre la
//    simulación y la ejecución, no se escribe NADA (transacción).
//  - Deja constancia en auditoriaRestauraciones.<id> y devuelve los valores anteriores para revertir.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    raiz.BesoulRestauracionFinanzas = api;
    raiz.cargarRespaldoFinanzas = api.cargarRespaldoNavegador;
    if (raiz.firebase && raiz.firebase.firestore) {
      raiz.restauracionFinanzas = api.crear({ firestore: raiz.firebase.firestore(), FieldValue: raiz.firebase.firestore.FieldValue, FieldPath: raiz.firebase.firestore.FieldPath, actor: (raiz.firebase.auth && raiz.firebase.auth().currentUser || {}).email || '' });
      console.log('Listo: cargarRespaldoFinanzas(), restauracionFinanzas.planificar(), .ejecutar(), .revertir()');
    }
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Campos cuyas entradas se perdieron el 10-10 y pueden restaurarse por clave.
  const CAMPOS_POR_CLAVE = ['trainerSettings', 'trainerSettingsVersiones', 'centrosVersiones', 'otrosIngresos', 'centros'];
  // El "historico" del 09-10 es una LISTA de formato antiguo (no un mapa de cierres por mes):
  // devolverla a "historico" rompería el cierre de meses del código actual. Se conserva aparte.
  const CAMPO_HISTORICO_LEGADO = 'historicoLegadoRestaurado';
  const CONFIRMAR = 'RESTAURAR FINANZAS', CONFIRMAR_REVERSION = 'REVERTIR RESTAURACION';
  const AUSENTE = { __ausente: true };

  const esMapa = v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.toMillis !== 'function' && typeof v.toDate !== 'function';
  function ordenar(v) {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() };
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = ordenar(v[k]); }); return o; }
    return v;
  }
  const canon = v => (v === undefined ? '__ausente__' : JSON.stringify(ordenar(v)));
  const igual = (a, b) => canon(a) === canon(b);
  const clonar = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  // Huella corta (cyrb53) del documento: detecta cualquier cambio entre simulación y ejecución.
  function huella(v) {
    const s = canon(v); let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  // Un respaldo guarda las fechas serializadas ({__ts} o {seconds,nanoseconds}): nunca se escriben así.
  function contieneFechaSerializada(v) {
    if (Array.isArray(v)) return v.some(contieneFechaSerializada);
    if (v && typeof v === 'object') {
      if ('__ts' in v || ('seconds' in v && 'nanoseconds' in v && Object.keys(v).length === 2)) return true;
      return Object.values(v).some(contieneFechaSerializada);
    }
    return false;
  }
  const finanzasDe = respaldo => { const f = respaldo && respaldo.besoulSuite && respaldo.besoulSuite.finanzas; return f ? (f.data || f) : null; };
  const nombreRuta = r => (r.clave === null ? r.campo : `${r.campo}.${r.clave}`);
  function leer(doc, r) { const v = (doc || {})[r.campo]; return r.clave === null ? v : (esMapa(v) ? v[r.clave] : undefined); }

  function rutasCandidatas(origen) {
    const rutas = [];
    CAMPOS_POR_CLAVE.forEach(campo => { if (esMapa(origen[campo])) Object.keys(origen[campo]).sort().forEach(clave => rutas.push({ campo, clave, valor: origen[campo][clave] })); });
    const h = origen.historico;
    if (h && (Array.isArray(h) ? h.length : Object.keys(h).length)) rutas.push({ campo: CAMPO_HISTORICO_LEGADO, clave: null, valor: h, nota: 'historico del 09-10 (formato antiguo); se conserva aparte, no en "historico"' });
    return rutas;
  }

  // Plan puro (sin E/S): mismo cálculo en la simulación y dentro de la transacción.
  function construirPlan({ servidor, origen, actualizado, rutasAprobadas, sobrescribir }) {
    const aprobadas = new Set(rutasAprobadas || []), forzar = new Set(sobrescribir || []);
    const rutas = rutasCandidatas(origen).map(r => {
      const ruta = nombreRuta(r);
      const vServidor = leer(servidor, r), vActualizado = actualizado ? leer(actualizado, r) : undefined;
      let estado;
      if (contieneFechaSerializada(r.valor)) estado = 'fecha_serializada';
      else if (igual(vServidor, r.valor)) estado = 'ya_restaurado';
      else if (actualizado && !igual(vServidor, vActualizado)) estado = 'cambiado_tras_respaldo';
      else if (vServidor === undefined) estado = 'restaurable';
      else estado = 'requiere_decision';
      const aprobada = aprobadas.has(ruta);
      const escribir = aprobada && (estado === 'restaurable' || (estado === 'requiere_decision' && forzar.has(ruta)));
      return { ruta, campo: r.campo, clave: r.clave, estado, aprobada, escribir, valorOrigen: r.valor, valorServidor: vServidor, nota: r.nota || '' };
    });
    const bloqueos = rutas.filter(r => r.aprobada && ['cambiado_tras_respaldo', 'fecha_serializada'].includes(r.estado)).map(r => `${r.ruta}: ${r.estado}`);
    rutas.filter(r => r.aprobada && r.estado === 'requiere_decision' && !forzar.has(r.ruta)).forEach(r => bloqueos.push(`${r.ruta}: requiere_decision (el servidor tiene otro valor; añádela a "sobrescribir" si se confirma)`));
    [...aprobadas].filter(a => !rutas.some(r => r.ruta === a)).forEach(a => bloqueos.push(`${a}: no existe en el respaldo de origen`));
    const camposCambiadosTrasRespaldo = actualizado ? [...new Set([...Object.keys(servidor), ...Object.keys(actualizado)])].filter(k => !['actualizadoEn'].includes(k) && !igual(servidor[k], actualizado[k])) : null;
    const porEstado = {}; rutas.forEach(r => { porEstado[r.estado] = (porEstado[r.estado] || 0) + 1; });
    return { rutas, bloqueos, porEstado, aEscribir: rutas.filter(r => r.escribir).map(r => r.ruta), camposCambiadosTrasRespaldo, huellaServidor: huella(servidor) };
  }

  function crear({ firestore, FieldValue, FieldPath, actor }) {
    const ref = firestore.collection('besoulSuite').doc('finanzas');
    const ruta = r => (r.clave === null ? new FieldPath(r.campo) : new FieldPath(r.campo, r.clave));

    async function planificar({ origen, actualizado, rutasAprobadas = [], sobrescribir = [] }) {
      const fOrigen = finanzasDe(origen) || origen, fActual = actualizado ? (finanzasDe(actualizado) || actualizado) : null;
      if (!fOrigen || !esMapa(fOrigen)) throw new Error('Respaldo de origen sin besoulSuite/finanzas.');
      const snap = await ref.get({ source: 'server' });
      if (!snap.exists) throw new Error('besoulSuite/finanzas no existe en el servidor.');
      const plan = construirPlan({ servidor: snap.data(), origen: fOrigen, actualizado: fActual, rutasAprobadas, sobrescribir });
      plan.entrada = { rutasAprobadas: [...rutasAprobadas], sobrescribir: [...sobrescribir], origen: infoRespaldo(origen), actualizado: infoRespaldo(actualizado) };
      plan.__origen = fOrigen; plan.__actualizado = fActual;
      if (typeof console !== 'undefined' && console.table) {
        console.table(plan.rutas.map(r => ({ ruta: r.ruta, estado: r.estado, aprobada: r.aprobada, escribir: r.escribir })));
        console.log('[RESTAURACIÓN · SIMULACIÓN] por estado:', plan.porEstado, '· a escribir:', plan.aEscribir.length, '· bloqueos:', plan.bloqueos, '· campos cambiados desde el respaldo actualizado:', plan.camposCambiadosTrasRespaldo);
      }
      return plan;
    }

    async function ejecutar({ plan, confirmacion, motivo }) {
      if (confirmacion !== CONFIRMAR) throw new Error(`Confirmación incorrecta: escribe exactamente "${CONFIRMAR}".`);
      if (!motivo || !String(motivo).trim()) throw new Error('Indica el motivo (queda en la auditoría).');
      if (!plan || !plan.__origen) throw new Error('Ejecuta primero planificar() y pasa su resultado.');
      if (plan.bloqueos.length) throw new Error('El plan tiene bloqueos; no se escribe nada:\n - ' + plan.bloqueos.join('\n - '));
      if (!plan.aEscribir.length) throw new Error('El plan no tiene rutas que escribir.');
      const id = 'rest_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17) + '_' + Math.random().toString(36).slice(2, 6);
      let reversion = null;
      await firestore.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const servidor = snap.data();
        if (huella(servidor) !== plan.huellaServidor) throw new Error('El documento ha cambiado desde la simulación. No se escribe nada: repite planificar().');
        const nuevo = construirPlan({ servidor, origen: plan.__origen, actualizado: plan.__actualizado, rutasAprobadas: plan.entrada.rutasAprobadas, sobrescribir: plan.entrada.sobrescribir });
        if (nuevo.bloqueos.length || canon(nuevo.aEscribir) !== canon(plan.aEscribir)) throw new Error('El plan ya no coincide con el servidor. No se escribe nada.');
        const escribir = nuevo.rutas.filter(r => r.escribir);
        const args = [];
        escribir.forEach(r => { args.push(ruta(r), clonar(r.valorOrigen)); });
        reversion = {
          id, creadaEn: new Date().toISOString(), por: actor || '',
          rutas: escribir.map(r => ({ campo: r.campo, clave: r.clave, anterior: r.valorServidor === undefined ? AUSENTE : clonar(r.valorServidor), restaurado: clonar(r.valorOrigen) })),
        };
        args.push(new FieldPath('auditoriaRestauraciones', id), {
          accion: 'restauracion', fecha: reversion.creadaEn, por: actor || '', motivo: String(motivo),
          origen: plan.entrada.origen, actualizado: plan.entrada.actualizado, rutas: escribir.map(r => r.ruta),
          huellaAntes: plan.huellaServidor,
        });
        args.push(new FieldPath('actualizadoEn'), FieldValue.serverTimestamp(), new FieldPath('actualizadoPor'), actor || ''); args.push(new FieldPath('guardadoSeguroEn'), FieldValue.serverTimestamp());
        tx.update(ref, ...args);
      });
      descargar(`besoul-reversion-${id}.json`, reversion);
      console.log(`[RESTAURACIÓN] ${reversion.rutas.length} ruta(s) restauradas · id=${id} · guarda el archivo de reversión.`);
      return { id, rutasEscritas: reversion.rutas.map(nombreRuta), reversion };
    }

    async function revertir({ reversion, confirmacion, motivo }) {
      if (confirmacion !== CONFIRMAR_REVERSION) throw new Error(`Confirmación incorrecta: escribe exactamente "${CONFIRMAR_REVERSION}".`);
      if (!reversion || !Array.isArray(reversion.rutas) || !reversion.rutas.length) throw new Error('Archivo de reversión no válido.');
      // La reversión NUNCA vuelve a vaciar ni borra configuración: solo devuelve su valor anterior a
      // las rutas que la restauración SOBRESCRIBIÓ (tenían otro valor). Las rutas que estaban
      // ausentes (perdidas en el incidente) se mantienen y se listan para corregirlas una a una
      // desde Finanzas si administración decide que el valor del respaldo no era el correcto.
      const aRevertir = reversion.rutas.filter(r => !(r.anterior && r.anterior.__ausente));
      const seMantienen = reversion.rutas.filter(r => r.anterior && r.anterior.__ausente).map(nombreRuta);
      if (!aRevertir.length) throw new Error('Ninguna ruta de esta restauración sobrescribió un valor existente; no hay nada que revertir. Rutas que se mantienen (corregir desde Finanzas si procede):\n - ' + seMantienen.join('\n - '));
      await firestore.runTransaction(async tx => {
        const servidor = (await tx.get(ref)).data();
        const cambiadas = aRevertir.filter(r => !igual(leer(servidor, r), r.restaurado)).map(nombreRuta);
        if (cambiadas.length) throw new Error('Estas rutas han cambiado desde la restauración; no se revierte nada:\n - ' + cambiadas.join('\n - '));
        const args = [];
        aRevertir.forEach(r => { args.push(ruta(r), clonar(r.anterior)); });
        const idRev = 'rev_' + reversion.id;
        args.push(new FieldPath('auditoriaRestauraciones', idRev), { accion: 'reversion', de: reversion.id, fecha: new Date().toISOString(), por: actor || '', motivo: String(motivo || ''), rutas: aRevertir.map(nombreRuta), seMantienen });
        args.push(new FieldPath('actualizadoEn'), FieldValue.serverTimestamp(), new FieldPath('actualizadoPor'), actor || ''); args.push(new FieldPath('guardadoSeguroEn'), FieldValue.serverTimestamp());
        tx.update(ref, ...args);
      });
      console.log(`[RESTAURACIÓN] revertida ${reversion.id}: ${aRevertir.length} ruta(s) a su valor anterior; se mantienen ${seMantienen.length}.`);
      return { ok: true, revertidas: aRevertir.map(nombreRuta), seMantienen };
    }
    return { planificar, ejecutar, revertir };
  }

  function infoRespaldo(r) { return r && r.exportadoEn ? { exportadoEn: r.exportadoEn, sha256: r.__sha256 || '', nombre: r.__nombre || '' } : null; }
  function descargar(nombre, datos) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
  }
  // Selector de archivo en el navegador: lee el respaldo y calcula su SHA-256 (compáralo con el .sha256).
  function cargarRespaldoNavegador() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
      input.onchange = async () => {
        try {
          const f = input.files[0]; const texto = await f.text();
          const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))].map(x => x.toString(16).padStart(2, '0')).join('');
          const datos = JSON.parse(texto); datos.__sha256 = sha; datos.__nombre = f.name;
          console.log(`[RESTAURACIÓN] ${f.name} · sha256=${sha} · exportadoEn=${datos.exportadoEn}`); resolve(datos);
        } catch (e) { reject(e); }
      };
      input.click();
    });
  }

  return { crear, construirPlan, rutasCandidatas, huella, canon, igual, cargarRespaldoNavegador, CONFIRMAR, CONFIRMAR_REVERSION, CAMPO_HISTORICO_LEGADO };
}));
