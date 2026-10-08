// BESOUL V1 -- IMPORTACIÓN EXCEL DE CLIENTES Y AGENDA (IMPORT-V1-EXCEL-CLIENTES-AGENDA).
//
// Módulo PURO (sin DOM, sin Firestore): catálogo, plantilla .xlsx oficial, lectura del Excel,
// validación y planificación de la importación. agenda.html lo carga y le inyecta las funciones
// REALES de Besoul (tarifaBaseFicha, multiplicadorFacturacionFicha, normalizarPorcentajeDescuento,
// aplicarDescuentoImporte, opcionesFrecuenciaParaModalidad, contratoVacio, BesoulIdentidad...), así
// que tarifas, descuentos, frecuencias e identidad NUNCA se recalculan con una segunda lógica.
//
// Lo que este módulo NO hace (a propósito):
//   - No guarda nada. agenda.html aplica el plan en memoria y usa el MISMO guardado transaccional
//     por entrenador que el resto de la Agenda (guardarEstadoNubeAgenda, hotfix P0): todo o nada.
//   - No borra clientes ni sesiones, nunca sustituye una sesión existente (un hueco ocupado es un
//     conflicto que se informa y se omite).
//   - No toca CRM, Finanzas, históricos ni disponibilidad.
//
// Se carga igual en el navegador (window.BesoulImportacion) y en Node (require) para los tests.
(function (root) {
  'use strict';

  var VERSION_PLANTILLA = 'BESOUL-IMPORT-V1-2026-10-R2';
  var DURACION_SESION_MIN = 45;           // regla de negocio: una sesión dura 45 minutos
  var PASO_MIN = 15;                      // la rejilla de la Agenda es de 15 minutos
  var INICIO_AGENDA_MIN = 6 * 60;         // la Agenda muestra 06:00-22:00
  var FIN_AGENDA_MIN = 22 * 60;
  var MAX_DIAS_PERIODO = 183;             // mismo orden que la recurrencia manual (26 semanas)
  var LIMITE_DOC_AVISO = 700000;          // bytes estimados del documento besoulSuite/agenda
  var LIMITE_DOC_BLOQUEO = 900000;        // Firestore rechaza documentos de más de 1 MiB
  var FILAS = { CLIENTES: 300, GRUPOS: 60, HORARIOS_FIJOS: 600, SESIONES_VARIABLES: 600 };

  var DIAS = [
    { label: 'Lunes', js: 1 }, { label: 'Martes', js: 2 }, { label: 'Miércoles', js: 3 },
    { label: 'Jueves', js: 4 }, { label: 'Viernes', js: 5 }, { label: 'Sábado', js: 6 }, { label: 'Domingo', js: 0 }
  ];
  var ESTADOS = [{ label: 'Activo', key: 'activo' }, { label: 'Inactivo temporal', key: 'inactivo' }, { label: 'Baja definitiva', key: 'baja' }];
  var CONTRATACION = [{ label: 'Mensualidad recurrente', key: 'Mensualidad' }, { label: 'Bono', key: 'Bono' }];
  var TIPOS_GRUPO = [{ label: 'Cerrado', key: 'cerrado' }, { label: 'Abierto', key: 'abierto' }];
  var ORIGEN_EXISTENTE = 'EXISTENTE en Besoul (no editar)';

  // ---------------------------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------------------------
  function texto(v) { return String(v == null ? '' : v).trim(); }
  function normalizarTexto(v) {
    return texto(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function minutosAHora(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  function isoDesdeUTC(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function fechaISOValida(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
    var p = iso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function sumarDiasISO(iso, dias) {
    var p = iso.split('-').map(Number);
    return isoDesdeUTC(new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias)));
  }
  function diaSemanaISO(iso) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function diasEntre(desde, hasta) {
    var a = desde.split('-').map(Number), b = hasta.split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }
  function fechaHumana(iso) { return fechaISOValida(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  // Mismo redondeo que ROUND(x;2) de Excel (mitad hacia fuera del cero).
  function redondear2(x) { var s = x < 0 ? -1 : 1; return s * Math.round(Math.abs(x) * 100 + 1e-9) / 100; }
  function letraColumna(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function tamanoJSON(v) { try { return JSON.stringify(v).length; } catch (e) { return 0; } }

  // ---------------------------------------------------------------------------------------------
  // Definición de hojas (fuente única para la plantilla y para el lector)
  // ---------------------------------------------------------------------------------------------
  var HOJAS = {
    CLIENTES: [
      { k: 'nombre', h: 'Nombre y apellidos *', w: 28 },
      { k: 'telefono', h: 'Teléfono *', w: 16, textoForzado: true },
      { k: 'email', h: 'Email *', w: 30 },
      { k: 'entrenador', h: 'Entrenador/PT [auto]', w: 22, calc: true },
      { k: 'modalidad', h: 'Modalidad *', w: 30, lista: 'modalidades' },
      { k: 'frecuencia', h: 'Frecuencia semanal / sesiones del bono *', w: 16, lista: 'frecuencias' },
      { k: 'contratacion', h: 'Tipo de contratación *', w: 22, lista: 'contratacion' },
      { k: 'fechaCompra', h: 'Fecha compra bono', w: 14, fecha: true },
      { k: 'precio', h: 'Precio real que paga (€) *', w: 15, numero: true },
      { k: 'tarifa', h: 'Tarifa oficial (€) [auto]', w: 15, calc: true },
      { k: 'descuento', h: 'Descuento % [auto]', w: 13, calc: true },
      { k: 'diferencia', h: 'Diferencia vs tarifa (€) [auto]', w: 15, calc: true },
      { k: 'revision', h: 'Revisión [auto]', w: 34, calc: true },
      { k: 'grupo', h: 'Grupo (si pertenece)', w: 22, lista: 'grupos' },
      { k: 'fechaAlta', h: 'Fecha de inicio', w: 14, fecha: true },
      { k: 'estado', h: 'Estado', w: 18, lista: 'estados' },
      { k: 'fechaEstado', h: 'Fecha pausa/baja', w: 14, fecha: true },
      { k: 'observaciones', h: 'Observaciones', w: 34 }
    ],
    GRUPOS: [
      { k: 'nombre', h: 'Nombre del grupo *', w: 26 },
      { k: 'tipoGrupo', h: 'Tipo de grupo *', w: 14, lista: 'tiposGrupo' },
      { k: 'entrenador', h: 'Entrenador/PT [auto]', w: 22, calc: true },
      { k: 'modalidad', h: 'Modalidad (grupo cerrado) *', w: 30, lista: 'modalidades' },
      { k: 'frecuencia', h: 'Frecuencia semanal / sesiones del bono', w: 16, lista: 'frecuencias' },
      { k: 'contratacion', h: 'Tipo de contratación', w: 22, lista: 'contratacion' },
      { k: 'fechaCompra', h: 'Fecha compra bono', w: 14, fecha: true },
      { k: 'tarifa', h: 'Tarifa oficial por persona (€) [auto]', w: 18, calc: true },
      { k: 'capacidad', h: 'Capacidad (grupo abierto)', w: 14, numero: true },
      { k: 'fechaAlta', h: 'Fecha de inicio', w: 14, fecha: true },
      { k: 'estado', h: 'Estado', w: 18, lista: 'estados' },
      { k: 'origen', h: 'Origen [auto]', w: 30, calc: true }
    ],
    HORARIOS_FIJOS: [
      { k: 'cliente', h: 'Cliente (nombre exacto de CLIENTES)', w: 28, lista: 'clientesHoja' },
      { k: 'grupo', h: 'Grupo (nombre exacto de GRUPOS)', w: 24, lista: 'grupos' },
      { k: 'dia', h: 'Día de la semana *', w: 14, lista: 'dias' },
      { k: 'horaInicio', h: 'Hora inicio *', w: 11, lista: 'horasInicio', textoForzado: true },
      { k: 'horaFin', h: 'Hora fin declarada', w: 11, lista: 'horasFin', textoForzado: true },
      { k: 'duracionReal', h: 'Duración real sesión (min) [auto]', w: 14, calc: true },
      { k: 'minutosExtra', h: 'Minutos adicionales declarados [auto]', w: 18, calc: true },
      { k: 'desde', h: 'Desde (opcional)', w: 14, fecha: true },
      { k: 'hasta', h: 'Hasta (opcional)', w: 14, fecha: true },
      { k: 'observaciones', h: 'Observaciones', w: 30 }
    ],
    SESIONES_VARIABLES: [
      { k: 'cliente', h: 'Cliente (nombre exacto de CLIENTES)', w: 28, lista: 'clientesHoja' },
      { k: 'grupo', h: 'Grupo (nombre exacto de GRUPOS)', w: 24, lista: 'grupos' },
      { k: 'fecha', h: 'Fecha *', w: 14, fecha: true },
      { k: 'horaInicio', h: 'Hora inicio *', w: 11, lista: 'horasInicio', textoForzado: true },
      { k: 'horaFin', h: 'Hora fin declarada', w: 11, lista: 'horasFin', textoForzado: true },
      { k: 'duracionReal', h: 'Duración real sesión (min) [auto]', w: 14, calc: true },
      { k: 'minutosExtra', h: 'Minutos adicionales declarados [auto]', w: 18, calc: true },
      { k: 'observaciones', h: 'Nota de la sesión (se guarda como nota de Agenda)', w: 34 }
    ]
  };
  function col(hoja, k) { var cols = HOJAS[hoja]; for (var i = 0; i < cols.length; i++) if (cols[i].k === k) return i + 1; return 0; }
  function L(hoja, k) { return letraColumna(col(hoja, k)); }

  // ---------------------------------------------------------------------------------------------
  // Catálogo (se construye SIEMPRE desde la configuración real de Besoul)
  // ---------------------------------------------------------------------------------------------
  // ctx = { modalidades:[{key,label}] (opciones reales del selector de la ficha), entrenadores:
  // [{key,nombre}], trainerKey, gruposExistentes:[ficha grupo], deps:{tarifaBaseFicha,
  // multiplicadorFacturacionFicha, opcionesFrecuenciaParaModalidad} }
  function construirCatalogo(ctx) {
    var deps = ctx.deps;
    var frecuenciasTodas = [];
    var modalidades = (ctx.modalidades || []).map(function (m) {
      var opciones = deps.opcionesFrecuenciaParaModalidad(m.key) || [];
      var frecuencias = opciones.map(function (o) { return Number(o.v); });
      var tarifas = {};
      frecuencias.forEach(function (f) {
        tarifas[f] = Number(deps.tarifaBaseFicha({ modalidad: m.key, factor: f })) || 0;
        if (frecuenciasTodas.indexOf(f) === -1) frecuenciasTodas.push(f);
      });
      return {
        key: m.key, label: m.label, frecuencias: frecuencias, tarifas: tarifas,
        multiplicador: Number(deps.multiplicadorFacturacionFicha({ modalidad: m.key, tipo: 'individual' })) || 1,
        esBono: m.key.indexOf('Bono') !== -1
      };
    });
    frecuenciasTodas.sort(function (a, b) { return a - b; });
    var horasInicio = [], horasFin = [];
    for (var m = INICIO_AGENDA_MIN; m + DURACION_SESION_MIN <= FIN_AGENDA_MIN; m += PASO_MIN) horasInicio.push(minutosAHora(m));
    for (var f = INICIO_AGENDA_MIN + DURACION_SESION_MIN; f <= FIN_AGENDA_MIN; f += PASO_MIN) horasFin.push(minutosAHora(f));
    var trainerNombre = '';
    (ctx.entrenadores || []).forEach(function (e) { if (e.key === ctx.trainerKey) trainerNombre = e.nombre; });
    return {
      version: VERSION_PLANTILLA,
      trainerKey: ctx.trainerKey,
      trainerNombre: trainerNombre || ctx.trainerKey,
      // Una plantilla = un entrenador: nunca se ofrecen entrenadores ajenos.
      entrenadores: [{ key: ctx.trainerKey, nombre: trainerNombre || ctx.trainerKey }],
      modalidades: modalidades,
      frecuencias: frecuenciasTodas,
      contratacion: CONTRATACION, estados: ESTADOS, tiposGrupo: TIPOS_GRUPO, dias: DIAS,
      horasInicio: horasInicio, horasFin: horasFin,
      gruposExistentes: (ctx.gruposExistentes || []).filter(function (g) { return g && g.tipo === 'grupo'; }).map(function (g) {
        return {
          id: g.id, nombre: g.nombre || '', abierto: !!(g.grupoAbierto === true || g.tipoCita === 'grupo_abierto'),
          modalidad: g.modalidad || '', factor: parseInt(g.factor, 10) || 1, tipoCompra: g.tipoCompra || 'Mensualidad',
          capacidad: parseInt(g.capacidadGrupoAbierto, 10) || 0, estadoCliente: g.estadoCliente || 'activo'
        };
      })
    };
  }
  function buscarModalidad(catalogo, valor) {
    var n = normalizarTexto(valor);
    if (!n) return null;
    for (var i = 0; i < catalogo.modalidades.length; i++) {
      var m = catalogo.modalidades[i];
      if (normalizarTexto(m.label) === n || normalizarTexto(m.key) === n) return m;
    }
    return null;
  }
  function buscarEnLista(lista, valor) {
    var n = normalizarTexto(valor);
    if (!n) return null;
    for (var i = 0; i < lista.length; i++) if (normalizarTexto(lista[i].label) === n || normalizarTexto(lista[i].key) === n) return lista[i];
    return null;
  }
  function buscarEntrenador(catalogo, valor) {
    var n = normalizarTexto(valor);
    if (!n) return null;
    for (var i = 0; i < catalogo.entrenadores.length; i++) {
      var e = catalogo.entrenadores[i];
      if (normalizarTexto(e.nombre) === n || normalizarTexto(e.key) === n) return e;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Fórmulas de la plantilla (la misma función genera la fórmula y la que se espera al leer)
  // ---------------------------------------------------------------------------------------------
  function rangosCatalogo(catalogo) {
    var nM = Math.max(1, catalogo.modalidades.length);
    var nF = Math.max(1, catalogo.frecuencias.length);
    var colIni = 7; // G
    var colFin = colIni + nF - 1;
    return {
      labels: 'CATALOGOS!$D$2:$D$' + (1 + nM),
      mult: 'CATALOGOS!$F$2:$F$' + (1 + nM),
      grid: 'CATALOGOS!$' + letraColumna(colIni) + '$2:$' + letraColumna(colFin) + '$' + (1 + nM),
      frecHeader: 'CATALOGOS!$' + letraColumna(colIni) + '$1:$' + letraColumna(colFin) + '$1',
      gNombres: 'GRUPOS!$A$2:$A$' + (FILAS.GRUPOS + 1),
      gTipos: 'GRUPOS!$B$2:$B$' + (FILAS.GRUPOS + 1),
      gMods: 'GRUPOS!$D$2:$D$' + (FILAS.GRUPOS + 1),
      gFrecs: 'GRUPOS!$E$2:$E$' + (FILAS.GRUPOS + 1)
    };
  }
  function formulasFila(hoja, r, catalogo) {
    var R = rangosCatalogo(catalogo);
    var c = function (k) { return L(hoja, k) + r; };
    if (hoja === 'CLIENTES') {
      var individual = 'INDEX(' + R.grid + ',MATCH(' + c('modalidad') + ',' + R.labels + ',0),MATCH(' + c('frecuencia') + ',' + R.frecHeader + ',0))*INDEX(' + R.mult + ',MATCH(' + c('modalidad') + ',' + R.labels + ',0))';
      var filaGrupo = 'MATCH(' + c('grupo') + ',' + R.gNombres + ',0)';
      var miembro = 'INDEX(' + R.grid + ',MATCH(INDEX(' + R.gMods + ',' + filaGrupo + '),' + R.labels + ',0),MATCH(INDEX(' + R.gFrecs + ',' + filaGrupo + '),' + R.frecHeader + ',0))';
      var esMiembro = 'AND(' + c('grupo') + '<>"",IFERROR(INDEX(' + R.gTipos + ',' + filaGrupo + '),"")="Cerrado")';
      var tarifa = 'IF(' + c('nombre') + '="","",IFERROR(IF(' + esMiembro + ',' + miembro + ',' + individual + '),""))';
      var T = c('tarifa'), P = c('precio');
      return {
        entrenador: 'IF(' + c('nombre') + '="","",CATALOGOS!$A$2)',
        tarifa: tarifa,
        descuento: 'IF(OR(NOT(ISNUMBER(' + T + ')),' + P + '=""),"",IF(' + T + '>0,MAX(0,(1-' + P + '/' + T + ')*100),""))',
        diferencia: 'IF(OR(NOT(ISNUMBER(' + T + ')),' + P + '=""),"",IF(' + T + '>0,ROUND(' + P + '-' + T + ',2),""))',
        revision: 'IF(' + c('nombre') + '="","",IF(OR(NOT(ISNUMBER(' + T + ')),' + T + '<=0),"REVISAR: modalidad/frecuencia sin tarifa (o cliente ya existente)",IF(' + P + '="","FALTA el precio real",IF(' + P + '>' + T + ',"REVISAR: precio superior a la tarifa oficial","OK"))))'
      };
    }
    if (hoja === 'GRUPOS') {
      return {
        tarifa: 'IF(OR(' + c('nombre') + '="",' + c('tipoGrupo') + '<>"Cerrado"),"",IFERROR(INDEX(' + R.grid + ',MATCH(' + c('modalidad') + ',' + R.labels + ',0),MATCH(' + c('frecuencia') + ',' + R.frecHeader + ',0)),""))',
        origen: 'IF(' + c('nombre') + '="","","Nuevo (se creará al importar)")',
        entrenador: 'IF(' + c('nombre') + '="","",CATALOGOS!$A$2)'
      };
    }
    if (hoja === 'HORARIOS_FIJOS' || hoja === 'SESIONES_VARIABLES') {
      var I = c('horaInicio'), F = c('horaFin');
      var dif = 'ROUND(IFERROR(TIMEVALUE(' + F + ')-TIMEVALUE(' + I + '),' + F + '-' + I + ')*1440,0)';
      return {
        duracionReal: 'IF(' + I + '="","",' + DURACION_SESION_MIN + ')',
        minutosExtra: 'IF(OR(' + I + '="",' + F + '=""),"",IF(' + dif + '<' + DURACION_SESION_MIN + ',"REVISAR: franja menor de 45 min",' + dif + '-' + DURACION_SESION_MIN + '))'
      };
    }
    return {};
  }
  function normalizarFormula(f) { return String(f || '').replace(/^=/, '').replace(/_xlfn\./gi, '').replace(/[\s$]/g, '').toUpperCase(); }

  // ---------------------------------------------------------------------------------------------
  // Plantilla .xlsx oficial (ExcelJS)
  // ---------------------------------------------------------------------------------------------
  var ESTILO_CABECERA = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } } };
  var RELLENO_CALC = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  var RELLENO_EXISTENTE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

  function rangoLista(catalogo, lista) {
    var n;
    switch (lista) {
      case 'entrenadores': n = catalogo.entrenadores.length; return 'CATALOGOS!$A$2:$A$' + (1 + Math.max(1, n));
      case 'modalidades': n = catalogo.modalidades.length; return 'CATALOGOS!$D$2:$D$' + (1 + Math.max(1, n));
      case 'frecuencias': n = catalogo.frecuencias.length; return 'CATALOGOS!$P$2:$P$' + (1 + Math.max(1, n));
      case 'contratacion': return 'CATALOGOS!$R$2:$R$' + (1 + CONTRATACION.length);
      case 'estados': return 'CATALOGOS!$T$2:$T$' + (1 + ESTADOS.length);
      case 'tiposGrupo': return 'CATALOGOS!$V$2:$V$' + (1 + TIPOS_GRUPO.length);
      case 'dias': return 'CATALOGOS!$X$2:$X$' + (1 + DIAS.length);
      case 'horasInicio': return 'CATALOGOS!$Z$2:$Z$' + (1 + catalogo.horasInicio.length);
      case 'horasFin': return 'CATALOGOS!$AA$2:$AA$' + (1 + catalogo.horasFin.length);
      case 'grupos': return 'GRUPOS!$A$2:$A$' + (FILAS.GRUPOS + 1);
      case 'clientesHoja': return 'CLIENTES!$A$2:$A$' + (FILAS.CLIENTES + 1);
    }
    return '';
  }
  var TEXTO_LISTA = {
    entrenadores: 'Elige un entrenador de la lista.', modalidades: 'Elige una modalidad oficial de Besoul.',
    frecuencias: 'Elige una frecuencia de la lista (1-5 días/semana; 8 o 10 para bonos).', contratacion: 'Elige Mensualidad recurrente o Bono.',
    estados: 'Elige Activo, Inactivo temporal o Baja definitiva.', tiposGrupo: 'Elige Cerrado o Abierto.', dias: 'Elige un día de la semana.',
    horasInicio: 'Elige una hora de inicio (tramos de 15 minutos, 06:00-21:15).', horasFin: 'Elige la hora de fin declarada (06:45-22:00).',
    grupos: 'Escribe exactamente el nombre de un grupo de la hoja GRUPOS.', clientesHoja: 'Escribe exactamente el nombre de un cliente de la hoja CLIENTES.'
  };

  async function generarPlantilla(ExcelJS, catalogo, opciones) {
    opciones = opciones || {};
    var wb = new ExcelJS.Workbook();
    wb.creator = 'BESOUL Suite';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };

    var wsInstr = wb.addWorksheet('INSTRUCCIONES', { properties: { tabColor: { argb: 'FFF59E0B' } } });
    var hojas = {};
    ['CLIENTES', 'HORARIOS_FIJOS', 'SESIONES_VARIABLES', 'GRUPOS'].forEach(function (nombre) {
      hojas[nombre] = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    });
    var wsCat = wb.addWorksheet('CATALOGOS', { properties: { tabColor: { argb: 'FF64748B' } } });

    escribirCatalogo(wsCat, catalogo);
    escribirInstrucciones(wsInstr, catalogo);

    Object.keys(hojas).forEach(function (nombre) {
      var ws = hojas[nombre];
      var cols = HOJAS[nombre];
      var nFilas = FILAS[nombre];
      ws.columns = cols.map(function (c) {
        var def = { header: c.h, key: c.k, width: c.w || 16 };
        // Las columnas de entrada quedan desbloqueadas; las [auto] y la cabecera, bloqueadas.
        def.style = c.calc ? {} : { protection: { locked: false } };
        if (c.fecha) def.style.numFmt = 'dd/mm/yyyy';
        if (c.textoForzado) def.style.numFmt = '@';
        if (c.numero) def.style.numFmt = '#,##0.00';
        return def;
      });
      var cab = ws.getRow(1);
      cab.height = 32;
      cols.forEach(function (c, i) {
        var celda = cab.getCell(i + 1);
        celda.font = ESTILO_CABECERA.font;
        celda.fill = c.calc ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } } : ESTILO_CABECERA.fill;
        celda.alignment = { wrapText: true, vertical: 'middle' };
        celda.protection = { locked: true };
      });
      for (var r = 2; r <= nFilas + 1; r++) {
        var f = formulasFila(nombre, r, catalogo);
        cols.forEach(function (c, i) {
          if (!c.calc) return;
          var celda = ws.getRow(r).getCell(i + 1);
          if (f[c.k]) celda.value = { formula: f[c.k] };
          celda.fill = RELLENO_CALC;
          celda.protection = { locked: true };
          if (c.k === 'tarifa' || c.k === 'diferencia') celda.numFmt = '#,##0.00';
          if (c.k === 'descuento') celda.numFmt = '0.00';
        });
      }
      // Validaciones (Excel) -- el importador las repite TODAS, nunca se fía de ellas.
      var ultima = nFilas + 1;
      cols.forEach(function (c, i) {
        if (c.calc) return;
        var rango = letraColumna(i + 1) + '2:' + letraColumna(i + 1) + ultima;
        if (c.lista) {
          ws.dataValidations.add(rango, {
            type: 'list', allowBlank: true, formulae: [rangoLista(catalogo, c.lista)], showErrorMessage: true,
            errorStyle: 'stop', errorTitle: 'Valor no permitido', error: TEXTO_LISTA[c.lista] || 'Usa el desplegable.',
            showInputMessage: true, promptTitle: c.h.replace(/ \*$/, ''), prompt: TEXTO_LISTA[c.lista] || ''
          });
        } else if (c.fecha) {
          ws.dataValidations.add(rango, {
            type: 'date', operator: 'between', allowBlank: true, showErrorMessage: true, errorStyle: 'stop',
            formulae: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2035, 11, 31))],
            errorTitle: 'Fecha no válida', error: 'Introduce una fecha válida (dd/mm/aaaa).'
          });
        } else if (c.k === 'precio') {
          ws.dataValidations.add(rango, {
            type: 'decimal', operator: 'between', allowBlank: true, showErrorMessage: true, errorStyle: 'stop',
            formulae: [0, 10000], errorTitle: 'Precio no válido', error: 'Introduce el importe en euros (número entre 0 y 10.000).',
            showInputMessage: true, promptTitle: 'Precio real', prompt: 'Lo que paga de verdad el cliente (€/mes; en bonos, el precio del bono; Pareja/Trío: el total de todas las personas). La tarifa y el descuento se calculan solos.'
          });
        } else if (c.k === 'capacidad') {
          ws.dataValidations.add(rango, {
            type: 'whole', operator: 'between', allowBlank: true, showErrorMessage: true, errorStyle: 'stop',
            formulae: [1, 20], errorTitle: 'Capacidad no válida', error: 'Solo grupos abiertos: número entero entre 1 y 20.'
          });
        } else if (c.k === 'nombre' && (nombre === 'CLIENTES' || nombre === 'GRUPOS')) {
          var colN = letraColumna(i + 1);
          ws.dataValidations.add(rango, {
            type: 'custom', allowBlank: true, showErrorMessage: true, errorStyle: 'stop',
            formulae: ['COUNTIF($' + colN + '$2:$' + colN + '$' + ultima + ',' + colN + '2)=1'],
            errorTitle: 'Nombre repetido', error: 'Cada nombre debe aparecer una sola vez en esta hoja (añade el segundo apellido para distinguirlos).'
          });
        } else if (c.k === 'email') {
          var colE = letraColumna(i + 1);
          ws.dataValidations.add(rango, {
            type: 'custom', allowBlank: true, showErrorMessage: true, errorStyle: 'stop',
            formulae: ['AND(ISNUMBER(SEARCH("@",' + colE + '2)),ISNUMBER(SEARCH(".",' + colE + '2)))'],
            errorTitle: 'Email no válido', error: 'Introduce un email válido (nombre@dominio.com).'
          });
        }
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    });

    // Grupos ya existentes en Besoul: precargados y bloqueados, para poder elegirlos en los
    // desplegables. Su configuración nunca se modifica desde la importación.
    var wsG = hojas.GRUPOS;
    catalogo.gruposExistentes.slice(0, FILAS.GRUPOS).forEach(function (g, idx) {
      var fila = wsG.getRow(idx + 2);
      var mod = null;
      catalogo.modalidades.forEach(function (m) { if (m.key === g.modalidad) mod = m; });
      var valores = {
        nombre: g.nombre, tipoGrupo: g.abierto ? 'Abierto' : 'Cerrado', entrenador: catalogo.trainerNombre,
        modalidad: g.abierto ? '' : (mod ? mod.label : g.modalidad), frecuencia: g.abierto ? null : g.factor,
        contratacion: g.abierto ? '' : (g.tipoCompra === 'Bono' ? 'Bono' : 'Mensualidad recurrente'),
        capacidad: g.abierto ? (g.capacidad || null) : null, estado: (buscarEnLista(ESTADOS, g.estadoCliente) || ESTADOS[0]).label
      };
      HOJAS.GRUPOS.forEach(function (c, i) {
        var celda = fila.getCell(i + 1);
        if (c.k === 'origen') { celda.value = ORIGEN_EXISTENTE; }
        else if (c.k === 'entrenador') { celda.value = catalogo.trainerNombre; }
        else if (c.k !== 'tarifa' && valores[c.k] != null && valores[c.k] !== '') celda.value = valores[c.k];
        celda.fill = RELLENO_EXISTENTE;
        celda.protection = { locked: true };
      });
    });

    if (opciones.ejemplo) rellenarEjemplo(hojas, catalogo, opciones.ejemplo);

    // Protección: evita modificar por error cabeceras, columnas [auto] y catálogos. No es una
    // medida de seguridad (Excel permite quitarla); por eso el importador lo revalida todo.
    var proteccion = { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, autoFilter: true, sort: false, insertRows: false, deleteRows: false };
    var promesas = Object.keys(hojas).map(function (n) { return hojas[n].protect('', proteccion); });
    promesas.push(wsCat.protect('', { selectLockedCells: true, selectUnlockedCells: true }));
    promesas.push(wsInstr.protect('', { selectLockedCells: true, selectUnlockedCells: true }));
    await Promise.all(promesas);
    return wb;
  }

  function escribirCatalogo(ws, catalogo) {
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 16; ws.getColumn(4).width = 32; ws.getColumn(5).width = 24;
    var cab = function (celda, txt) { var c = ws.getCell(celda); c.value = txt; c.font = ESTILO_CABECERA.font; c.fill = ESTILO_CABECERA.fill; };
    cab('A1', 'Entrenadores'); cab('B1', 'Clave Besoul');
    catalogo.entrenadores.forEach(function (e, i) { ws.getCell('A' + (i + 2)).value = e.nombre; ws.getCell('B' + (i + 2)).value = e.key; });
    cab('D1', 'Modalidad'); cab('E1', 'Clave Besoul'); cab('F1', 'Multiplicador ficha');
    catalogo.frecuencias.forEach(function (f, j) {
      var c = ws.getRow(1).getCell(7 + j); c.value = f; c.font = ESTILO_CABECERA.font; c.fill = ESTILO_CABECERA.fill;
    });
    catalogo.modalidades.forEach(function (m, i) {
      var fila = ws.getRow(i + 2);
      fila.getCell(4).value = m.label; fila.getCell(5).value = m.key; fila.getCell(6).value = m.multiplicador;
      catalogo.frecuencias.forEach(function (f, j) {
        if (m.frecuencias.indexOf(f) !== -1) { var c = fila.getCell(7 + j); c.value = m.tarifas[f]; c.numFmt = '#,##0.00'; }
      });
    });
    var nota = ws.getCell('D' + (catalogo.modalidades.length + 3));
    nota.value = 'Tarifas oficiales POR PERSONA (Besoul). La tarifa de la ficha = tarifa × multiplicador (Pareja ×2, Trío ×3). Celda vacía = frecuencia no permitida para esa modalidad.';
    nota.font = { italic: true, color: { argb: 'FF64748B' } };
    cab('P1', 'Frecuencias'); catalogo.frecuencias.forEach(function (f, i) { ws.getCell('P' + (i + 2)).value = f; });
    cab('R1', 'Tipo de contratación'); CONTRATACION.forEach(function (c, i) { ws.getCell('R' + (i + 2)).value = c.label; });
    cab('T1', 'Estado'); ESTADOS.forEach(function (c, i) { ws.getCell('T' + (i + 2)).value = c.label; });
    cab('V1', 'Tipo de grupo'); TIPOS_GRUPO.forEach(function (c, i) { ws.getCell('V' + (i + 2)).value = c.label; });
    cab('X1', 'Días'); DIAS.forEach(function (c, i) { ws.getCell('X' + (i + 2)).value = c.label; });
    cab('Z1', 'Hora inicio'); catalogo.horasInicio.forEach(function (h, i) { var c = ws.getCell('Z' + (i + 2)); c.numFmt = '@'; c.value = h; });
    cab('AA1', 'Hora fin'); catalogo.horasFin.forEach(function (h, i) { var c = ws.getCell('AA' + (i + 2)); c.numFmt = '@'; c.value = h; });
    cab('AC1', 'Plantilla');
    ws.getCell('AC2').value = VERSION_PLANTILLA;
    ws.getCell('AC3').value = catalogo.trainerKey;
    ws.getCell('AC4').value = catalogo.trainerNombre;
    ws.getCell('AC5').value = new Date().toISOString();
    ws.getColumn(29).width = 30;
  }

  function escribirInstrucciones(ws, catalogo) {
    ws.getColumn(1).width = 120;
    var lineas = [
      ['BESOUL · Plantilla oficial de importación de clientes y agenda', 'titulo'],
      ['Entrenador: ' + catalogo.trainerNombre + ' · versión ' + VERSION_PLANTILLA, 'sub'],
      ['', ''],
      ['CÓMO RELLENARLA', 'seccion'],
      ['1. CLIENTES: una fila por cliente. Obligatorio: nombre, teléfono, email, modalidad, frecuencia, tipo de contratación y precio real.', ''],
      ['   Esta plantilla es SOLO de ' + catalogo.trainerNombre + ': la columna Entrenador/PT se rellena sola y no se puede cambiar. Cada entrenador descarga e importa la suya.', ''],
      ['   Solo escribes el PRECIO REAL que paga el cliente. La tarifa oficial, el descuento y la diferencia se calculan solos (columnas grises [auto], protegidas). Besoul conserva el precio exacto, sin diferencias de céntimos.', ''],
      ['   Si el precio supera la tarifa oficial, la columna Revisión lo marca: Besoul no admite recargos y lo importará con descuento 0 % solo si lo confirmas.', ''],
      ['   Pareja / Trío: el precio es el TOTAL que pagan todas las personas de la ficha. Bonos: el precio del bono completo.', ''],
      ['   Cliente que ya existe en Besoul: basta con nombre, teléfono y email (se detecta por teléfono/email y su ficha NO se modifica salvo que lo confirmes).', ''],
      ['   Fecha de inicio vacía = hoy. Estado vacío = Activo. Observaciones solo se guardan si el estado es Inactivo o Baja (es el motivo de la pausa/baja).', ''],
      ['2. GRUPOS: un grupo por fila. Cerrado = integrantes fijos que comparten modalidad, frecuencia y tipo de compra (cada integrante con su propio precio).', ''],
      ['   Abierto = hora fija con plazas (capacidad); cada asistente es un cliente individual con su propio plan. Los grupos ya existentes aparecen en amarillo (no se editan).', ''],
      ['   Para meter a alguien en un grupo, escribe el nombre del grupo en la columna "Grupo" de CLIENTES. Integrante de grupo cerrado: modalidad/frecuencia/contratación se toman del grupo.', ''],
      ['3. HORARIOS_FIJOS: una fila por cada día fijo de un cliente O de un grupo (nunca por cada integrante). Se repite cada semana dentro del periodo que elijas al importar.', ''],
      ['   Varios días = varias filas. Cada día puede tener su propia hora. "Desde"/"Hasta" opcionales limitan esa fila.', ''],
      ['4. SESIONES_VARIABLES: sesiones sueltas en una fecha concreta (también para clientes con bono sin horario fijo).', ''],
      ['5. Clientes sin horario: déjalos solo en CLIENTES.', ''],
      ['', ''],
      ['DURACIÓN DE LAS SESIONES', 'seccion'],
      ['Toda sesión dura 45 minutos. Si declaras un bloque de una hora (p. ej. 10:00-11:00), Besoul crea una sesión REAL de 10:00 a 10:45.', ''],
      ['Los 15 minutos restantes NO se reservan, no cuentan como conflicto y se muestran en la Agenda como "franja declarada" informativa.', ''],
      ['', ''],
      ['AL IMPORTAR (Agenda → Clientes → Importar Excel)', 'seccion'],
      ['Besoul vuelve a validar TODO (no se fía de las validaciones de Excel), te enseña una vista previa (clientes nuevos, existentes, posibles duplicados, sesiones y conflictos) y solo guarda si confirmas.', ''],
      ['Nunca borra clientes ni sesiones y nunca pisa una sesión existente: un hueco ocupado se informa como conflicto y se omite.', ''],
      ['Puedes repetir la importación con el mismo Excel (por ejemplo, para otro mes): lo que ya existe no se duplica.', ''],
      ['Todo se guarda de una vez: si algo falla, no se guarda nada.', ''],
      ['', ''],
      ['EJEMPLOS', 'seccion'],
      ['CLIENTES: Ana Ejemplo · 600 000 001 · ana@ejemplo.test · ' + catalogo.trainerNombre + ' · Individual (Plan Mensual) · 2 · Mensualidad recurrente · precio 190 → tarifa 210, descuento 9,52 %', ''],
      ['HORARIOS_FIJOS: Ana Ejemplo · Lunes · 10:00 · 11:00 → sesión de 10:00 a 10:45 todos los lunes del periodo (15 minutos adicionales declarados).', ''],
      ['SESIONES_VARIABLES: Ana Ejemplo · 15/10/2026 · 18:30 → una sesión ese día a las 18:30.', '']
    ];
    lineas.forEach(function (l, i) {
      var c = ws.getCell('A' + (i + 1));
      c.value = l[0];
      c.alignment = { wrapText: true, vertical: 'top' };
      if (l[1] === 'titulo') c.font = { bold: true, size: 16, color: { argb: 'FFB45309' } };
      if (l[1] === 'sub') c.font = { italic: true, color: { argb: 'FF475569' } };
      if (l[1] === 'seccion') { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = ESTILO_CABECERA.fill; }
    });
  }

  // Rellena las hojas con datos FICTICIOS (Excel de ejemplo / pruebas).
  function rellenarEjemplo(hojas, catalogo, ejemplo) {
    ['CLIENTES', 'GRUPOS', 'HORARIOS_FIJOS', 'SESIONES_VARIABLES'].forEach(function (nombre) {
      var filas = ejemplo[nombre] || [];
      var ws = hojas[nombre];
      var inicio = 2;
      if (nombre === 'GRUPOS') inicio = 2 + Math.min(FILAS.GRUPOS, catalogo.gruposExistentes.length);
      filas.forEach(function (datos, i) {
        var fila = ws.getRow(inicio + i);
        HOJAS[nombre].forEach(function (c, j) {
          if (c.calc || !(c.k in datos)) return;
          var v = datos[c.k];
          if (v == null || v === '') return;
          if (c.fecha && typeof v === 'string' && fechaISOValida(v)) { var p = v.split('-').map(Number); v = new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
          fila.getCell(j + 1).value = v;
        });
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Lectura del Excel subido
  // ---------------------------------------------------------------------------------------------
  function leerCelda(celda) {
    var v = celda ? celda.value : null;
    var out = { valor: '', formula: null, tieneFormula: false, resultado: undefined };
    if (v == null) return out;
    if (v instanceof Date) { out.valor = v; return out; }
    if (typeof v === 'object') {
      if (v.formula != null || v.sharedFormula != null) {
        out.tieneFormula = true;
        out.formula = v.formula != null ? v.formula : null; // fórmula compartida: no se puede comparar el texto
        out.resultado = v.result;
        out.valor = v.result instanceof Date ? v.result : (v.result && typeof v.result === 'object' ? '' : (v.result == null ? '' : v.result));
        return out;
      }
      if (Array.isArray(v.richText)) { out.valor = v.richText.map(function (t) { return t.text || ''; }).join(''); return out; }
      if (v.text != null) { out.valor = typeof v.text === 'object' && Array.isArray(v.text.richText) ? v.text.richText.map(function (t) { return t.text || ''; }).join('') : v.text; return out; }
      if (v.error != null) { out.valor = ''; out.error = String(v.error); return out; }
      out.valor = '';
      return out;
    }
    out.valor = v;
    return out;
  }
  function leerFecha(v) {
    if (v == null || v === '') return { iso: '' };
    if (v instanceof Date) { if (isNaN(v.getTime())) return { error: true }; return { iso: isoDesdeUTC(v) }; }
    if (typeof v === 'number') { if (v < 20000 || v > 80000) return { error: true }; return { iso: isoDesdeUTC(new Date(Math.round((v - 25569) * 86400000))) }; }
    var s = texto(v), m;
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) { var iso = m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]); return fechaISOValida(iso) ? { iso: iso } : { error: true }; }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) { var iso2 = m[1] + '-' + m[2] + '-' + m[3]; return fechaISOValida(iso2) ? { iso: iso2 } : { error: true }; }
    return { error: true };
  }
  function leerHora(v) {
    if (v == null || v === '') return { min: null };
    var min = null;
    if (v instanceof Date) min = v.getUTCHours() * 60 + v.getUTCMinutes();
    else if (typeof v === 'number') { if (v >= 0 && v < 1) min = Math.round(v * 1440); else return { error: true }; }
    else {
      var m = texto(v).toLowerCase().replace(/\s/g, '').match(/^(\d{1,2})(?:[:.h](\d{2}))?h?$/);
      if (!m) return { error: true };
      min = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    }
    if (min == null || isNaN(min) || min < 0 || min > 24 * 60) return { error: true };
    return { min: min };
  }
  function leerNumero(v) {
    if (v == null || v === '') return { n: null };
    if (typeof v === 'number') return isFinite(v) ? { n: v } : { error: true };
    var s = texto(v).replace(/€/g, '').replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: true };
    return { n: parseFloat(s) };
  }

  function leerLibro(wb, catalogo) {
    var errores = [], advertencias = [];
    var res = { errores: errores, advertencias: advertencias, filas: {}, meta: {} };
    var faltan = ['CLIENTES', 'GRUPOS', 'HORARIOS_FIJOS', 'SESIONES_VARIABLES', 'CATALOGOS'].filter(function (n) { return !wb.getWorksheet(n); });
    if (faltan.length) {
      errores.push({ hoja: '-', fila: 0, mensaje: 'No es la plantilla oficial de Besoul: faltan las hojas ' + faltan.join(', ') + '. Descarga la plantilla desde Besoul.' });
      return res;
    }
    var cat = wb.getWorksheet('CATALOGOS');
    var version = texto(leerCelda(cat.getCell('AC2')).valor);
    res.meta = { version: version, trainerKey: texto(leerCelda(cat.getCell('AC3')).valor), trainerNombre: texto(leerCelda(cat.getCell('AC4')).valor), generadaEn: texto(leerCelda(cat.getCell('AC5')).valor) };
    if (version !== VERSION_PLANTILLA) {
      errores.push({ hoja: 'CATALOGOS', fila: 0, mensaje: 'Versión de plantilla no reconocida (' + (version || 'sin marca') + '). Descarga la plantilla actual desde Besoul.' });
      return res;
    }
    if (res.meta.trainerKey !== catalogo.trainerKey) {
      errores.push({ hoja: 'CATALOGOS', fila: 0, mensaje: 'Esta plantilla es de "' + (res.meta.trainerNombre || res.meta.trainerKey || 'otro entrenador') + '" y estás importando en la agenda de "' + catalogo.trainerNombre + '". Cada entrenador importa solo sus propios datos: descarga la plantilla desde tu propia agenda.' });
      return res;
    }
    ['CLIENTES', 'GRUPOS', 'HORARIOS_FIJOS', 'SESIONES_VARIABLES'].forEach(function (nombre) {
      var ws = wb.getWorksheet(nombre);
      var cols = HOJAS[nombre];
      var cab = ws.getRow(1);
      var malas = [];
      cols.forEach(function (c, i) {
        if (normalizarTexto(leerCelda(cab.getCell(i + 1)).valor) !== normalizarTexto(c.h)) malas.push(letraColumna(i + 1) + ' ("' + c.h + '")');
      });
      if (malas.length) {
        errores.push({ hoja: nombre, fila: 1, mensaje: 'Columnas alteradas, movidas o renombradas: ' + malas.slice(0, 4).join(', ') + (malas.length > 4 ? '...' : '') + '. Usa la plantilla oficial sin cambiar las columnas.' });
        res.filas[nombre] = [];
        return;
      }
      var filas = [];
      var ultima = Math.max(ws.rowCount || 0, ws.actualRowCount || 0);
      var formulasMal = [];
      for (var r = 2; r <= ultima; r++) {
        var row = ws.getRow(r);
        var datos = { _fila: r, _calc: {} };
        var vacia = true;
        cols.forEach(function (c, i) {
          var lc = leerCelda(row.getCell(i + 1));
          if (c.calc) { datos._calc[c.k] = lc; return; }
          datos[c.k] = lc.valor;
          if (lc.error) datos['_error_' + c.k] = lc.error;
          if (texto(lc.valor instanceof Date ? 'x' : lc.valor) !== '') vacia = false;
        });
        if (vacia) continue;
        if (nombre === 'GRUPOS' && texto(datos._calc.origen && datos._calc.origen.valor) === ORIGEN_EXISTENTE) datos._existentePlantilla = true;
        // Entrenador/PT: con la fórmula intacta es la identidad de la plantilla (ya verificada arriba);
        // si alguien la sustituyó por un valor, ese valor se valida (y uno ajeno es un error).
        var lcE = datos._calc.entrenador;
        var formulaE = formulasFila(nombre, r, catalogo).entrenador;
        if (datos._existentePlantilla) datos.entrenador = catalogo.trainerNombre;
        else if (lcE && lcE.tieneFormula && (lcE.formula == null || normalizarFormula(lcE.formula) === normalizarFormula(formulaE))) datos.entrenador = catalogo.trainerNombre;
        else datos.entrenador = texto(lcE && lcE.valor);
        // Columnas [auto]: el importador las recalcula SIEMPRE; aquí solo detecta si alguien las tocó.
        if (!datos._existentePlantilla) {
          var esperadas = formulasFila(nombre, r, catalogo);
          cols.forEach(function (c) {
            if (!c.calc || !esperadas[c.k]) return;
            var lc = datos._calc[c.k];
            if (!lc.tieneFormula) formulasMal.push(letraColumna(col(nombre, c.k)) + r + (texto(lc.valor) !== '' ? ' (valor escrito a mano)' : ' (fórmula borrada)'));
            else if (lc.formula != null && normalizarFormula(lc.formula) !== normalizarFormula(esperadas[c.k])) formulasMal.push(letraColumna(col(nombre, c.k)) + r + ' (fórmula modificada)');
          });
        }
        filas.push(datos);
      }
      if (formulasMal.length) {
        advertencias.push({ hoja: nombre, fila: 0, mensaje: 'Columnas automáticas alteradas o eliminadas en ' + formulasMal.slice(0, 6).join(', ') + (formulasMal.length > 6 ? ' y ' + (formulasMal.length - 6) + ' más' : '') + '. Se ignoran: Besoul recalcula tarifa, descuento y minutos con su propia lógica.' });
      }
      res.filas[nombre] = filas;
    });
    return res;
  }

  // ---------------------------------------------------------------------------------------------
  // Planificación (validación completa + vista previa). No modifica nada.
  // ---------------------------------------------------------------------------------------------
  // entorno = { catalogo, deps:{tarifaBaseFicha, multiplicadorFacturacionFicha, normalizarPorcentajeDescuento,
  //   aplicarDescuentoImporte, buscarCoincidenciasIdentidad, normalizarTelefono, normalizarEmail},
  //   trainerKey, clientesTrainer:[fichas], candidatosIdentidad:[{id,nombre,telefono,email,trainerKey,miembroGrupo}],
  //   ocupacion(clave) -> {obj, claveInicio} | null, periodo:{desde,hasta}, hoyISO, tamanoDocumentoActual }
  // opciones = { resoluciones:{'CLIENTES:5':'nuevo'|'omitir'|'vincular:<id>'}, actualizar:{'CLIENTES:5':true},
  //   confirmarGrupos:{'<nombre normalizado>':true}, aceptarPrecioSuperior:{'CLIENTES:5':true} }
  function planificar(lectura, entorno, opciones) {
    opciones = opciones || {};
    var resoluciones = opciones.resoluciones || {}, actualizar = opciones.actualizar || {};
    var confirmarGrupos = opciones.confirmarGrupos || {};
    var catalogo = entorno.catalogo, deps = entorno.deps, tk = entorno.trainerKey;
    var errores = (lectura.errores || []).slice(), advertencias = (lectura.advertencias || []).slice();
    var pendientes = [];
    var plan = { errores: errores, advertencias: advertencias, pendientes: pendientes, clientes: [], grupos: [], sesiones: [], periodo: entorno.periodo, trainerKey: tk };
    var err = function (hoja, fila, mensaje) { errores.push({ hoja: hoja, fila: fila, mensaje: mensaje }); };
    var adv = function (hoja, fila, mensaje) { advertencias.push({ hoja: hoja, fila: fila, mensaje: mensaje }); };

    var periodo = entorno.periodo || {};
    if (!fechaISOValida(periodo.desde) || !fechaISOValida(periodo.hasta) || periodo.desde > periodo.hasta) {
      err('-', 0, 'El periodo de importación no es válido (fecha inicial y final).');
    } else if (diasEntre(periodo.desde, periodo.hasta) > MAX_DIAS_PERIODO) {
      err('-', 0, 'El periodo de importación es demasiado largo: máximo ' + MAX_DIAS_PERIODO + ' días (unos 6 meses) por importación. Importa por tramos; repetir la importación no duplica nada.');
    }
    if (errores.some(function (e) { return e.fila <= 1; }) && !lectura.filas) { plan.bloqueante = true; return finalizar(plan, entorno); }
    var filas = lectura.filas || {};

    var esDeOtroEntrenador = function (hoja, d) {
      var e = buscarEntrenador(catalogo, d.entrenador);
      if (!texto(d.entrenador)) { err(hoja, d._fila, 'Falta el entrenador/PT (la columna automática se ha borrado).'); return true; }
      if (!e) { err(hoja, d._fila, 'Entrenador/PT "' + texto(d.entrenador) + '" no es el de esta agenda (' + catalogo.trainerNombre + '). Cada entrenador importa solo sus propios datos.'); return true; }
      return false;
    };
    var leerFechaCampo = function (hoja, d, campo, etiqueta) {
      var f = leerFecha(d[campo]);
      if (f.error) { err(hoja, d._fila, etiqueta + ' no es una fecha válida.'); return ''; }
      return f.iso;
    };
    var tarifaFicha = function (modKey, factor) {
      return (Number(deps.tarifaBaseFicha({ modalidad: modKey, factor: factor })) || 0) * (Number(deps.multiplicadorFacturacionFicha({ modalidad: modKey, tipo: 'individual' })) || 1);
    };
    // Descuento con precisión completa (sin redondear a 2 decimales): con la fórmula de siempre
    // (tarifa × (1 − descuento/100)) Besoul factura exactamente el precio pactado.
    var calcularDescuento = function (precio, tarifa) {
      if (!(tarifa > 0)) return 0;
      if (precio >= tarifa) return 0;
      return deps.normalizarPorcentajeDescuento((tarifa - precio) / tarifa * 100);
    };

    // --- GRUPOS ---
    var gruposPorNombre = {};
    var existentesGrupo = {};
    (entorno.clientesTrainer || []).forEach(function (c) { if (c && c.tipo === 'grupo') existentesGrupo[normalizarTexto(c.nombre)] = c; });
    (filas.GRUPOS || []).forEach(function (d) {
      var nombre = texto(d.nombre), n = normalizarTexto(nombre);
      if (!nombre) { err('GRUPOS', d._fila, 'Falta el nombre del grupo.'); return; }
      if (gruposPorNombre[n]) {
        var previo = gruposPorNombre[n];
        if (previo.precargado !== !!d._existentePlantilla && previo.existente) {
          if (!d._existentePlantilla) adv('GRUPOS', d._fila, 'El grupo "' + nombre + '" ya existe en Besoul (fila ' + previo.fila + '): se usa tal cual, su configuración no se modifica desde la importación.');
          return;
        }
        err('GRUPOS', d._fila, 'Grupo "' + nombre + '" repetido en la hoja GRUPOS.');
        return;
      }
      var existente = existentesGrupo[n] || null;
      var g = { fila: d._fila, nombre: nombre, n: n, existente: existente, accion: existente ? 'existente' : 'crear', miembrosNuevos: [], asistentes: [], precargado: !!d._existentePlantilla };
      gruposPorNombre[n] = g;
      if (d._existentePlantilla) {
        if (!existente) { err('GRUPOS', d._fila, 'El grupo "' + nombre + '" figura como existente pero ya no existe en esta agenda. Descarga de nuevo la plantilla.'); g.accion = 'error'; }
        else g.abierto = !!(existente.grupoAbierto === true || existente.tipoCita === 'grupo_abierto');
        plan.grupos.push(g);
        return;
      }
      if (esDeOtroEntrenador('GRUPOS', d)) { g.accion = 'error'; plan.grupos.push(g); return; }
      var tipo = buscarEnLista(TIPOS_GRUPO, d.tipoGrupo);
      if (!tipo) { err('GRUPOS', d._fila, texto(d.tipoGrupo) ? 'Tipo de grupo "' + texto(d.tipoGrupo) + '" no válido (Cerrado/Abierto).' : 'Falta el tipo de grupo (Cerrado/Abierto).'); g.accion = 'error'; plan.grupos.push(g); return; }
      g.abierto = tipo.key === 'abierto';
      var estado = texto(d.estado) ? buscarEnLista(ESTADOS, d.estado) : ESTADOS[0];
      if (!estado) { err('GRUPOS', d._fila, 'Estado "' + texto(d.estado) + '" no válido.'); g.accion = 'error'; }
      g.estadoCliente = estado ? estado.key : 'activo';
      g.fechaAlta = leerFechaCampo('GRUPOS', d, 'fechaAlta', 'Fecha de inicio');
      if (g.abierto) {
        var cap = leerNumero(d.capacidad);
        if (cap.error || cap.n == null || cap.n !== Math.floor(cap.n) || cap.n < 1 || cap.n > 20) { err('GRUPOS', d._fila, 'Grupo abierto: la capacidad debe ser un número entero entre 1 y 20.'); g.accion = 'error'; }
        g.capacidad = cap.n || 0;
        // El formulario de Besoul guarda siempre una modalidad/frecuencia también en grupos abiertos
        // (valores por defecto del alta de grupo); no afectan a la facturación (cada asistente paga
        // su propio plan). Si el Excel trae valores, se validan y se respetan.
        var modA = texto(d.modalidad) ? buscarModalidad(catalogo, d.modalidad) : buscarModalidad(catalogo, 'Grupo Reducido Plan');
        if (!modA) { err('GRUPOS', d._fila, 'Modalidad "' + texto(d.modalidad) + '" no válida.'); g.accion = 'error'; }
        g.modalidad = modA ? modA.key : 'Grupo Reducido Plan';
        var fA = leerNumero(d.frecuencia);
        g.factor = fA.n != null && !fA.error && modA && modA.frecuencias.indexOf(fA.n) !== -1 ? fA.n : (modA && modA.frecuencias.length ? modA.frecuencias[0] : 1);
        g.tipoCompra = (buscarEnLista(CONTRATACION, d.contratacion) || CONTRATACION[0]).key;
        if (modA && modA.esBono) g.tipoCompra = 'Bono';
        g.fechaCompra = leerFechaCampo('GRUPOS', d, 'fechaCompra', 'Fecha compra bono');
      } else {
        var mod = buscarModalidad(catalogo, d.modalidad);
        if (!mod) { err('GRUPOS', d._fila, texto(d.modalidad) ? 'Modalidad "' + texto(d.modalidad) + '" no válida (usa el desplegable).' : 'Grupo cerrado: falta la modalidad.'); g.accion = 'error'; }
        var fr = leerNumero(d.frecuencia);
        if (mod) {
          if (fr.error || fr.n == null) { err('GRUPOS', d._fila, 'Grupo cerrado: falta la frecuencia / sesiones.'); g.accion = 'error'; }
          else if (mod.frecuencias.indexOf(fr.n) === -1) { err('GRUPOS', d._fila, 'Frecuencia ' + fr.n + ' no permitida para "' + mod.label + '" (permitidas: ' + mod.frecuencias.join(', ') + ').'); g.accion = 'error'; }
        }
        g.modalidad = mod ? mod.key : '';
        g.factor = fr.n || 1;
        var contr = buscarEnLista(CONTRATACION, d.contratacion);
        if (!contr) { err('GRUPOS', d._fila, texto(d.contratacion) ? 'Tipo de contratación "' + texto(d.contratacion) + '" no válido.' : 'Grupo cerrado: falta el tipo de contratación.'); g.accion = 'error'; }
        g.tipoCompra = contr ? contr.key : 'Mensualidad';
        if (mod && mod.esBono && g.tipoCompra !== 'Bono') { err('GRUPOS', d._fila, 'La modalidad "' + mod.label + '" es un bono: el tipo de contratación debe ser Bono.'); g.accion = 'error'; }
        g.fechaCompra = leerFechaCampo('GRUPOS', d, 'fechaCompra', 'Fecha compra bono');
        if (g.tipoCompra === 'Bono' && !g.fechaCompra) adv('GRUPOS', d._fila, 'Bono sin fecha de compra: el contador de clases usará el mes visible como inicio (mismo comportamiento que una ficha sin fecha).');
        g.tarifaPersona = mod && g.accion !== 'error' ? (Number(deps.tarifaBaseFicha({ modalidad: g.modalidad, factor: g.factor })) || 0) : 0;
      }
      if (existente) {
        var abiertoExistente = !!(existente.grupoAbierto === true || existente.tipoCita === 'grupo_abierto');
        if (abiertoExistente !== g.abierto) { err('GRUPOS', d._fila, 'Ya existe un grupo "' + nombre + '" ' + (abiertoExistente ? 'abierto' : 'cerrado') + ' en esta agenda: no se puede importar como ' + (g.abierto ? 'abierto' : 'cerrado') + '.'); g.accion = 'error'; }
        else adv('GRUPOS', d._fila, 'El grupo "' + nombre + '" ya existe: se usa tal cual, su configuración no se modifica desde la importación.');
        g.abierto = abiertoExistente;
        if (g.accion !== 'error') g.accion = 'existente';
      }
      plan.grupos.push(g);
    });
    var grupoValido = function (g) { return g && (g.accion === 'crear' || g.accion === 'existente'); };

    // --- CLIENTES ---
    var vistosTel = {}, vistosEmail = {}, porNombre = {};
    var idsTrainer = {};
    (entorno.clientesTrainer || []).forEach(function (c) { if (c) idsTrainer[c.id] = c; });
    (filas.CLIENTES || []).forEach(function (d) {
      var ref = 'CLIENTES:' + d._fila;
      var nombre = texto(d.nombre);
      var c = { fila: d._fila, ref: ref, nombre: nombre, accion: 'nuevo', cambios: [] };
      plan.clientes.push(c);
      if (!nombre) { err('CLIENTES', d._fila, 'Falta el nombre y apellidos.'); c.accion = 'error'; return; }
      var nn = normalizarTexto(nombre);
      if (porNombre[nn]) { err('CLIENTES', d._fila, 'Nombre "' + nombre + '" repetido en CLIENTES (fila ' + porNombre[nn].fila + '). Añade el segundo apellido para distinguirlos.'); c.accion = 'error'; return; }
      porNombre[nn] = c;
      if (esDeOtroEntrenador('CLIENTES', d)) { c.accion = 'error'; return; }
      var telefono = texto(d.telefono), email = texto(d.email).toLowerCase();
      c.telefono = telefono; c.email = email;
      if (!telefono) err('CLIENTES', d._fila, 'Falta el teléfono (obligatorio en Besoul).');
      else if (!deps.normalizarTelefono(telefono) || deps.normalizarTelefono(telefono).length < 9) err('CLIENTES', d._fila, 'Teléfono "' + telefono + '" no válido.');
      if (!email) err('CLIENTES', d._fila, 'Falta el email (obligatorio en Besoul).');
      else if (!/^\S+@\S+\.\S+$/.test(email)) err('CLIENTES', d._fila, 'Email "' + email + '" no válido.');
      var telN = deps.normalizarTelefono(telefono), emailN = deps.normalizarEmail(email);
      if (telN && vistosTel[telN]) err('CLIENTES', d._fila, 'Teléfono repetido en el Excel (también en la fila ' + vistosTel[telN] + ').');
      if (emailN && vistosEmail[emailN]) err('CLIENTES', d._fila, 'Email repetido en el Excel (también en la fila ' + vistosEmail[emailN] + ').');
      if (telN) vistosTel[telN] = d._fila;
      if (emailN) vistosEmail[emailN] = d._fila;

      // Grupo
      var grupoTxt = texto(d.grupo);
      var grupo = null;
      if (grupoTxt) {
        grupo = gruposPorNombre[normalizarTexto(grupoTxt)] || null;
        if (!grupo) err('CLIENTES', d._fila, 'El grupo "' + grupoTxt + '" no está en la hoja GRUPOS.');
        else if (!grupoValido(grupo)) err('CLIENTES', d._fila, 'El grupo "' + grupoTxt + '" tiene errores o no se importa en esta agenda.');
      }
      c.grupo = grupo;
      c.esMiembroCerrado = !!(grupo && grupo.abierto === false);

      // Estado y fechas
      var estado = texto(d.estado) ? buscarEnLista(ESTADOS, d.estado) : ESTADOS[0];
      if (!estado) err('CLIENTES', d._fila, 'Estado "' + texto(d.estado) + '" no válido (usa el desplegable).');
      c.estadoCliente = estado ? estado.key : 'activo';
      c.fechaAlta = leerFechaCampo('CLIENTES', d, 'fechaAlta', 'Fecha de inicio');
      c.fechaEstado = c.estadoCliente === 'activo' ? '' : leerFechaCampo('CLIENTES', d, 'fechaEstado', 'Fecha pausa/baja');
      c.observacionesEstado = c.estadoCliente === 'activo' ? '' : texto(d.observaciones);
      if (c.estadoCliente === 'activo' && texto(d.observaciones)) c.observacionesInformativas = true;
      if (c.esMiembroCerrado && c.estadoCliente !== 'activo') adv('CLIENTES', d._fila, 'Integrante de grupo cerrado: su estado lo marca el grupo; el estado de esta fila no se aplica.');

      // Modalidad / frecuencia / contratación / precio
      var precio = leerNumero(d.precio);
      if (precio.error || (precio.n != null && precio.n < 0)) err('CLIENTES', d._fila, 'Precio "' + texto(d.precio) + '" no válido.');
      c.precio = precio.error ? null : precio.n;
      c.datosEconomicos = false;
      if (c.esMiembroCerrado) {
        ['modalidad', 'frecuencia', 'contratacion'].forEach(function (campo) {
          if (texto(d[campo]) && grupo) {
            var coincide = campo === 'modalidad' ? (buscarModalidad(catalogo, d[campo]) || {}).key === grupo.modalidad
              : campo === 'frecuencia' ? Number(leerNumero(d[campo]).n) === Number(grupo.factor)
              : (buscarEnLista(CONTRATACION, d[campo]) || {}).key === grupo.tipoCompra;
            if (!coincide && grupo.accion === 'crear') adv('CLIENTES', d._fila, 'Integrante de "' + grupo.nombre + '": ' + campo + ' se toma del grupo (el valor de esta fila se ignora).');
          }
        });
        if (grupo && grupo.accion === 'crear') {
          c.tarifa = grupo.tarifaPersona || 0;
          if (c.precio == null) err('CLIENTES', d._fila, 'Falta el precio real que paga este integrante.');
        } else if (grupo && grupo.existente) {
          c.tarifa = Number(deps.tarifaBaseFicha(grupo.existente)) || 0;
        }
        if (c.precio != null && c.tarifa > 0) { c.datosEconomicos = true; c.descuentoPct = calcularDescuento(c.precio, c.tarifa); }
      } else {
        var algunEconomico = texto(d.modalidad) || texto(d.frecuencia) || texto(d.contratacion) || c.precio != null;
        c.datosEconomicos = !!algunEconomico;
        var mod = texto(d.modalidad) ? buscarModalidad(catalogo, d.modalidad) : null;
        if (texto(d.modalidad) && !mod) err('CLIENTES', d._fila, 'Modalidad "' + texto(d.modalidad) + '" no válida (usa el desplegable).');
        var fr = leerNumero(d.frecuencia);
        if (fr.error) err('CLIENTES', d._fila, 'Frecuencia "' + texto(d.frecuencia) + '" no válida.');
        if (mod && fr.n != null && mod.frecuencias.indexOf(fr.n) === -1) err('CLIENTES', d._fila, 'Frecuencia ' + fr.n + ' no permitida para "' + mod.label + '" (permitidas: ' + mod.frecuencias.join(', ') + ').');
        var contr = texto(d.contratacion) ? buscarEnLista(CONTRATACION, d.contratacion) : null;
        if (texto(d.contratacion) && !contr) err('CLIENTES', d._fila, 'Tipo de contratación "' + texto(d.contratacion) + '" no válido.');
        if (mod && mod.esBono && contr && contr.key !== 'Bono') err('CLIENTES', d._fila, 'La modalidad "' + mod.label + '" es un bono: el tipo de contratación debe ser Bono.');
        c.modalidad = mod ? mod.key : '';
        c.modalidadLabel = mod ? mod.label : '';
        c.factor = fr.n != null && !fr.error ? fr.n : null;
        c.tipoCompra = contr ? contr.key : (mod && mod.esBono ? 'Bono' : '');
        c.fechaCompra = leerFechaCampo('CLIENTES', d, 'fechaCompra', 'Fecha compra bono');
        if (mod && c.factor != null && mod.frecuencias.indexOf(c.factor) !== -1) {
          c.tarifa = tarifaFicha(mod.key, c.factor);
          if (c.precio != null) c.descuentoPct = calcularDescuento(c.precio, c.tarifa);
        }
        c.camposEconomicosFaltan = [];
        // Solo lo que falta de verdad (un valor presente pero inválido ya tiene su propio error).
        if (!texto(d.modalidad)) c.camposEconomicosFaltan.push('modalidad');
        if (!texto(d.frecuencia)) c.camposEconomicosFaltan.push('frecuencia');
        if (!texto(d.contratacion) && !(mod && mod.esBono)) c.camposEconomicosFaltan.push('tipo de contratación');
        if (c.precio == null && !texto(d.precio)) c.camposEconomicosFaltan.push('precio real');
      }
      if (c.precio != null && c.tarifa > 0 && c.precio > c.tarifa + 0.004) {
        c.precioSuperior = true;
        var aceptado = (opciones.aceptarPrecioSuperior || {})[ref];
        if (!aceptado) pendientes.push({ tipo: 'precio-superior', ref: ref, fila: d._fila, nombre: nombre, mensaje: 'Precio ' + c.precio.toFixed(2) + ' € superior a la tarifa oficial ' + c.tarifa.toFixed(2) + ' €. Besoul no admite recargos: se importará con descuento 0 % (paga la tarifa oficial) si lo confirmas.' });
        else adv('CLIENTES', d._fila, 'Precio superior a la tarifa confirmado: se registra la tarifa oficial con descuento 0 %.');
      }
      if (c.descuentoPct != null && c.tarifa > 0) c.importeResultante = redondear2(deps.aplicarDescuentoImporte(c.tarifa, c.descuentoPct));
      if (c.tipoCompra === 'Bono' && !c.fechaCompra && !c.esMiembroCerrado && c.datosEconomicos) adv('CLIENTES', d._fila, 'Bono sin fecha de compra: el contador de clases usará el mes visible como inicio.');

      // Identidad: existente / dudoso / nuevo (teléfono y email normalizados, nunca el nombre)
      var coincidencias = telN || emailN ? deps.buscarCoincidenciasIdentidad({ telefono: telefono, email: email }, entorno.candidatosIdentidad || []) : [];
      c.coincidencias = coincidencias.map(function (m) { return { id: m.candidato.id, nombre: m.candidato.nombre, trainerKey: m.candidato.trainerKey, miembroGrupo: !!m.candidato.miembroGrupo, por: m.por }; });
      var propias = coincidencias.filter(function (m) { return m.candidato.trainerKey === tk; });
      var ajenas = coincidencias.filter(function (m) { return m.candidato.trainerKey !== tk; });
      var resolucion = resoluciones[ref];
      var fichaExistente = null;
      if (resolucion) {
        if (resolucion === 'nuevo') c.accion = 'nuevo';
        else if (resolucion === 'omitir') c.accion = 'omitir';
        else if (resolucion.indexOf('vincular:') === 0) {
          var idV = resolucion.slice(9);
          if (propias.some(function (m) { return m.candidato.id === idV; }) && idsTrainer[idV]) { fichaExistente = idsTrainer[idV]; c.accion = 'existente'; }
          else { err('CLIENTES', d._fila, 'La resolución elegida ya no es válida: vuelve a revisar la coincidencia.'); c.accion = 'error'; }
        }
        c.resuelto = resolucion;
      } else if (coincidencias.length) {
        var unica = propias.length === 1 && !ajenas.length ? propias[0] : null;
        var fichaU = unica ? idsTrainer[unica.candidato.id] : null;
        if (unica && fichaU && unica.por.length === 2 && normalizarTexto(fichaU.nombre) === nn) { fichaExistente = fichaU; c.accion = 'existente'; }
        else {
          c.accion = 'dudoso';
          pendientes.push({ tipo: 'duplicado', ref: ref, fila: d._fila, nombre: nombre, coincidencias: c.coincidencias, mensaje: 'Posible duplicado: ' + c.coincidencias.map(function (m) { return '"' + m.nombre + '" (' + (m.trainerKey === tk ? 'esta agenda' : 'agenda de otro entrenador') + (m.miembroGrupo ? ', integrante de grupo' : '') + ', coincide ' + m.por.map(function (p) { return p === 'telefono' ? 'teléfono' : 'email'; }).join(' y ') + ')'; }).join('; ') });
        }
      }
      if (c.accion === 'nuevo' && !c.esMiembroCerrado && c.camposEconomicosFaltan && c.camposEconomicosFaltan.length) {
        err('CLIENTES', d._fila, 'Cliente nuevo: falta ' + c.camposEconomicosFaltan.join(', ') + '.');
      }
      if (c.accion === 'nuevo' && c.esMiembroCerrado && grupo && grupo.existente) {
        // Añadir un integrante a un grupo cerrado YA existente cambia ese grupo: requiere confirmación.
        grupo.miembrosNuevos.push(c);
      } else if (c.accion === 'nuevo' && c.esMiembroCerrado && grupo) {
        grupo.miembrosNuevos.push(c);
      }
      if (fichaExistente) {
        c.ficha = fichaExistente;
        c.id = fichaExistente.id;
        var esMiembroExistente = !!fichaExistente.vinculacion;
        if (c.esMiembroCerrado) {
          if (!esMiembroExistente || !grupo || !grupo.existente || fichaExistente.vinculacion !== grupo.existente.id) {
            err('CLIENTES', d._fila, '"' + nombre + '" ya existe en Besoul' + (esMiembroExistente ? ' como integrante de otro grupo' : ' como cliente individual') + ': no se puede cambiar su grupo desde la importación (hazlo desde su ficha o desde el grupo).');
            c.accion = 'error';
          }
        } else if (esMiembroExistente) {
          err('CLIENTES', d._fila, '"' + nombre + '" ya existe como integrante del grupo "' + (fichaExistente.grupoNombre || '') + '". Indica ese grupo en la columna Grupo o quita la fila.');
          c.accion = 'error';
        }
        if (c.accion === 'existente') {
          // Diferencias con la ficha actual: nunca se aplican sin confirmación expresa.
          var cambios = [];
          var comparar = function (campo, etiqueta, nuevo, actual, fmt) {
            if (nuevo == null || nuevo === '') return;
            if (String(nuevo) !== String(actual == null ? '' : actual)) cambios.push({ campo: campo, etiqueta: etiqueta, antes: fmt ? fmt(actual) : actual, despues: fmt ? fmt(nuevo) : nuevo, valor: nuevo });
          };
          if (fichaExistente.actividadEspecialId) {
            if (c.datosEconomicos) adv('CLIENTES', d._fila, '"' + nombre + '" es cliente de actividad especial: sus condiciones no se modifican desde la importación.');
          } else if (esMiembroExistente) {
            if (c.descuentoPct != null) comparar('descuentoPct', 'Descuento %', c.descuentoPct, deps.normalizarPorcentajeDescuento(fichaExistente.descuentoPct || 0));
          } else {
            comparar('modalidad', 'Modalidad', c.modalidad, fichaExistente.modalidad);
            if (c.factor != null) comparar('factor', 'Frecuencia', c.factor, parseInt(fichaExistente.factor, 10) || 1);
            comparar('tipoCompra', 'Tipo de compra', c.tipoCompra, fichaExistente.tipoCompra);
            comparar('fechaCompra', 'Fecha compra bono', c.fechaCompra, fichaExistente.fechaCompra, fechaHumana);
            if (c.descuentoPct != null) comparar('descuentoPct', 'Descuento %', c.descuentoPct, deps.normalizarPorcentajeDescuento(fichaExistente.descuentoPct || 0));
            if (texto(d.estado)) comparar('estadoCliente', 'Estado', c.estadoCliente, fichaExistente.estadoCliente || 'activo');
          }
          c.cambios = cambios;
          if (cambios.length && actualizar[ref]) c.accion = 'actualizar';
          else if (cambios.length) adv('CLIENTES', d._fila, '"' + nombre + '" ya existe y el Excel trae datos distintos (' + cambios.map(function (x) { return x.etiqueta; }).join(', ') + '). No se modifican salvo que marques "Actualizar ficha".');
        }
      }
      if (c.accion === 'nuevo' && errores.some(function (e) { return e.hoja === 'CLIENTES' && e.fila === d._fila; })) c.accion = 'error';
      if (c.observacionesInformativas && c.accion !== 'error') adv('CLIENTES', d._fila, 'Observaciones de un cliente activo: Besoul no tiene un campo general de observaciones en la ficha; este texto no se guarda.');
    });

    // Grupos cerrados existentes que recibirían integrantes nuevos -> requiere confirmación.
    plan.grupos.forEach(function (g) {
      if (!g.existente || g.abierto || !g.miembrosNuevos.length) return;
      if (confirmarGrupos[g.n]) { g.accion = 'ampliar'; }
      else pendientes.push({ tipo: 'grupo-existente', ref: 'GRUPO:' + g.n, grupoN: g.n, fila: g.fila, nombre: g.nombre, mensaje: 'Se añadirían ' + g.miembrosNuevos.length + ' integrante(s) nuevo(s) al grupo cerrado existente "' + g.nombre + '" (' + g.miembrosNuevos.map(function (m) { return m.nombre; }).join(', ') + ').' });
    });
    // Asistentes de grupos abiertos (clientes individuales con su propio plan).
    plan.clientes.forEach(function (c) {
      if (c.grupo && c.grupo.abierto && (c.accion === 'nuevo' || c.accion === 'existente' || c.accion === 'actualizar')) c.grupo.asistentes.push(c);
    });
    plan.grupos.forEach(function (g) {
      if (g.abierto && grupoValido(g)) {
        var cap = g.existente ? (parseInt(g.existente.capacidadGrupoAbierto, 10) || 1) : g.capacidad;
        if (g.asistentes.length > cap) err('GRUPOS', g.fila, 'El grupo abierto "' + g.nombre + '" tiene capacidad ' + cap + ' y el Excel le asigna ' + g.asistentes.length + ' asistentes.');
        g.capacidadEfectiva = cap;
      }
      if (!g.abierto && g.accion === 'crear' && !g.miembrosNuevos.length) adv('GRUPOS', g.fila, 'El grupo cerrado "' + g.nombre + '" no tiene integrantes en CLIENTES: se creará vacío.');
    });

    // --- SESIONES (horarios fijos + variables) ---
    var ocupadasPlan = {};            // clave de 15 min -> sesión planificada que la ocupa
    var series = 0;
    var titularDe = function (hoja, d) {
      var cTxt = texto(d.cliente), gTxt = texto(d.grupo);
      if (cTxt && gTxt) { err(hoja, d._fila, 'Indica un cliente O un grupo, no los dos.'); return null; }
      if (!cTxt && !gTxt) { err(hoja, d._fila, 'Falta el cliente o el grupo.'); return null; }
      if (cTxt) {
        var c = porNombre[normalizarTexto(cTxt)];
        if (!c) { err(hoja, d._fila, 'El cliente "' + cTxt + '" no está en la hoja CLIENTES.'); return null; }
        if (c.accion === 'otro-entrenador') { adv(hoja, d._fila, 'Sesión de un cliente de otro entrenador: no se importa aquí.'); return null; }
        if (c.accion === 'error') { err(hoja, d._fila, 'El cliente "' + cTxt + '" tiene errores en CLIENTES.'); return null; }
        if (c.accion === 'omitir') { adv(hoja, d._fila, 'Cliente "' + cTxt + '" omitido: no se crean sus sesiones.'); return null; }
        if (c.esMiembroCerrado) { err(hoja, d._fila, '"' + cTxt + '" es integrante de un grupo cerrado: agenda el GRUPO (nunca cada integrante por separado).'); return null; }
        if (c.grupo && c.grupo.abierto) adv(hoja, d._fila, '"' + cTxt + '" es asistente del grupo abierto "' + c.grupo.nombre + '" y además tiene una sesión individual propia.');
        return { tipo: 'cliente', c: c, nombre: c.nombre, ref: c.ref };
      }
      var g = gruposPorNombre[normalizarTexto(gTxt)];
      if (!g) { err(hoja, d._fila, 'El grupo "' + gTxt + '" no está en la hoja GRUPOS.'); return null; }
      if (g.accion === 'otro-entrenador') { adv(hoja, d._fila, 'Sesión de un grupo de otro entrenador: no se importa aquí.'); return null; }
      if (!grupoValido(g) && g.accion !== 'ampliar') { err(hoja, d._fila, 'El grupo "' + gTxt + '" tiene errores.'); return null; }
      return { tipo: 'grupo', g: g, nombre: g.nombre, ref: 'GRUPO:' + g.n };
    };
    var activo = function (t) {
      if (t.tipo === 'cliente') {
        if (!t.c.ficha) return t.c.estadoCliente === 'activo';
        var cambiaEstado = t.c.accion === 'actualizar' && t.c.cambios.some(function (x) { return x.campo === 'estadoCliente'; });
        return (cambiaEstado ? t.c.estadoCliente : (t.c.ficha.estadoCliente || 'activo')) === 'activo';
      }
      return t.g.existente ? (t.g.existente.estadoCliente || 'activo') === 'activo' : t.g.estadoCliente === 'activo';
    };
    var horasDeFila = function (hoja, d) {
      var hi = leerHora(d.horaInicio), hf = leerHora(d.horaFin);
      if (hi.error || hi.min == null) { err(hoja, d._fila, hi.error ? 'Hora de inicio "' + texto(d.horaInicio) + '" no válida.' : 'Falta la hora de inicio.'); return null; }
      if (hi.min % PASO_MIN !== 0) { err(hoja, d._fila, 'La hora de inicio debe ir en tramos de 15 minutos (p. ej. 10:00, 10:15).'); return null; }
      if (hi.min < INICIO_AGENDA_MIN || hi.min + DURACION_SESION_MIN > FIN_AGENDA_MIN) { err(hoja, d._fila, 'La sesión de 45 min a las ' + minutosAHora(hi.min) + ' queda fuera del horario de la Agenda (06:00-22:00).'); return null; }
      var extra = 0;
      if (hf.error) { err(hoja, d._fila, 'Hora de fin "' + texto(d.horaFin) + '" no válida.'); return null; }
      if (hf.min != null) {
        var dur = hf.min - hi.min;
        if (dur < DURACION_SESION_MIN) { err(hoja, d._fila, 'La franja ' + minutosAHora(hi.min) + '-' + minutosAHora(hf.min) + ' dura menos de 45 minutos: una sesión siempre dura 45.'); return null; }
        extra = dur - DURACION_SESION_MIN;
        if (dur > 60) adv(hoja, d._fila, 'Franja declarada de ' + dur + ' minutos: se crea UNA sesión real de 45 min (' + minutosAHora(hi.min) + '-' + minutosAHora(hi.min + 45) + ').');
      }
      return { inicio: minutosAHora(hi.min), inicioMin: hi.min, extra: extra, finDeclarado: hf.min != null ? minutosAHora(hf.min) : '' };
    };
    var registrarSesion = function (s) {
      // Bloque real de 45 min (3 tramos de 15). Los minutos adicionales declarados NO se reservan.
      var claves = [];
      for (var m = s.inicioMin; m < s.inicioMin + DURACION_SESION_MIN; m += PASO_MIN) claves.push(s.fecha + '_' + minutosAHora(m));
      s.clave = claves[0];
      var idTitular = s.titular.tipo === 'cliente' ? (s.titular.c.id || null) : (s.titular.g.existente ? s.titular.g.existente.id : null);
      var existente = null;
      for (var i = 0; i < claves.length; i++) {
        var cob = entorno.ocupacion(claves[i]);
        if (cob) { existente = cob; break; }
      }
      if (existente) {
        var obj = existente.obj || {};
        if (idTitular && obj.id === idTitular && existente.claveInicio === s.clave) {
          s.accion = 'existe';
          s.motivo = 'Ya existe en la Agenda (no se duplica).';
          if (s.titular.tipo === 'grupo' && s.titular.g.abierto) {
            var yaIds = (Array.isArray(obj.asistentesGrupoAbierto) ? obj.asistentesGrupoAbierto : []).map(function (a) { return a.id || a.clientId; });
            var faltan = s.titular.g.asistentes.filter(function (c) { return !c.id || yaIds.indexOf(c.id) === -1; });
            if (faltan.length) {
              var cap = parseInt(obj.capacidadGrupoAbierto || obj.capacidad, 10) || 1;
              if (yaIds.length + faltan.length > cap) { s.accion = 'conflicto'; s.motivo = 'La sesión del grupo abierto ya existe y no tiene plazas para ' + faltan.length + ' asistente(s) más.'; }
              else { s.accion = 'asistentes'; s.asistentesNuevos = faltan; s.motivo = 'Ya existe: se añaden ' + faltan.length + ' asistente(s).'; }
            }
          }
        } else {
          s.accion = 'conflicto';
          var esCRM = !!(obj.esPruebaCRM || obj.tipoCita === 'pruebaCRM');
          s.motivo = 'Hueco ocupado por ' + (esCRM ? 'una prueba CRM de ' : '') + (obj.nombre || 'otra cita') + ' (' + existente.claveInicio.split('_')[1] + '). No se sustituye.';
        }
      } else {
        for (var j = 0; j < claves.length; j++) {
          var otra = ocupadasPlan[claves[j]];
          if (otra) { s.accion = 'conflicto'; s.motivo = 'Se solapa con otra sesión del propio Excel (' + otra.nombre + ' ' + otra.inicio + ', ' + otra.hoja + ' fila ' + otra.fila + ').'; break; }
        }
        if (!s.accion) {
          s.accion = 'crear';
          claves.forEach(function (k) { ocupadasPlan[k] = s; });
        }
      }
      plan.sesiones.push(s);
    };
    var periodoOk = fechaISOValida(periodo.desde) && fechaISOValida(periodo.hasta) && periodo.desde <= periodo.hasta;

    (filas.HORARIOS_FIJOS || []).forEach(function (d) {
      var t = titularDe('HORARIOS_FIJOS', d);
      var dia = buscarEnLista(DIAS.map(function (x) { return { label: x.label, key: String(x.js), js: x.js }; }), d.dia);
      if (!texto(d.dia)) err('HORARIOS_FIJOS', d._fila, 'Falta el día de la semana.');
      else if (!dia) err('HORARIOS_FIJOS', d._fila, 'Día "' + texto(d.dia) + '" no válido (usa el desplegable).');
      var h = horasDeFila('HORARIOS_FIJOS', d);
      var desde = leerFechaCampo('HORARIOS_FIJOS', d, 'desde', 'Desde');
      var hasta = leerFechaCampo('HORARIOS_FIJOS', d, 'hasta', 'Hasta');
      if (desde && hasta && desde > hasta) err('HORARIOS_FIJOS', d._fila, '"Desde" es posterior a "Hasta".');
      if (!t || !dia || !h || !periodoOk) return;
      if (!activo(t)) { adv('HORARIOS_FIJOS', d._fila, '"' + t.nombre + '" no está activo: no se crean sesiones (igual que en la Agenda).'); return; }
      var ini = periodo.desde, fin = periodo.hasta;
      if (desde && desde > ini) ini = desde;
      if (hasta && hasta < fin) fin = hasta;
      var altaTitular = t.tipo === 'cliente' ? (t.c.ficha ? '' : t.c.fechaAlta) : (t.g.existente ? '' : t.g.fechaAlta);
      if (altaTitular && altaTitular > ini) ini = altaTitular;
      if (ini > fin) { adv('HORARIOS_FIJOS', d._fila, 'Ninguna fecha de esta fila cae dentro del periodo de importación.'); return; }
      var primera = ini;
      while (diaSemanaISO(primera) !== dia.js) primera = sumarDiasISO(primera, 1);
      series++;
      var serie = { id: 'serie_imp_' + series, fila: d._fila };
      var generadas = 0;
      for (var f = primera; f <= fin; f = sumarDiasISO(f, 7)) {
        registrarSesion({ origen: 'fijo', hoja: 'HORARIOS_FIJOS', fila: d._fila, titular: t, nombre: t.nombre, fecha: f, inicio: h.inicio, inicioMin: h.inicioMin, minutosExtra: h.extra, finDeclarado: h.finDeclarado, serie: serie });
        generadas++;
      }
      if (!generadas) adv('HORARIOS_FIJOS', d._fila, 'Ningún ' + dia.label.toLowerCase() + ' dentro del periodo.');
    });
    (filas.SESIONES_VARIABLES || []).forEach(function (d) {
      var t = titularDe('SESIONES_VARIABLES', d);
      var fecha = leerFechaCampo('SESIONES_VARIABLES', d, 'fecha', 'Fecha');
      if (!texto(d.fecha instanceof Date ? 'x' : d.fecha)) err('SESIONES_VARIABLES', d._fila, 'Falta la fecha.');
      var h = horasDeFila('SESIONES_VARIABLES', d);
      if (!t || !fecha || !h || !periodoOk) return;
      if (fecha < periodo.desde || fecha > periodo.hasta) { adv('SESIONES_VARIABLES', d._fila, 'Sesión del ' + fechaHumana(fecha) + ' fuera del periodo de importación: no se crea (impórtala eligiendo ese periodo).'); return; }
      if (!activo(t)) { adv('SESIONES_VARIABLES', d._fila, '"' + t.nombre + '" no está activo: no se crea la sesión.'); return; }
      registrarSesion({ origen: 'variable', hoja: 'SESIONES_VARIABLES', fila: d._fila, titular: t, nombre: t.nombre, fecha: fecha, inicio: h.inicio, inicioMin: h.inicioMin, minutosExtra: h.extra, finDeclarado: h.finDeclarado, nota: texto(d.observaciones) });
    });

    // Avisos de coherencia (no bloquean): plan mensual con más días fijos que su frecuencia,
    // bonos con más sesiones que las contratadas dentro del periodo, sesiones en fechas pasadas.
    var porTitular = {};
    plan.sesiones.forEach(function (s) {
      if (s.accion !== 'crear' && s.accion !== 'existe' && s.accion !== 'asistentes') return;
      var k = s.titular.ref;
      if (!porTitular[k]) porTitular[k] = { t: s.titular, total: 0, dias: {}, meses: {} };
      porTitular[k].total++;
      porTitular[k].meses[s.fecha.slice(0, 7)] = (porTitular[k].meses[s.fecha.slice(0, 7)] || 0) + 1;
      if (s.origen === 'fijo') porTitular[k].dias[s.serie.id] = true;
    });
    Object.keys(porTitular).forEach(function (k) {
      var x = porTitular[k], t = x.t;
      var info = t.tipo === 'cliente' ? (t.c.ficha && t.c.accion !== 'actualizar' ? { modalidad: t.c.ficha.modalidad, factor: parseInt(t.c.ficha.factor, 10) || 1, tipoCompra: t.c.ficha.tipoCompra } : { modalidad: t.c.modalidad, factor: t.c.factor, tipoCompra: t.c.tipoCompra })
        : (t.g.existente ? { modalidad: t.g.existente.modalidad, factor: parseInt(t.g.existente.factor, 10) || 1, tipoCompra: t.g.existente.tipoCompra } : { modalidad: t.g.modalidad, factor: t.g.factor, tipoCompra: t.g.tipoCompra });
      if (t.tipo === 'grupo' && t.g.abierto) return;
      var esBono = info.tipoCompra === 'Bono' || String(info.modalidad || '').indexOf('Bono') !== -1;
      var nDias = Object.keys(x.dias).length;
      if (esBono && info.factor && x.total > info.factor) adv('-', 0, '"' + t.nombre + '": ' + x.total + ' sesiones en el periodo para un bono de ' + info.factor + ' (el contador mostrará el exceso).');
      if (!esBono && String(info.modalidad || '').indexOf('Suelta') === -1 && info.factor && nDias > info.factor) adv('-', 0, '"' + t.nombre + '": ' + nDias + ' días fijos por semana para un plan de ' + info.factor + ' día(s)/semana.');
      // Plan mensual: un mes con 5 semanas puede superar las sesiones contratadas (frecuencia × 4).
      // No cambia la facturación (la mensualidad se cobra entera); el contador mostrará el exceso.
      if (!esBono && String(info.modalidad || '').indexOf('Suelta') === -1 && info.factor) {
        Object.keys(x.meses).forEach(function (mes) {
          if (x.meses[mes] > info.factor * 4) adv('-', 0, '"' + t.nombre + '": ' + x.meses[mes] + ' sesiones en ' + mes.slice(5, 7) + '/' + mes.slice(0, 4) + ' para un plan de ' + (info.factor * 4) + ' al mes (mes de 5 semanas): el contador de clases mostrará el exceso; la mensualidad no cambia.');
        });
      }
    });
    var pasadas = plan.sesiones.filter(function (s) { return s.accion === 'crear' && s.fecha < entorno.hoyISO; }).length;
    if (pasadas) adv('-', 0, pasadas + ' sesión(es) en fechas ya pasadas: contarán en los contadores de clases y en la facturación por sesión de ese mes.');
    var conMargen = plan.sesiones.filter(function (s) { return s.accion === 'crear' && s.minutosExtra > 0; }).length;
    if (conMargen) adv('-', 0, conMargen + ' sesión(es) con franja declarada mayor de 45 min: se crean de 45 min reales; el resto de la franja queda libre y se muestra solo como información.');

    plan.bloqueante = !!errores.length;
    return finalizar(plan, entorno);
  }

  function finalizar(plan, entorno) {
    var r = { nuevos: 0, existentes: 0, actualizar: 0, dudosos: 0, omitidos: 0, otroEntrenador: 0, errorFilas: 0, gruposNuevos: 0, gruposExistentes: 0, gruposAmpliados: 0, sesionesCrear: 0, sesionesExisten: 0, sesionesConflicto: 0, sesionesAsistentes: 0 };
    plan.clientes.forEach(function (c) {
      if (c.accion === 'nuevo') r.nuevos++; else if (c.accion === 'existente') r.existentes++; else if (c.accion === 'actualizar') r.actualizar++;
      else if (c.accion === 'dudoso') r.dudosos++; else if (c.accion === 'omitir') r.omitidos++; else if (c.accion === 'otro-entrenador') r.otroEntrenador++; else if (c.accion === 'error') r.errorFilas++;
    });
    plan.grupos.forEach(function (g) { if (g.accion === 'crear') r.gruposNuevos++; else if (g.accion === 'existente') r.gruposExistentes++; else if (g.accion === 'ampliar') r.gruposAmpliados++; });
    plan.sesiones.forEach(function (s) { if (s.accion === 'crear') r.sesionesCrear++; else if (s.accion === 'existe') r.sesionesExisten++; else if (s.accion === 'conflicto') r.sesionesConflicto++; else if (s.accion === 'asistentes') r.sesionesAsistentes++; });
    plan.resumen = r;
    // Tamaño estimado del documento besoulSuite/agenda tras la importación (límite de Firestore 1 MiB).
    var bytesFicha = function (c) { return 900 + texto(c.nombre).length + texto(c.email).length; };
    var extra = 0;
    plan.clientes.forEach(function (c) { if (c.accion === 'nuevo') extra += bytesFicha(c); });
    plan.grupos.forEach(function (g) { if (g.accion === 'crear') extra += 900 + g.miembrosNuevos.length * 120; });
    plan.sesiones.forEach(function (s) {
      if (s.accion === 'crear') {
        var base = s.titular.tipo === 'cliente' ? (s.titular.c.ficha ? tamanoJSON(s.titular.c.ficha) : bytesFicha(s.titular.c)) : (s.titular.g.existente ? tamanoJSON(s.titular.g.existente) : 900);
        extra += base + 200 + (s.titular.tipo === 'grupo' && s.titular.g.abierto ? s.titular.g.asistentes.length * 160 : 0) + (s.nota ? s.nota.length + 40 : 0);
      } else if (s.accion === 'asistentes') extra += s.asistentesNuevos.length * 160;
    });
    plan.tamanoEstimado = (entorno.tamanoDocumentoActual || 0) + extra;
    if (plan.tamanoEstimado > LIMITE_DOC_BLOQUEO) {
      plan.errores.push({ hoja: '-', fila: 0, mensaje: 'La importación haría crecer el documento de la Agenda hasta unos ' + Math.round(plan.tamanoEstimado / 1024) + ' KB y Firestore no admite más de 1 MB por documento. Importa un periodo más corto (por ejemplo, un mes).' });
      plan.bloqueante = true;
    } else if (plan.tamanoEstimado > LIMITE_DOC_AVISO) {
      plan.advertencias.push({ hoja: '-', fila: 0, mensaje: 'El documento de la Agenda quedará en unos ' + Math.round(plan.tamanoEstimado / 1024) + ' KB (límite de Firestore: 1 MB). Conviene importar periodos cortos.' });
    }
    plan.hayAlgoQueGuardar = r.nuevos + r.actualizar + r.gruposNuevos + r.gruposAmpliados + r.sesionesCrear + r.sesionesAsistentes > 0;
    plan.aplicable = !plan.bloqueante && !plan.errores.length && !plan.pendientes.length;
    plan.firma = firmaPlan(plan);
    return plan;
  }

  // Huella del plan: si al confirmar el estado real ya no produce el mismo plan, se vuelve a
  // enseñar la vista previa en vez de importar algo distinto de lo revisado.
  function firmaPlan(plan) {
    var partes = [];
    plan.clientes.forEach(function (c) { partes.push('C' + c.fila + ':' + c.accion + ':' + (c.id || '') + ':' + (c.descuentoPct != null ? c.descuentoPct : '')); });
    plan.grupos.forEach(function (g) { partes.push('G' + g.fila + ':' + g.accion); });
    plan.sesiones.forEach(function (s) { partes.push('S' + s.clave + ':' + s.titular.ref + ':' + s.accion); });
    return partes.join('|');
  }

  // ---------------------------------------------------------------------------------------------
  // Aplicación del plan EN MEMORIA (agenda.html guarda después con su guardado transaccional).
  // ---------------------------------------------------------------------------------------------
  // est = { clientes: array vivo dbClientes[tk], agenda: objeto vivo dbAgenda[tk], notas:{leer(clave), fijar(clave,texto)},
  //   sincronizarIntegrantesGrupo(fichaGrupo), importeEfectivoCliente(ficha), contratoVacio(), generarToken(),
  //   idsUsados:Set, ahoraISO, hoyISO, loteId }
  // Devuelve { deshacer(), resumen }. deshacer() solo revierte lo que esta importación cambió y que
  // sigue intacto (comparación por identidad), así que nunca pisa datos que hayan llegado después.
  function aplicarPlan(plan, est) {
    if (!plan || !plan.aplicable) throw new Error('El plan no es aplicable.');
    var ops = [];
    var lista = est.clientes, agenda = est.agenda;
    var base = Date.now();
    var seq = 0;
    var nuevoId = function (prefijo) {
      var id;
      do { id = prefijo + (base + (seq++)); } while (est.idsUsados.has(id));
      est.idsUsados.add(id);
      return id;
    };
    var fichaBaseNueva = function (datos) {
      var contrato = est.contratoVacio(); contrato.firmado = false;
      return {
        id: datos.id, tipo: datos.tipo, nombre: datos.nombre,
        telefono: datos.tipo === 'grupo' ? '' : datos.telefono, email: datos.tipo === 'grupo' ? '' : datos.email,
        reservaToken: datos.tipo === 'grupo' ? '' : est.generarToken(),
        reservasOnlineActivas: datos.tipo !== 'grupo',
        reservasBloqueadasTexto: '', restriccionesReservas: { modo: 'bloquear', bloquesTexto: '' },
        grupoAbierto: datos.tipo === 'grupo' ? !!datos.grupoAbierto : false,
        capacidadGrupoAbierto: datos.tipo === 'grupo' && datos.grupoAbierto ? datos.capacidad : 0,
        modalidad: datos.modalidad, factor: datos.factor, tipoCompra: datos.tipoCompra, fechaCompra: datos.fechaCompra || '',
        actividadEspecialId: '', modalidadId: '', segmentoId: '', planSesiones: 0, numPersonas: 0,
        color: 'amber', descuentoPct: datos.descuentoPct || 0, contratoCliente: contrato,
        estadoCliente: datos.estadoCliente || 'activo', fechaAlta: datos.fechaAlta || est.hoyISO,
        fechaEstado: datos.fechaEstado || '', observacionesEstado: datos.observacionesEstado || '',
        integrantesObj: datos.integrantesObj || [],
        importacionExcelId: est.loteId
      };
    };
    var resumen = { clientesCreados: 0, clientesActualizados: 0, gruposCreados: 0, gruposAmpliados: 0, sesionesCreadas: 0, sesionesConAsistentes: 0 };
    var fichaDe = {}; // ref -> ficha viva tras aplicar
    var deshacer = function () {
      for (var i = ops.length - 1; i >= 0; i--) {
        var op = ops[i];
        if (op.tipo === 'alta') {
          var k = lista.indexOf(op.actual);
          if (k !== -1) lista.splice(k, 1);
        } else if (op.tipo === 'ficha') {
          var k2 = lista.indexOf(op.actual);
          if (k2 !== -1) lista[k2] = op.anterior;
        } else if (op.tipo === 'cita') {
          if (agenda[op.clave] === op.actual) {
            if (op.anterior === undefined) delete agenda[op.clave];
            else agenda[op.clave] = op.anterior;
          }
        } else if (op.tipo === 'nota') {
          if ((est.notas.leer(op.clave) || '') === op.actual) est.notas.fijar(op.clave, op.anterior);
        }
      }
      ops.length = 0;
    };
    try {

    // 1) Clientes individuales nuevos (no integrantes de grupo cerrado).
    plan.clientes.forEach(function (c) {
      if (c.accion === 'existente') { fichaDe[c.ref] = c.ficha; return; }
      if (c.accion === 'actualizar') {
        var anterior = c.ficha;
        var idx = lista.indexOf(anterior);
        if (idx === -1) throw new Error('La ficha de "' + c.nombre + '" ha cambiado mientras se importaba.');
        var nueva = Object.assign({}, anterior);
        c.cambios.forEach(function (x) { nueva[x.campo] = x.valor; });
        if (nueva.estadoCliente === 'activo') { nueva.fechaEstado = ''; nueva.observacionesEstado = ''; }
        else if (c.cambios.some(function (x) { return x.campo === 'estadoCliente'; })) { nueva.fechaEstado = c.fechaEstado || ''; nueva.observacionesEstado = c.observacionesEstado || ''; }
        if (anterior.vinculacion) nueva.facturacionEstadistica = est.importeEfectivoCliente(nueva);
        lista[idx] = nueva;
        ops.push({ tipo: 'ficha', anterior: anterior, actual: nueva });
        fichaDe[c.ref] = nueva;
        resumen.clientesActualizados++;
        return;
      }
      if (c.accion !== 'nuevo' || c.esMiembroCerrado) return;
      var ficha = fichaBaseNueva({
        id: nuevoId('cli_'), tipo: 'individual', nombre: c.nombre, telefono: c.telefono, email: c.email,
        modalidad: c.modalidad, factor: c.factor, tipoCompra: c.tipoCompra || 'Mensualidad', fechaCompra: c.tipoCompra === 'Bono' ? c.fechaCompra : '',
        descuentoPct: c.descuentoPct || 0, estadoCliente: c.estadoCliente, fechaAlta: c.fechaAlta, fechaEstado: c.fechaEstado, observacionesEstado: c.observacionesEstado
      });
      lista.push(ficha);
      ops.push({ tipo: 'alta', actual: ficha });
      c.id = ficha.id;
      fichaDe[c.ref] = ficha;
      resumen.clientesCreados++;
    });

    // 2) Grupos nuevos y ampliación (confirmada) de grupos cerrados existentes. Los integrantes se
    //    crean con la MISMA función que el formulario (sincronizarIntegrantesGrupo); después se fija
    //    el descuento individual de cada integrante (regla B: cada uno con el suyo).
    var fijarMiembros = function (fichaGrupo, miembros) {
      miembros.forEach(function (m) {
        var fm = null;
        for (var i = 0; i < lista.length; i++) if (lista[i] && lista[i].tipo === 'individual' && lista[i].vinculacion === fichaGrupo.id && lista[i].memberId === m._memberId) { fm = lista[i]; break; }
        if (!fm) throw new Error('No se ha podido crear la ficha del integrante "' + m.nombre + '".');
        fm.descuentoPct = m.descuentoPct || 0;
        fm.importacionExcelId = est.loteId;
        fm.facturacionEstadistica = est.importeEfectivoCliente(fm);
        ops.push({ tipo: 'alta', actual: fm });
        m.id = fm.id;
        fichaDe[m.ref] = fm;
      });
    };
    plan.grupos.forEach(function (g) {
      if (g.accion === 'crear') {
        var miembros = g.abierto ? [] : g.miembrosNuevos;
        var integrantes = miembros.map(function (m) { m._memberId = nuevoId('mem_'); return { id: m._memberId, nombre: m.nombre, telefono: m.telefono, email: m.email }; });
        var fg = fichaBaseNueva({
          id: nuevoId('cli_'), tipo: 'grupo', nombre: g.nombre, grupoAbierto: g.abierto, capacidad: g.capacidad,
          modalidad: g.modalidad, factor: g.factor, tipoCompra: g.tipoCompra, fechaCompra: g.tipoCompra === 'Bono' ? g.fechaCompra : '',
          descuentoPct: 0, estadoCliente: g.estadoCliente, fechaAlta: g.fechaAlta, integrantesObj: integrantes
        });
        lista.push(fg);
        ops.push({ tipo: 'alta', actual: fg });
        if (!g.abierto) { est.sincronizarIntegrantesGrupo(fg); fijarMiembros(fg, miembros); }
        g.ficha = fg;
        resumen.gruposCreados++;
      } else if (g.accion === 'ampliar') {
        var anteriorG = g.existente;
        var idxG = lista.indexOf(anteriorG);
        if (idxG === -1) throw new Error('El grupo "' + g.nombre + '" ha cambiado mientras se importaba.');
        var antesIds = {};
        lista.forEach(function (x) { if (x) antesIds[x.id] = true; });
        var nuevos = g.miembrosNuevos.map(function (m) { m._memberId = nuevoId('mem_'); return { id: m._memberId, nombre: m.nombre, telefono: m.telefono, email: m.email }; });
        var fgN = Object.assign({}, anteriorG, { integrantesObj: (anteriorG.integrantesObj || []).concat(nuevos) });
        lista[idxG] = fgN;
        ops.push({ tipo: 'ficha', anterior: anteriorG, actual: fgN });
        est.sincronizarIntegrantesGrupo(fgN);
        fijarMiembros(fgN, g.miembrosNuevos);
        g.ficha = fgN;
        resumen.gruposAmpliados++;
      } else if (g.accion === 'existente') {
        g.ficha = g.existente;
      }
    });

    // 3) Sesiones: misma forma que crea la Agenda al arrastrar un cliente ({...ficha, duracionMin:45})
    //    o al crear una recurrencia semanal (recurrente/serieRecurrenteId/recurrenteOrigen).
    var seriesReales = {};
    var asistentesDe = function (g) {
      return g.asistentes.map(function (c) {
        var f = fichaDe[c.ref];
        return { id: f.id, nombre: f.nombre, email: f.email || '', telefono: f.telefono || '', añadidoManual: true, añadidoEn: est.ahoraISO, importacionExcelId: est.loteId };
      });
    };
    plan.sesiones.forEach(function (s) {
      if (s.accion === 'asistentes') {
        var actualCita = agenda[s.clave];
        if (!actualCita) throw new Error('La sesión de ' + s.clave + ' ha cambiado mientras se importaba.');
        var nuevosA = s.asistentesNuevos.map(function (c) { var f = fichaDe[c.ref]; return { id: f.id, nombre: f.nombre, email: f.email || '', telefono: f.telefono || '', añadidoManual: true, añadidoEn: est.ahoraISO, importacionExcelId: est.loteId }; });
        var citaA = Object.assign({}, actualCita, { asistentesGrupoAbierto: (Array.isArray(actualCita.asistentesGrupoAbierto) ? actualCita.asistentesGrupoAbierto : []).concat(nuevosA) });
        agenda[s.clave] = citaA;
        ops.push({ tipo: 'cita', clave: s.clave, anterior: actualCita, actual: citaA });
        resumen.sesionesConAsistentes++;
        return;
      }
      if (s.accion !== 'crear') return;
      if (agenda[s.clave]) throw new Error('El hueco ' + s.clave + ' se ha ocupado mientras se importaba.');
      var base = s.titular.tipo === 'cliente' ? fichaDe[s.titular.c.ref] : s.titular.g.ficha;
      if (!base) throw new Error('No se encuentra la ficha de "' + s.nombre + '".');
      var cita;
      if (s.titular.tipo === 'grupo' && s.titular.g.abierto) {
        cita = Object.assign({}, base, { duracionMin: DURACION_SESION_MIN, tipoCita: 'grupo_abierto', grupoAbierto: true, capacidadGrupoAbierto: Math.max(1, parseInt(base.capacidadGrupoAbierto || base.capacidad || 1, 10) || 1), asistentesGrupoAbierto: asistentesDe(s.titular.g) });
      } else {
        cita = Object.assign({}, base, { duracionMin: DURACION_SESION_MIN });
      }
      if (s.origen === 'fijo') {
        var sr = seriesReales[s.serie.id];
        if (!sr) sr = seriesReales[s.serie.id] = { id: 'serie_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), origen: s.clave };
        cita.recurrente = true;
        cita.serieRecurrenteId = sr.id;
        cita.recurrenteOrigen = sr.origen;
        cita.recurrenteCreadaEn = est.ahoraISO;
      }
      if (s.minutosExtra > 0) cita.bloqueDeclaradoMin = DURACION_SESION_MIN + s.minutosExtra;
      cita.importacionExcelId = est.loteId;
      agenda[s.clave] = cita;
      ops.push({ tipo: 'cita', clave: s.clave, anterior: undefined, actual: cita });
      // Igual que la Agenda al crear una sesión: el hueco empieza sin nota (o con la nota del Excel).
      var notaAnterior = est.notas.leer(s.clave);
      var notaNueva = s.nota || '';
      if ((notaAnterior || '') !== notaNueva) {
        est.notas.fijar(s.clave, notaNueva);
        ops.push({ tipo: 'nota', clave: s.clave, anterior: notaAnterior || '', actual: notaNueva });
      }
      resumen.sesionesCreadas++;
    });
    } catch (e) {
      // Nunca un estado a medias: lo aplicado hasta el fallo se revierte antes de propagar el error.
      deshacer();
      throw e;
    }
    return { deshacer: deshacer, resumen: resumen, operaciones: ops.length };
  }

  // ---------------------------------------------------------------------------------------------
  // Excel de EJEMPLO con datos 100 % ficticios (para enseñar a rellenar la plantilla y para tests)
  // ---------------------------------------------------------------------------------------------
  function ejemploFicticio(catalogo, desdeISO) {
    var lab = function (key) { for (var i = 0; i < catalogo.modalidades.length; i++) if (catalogo.modalidades[i].key === key) return catalogo.modalidades[i].label; return key; };
    var tr = catalogo.trainerNombre;
    var d0 = fechaISOValida(desdeISO) ? desdeISO : isoDesdeUTC(new Date());
    var cli = function (nombre, tel, email, mod, frec, contr, precio, extra) {
      var o = { nombre: nombre, telefono: tel, email: email, entrenador: tr, modalidad: mod ? lab(mod) : '', frecuencia: frec, contratacion: contr, precio: precio, fechaAlta: d0, estado: 'Activo' };
      for (var k in (extra || {})) o[k] = extra[k];
      return o;
    };
    return {
      CLIENTES: [
        cli('Ana Ficticia Ejemplo', '600 000 101', 'ana.ficticia@example.test', 'Individual Plan', 2, 'Mensualidad recurrente', 190),
        cli('Bruno Ficticio Ejemplo', '600 000 102', 'bruno.ficticio@example.test', 'Individual Bono', 10, 'Bono', 270, { fechaCompra: d0 }),
        cli('Carla Ficticia Ejemplo', '600 000 103', 'carla.ficticia@example.test', 'Individual Plan', 1, 'Mensualidad recurrente', 120, { observaciones: 'Sin horario fijo todavía' }),
        cli('Diego Ficticio Ejemplo', '600 000 104', 'diego.ficticio@example.test', 'Pareja', 2, 'Mensualidad recurrente', 300),
        cli('Elena Ficticia Ejemplo', '600 000 105', 'elena.ficticia@example.test', '', null, '', 75, { grupo: 'Grupo Ficticio Mañanas' }),
        cli('Fran Ficticio Ejemplo', '600 000 106', 'fran.ficticio@example.test', '', null, '', 80, { grupo: 'Grupo Ficticio Mañanas' }),
        cli('Gema Ficticia Ejemplo', '600 000 107', 'gema.ficticia@example.test', 'Grupo Reducido Plan', 1, 'Mensualidad recurrente', 45, { grupo: 'Grupo Abierto Ficticio 19h' }),
        cli('Hugo Ficticio Ejemplo', '600 000 108', 'hugo.ficticio@example.test', 'Individual Suelta', 1, 'Mensualidad recurrente', 30)
      ],
      GRUPOS: [
        { nombre: 'Grupo Ficticio Mañanas', tipoGrupo: 'Cerrado', entrenador: tr, modalidad: lab('Grupo Reducido Plan'), frecuencia: 2, contratacion: 'Mensualidad recurrente', fechaAlta: d0, estado: 'Activo' },
        { nombre: 'Grupo Abierto Ficticio 19h', tipoGrupo: 'Abierto', entrenador: tr, capacidad: 6, fechaAlta: d0, estado: 'Activo' }
      ],
      HORARIOS_FIJOS: [
        { cliente: 'Ana Ficticia Ejemplo', dia: 'Lunes', horaInicio: '10:00', horaFin: '11:00' },
        { cliente: 'Ana Ficticia Ejemplo', dia: 'Jueves', horaInicio: '18:00', horaFin: '18:45' },
        { cliente: 'Bruno Ficticio Ejemplo', dia: 'Miércoles', horaInicio: '09:00' },
        { cliente: 'Diego Ficticio Ejemplo', dia: 'Martes', horaInicio: '08:00', horaFin: '09:00' },
        { grupo: 'Grupo Ficticio Mañanas', dia: 'Lunes', horaInicio: '09:00', horaFin: '10:00' },
        { grupo: 'Grupo Ficticio Mañanas', dia: 'Miércoles', horaInicio: '10:00', horaFin: '11:00' },
        { grupo: 'Grupo Abierto Ficticio 19h', dia: 'Viernes', horaInicio: '19:00', horaFin: '20:00' }
      ],
      SESIONES_VARIABLES: [
        { cliente: 'Hugo Ficticio Ejemplo', fecha: sumarDiasISO(d0, 10), horaInicio: '12:00', horaFin: '13:00', observaciones: 'Sesión puntual de ejemplo' },
        { cliente: 'Bruno Ficticio Ejemplo', fecha: sumarDiasISO(d0, 3), horaInicio: '17:00' }
      ]
    };
  }

  var api = {
    VERSION_PLANTILLA: VERSION_PLANTILLA, DURACION_SESION_MIN: DURACION_SESION_MIN, HOJAS: HOJAS, FILAS: FILAS,
    LIMITE_DOC_AVISO: LIMITE_DOC_AVISO, LIMITE_DOC_BLOQUEO: LIMITE_DOC_BLOQUEO, MAX_DIAS_PERIODO: MAX_DIAS_PERIODO,
    construirCatalogo: construirCatalogo, generarPlantilla: generarPlantilla, leerLibro: leerLibro,
    planificar: planificar, aplicarPlan: aplicarPlan, formulasFila: formulasFila, ejemploFicticio: ejemploFicticio,
    redondear2: redondear2, fechaHumana: fechaHumana, normalizarTexto: normalizarTexto
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BesoulImportacion = api;
})(typeof window !== 'undefined' ? window : this);
