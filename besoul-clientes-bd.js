// BESOUL -- CLIENTES-BD (2026-10-27): base de datos de clientes de la Agenda (solo administración).
//
// Funciones PURAS (sin DOM ni Firestore) que convierten los datos ya cargados en la Agenda en filas
// para consultar, filtrar, ordenar y exportar: clientes, grupos, integrantes y tarifas. No modifican
// nada de lo que reciben (trabajan sobre copias) y no inventan datos: un campo que no existe en la
// ficha se deja vacío (nunca 0). El importe de cada cliente lo calcula la propia Agenda (callback
// `precio`), para no duplicar la lógica de facturación.
//
// Un grupo cerrado NO es una fila de cliente: cada integrante con ficha propia es su fila (con el
// grupo indicado), y el grupo aparece en la hoja Grupos. Así nadie se cuenta dos veces.
// Nunca se incluye el token de reservas, contraseñas, contratos ni notas de salud o comerciales.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.BesoulClientesBD = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ESTADOS = { activo: 'Activo', inactivo: 'Inactivo temporal', baja: 'Baja definitiva', prueba: 'En prueba' };
  const GRUPOS_FILTRO = { sin_grupo: 'Sin grupo', grupo_cerrado: 'En grupo cerrado', grupo_abierto: 'En grupo abierto' };

  // tipo: texto | numero | importe | fecha (las fechas se exportan como texto AAAA-MM-DD).
  const COLUMNAS_CLIENTES = [
    { clave: 'id', titulo: 'ID', tipo: 'texto' },
    { clave: 'nombre', titulo: 'Nombre', tipo: 'texto' },
    { clave: 'apellidos', titulo: 'Apellidos', tipo: 'texto' },
    { clave: 'nombreCompleto', titulo: 'Nombre completo', tipo: 'texto' },
    { clave: 'telefono', titulo: 'Teléfono', tipo: 'texto' },
    { clave: 'email', titulo: 'Email', tipo: 'texto' },
    { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
    { clave: 'fechaAlta', titulo: 'Fecha alta', tipo: 'fecha' },
    { clave: 'fechaBaja', titulo: 'Fecha baja', tipo: 'fecha' },
    { clave: 'entrenadorNombre', titulo: 'Entrenador', tipo: 'texto' },
    { clave: 'trainerKey', titulo: 'trainerKey', tipo: 'texto' },
    { clave: 'centro', titulo: 'Centro', tipo: 'texto' },
    { clave: 'modalidad', titulo: 'Modalidad', tipo: 'texto' },
    { clave: 'tipoTarifa', titulo: 'Tipo tarifa', tipo: 'texto' },
    { clave: 'plan', titulo: 'Nombre del plan', tipo: 'texto' },
    { clave: 'precioBase', titulo: 'Precio base', tipo: 'importe' },
    { clave: 'descuentoPct', titulo: 'Descuento (%)', tipo: 'numero' },
    { clave: 'descuentoImporte', titulo: 'Descuento (€)', tipo: 'importe' },
    { clave: 'precioFinal', titulo: 'Precio final', tipo: 'importe' },
    { clave: 'frecuenciaSemanal', titulo: 'Frecuencia semanal', tipo: 'numero' },
    { clave: 'sesionesMensuales', titulo: 'Sesiones mensuales', tipo: 'numero' },
    { clave: 'grupoNombre', titulo: 'Grupo', tipo: 'texto' },
    { clave: 'grupoId', titulo: 'ID grupo', tipo: 'texto' },
    { clave: 'grupoIntegrantes', titulo: 'Nº integrantes', tipo: 'numero' },
    { clave: 'grupoListaIntegrantes', titulo: 'Integrantes', tipo: 'texto' },
    { clave: 'actividad', titulo: 'Actividad', tipo: 'texto' },
    { clave: 'sesionesRealizadas', titulo: 'Sesiones realizadas', tipo: 'numero' },
    { clave: 'sesionesPendientes', titulo: 'Sesiones pendientes', tipo: 'numero' },
    { clave: 'sesionesCanceladas', titulo: 'Sesiones canceladas', tipo: 'numero' },
    { clave: 'ultimaSesion', titulo: 'Última sesión', tipo: 'texto' },
    { clave: 'proximaSesion', titulo: 'Próxima sesión', tipo: 'texto' },
    { clave: 'fechaCreacion', titulo: 'Fecha creación', tipo: 'texto' },
    { clave: 'ultimaModificacion', titulo: 'Última modificación', tipo: 'texto' },
    { clave: 'observaciones', titulo: 'Observaciones administrativas', tipo: 'texto' },
  ];
  const COLUMNAS_GRUPOS = [
    { clave: 'id', titulo: 'ID grupo', tipo: 'texto' },
    { clave: 'nombre', titulo: 'Grupo', tipo: 'texto' },
    { clave: 'tipoGrupo', titulo: 'Tipo', tipo: 'texto' },
    { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
    { clave: 'entrenadorNombre', titulo: 'Entrenador', tipo: 'texto' },
    { clave: 'trainerKey', titulo: 'trainerKey', tipo: 'texto' },
    { clave: 'centro', titulo: 'Centro', tipo: 'texto' },
    { clave: 'modalidad', titulo: 'Modalidad', tipo: 'texto' },
    { clave: 'tipoTarifa', titulo: 'Tipo tarifa', tipo: 'texto' },
    { clave: 'plan', titulo: 'Nombre del plan', tipo: 'texto' },
    { clave: 'precioPorPersona', titulo: 'Precio base por persona', tipo: 'importe' },
    { clave: 'integrantes', titulo: 'Nº integrantes', tipo: 'numero' },
    { clave: 'capacidad', titulo: 'Capacidad (abierto)', tipo: 'numero' },
    { clave: 'listaIntegrantes', titulo: 'Integrantes', tipo: 'texto' },
    { clave: 'totalGrupo', titulo: 'Total del grupo (precio final)', tipo: 'importe' },
    { clave: 'sesionesRealizadas', titulo: 'Sesiones realizadas', tipo: 'numero' },
    { clave: 'sesionesPendientes', titulo: 'Sesiones pendientes', tipo: 'numero' },
    { clave: 'ultimaSesion', titulo: 'Última sesión', tipo: 'texto' },
    { clave: 'proximaSesion', titulo: 'Próxima sesión', tipo: 'texto' },
    { clave: 'fechaAlta', titulo: 'Fecha alta', tipo: 'fecha' },
  ];
  const COLUMNAS_INTEGRANTES = [
    { clave: 'grupoId', titulo: 'ID grupo', tipo: 'texto' },
    { clave: 'grupoNombre', titulo: 'Grupo', tipo: 'texto' },
    { clave: 'tipoGrupo', titulo: 'Tipo de grupo', tipo: 'texto' },
    { clave: 'integranteId', titulo: 'ID integrante', tipo: 'texto' },
    { clave: 'clienteId', titulo: 'ID ficha cliente', tipo: 'texto' },
    { clave: 'nombre', titulo: 'Nombre', tipo: 'texto' },
    { clave: 'telefono', titulo: 'Teléfono', tipo: 'texto' },
    { clave: 'email', titulo: 'Email', tipo: 'texto' },
    { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
    { clave: 'descuentoPct', titulo: 'Descuento (%)', tipo: 'numero' },
    { clave: 'precioFinal', titulo: 'Precio final', tipo: 'importe' },
    { clave: 'entrenadorNombre', titulo: 'Entrenador', tipo: 'texto' },
    { clave: 'trainerKey', titulo: 'trainerKey', tipo: 'texto' },
  ];
  const COLUMNAS_TARIFAS = [
    { clave: 'tipo', titulo: 'Tipo', tipo: 'texto' },
    { clave: 'modalidad', titulo: 'Modalidad / actividad', tipo: 'texto' },
    { clave: 'variante', titulo: 'Variante', tipo: 'texto' },
    { clave: 'sesiones', titulo: 'Sesiones (semana / bono / plan)', tipo: 'numero' },
    { clave: 'precio', titulo: 'Precio', tipo: 'importe' },
    { clave: 'porPersona', titulo: 'Precio por persona', tipo: 'texto' },
    { clave: 'clientesActivos', titulo: 'Clientes activos con esta tarifa', tipo: 'numero' },
  ];

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const txt = v => (v === undefined || v === null) ? '' : String(v).trim();
  const vacio = v => v === undefined || v === null || v === '';
  function fechaTexto(v) {
    if (vacio(v)) return '';
    if (typeof v === 'object' && typeof v.toDate === 'function') { try { return v.toDate().toISOString().slice(0, 10); } catch (e) { return ''; } }
    if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString().slice(0, 10);
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  }
  function estadoDe(f) { const e = String((f && f.estadoCliente) || 'activo'); return ['activo', 'inactivo', 'baja'].includes(e) ? e : 'activo'; }
  function esGrupoAbierto(f) { return !!(f && (f.grupoAbierto === true || f.tipoCita === 'grupo_abierto')); }
  function esMiembro(f) { return !!(f && f.vinculacion); }
  function esPrueba(c) { return !!(c && (c.esPruebaCRM === true || c.tipoCita === 'pruebaCRM')); }
  function modalidadBase(m) { return String(m || ''); }

  function tipoTarifaFicha(f) {
    if (!f) return '';
    if (f.actividadEspecialId) return txt(f.tipoCompra) || 'Mensualidad';
    const m = modalidadBase(f.modalidad);
    if (m.includes('Suelta')) return 'Sesión suelta';
    if (m.includes('Bono') || f.tipoCompra === 'Bono') return 'Bono';
    return txt(f.tipoCompra) || (m ? 'Mensualidad' : '');
  }
  function categoriaModalidad(f, grupo) {
    if (!f) return '';
    if (f.actividadEspecialId) return 'Actividad especial';
    if (grupo) return esGrupoAbierto(grupo) ? 'Grupo abierto' : 'Grupo cerrado';
    if (f.tipo === 'grupo') return esGrupoAbierto(f) ? 'Grupo abierto' : 'Grupo cerrado';
    const m = modalidadBase(f.modalidad);
    if (m.includes('Pareja')) return 'Pareja';
    if (m.includes('Trío') || m.includes('Trio')) return 'Trío';
    if (m.includes('Grupo')) return 'Grupo reducido';
    if (m.includes('Individual')) return 'Individual';
    return m;
  }
  function sesionesMensualesFicha(f) {
    if (!f || f.actividadEspecialId) return '';
    const tipo = tipoTarifaFicha(f);
    if (tipo !== 'Mensualidad') return '';
    const factor = parseInt(f.factor, 10);
    return Number.isFinite(factor) && factor > 0 ? factor * 4 : '';
  }
  function frecuenciaFicha(f) {
    if (!f || f.actividadEspecialId) return '';
    if (tipoTarifaFicha(f) !== 'Mensualidad') return '';
    const factor = parseInt(f.factor, 10);
    return Number.isFinite(factor) && factor > 0 ? factor : '';
  }
  function planFicha(f, actividades) {
    if (!f) return '';
    if (f.actividadEspecialId) {
      const act = actividades && actividades[f.actividadEspecialId];
      const mod = act && act.modalidades && act.modalidades[f.modalidadId];
      const seg = mod && mod.segmentos && mod.segmentos[f.segmentoId];
      const partes = [act ? act.nombre : f.actividadEspecialId, mod ? (mod.nombre || f.modalidadId) : f.modalidadId, seg ? (seg.nombre || f.segmentoId) : f.segmentoId];
      return partes.filter(Boolean).join(' · ') + (vacio(f.planSesiones) ? '' : ` · ${f.planSesiones} sesiones`);
    }
    const m = modalidadBase(f.modalidad);
    const tipo = tipoTarifaFicha(f);
    if (tipo === 'Mensualidad' && !vacio(f.factor)) return `${m} · ${f.factor} día(s)/semana`;
    return m;
  }

  // Índice de sesiones por id de ficha (y por lead para las pruebas CRM).
  function indexarSesiones(agenda, ahoraISO) {
    const idx = {};
    const add = (id, s) => { if (!id) return; (idx[id] = idx[id] || []).push(s); };
    Object.keys(agenda || {}).forEach(clave => {
      const c = agenda[clave];
      if (!c || typeof c !== 'object') return;
      const [fecha, hora] = String(clave).split('_');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return;
      const cuando = `${fecha} ${hora || '00:00'}`;
      const cancelada = c.estadoCancelacion === 'cancelada_fuera_plazo';
      const s = { cuando, cancelada, futura: cuando >= ahoraISO };
      if (esPrueba(c)) { add(c.leadId ? `lead:${c.leadId}` : null, s); return; }
      add(c.id, s);
      if (Array.isArray(c.asistentesGrupoAbierto)) c.asistentesGrupoAbierto.forEach(a => { const id = a && (a.id || a.clientId); if (id && id !== c.id) add(id, s); });
    });
    return idx;
  }
  function resumenSesiones(listas) {
    const todas = [].concat(...listas.filter(Boolean));
    const vistas = new Set();
    const unicas = todas.filter(s => { const k = s.cuando; if (vistas.has(k)) return false; vistas.add(k); return true; });
    const realizadas = unicas.filter(s => !s.cancelada && !s.futura).map(s => s.cuando).sort();
    const pendientes = unicas.filter(s => !s.cancelada && s.futura).map(s => s.cuando).sort();
    return {
      sesionesRealizadas: realizadas.length,
      sesionesPendientes: pendientes.length,
      sesionesCanceladas: unicas.filter(s => s.cancelada).length,
      ultimaSesion: realizadas.length ? realizadas[realizadas.length - 1] : '',
      proximaSesion: pendientes.length ? pendientes[0] : '',
    };
  }

  // entrada: { clientes:{tk:[ficha]}, agenda:{tk:{clave:cita}}, pruebasCRM:{tk:{clave:cita}},
  //   entrenadores:{tk:{nombre, centro}}, ahora:Date, precio:(ficha, tk, grupo)=>({base, final}),
  //   tarifas: TARIFAS_2026, actividades: catálogo }
  function construir(entrada) {
    const e = entrada || {};
    const clientes = e.clientes || {}, agenda = e.agenda || {}, pruebas = e.pruebasCRM || {};
    const entrenadores = e.entrenadores || {};
    const ahora = e.ahora instanceof Date ? e.ahora : new Date();
    const pad = n => String(n).padStart(2, '0');
    const ahoraISO = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())} ${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
    const precio = typeof e.precio === 'function' ? e.precio : () => ({ base: '', final: '' });
    const actividades = e.actividades || {};
    const filas = [], grupos = [], integrantes = [];
    const tks = [...new Set([...Object.keys(clientes), ...Object.keys(pruebas)])].sort();
    const conLead = new Set();

    tks.forEach(tk => {
      const lista = (Array.isArray(clientes[tk]) ? clientes[tk] : []).filter(f => f && typeof f === 'object');
      const ent = entrenadores[tk] || {};
      const entrenadorNombre = txt(ent.nombre) || tk;
      const centro = txt(ent.centro);
      const sesiones = indexarSesiones(agenda[tk], ahoraISO);
      const porId = {};
      lista.forEach(f => { if (f.id) porId[f.id] = f; });
      // Asistencia a grupos abiertos: id de ficha -> grupos abiertos a los que asiste.
      const enAbiertos = {};
      lista.filter(f => f.tipo === 'grupo' && esGrupoAbierto(f)).forEach(g => {
        (Array.isArray(g.integrantesObj) ? g.integrantesObj : []).forEach(m => { const id = m && (m.clienteId || m.id); if (id) (enAbiertos[id] = enAbiertos[id] || []).push(g); });
      });
      Object.values(agenda[tk] || {}).forEach(c => {
        if (!c || !esGrupoAbierto(c) || !Array.isArray(c.asistentesGrupoAbierto)) return;
        const g = porId[c.id];
        if (!g) return;
        c.asistentesGrupoAbierto.forEach(a => { const id = a && (a.id || a.clientId); if (id && !(enAbiertos[id] || []).includes(g)) (enAbiertos[id] = enAbiertos[id] || []).push(g); });
      });

      lista.forEach(f => {
        if (f.leadId) conLead.add(`${tk}|${f.leadId}`);
        if (f.tipo === 'grupo') {
          const abierto = esGrupoAbierto(f);
          const miembros = Array.isArray(f.integrantesObj) ? f.integrantesObj : [];
          const fichasMiembro = lista.filter(x => x.vinculacion === f.id);
          const total = abierto ? '' : r2(fichasMiembro.length ? fichasMiembro.reduce((s, m) => s + (Number(precio(m, tk, f).final) || 0), 0) : (Number(precio(f, tk, null).final) || 0));
          const p = precio(f, tk, null);
          grupos.push({
            id: txt(f.id), nombre: txt(f.nombre), tipoGrupo: abierto ? 'Grupo abierto' : 'Grupo cerrado', estado: ESTADOS[estadoDe(f)],
            entrenadorNombre, trainerKey: tk, centro, modalidad: modalidadBase(f.modalidad), tipoTarifa: tipoTarifaFicha(f), plan: planFicha(f, actividades),
            precioPorPersona: vacio(p.unitario) ? '' : r2(p.unitario), integrantes: abierto ? '' : miembros.length, capacidad: abierto ? (parseInt(f.capacidadGrupoAbierto || f.capacidad, 10) || '') : '',
            listaIntegrantes: miembros.map(m => txt(m && m.nombre)).filter(Boolean).join(', '), totalGrupo: total,
            ...resumenSesiones([sesiones[f.id]]), fechaAlta: fechaTexto(f.fechaAlta),
          });
          miembros.forEach(m => {
            if (!m) return;
            const ficha = fichasMiembro.find(x => x.memberId === m.id) || (m.clienteId ? porId[m.clienteId] : null);
            integrantes.push({
              grupoId: txt(f.id), grupoNombre: txt(f.nombre), tipoGrupo: abierto ? 'Grupo abierto' : 'Grupo cerrado',
              integranteId: txt(m.id), clienteId: ficha ? txt(ficha.id) : '', nombre: txt((ficha && ficha.nombre) || m.nombre),
              telefono: txt((ficha && ficha.telefono) || m.telefono), email: txt((ficha && ficha.email) || m.email),
              estado: ficha ? ESTADOS[estadoDe(ficha)] : ESTADOS[estadoDe(f)],
              descuentoPct: ficha && !vacio(ficha.descuentoPct) ? Number(String(ficha.descuentoPct).replace(',', '.')) || 0 : '',
              precioFinal: ficha ? r2(precio(ficha, tk, f).final) : '', entrenadorNombre, trainerKey: tk,
            });
          });
          return;
        }
        const grupo = esMiembro(f) ? porId[f.vinculacion] || null : null;
        const fichaTarifa = grupo || f;
        const p = precio(f, tk, grupo);
        const base = vacio(p.base) ? '' : r2(p.base);
        const final = vacio(p.final) ? '' : r2(p.final);
        const descPct = f.actividadEspecialId || vacio(f.descuentoPct) ? '' : (Number(String(f.descuentoPct).replace(',', '.')) || 0);
        const estado = estadoDe(f);
        const abiertos = enAbiertos[f.id] || [];
        const miembrosGrupo = grupo && Array.isArray(grupo.integrantesObj) ? grupo.integrantesObj : [];
        filas.push({
          id: txt(f.id), nombre: txt(f.nombre), apellidos: txt(f.apellidos),
          nombreCompleto: [txt(f.nombre), txt(f.apellidos)].filter(Boolean).join(' '),
          telefono: txt(f.telefono), email: txt(f.email),
          estado: ESTADOS[estado], estadoClave: estado,
          fechaAlta: fechaTexto(f.fechaAlta), fechaBaja: estado === 'baja' ? fechaTexto(f.fechaEstado) : '',
          entrenadorNombre, trainerKey: tk, centro,
          modalidad: categoriaModalidad(f, grupo), modalidadDetalle: modalidadBase(fichaTarifa.modalidad),
          tipoTarifa: tipoTarifaFicha(fichaTarifa), plan: planFicha(f.actividadEspecialId ? f : fichaTarifa, actividades),
          precioBase: base, descuentoPct: descPct,
          descuentoImporte: base === '' || final === '' ? '' : r2(Math.max(0, base - final)),
          precioFinal: final,
          frecuenciaSemanal: frecuenciaFicha(fichaTarifa), sesionesMensuales: sesionesMensualesFicha(fichaTarifa),
          grupoNombre: grupo ? txt(grupo.nombre) : abiertos.map(g => txt(g.nombre)).join(', '),
          grupoId: grupo ? txt(grupo.id) : abiertos.map(g => txt(g.id)).join(', '),
          grupoIntegrantes: grupo ? miembrosGrupo.length : '',
          grupoListaIntegrantes: grupo ? miembrosGrupo.map(m => txt(m && m.nombre)).filter(Boolean).join(', ') : '',
          grupoFiltro: grupo ? 'grupo_cerrado' : (abiertos.length ? 'grupo_abierto' : 'sin_grupo'),
          actividad: f.actividadEspecialId ? txt((actividades[f.actividadEspecialId] || {}).nombre || f.actividadEspecialId) : '',
          actividadId: txt(f.actividadEspecialId),
          ...resumenSesiones([sesiones[f.id], grupo ? sesiones[grupo.id] : null]),
          fechaCreacion: fechaTexto(f.creadoEn || f.fechaCreacion || f.creadoDesdeCRMEn),
          ultimaModificacion: fechaTexto(f.actualizadoEn || f.modificadoEn || f.ultimaModificacion || f.updatedAt),
          observaciones: txt(f.observacionesEstado),
          conDescuento: descPct !== '' && descPct > 0,
        });
      });

      // Pruebas CRM (leads en prueba): una fila por lead que aún no tiene ficha de cliente.
      const leadsVistos = new Set();
      Object.keys(pruebas[tk] || {}).sort().forEach(clave => {
        const c = pruebas[tk][clave];
        if (!c || !esPrueba(c)) return;
        const lid = c.leadId || `${tk}_${clave}`;
        if (leadsVistos.has(lid) || conLead.has(`${tk}|${c.leadId}`)) return;
        leadsVistos.add(lid);
        filas.push({
          id: txt(c.leadId ? `lead_${c.leadId}` : `prueba_${clave}`), nombre: txt(c.nombre), apellidos: txt(c.apellidos),
          nombreCompleto: [txt(c.nombre), txt(c.apellidos)].filter(Boolean).join(' '),
          telefono: txt(c.telefono), email: txt(c.email), estado: ESTADOS.prueba, estadoClave: 'prueba',
          fechaAlta: '', fechaBaja: '', entrenadorNombre, trainerKey: tk, centro: centro || txt(c.centroNombre),
          modalidad: 'Prueba CRM', modalidadDetalle: txt(c.tipoPrueba), tipoTarifa: 'Prueba (no facturable)', plan: txt(c.tipoPrueba),
          precioBase: '', descuentoPct: '', descuentoImporte: '', precioFinal: '', frecuenciaSemanal: '', sesionesMensuales: '',
          grupoNombre: '', grupoId: '', grupoIntegrantes: '', grupoListaIntegrantes: '', grupoFiltro: 'sin_grupo', actividad: '', actividadId: '',
          ...resumenSesiones([sesiones[`lead:${c.leadId}`]]),
          fechaCreacion: fechaTexto(c.creadoDesdeCRMEn), ultimaModificacion: fechaTexto(c.updatedAt), observaciones: '', conDescuento: false,
        });
      });
    });

    // Tarifas: catálogo estándar y de actividades, con cuántos clientes activos la usan.
    const tarifas = [];
    const usoClave = {};
    filas.filter(f => f.estadoClave === 'activo').forEach(f => { const k = `${f.modalidadDetalle}|${f.frecuenciaSemanal || ''}|${f.actividadId}`; usoClave[k] = (usoClave[k] || 0) + 1; });
    Object.keys(e.tarifas || {}).forEach(mod => {
      if (mod === 'Miembro Subordinado') return;
      const tabla = e.tarifas[mod] || {};
      Object.keys(tabla).forEach(n => {
        const esPlan = !mod.includes('Bono') && !mod.includes('Suelta');
        tarifas.push({ tipo: 'Tarifa estándar', modalidad: mod, variante: esPlan ? `${n} día(s)/semana` : (mod.includes('Bono') ? `Bono ${n} sesiones` : 'Sesión suelta'), sesiones: Number(n), precio: r2(tabla[n]), porPersona: /Pareja|Trío|Grupo/.test(mod) ? 'Sí' : 'No', clientesActivos: esPlan ? (usoClave[`${mod}|${n}|`] || 0) : (usoClave[`${mod}||`] || 0) });
      });
    });
    Object.values(actividades).forEach(act => {
      if (!act) return;
      Object.keys(act.modalidades || {}).forEach(mid => {
        const mod = act.modalidades[mid] || {};
        Object.keys(mod.segmentos || {}).forEach(sid => {
          const seg = mod.segmentos[sid] || {};
          (seg.planes || []).forEach(pl => {
            tarifas.push({ tipo: 'Actividad especial', modalidad: txt(act.nombre || act.id), variante: [mod.nombre || mid, seg.nombre || sid].join(' · '), sesiones: Number(pl.sesiones) || '', precio: r2(pl.precio), porPersona: seg.porPersona ? 'Sí' : 'No', clientesActivos: '' });
          });
        });
      });
    });
    return { clientes: filas, grupos, integrantes, tarifas };
  }

  function normalizarBusqueda(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // filtros: { texto, trainerKey, centro, estado, modalidad, tipoTarifa, actividad, grupo, conDescuento }
  function filtrar(filas, filtros) {
    const f = filtros || {};
    const q = normalizarBusqueda(f.texto).trim();
    const qTel = String(f.texto || '').replace(/\D/g, '');
    return (filas || []).filter(r => {
      if (q) {
        const enTexto = [r.nombreCompleto, r.email].some(v => normalizarBusqueda(v).includes(q));
        const enTel = qTel.length >= 3 && String(r.telefono || '').replace(/\D/g, '').includes(qTel);
        if (!enTexto && !enTel) return false;
      }
      if (f.trainerKey && r.trainerKey !== f.trainerKey) return false;
      if (f.centro && r.centro !== f.centro) return false;
      if (f.estado && r.estadoClave !== f.estado) return false;
      if (f.modalidad && r.modalidad !== f.modalidad) return false;
      if (f.tipoTarifa && r.tipoTarifa !== f.tipoTarifa) return false;
      if (f.actividad && r.actividadId !== f.actividad) return false;
      if (f.grupo && r.grupoFiltro !== f.grupo) return false;
      if (f.conDescuento === 'si' && !r.conDescuento) return false;
      if (f.conDescuento === 'no' && r.conDescuento) return false;
      return true;
    });
  }
  // Orden estable; los vacíos siempre al final (en ambos sentidos).
  function ordenar(filas, clave, sentido) {
    const dir = sentido === 'desc' ? -1 : 1;
    return (filas || []).map((r, i) => ({ r, i })).sort((a, b) => {
      const va = a.r[clave], vb = b.r[clave];
      const ea = va === '' || va === null || va === undefined, eb = vb === '' || vb === null || vb === undefined;
      if (ea || eb) return ea === eb ? a.i - b.i : (ea ? 1 : -1);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
      return c !== 0 ? c * dir : a.i - b.i;
    }).map(x => x.r);
  }
  function valoresDistintos(filas, clave) { return [...new Set((filas || []).map(r => r[clave]).filter(v => v !== '' && v !== null && v !== undefined))].sort((a, b) => String(a).localeCompare(String(b), 'es')); }
  // Hojas del Excel. `columnasClientes` permite exportar solo las columnas elegidas.
  function hojas(bd, filasClientes, columnasClientes) {
    const cols = columnasClientes && columnasClientes.length ? COLUMNAS_CLIENTES.filter(c => columnasClientes.includes(c.clave)) : COLUMNAS_CLIENTES;
    const ids = new Set((filasClientes || bd.clientes).map(r => r.trainerKey + '|' + r.grupoId));
    const parcial = filasClientes && filasClientes.length !== bd.clientes.length;
    const grupos = parcial ? bd.grupos.filter(g => ids.has(g.trainerKey + '|' + g.id)) : bd.grupos;
    const idsGrupos = new Set(grupos.map(g => g.trainerKey + '|' + g.id));
    return [
      { nombre: 'Clientes', filas: filasClientes || bd.clientes, columnas: cols },
      { nombre: 'Grupos', filas: grupos, columnas: COLUMNAS_GRUPOS },
      { nombre: 'Integrantes', filas: bd.integrantes.filter(m => idsGrupos.has(m.trainerKey + '|' + m.grupoId)), columnas: COLUMNAS_INTEGRANTES },
      { nombre: 'Tarifas', filas: bd.tarifas, columnas: COLUMNAS_TARIFAS },
    ];
  }

  return { ESTADOS, GRUPOS_FILTRO, COLUMNAS_CLIENTES, COLUMNAS_GRUPOS, COLUMNAS_INTEGRANTES, COLUMNAS_TARIFAS, construir, filtrar, ordenar, valoresDistintos, hojas, indexarSesiones, resumenSesiones };
}));
