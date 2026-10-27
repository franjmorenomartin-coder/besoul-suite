// BESOUL V1 — Ingresos y gastos REALES por mes y cierre mensual (REFORMA-FINANZAS, 2026-10-27).
//
// Principio: Finanzas registra lo que BESOUL ha cobrado y pagado de verdad cada mes; no calcula
// importes teóricos. Desde MES_INICIO_REGISTRO_REAL no hay cánones automáticos (ni de entrenadores
// a BESOUL ni de BESOUL a los centros), ni tramos, ni exenciones, ni traslado de importes entre
// meses. Los meses anteriores conservan su modelo (cálculo teórico) y se consultan como estaban.
//
// Cada mes es un documento independiente: besoulFinanzasMeses/{AAAA-MM}
//   { mes, estado: 'abierto'|'revisado'|'cerrado', rev, actualizadoEn, actualizadoPor, creadoEn,
//     ingresosEntrenadores: { id: cobro }, gastosCentros: { id: gasto }, gastos: { id: gasto general },
//     otrosIngresos: { id: ingreso }, legadoImportado, revision, cierre, ultimaReapertura, historialEstados }
// Un registro nunca se borra: "eliminar" lo anula (anulado:true + quién y cuándo) y deja de sumar.
// Las escrituras son transacciones dirigidas (solo las rutas del registro tocado) con control de
// versión (rev + 1). firestore.rules impide en el servidor cualquier cambio de importes en un mes
// revisado o cerrado y exige quién/cuándo en cada cierre y reapertura, así que ni un error de la
// interfaz ni una versión antigua de la app pueden modificar un mes cerrado.
//
// Modelos especiales (no son cobros manuales):
//   - empleado (Igor): el 100 % de su facturación a clientes es ingreso de BESOUL;
//   - actividades especiales (Verónica, pilates máquinas): la parte BESOUL de su reparto.
// Estos importes los calcula Finanzas desde la Agenda y se congelan al cerrar el mes. Para un
// empleado no se admite un cobro manual (duplicaría su facturación).
//
// UMD: <script> (window.BesoulFinanzasReal) y require() en Node (pruebas). Sin dependencias del SDK.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.BesoulFinanzasReal = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MES_INICIO_REGISTRO_REAL = '2026-10';
  const COLECCION_MESES = 'besoulFinanzasMeses';
  const ESTADOS = { abierto: 'Abierto', revisado: 'Revisado', cerrado: 'Cerrado' };
  const COLECCIONES = ['ingresosEntrenadores', 'gastosCentros', 'gastos', 'otrosIngresos'];
  const ESTADOS_COBRO = { confirmado: 'Cobrado', pendiente: 'Pendiente de confirmar' };
  const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const FECHA_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const PREFIJOS = { ingresosEntrenadores: 'cob', gastosCentros: 'gce', gastos: 'gas', otrosIngresos: 'oin' };
  // Campos editables de cada tipo de registro (lo demás -- id, mes, creadoEn... -- es inmutable).
  const CAMPOS_EDITABLES = {
    ingresosEntrenadores: ['trainerKey', 'trainerNombre', 'centroId', 'centroNombre', 'fecha', 'importe', 'estado', 'observaciones'],
    gastosCentros: ['centroId', 'centroNombre', 'fecha', 'concepto', 'importe', 'observaciones'],
    gastos: ['categoria', 'concepto', 'tipo', 'trainerKey', 'fecha', 'importe', 'observaciones'],
    otrosIngresos: ['categoria', 'concepto', 'centroId', 'fecha', 'importe', 'observaciones'],
  };

  // Asignación oficial de centro por trainerKey (fuente única para Finanzas, Dashboard y la base de
  // datos de clientes de la Agenda). Un cambio de centro con fecha efectiva se registra en Finanzas
  // (trainerSettingsVersiones) y tiene prioridad sobre esta tabla.
  const CENTRO_OFICIAL_POR_ENTRENADOR = Object.freeze({
    carmen: 'alfa_prime',
    lillo: 'lagunillas', miguel_fenech: 'lagunillas', ruben: 'lagunillas', carmen_palomo: 'lagunillas', lucia: 'lagunillas', miguel: 'lagunillas',
    miguel_luna: 'fantasy',
    bea: 'inacua', soraya: 'inacua', eu: 'inacua', alvaro: 'inacua', juancarlos: 'inacua', raul: 'inacua', marina: 'inacua', yosvel: 'inacua', lolo: 'inacua', gonzalo: 'inacua', fernando: 'inacua', cristina: 'inacua',
    igor: 'inacua', manuel: 'inacua'
  });
  // Centro vigente de un entrenador en un mes según la configuración de Finanzas (solo lectura):
  // versión con fecha efectiva > configuración viva > asignación oficial. '' si no hay ninguno.
  function centroConfiguradoEntrenador(finanzas, key, mes) {
    const f = finanzas || {};
    const versiones = ((f.trainerSettingsVersiones || {})[key] || []).filter(v => v && 'centroId' in v && v.desde <= mes && (!v.hasta || mes <= v.hasta));
    versiones.sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : (a.hasta ? 1 : 0) - (b.hasta ? 1 : 0)));
    const v = versiones.length ? versiones[versiones.length - 1].centroId : ((f.trainerSettings || {})[key] || {}).centroId;
    if (v && v !== 'sin_centro') return v;
    return CENTRO_OFICIAL_POR_ENTRENADOR[key] || '';
  }
  function clonar(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function esMesRegistroReal(mes) { return String(mes || '') >= MES_INICIO_REGISTRO_REAL; }
  function redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  // "2.223,32" / "2223,32" / "2223.32" / 2223.32 -> 2223.32. Devuelve NaN si no es un importe.
  function normalizarImporte(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? redondear(v) : NaN;
    let s = String(v ?? '').trim().replace(/\s|€/g, '');
    if (!s) return NaN;
    // Formato español: «2.223,32» y «1.200» (punto de millares); sin coma, «12.5» sigue siendo decimal.
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return redondear(parseFloat(s));
  }
  function fechaValida(f) {
    const m = FECHA_RE.exec(String(f || ''));
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1;
  }
  function generarId(coleccion, ahora, aleatorio) {
    const t = (ahora ?? Date.now()).toString(36);
    const r = Math.floor((aleatorio ?? Math.random()) * 36 ** 6).toString(36).padStart(6, '0');
    return `${PREFIJOS[coleccion] || 'reg'}_${t}_${r}`;
  }

  function mapa(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function normalizarDocMes(data, mes) {
    const d = data || {};
    const estado = ESTADOS[d.estado] ? d.estado : 'abierto';
    const out = {
      mes: d.mes || mes, existe: !!data, estado, rev: Number(d.rev) || 0,
      historialEstados: Array.isArray(d.historialEstados) ? d.historialEstados : [],
      legadoImportado: d.legadoImportado || null, revision: d.revision || null,
      cierre: d.cierre || null, ultimaReapertura: d.ultimaReapertura || null,
      actualizadoPor: d.actualizadoPor || '',
    };
    COLECCIONES.forEach(c => { out[c] = mapa(d[c]); });
    return out;
  }
  function activo(r) { return !!r && r.anulado !== true; }
  function ordenar(lista) {
    return lista.slice().sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || String(a.creadoEn || '').localeCompare(String(b.creadoEn || '')) || String(a.id).localeCompare(String(b.id)));
  }
  function registros(docNorm, coleccion, opts) {
    const incluirAnulados = !!(opts && opts.incluirAnulados);
    return ordenar(Object.keys(mapa(docNorm && docNorm[coleccion])).map(id => ({ ...docNorm[coleccion][id], id })).filter(r => incluirAnulados || activo(r)));
  }

  // Registros del modelo anterior (besoulSuite/finanzas.gastos/otrosIngresos[mes], arrays sin id)
  // vistos con la forma nueva. Son datos reales registrados: se muestran y suman (marcados
  // "heredado") mientras no se hayan traspasado al documento del mes, y nunca dos veces.
  function registrosLegado(legado, coleccion, mes) {
    const lista = Array.isArray(legado && legado[coleccion]) ? legado[coleccion] : [];
    return lista.map((g, i) => ({ ...clonar(g), id: `legado_${coleccion}_${mes}_${i}`, origen: 'heredado', legadoIndice: i, observaciones: g.observaciones ?? g.notas ?? '', soloLectura: true }));
  }
  function hayLegadoPendiente(docNorm, legado) {
    if (docNorm && docNorm.legadoImportado) return false;
    return ['gastos', 'otrosIngresos'].some(c => Array.isArray(legado && legado[c]) && legado[c].length > 0);
  }
  function registrosConLegado(docNorm, legado, coleccion, mes) {
    const propios = registros(docNorm, coleccion);
    if (!['gastos', 'otrosIngresos'].includes(coleccion) || (docNorm && docNorm.legadoImportado)) return propios;
    return registrosLegado(legado, coleccion, mes).concat(propios);
  }

  function sumar(lista) { return redondear(lista.reduce((s, r) => s + (Number(r.importe) || 0), 0)); }
  // Firestore no admite claves vacías en un mapa: lo que no tiene centro/categoría se agrupa con nombre.
  const CLAVE_VACIA = { centroId: 'sin_centro', categoria: 'Sin categoría' };
  function agrupar(lista, clave) {
    const res = {};
    lista.forEach(r => { const k = r[clave] || CLAVE_VACIA[clave] || 'sin_valor'; res[k] = redondear((res[k] || 0) + (Number(r.importe) || 0)); });
    return res;
  }
  // especiales: { empleados: [{ key, nombre, centroId, importe }], actividades: [{ key, nombre, centroId, importe }] }
  function resumenMes({ doc, legado, especiales, mes }) {
    const d = doc || normalizarDocMes(null, mes);
    const cobrosTodos = registros(d, 'ingresosEntrenadores');
    const cobros = cobrosTodos.filter(r => (r.estado || 'confirmado') === 'confirmado');
    const pendientes = cobrosTodos.filter(r => r.estado === 'pendiente');
    const gastosCentros = registros(d, 'gastosCentros');
    const gastos = registrosConLegado(d, legado, 'gastos', mes);
    const otros = registrosConLegado(d, legado, 'otrosIngresos', mes);
    const empleados = (especiales && especiales.empleados) || [];
    const actividades = (especiales && especiales.actividades) || [];
    const ingresosEmpleados = sumar(empleados), ingresosActividades = sumar(actividades);
    const totalCobros = sumar(cobros), totalOtros = sumar(otros);
    const totalGastosCentros = sumar(gastosCentros), totalGastos = sumar(gastos);
    const porEntrenador = {};
    cobros.forEach(r => {
      const k = r.trainerKey || '';
      const e = porEntrenador[k] || (porEntrenador[k] = { trainerKey: k, nombre: r.trainerNombre || k, total: 0, registros: 0 });
      e.total = redondear(e.total + (Number(r.importe) || 0)); e.registros += 1;
    });
    const ingresosModelosEspeciales = redondear(ingresosEmpleados + ingresosActividades);
    const ingresosReales = redondear(totalCobros + ingresosModelosEspeciales + totalOtros);
    const gastosReales = redondear(totalGastosCentros + totalGastos);
    return {
      mes: d.mes || mes,
      cobros: { total: totalCobros, registros: cobros.length, porEntrenador, porCentro: agrupar(cobros, 'centroId'), pendiente: sumar(pendientes), registrosPendientes: pendientes.length },
      gastosCentros: { total: totalGastosCentros, registros: gastosCentros.length, porCentro: agrupar(gastosCentros, 'centroId') },
      gastosGenerales: { total: totalGastos, registros: gastos.length, porCategoria: agrupar(gastos, 'categoria'), heredados: gastos.filter(g => g.origen === 'heredado' && g.soloLectura).length },
      otrosIngresos: { total: totalOtros, registros: otros.length, heredados: otros.filter(g => g.origen === 'heredado' && g.soloLectura).length },
      modelosEspeciales: { empleados: clonar(empleados), actividades: clonar(actividades), ingresosEmpleados, ingresosActividades, total: ingresosModelosEspeciales },
      ingresosReales, gastosReales, resultado: redondear(ingresosReales - gastosReales),
    };
  }

  // ---------- Validación de registros ----------
  function validarRegistro(coleccion, r, mes, ctx) {
    const errores = [], avisos = [];
    const c = ctx || {};
    if (!CAMPOS_EDITABLES[coleccion]) { errores.push('Tipo de registro desconocido.'); return { errores, avisos }; }
    const importe = normalizarImporte(r.importe);
    if (!Number.isFinite(importe) || importe <= 0) errores.push('Indica un importe mayor que 0 (por ejemplo 175 o 2.223,32).');
    if (!fechaValida(r.fecha)) errores.push('Indica una fecha válida.');
    else if (mes && String(r.fecha).slice(0, 7) !== mes) avisos.push(`La fecha (${r.fecha}) no es de este mes: el importe se guarda igualmente SOLO en ${mes}.`);
    if (coleccion === 'ingresosEntrenadores') {
      if (!r.trainerKey) errores.push('Elige el entrenador.');
      if (!ESTADOS_COBRO[r.estado || 'confirmado']) errores.push('Estado del cobro no válido.');
      if (r.trainerKey && (c.empleados || []).includes(r.trainerKey)) errores.push('Es empleado BESOUL: su facturación ya es ingreso de BESOUL. No se registra un cobro que la duplique.');
    }
    if (coleccion === 'gastosCentros' && !r.centroId) errores.push('Elige el centro.');
    if ((coleccion === 'gastosCentros' || coleccion === 'gastos' || coleccion === 'otrosIngresos') && !String(r.concepto || '').trim()) errores.push('Indica el concepto.');
    return { errores, avisos, importe };
  }
  // Registro vigente idéntico (mismo entrenador/centro, concepto, fecha e importe): casi siempre es
  // un doble envío. Distintos cobros del mismo entrenador en el mes son normales y no coinciden.
  function claveDuplicado(coleccion, r) {
    return [coleccion, r.trainerKey || '', r.centroId || '', String(r.concepto || '').trim().toLowerCase(), r.fecha || '', redondear(normalizarImporte(r.importe))].join('|');
  }
  function buscarDuplicado(docNorm, coleccion, r) {
    const clave = claveDuplicado(coleccion, r);
    return registros(docNorm, coleccion).find(x => claveDuplicado(coleccion, x) === clave) || null;
  }
  function limpiarRegistro(coleccion, r) {
    const out = {};
    CAMPOS_EDITABLES[coleccion].forEach(k => {
      if (r[k] === undefined) return;
      out[k] = k === 'importe' ? normalizarImporte(r[k]) : (typeof r[k] === 'string' ? r[k].trim() : r[k]);
    });
    if (coleccion === 'ingresosEntrenadores' && !out.estado) out.estado = 'confirmado';
    return out;
  }

  // ---------- Operaciones sobre el documento del mes ----------
  // Cada operación devuelve { cambios: [{ ruta:[...], valor } | { ruta:[...], borrar:true }], estado? }
  // calculada sobre el documento LEÍDO EN LA TRANSACCIÓN. Lanza error con code si no procede.
  function error(code, mensaje) { return Object.assign(new Error(mensaje), { code }); }
  function exigirEstado(docNorm, permitidos, accion) {
    if (!permitidos.includes(docNorm.estado)) {
      const txt = { revisado: 'está revisado (vuelve a abrirlo para editar)', cerrado: 'está cerrado (solo administración puede reabrirlo, indicando el motivo)', abierto: 'está abierto' }[docNorm.estado];
      throw error(`mes-${docNorm.estado}`, `No se puede ${accion}: ${docNorm.mes} ${txt}.`);
    }
  }
  function planOperacion(docNorm, op, ctx) {
    const c = ctx || {};
    const ahora = c.ahoraISO || new Date().toISOString();
    const actor = c.actor || '';
    const cambios = [];
    switch (op.tipo) {
      case 'crear': {
        exigirEstado(docNorm, ['abierto'], 'añadir registros');
        const datos = limpiarRegistro(op.coleccion, op.datos || {});
        const v = validarRegistro(op.coleccion, datos, docNorm.mes, c);
        if (v.errores.length) throw error('registro-no-valido', v.errores.join(' '));
        const id = op.id || generarId(op.coleccion);
        if (docNorm[op.coleccion][id]) throw error('registro-duplicado', 'Ya existe un registro con ese identificador.');
        if (!op.permitirDuplicado && buscarDuplicado(docNorm, op.coleccion, datos)) throw error('registro-duplicado', 'Ya hay un registro idéntico en este mes (misma persona o centro, concepto, fecha e importe). No se ha registrado otra vez.');
        cambios.push({ ruta: [op.coleccion, id], valor: { ...datos, id, mes: docNorm.mes, creadoEn: ahora, creadoPor: actor } });
        return { cambios, id };
      }
      case 'crearVarios': {
        exigirEstado(docNorm, ['abierto'], 'añadir registros');
        const lista = Array.isArray(op.lista) ? op.lista : [];
        if (!lista.length) throw error('registro-no-valido', 'No hay registros que añadir.');
        const ids = [];
        let simulado = docNorm;
        lista.forEach((d, i) => {
          const datos = limpiarRegistro(op.coleccion, d || {});
          const v = validarRegistro(op.coleccion, datos, docNorm.mes, c);
          if (v.errores.length) throw error('registro-no-valido', `Registro ${i + 1}: ${v.errores.join(' ')}`);
          if (buscarDuplicado(simulado, op.coleccion, datos)) return; // ya está: no se copia dos veces
          const id = generarId(op.coleccion);
          const valor = { ...datos, id, mes: docNorm.mes, creadoEn: ahora, creadoPor: actor };
          cambios.push({ ruta: [op.coleccion, id], valor });
          simulado = { ...simulado, [op.coleccion]: { ...simulado[op.coleccion], [id]: valor } };
          ids.push(id);
        });
        return { cambios, ids, sinCambios: !cambios.length };
      }
      case 'editar': {
        exigirEstado(docNorm, ['abierto'], 'modificar registros');
        const actual = docNorm[op.coleccion][op.id];
        if (!actual) throw error('registro-inexistente', 'El registro ya no existe en el servidor.');
        if (actual.anulado) throw error('registro-anulado', 'El registro está eliminado (anulado).');
        const datos = limpiarRegistro(op.coleccion, op.datos || {});
        const v = validarRegistro(op.coleccion, { ...actual, ...datos }, docNorm.mes, c);
        if (v.errores.length) throw error('registro-no-valido', v.errores.join(' '));
        Object.keys(datos).forEach(k => { if (JSON.stringify(datos[k]) !== JSON.stringify(actual[k])) cambios.push({ ruta: [op.coleccion, op.id, k], valor: datos[k] }); });
        if (!cambios.length) return { cambios, sinCambios: true };
        cambios.push({ ruta: [op.coleccion, op.id, 'modificadoEn'], valor: ahora }, { ruta: [op.coleccion, op.id, 'modificadoPor'], valor: actor });
        return { cambios };
      }
      case 'anular': {
        exigirEstado(docNorm, ['abierto'], 'eliminar registros');
        const actual = docNorm[op.coleccion][op.id];
        if (!actual) throw error('registro-inexistente', 'El registro ya no existe en el servidor.');
        if (actual.anulado) return { cambios, sinCambios: true };
        cambios.push({ ruta: [op.coleccion, op.id, 'anulado'], valor: true }, { ruta: [op.coleccion, op.id, 'anuladoEn'], valor: ahora }, { ruta: [op.coleccion, op.id, 'anuladoPor'], valor: actor });
        if (op.motivo) cambios.push({ ruta: [op.coleccion, op.id, 'motivoAnulacion'], valor: String(op.motivo) });
        return { cambios };
      }
      case 'importarLegado': {
        exigirEstado(docNorm, ['abierto'], 'traspasar los registros heredados');
        if (docNorm.legadoImportado) throw error('legado-ya-importado', 'Los registros heredados de este mes ya se traspasaron.');
        let n = 0;
        ['gastos', 'otrosIngresos'].forEach(col => {
          registrosLegado(op.legado, col, docNorm.mes).forEach(r => {
            const { soloLectura, ...resto } = r;
            const id = `her_${col === 'gastos' ? 'gas' : 'oin'}_${docNorm.mes.replace('-', '')}_${r.legadoIndice}`;
            const importe = normalizarImporte(resto.importe);
            cambios.push({ ruta: [col, id], valor: { ...resto, id, importe: Number.isFinite(importe) ? importe : 0, mes: docNorm.mes, origen: 'heredado', importadoEn: ahora, importadoPor: actor } });
            n++;
          });
        });
        cambios.push({ ruta: ['legadoImportado'], valor: { en: ahora, por: actor, registros: n } });
        return { cambios };
      }
      case 'revisar': {
        exigirEstado(docNorm, ['abierto'], 'marcar como revisado');
        if (c.legadoPendiente) throw error('legado-pendiente', 'Antes de revisar, traspasa los registros heredados de este mes.');
        return { cambios: [{ ruta: ['revision'], valor: { por: actor, en: '__SERVER_TIME__', enISO: ahora } }, historial(docNorm, 'revisado', actor, ahora)], estado: 'revisado' };
      }
      case 'volverAbierto': {
        exigirEstado(docNorm, ['revisado'], 'volver a abrir la revisión');
        return { cambios: [historial(docNorm, 'abierto', actor, ahora, 'Vuelve a edición desde revisado')], estado: 'abierto' };
      }
      case 'cerrar': {
        exigirEstado(docNorm, ['revisado'], 'cerrar el mes (primero márcalo como revisado)');
        if (!op.snapshot || typeof op.snapshot !== 'object') throw error('cierre-sin-fotografia', 'Falta la fotografía del cierre.');
        return { cambios: [{ ruta: ['cierre'], valor: { cerradoPor: actor, cerradoEn: '__SERVER_TIME__', cerradoEnISO: ahora, snapshot: seguroParaFirestore(op.snapshot) } }, historial(docNorm, 'cerrado', actor, ahora)], estado: 'cerrado' };
      }
      case 'reabrir': {
        exigirEstado(docNorm, ['cerrado'], 'reabrir el mes');
        const motivo = String(op.motivo || '').trim();
        if (motivo.length < 5) throw error('reapertura-sin-motivo', 'Indica el motivo de la reapertura (mínimo 5 caracteres).');
        return { cambios: [{ ruta: ['ultimaReapertura'], valor: { por: actor, en: '__SERVER_TIME__', enISO: ahora, motivo } }, historial(docNorm, 'abierto', actor, ahora, motivo)], estado: 'abierto' };
      }
      default: throw error('operacion-desconocida', `Operación desconocida: ${op.tipo}`);
    }
  }
  function historial(docNorm, nuevo, actor, ahora, motivo) {
    const lista = (docNorm.historialEstados || []).concat([{ de: docNorm.estado, a: nuevo, por: actor, en: ahora, ...(motivo ? { motivo } : {}) }]);
    return { ruta: ['historialEstados'], valor: lista.slice(-50) };
  }

  // Aplica un plan sobre una copia (mismo efecto que la escritura en Firestore). Para pruebas y para
  // actualizar la vista sin esperar al snapshot.
  function aplicarPlan(data, plan, mes) {
    const r = clonar(data) || { mes, estado: 'abierto', rev: 0 };
    plan.cambios.forEach(ch => {
      let o = r;
      for (let i = 0; i < ch.ruta.length - 1; i++) { if (!o[ch.ruta[i]] || typeof o[ch.ruta[i]] !== 'object') o[ch.ruta[i]] = {}; o = o[ch.ruta[i]]; }
      const ultima = ch.ruta[ch.ruta.length - 1];
      if (ch.borrar) delete o[ultima]; else o[ultima] = clonar(ch.valor);
    });
    if (plan.estado) r.estado = plan.estado;
    r.rev = (Number(r.rev) || 0) + 1;
    return r;
  }

  // Sustituye la marca '__SERVER_TIME__' por la hora del servidor (FieldValue.serverTimestamp()).
  function conHoraServidor(valor, FieldValue) {
    if (valor === '__SERVER_TIME__') return FieldValue.serverTimestamp();
    if (Array.isArray(valor)) return valor.map(v => conHoraServidor(v, FieldValue));
    if (valor && typeof valor === 'object') { const o = {}; Object.keys(valor).forEach(k => { if (valor[k] !== undefined) o[k] = conHoraServidor(valor[k], FieldValue); }); return o; }
    return valor;
  }

  // Ejecuta una operación en una transacción: lee el mes, calcula el plan sobre lo leído y escribe
  // solo esas rutas (o crea el documento si no existe). cfg: { firestore, FieldValue, FieldPath, mes,
  // op, ctx }. Devuelve { plan, datos } (datos = documento resultante, para pintar al momento).
  async function ejecutarOperacion(cfg) {
    const { firestore, FieldValue, FieldPath, mes, op } = cfg;
    if (!MES_RE.test(String(mes || ''))) throw error('mes-no-valido', 'Mes no válido.');
    const ctxBase = cfg.ctx || {};
    const ref = firestore.collection(COLECCION_MESES).doc(mes);
    let resultado = null;
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      const docNorm = normalizarDocMes(data, mes);
      const plan = planOperacion(docNorm, op, { ...ctxBase, ahoraISO: new Date().toISOString() });
      if (!plan.cambios.length) { resultado = { plan, datos: data, sinCambios: true }; return; }
      const actor = ctxBase.actor || '';
      if (!snap.exists) {
        const inicial = aplicarPlan({ mes, estado: 'abierto', rev: 0, ingresosEntrenadores: {}, gastosCentros: {}, gastos: {}, otrosIngresos: {}, historialEstados: [] }, plan, mes);
        const nuevo = conHoraServidor({ ...inicial, rev: 1, estado: plan.estado || 'abierto' }, FieldValue);
        nuevo.creadoEn = FieldValue.serverTimestamp(); nuevo.creadoPor = actor;
        nuevo.actualizadoEn = FieldValue.serverTimestamp(); nuevo.actualizadoPor = actor;
        tx.set(ref, nuevo);
        resultado = { plan, datos: inicial };
        return;
      }
      const args = [];
      plan.cambios.forEach(ch => { args.push(new FieldPath(...ch.ruta), ch.borrar ? FieldValue.delete() : conHoraServidor(ch.valor, FieldValue)); });
      if (plan.estado) args.push(new FieldPath('estado'), plan.estado);
      args.push(new FieldPath('rev'), docNorm.rev + 1, new FieldPath('actualizadoEn'), FieldValue.serverTimestamp(), new FieldPath('actualizadoPor'), actor);
      tx.update(ref, ...args);
      resultado = { plan, datos: aplicarPlan(data, plan, mes) };
    });
    return resultado;
  }

  // Fotografía del cierre: todo lo que hace falta para consultar el mes sin recalcular nada.
  // Copia apta para guardarse en Firestore: sin claves vacías ni reservadas (__x__), sin undefined/NaN.
  function seguroParaFirestore(v) {
    if (Array.isArray(v)) return v.map(seguroParaFirestore);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).forEach(k => { if (v[k] === undefined) return; const kk = k === '' ? '(vacío)' : (/^__.*__$/.test(k) ? `_${k.replace(/^_+|_+$/g, '')}_` : k); o[kk] = seguroParaFirestore(v[k]); });
      return o;
    }
    return typeof v === 'number' && !Number.isFinite(v) ? null : v;
  }
  function construirSnapshot({ mes, doc, legado, especiales, estadistica, modelo }) {
    const d = doc || normalizarDocMes(null, mes);
    const resumen = resumenMes({ doc: d, legado, especiales, mes });
    return {
      version: 'finanzas-real-v1', mes, modelo: modelo || (esMesRegistroReal(mes) ? 'registro_real' : 'teorico_anterior'),
      resumen,
      registros: Object.fromEntries(COLECCIONES.map(col => [col, col === 'gastos' || col === 'otrosIngresos' ? registrosConLegado(d, legado, col, mes) : registros(d, col)])),
      estadistica: clonar(estadistica || null),
    };
  }

  return {
    MES_INICIO_REGISTRO_REAL, COLECCION_MESES, CENTRO_OFICIAL_POR_ENTRENADOR, centroConfiguradoEntrenador, ESTADOS, COLECCIONES, ESTADOS_COBRO, CAMPOS_EDITABLES, MES_RE,
    esMesRegistroReal, normalizarImporte, fechaValida, generarId, normalizarDocMes, registros, registrosLegado,
    registrosConLegado, hayLegadoPendiente, resumenMes, validarRegistro, limpiarRegistro, buscarDuplicado, planOperacion, aplicarPlan,
    ejecutarOperacion, construirSnapshot, seguroParaFirestore, redondear,
  };
}));
