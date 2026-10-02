// BESOUL -- identidad y fechas de negocio compartidas (HOTFIX-CRM-DUPLICADOS-FECHA-ALTA).
//
// UNA sola implementación, cargada por crm.html, agenda.html y valoracion.html (y por los tests
// en Node con require()), para que la detección de duplicados y las fechas de negocio no puedan
// divergir entre pantallas.
//
// IDENTIDAD (solo señales "duras"; el nombre NUNCA identifica a una persona):
//   - email: trim + minúsculas. No se tocan puntos ni "+etiquetas": hacerlo fusionaría personas
//     distintas en dominios que sí los distinguen.
//   - teléfono: forma canónica con prefijo de país, solo dígitos.
//       612345678 / +34612345678 / +34 612 345 678 / 0034612345678 / 34612345678 -> 34612345678
//       +44 7700 900123 / 0044... -> 447700900123 (el país extranjero se conserva)
//       Un número sin prefijo que no es español reconocible se deja tal cual (no se inventa país).
//
// FECHAS DE NEGOCIO (calendario de Madrid, nunca UTC):
//   - fechaAltaReal 'YYYY-MM-DD' = cuándo se apuntó/entró de verdad la persona.
//   - createdAt (ISO) = cuándo se registró en Besoul. Inmutable, auditoría.
//   - fechaNegocioLead(lead) = fechaAltaReal ?? fecha de Madrid de createdAt  (compatibilidad:
//     los registros históricos sin el campo se comportan exactamente como antes).
(function (root) {
  'use strict';

  var ZONA = 'Europe/Madrid';

  function normalizarEmailIdentidad(email) {
    return String(email == null ? '' : email).trim().toLowerCase();
  }

  /** Forma canónica (solo dígitos, con prefijo de país) o '' si no hay número utilizable. */
  function normalizarTelefonoIdentidad(tel) {
    var bruto = String(tel == null ? '' : tel).trim();
    if (!bruto) return '';
    var internacional = /^\s*(\+|00)/.test(bruto);
    var d = bruto.replace(/\D/g, '');
    if (!d) return '';
    if (internacional) {
      if (bruto.trim().slice(0, 2) === '00' && bruto.trim()[0] !== '+') d = d.replace(/^00/, '');
      return d;
    }
    // Sin prefijo explícito.
    if (d.length === 9 && /^[6789]/.test(d)) return '34' + d;               // móvil/fijo español
    if (d.length === 11 && /^34[6789]/.test(d)) return d;                   // 34 sin "+"
    return d;                                                              // desconocido: tal cual
  }

  /**
   * Claves del registro público de valoraciones que pueden existir para este teléfono:
   * la canónica nueva + las variantes "solo dígitos" que la versión anterior generaba para un
   * número español (9 dígitos, 34+9, 0034+9). Así el registro existente sigue bloqueando
   * repeticiones aunque la persona escriba ahora el número con otro formato.
   */
  function variantesTelefonoRegistro(tel) {
    var canon = normalizarTelefonoIdentidad(tel);
    if (!canon) return [];
    var out = [canon];
    var digitosOriginales = String(tel == null ? '' : tel).replace(/\D/g, '');
    if (digitosOriginales && out.indexOf(digitosOriginales) === -1) out.push(digitosOriginales);
    if (/^34[6789]\d{8}$/.test(canon)) {
      [canon.slice(2), '00' + canon].forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
    }
    return out;
  }

  /** 'YYYY-MM-DD' del calendario de Madrid para un ISO/Date/ms, o '' si no es válido. */
  function fechaLocalMadrid(valor) {
    if (valor == null || valor === '') return '';
    var d = valor instanceof Date ? valor : new Date(valor);
    if (isNaN(d.getTime())) return '';
    var partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    var get = function (t) { for (var i = 0; i < partes.length; i++) if (partes[i].type === t) return partes[i].value; return ''; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function hoyLocalMadrid(ahora) { return fechaLocalMadrid(ahora || new Date()); }

  function esFechaNegocioValida(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
    var p = v.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  /** Fecha de negocio de un lead: fechaAltaReal si existe, si no la fecha de Madrid de createdAt
   *  (y, como hacía el código anterior, updatedAt si tampoco hay createdAt). */
  function fechaNegocioLead(lead) {
    if (lead && esFechaNegocioValida(lead.fechaAltaReal)) return lead.fechaAltaReal;
    return fechaLocalMadrid(lead && (lead.createdAt || lead.updatedAt));
  }

  /** Fecha de registro en Besoul (calendario de Madrid). */
  function fechaRegistroLead(lead) {
    return fechaLocalMadrid(lead && (lead.createdAt || lead.updatedAt));
  }

  /** Fecha (Madrid) en que se registró la conversión. */
  function fechaConversionLead(lead) {
    if (!lead) return '';
    if (esFechaNegocioValida(lead.fechaConversion)) return lead.fechaConversion;
    return fechaLocalMadrid(lead.convertedAt);
  }

  /** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (texto humano), '' si vacío. */
  function fechaHumana(yyyyMmDd) {
    if (!esFechaNegocioValida(yyyyMmDd)) return '';
    var p = yyyyMmDd.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /** ISO -> 'DD/MM/YYYY HH:mm' en hora de Madrid, '' si no válido. */
  function fechaHoraHumana(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var partes = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    var get = function (t) { for (var i = 0; i < partes.length; i++) if (partes[i].type === t) return partes[i].value; return ''; };
    return get('day') + '/' + get('month') + '/' + get('year') + ' ' + get('hour') + ':' + get('minute');
  }

  /** Primer y último día del mes actual de Madrid, 'YYYY-MM-DD'. */
  function rangoMesActualMadrid(ahora) {
    var hoy = hoyLocalMadrid(ahora);
    var y = Number(hoy.slice(0, 4));
    var m = Number(hoy.slice(5, 7));
    var ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { desde: hoy.slice(0, 8) + '01', hasta: hoy.slice(0, 8) + String(ultimo).padStart(2, '0') };
  }

  /** ¿'YYYY-MM-DD' está dentro de [desde, hasta] (ambos incluidos)? Vacíos = sin límite. */
  function fechaEnRango(fecha, desde, hasta) {
    if (!fecha) return false;
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  }

  /**
   * Coincidencias de identidad "dura" entre una persona y una lista de candidatos.
   * candidatos: [{ id, tipo, nombre, telefono, email, ...extra }]
   * Devuelve [{ candidato, por: ['telefono'|'email', ...] }]. El nombre nunca cuenta.
   */
  function buscarCoincidenciasIdentidad(persona, candidatos, opciones) {
    var excluirIds = (opciones && opciones.excluirIds) || [];
    var tel = normalizarTelefonoIdentidad(persona && persona.telefono);
    var email = normalizarEmailIdentidad(persona && persona.email);
    if (!tel && !email) return [];
    var out = [];
    (candidatos || []).forEach(function (c) {
      if (!c || excluirIds.indexOf(c.id) !== -1) return;
      var por = [];
      if (tel && normalizarTelefonoIdentidad(c.telefono) === tel) por.push('telefono');
      if (email && normalizarEmailIdentidad(c.email) === email) por.push('email');
      if (por.length) out.push({ candidato: c, por: por });
    });
    return out;
  }

  /** "teléfono", "email" o "teléfono y email" para el aviso al usuario. */
  function textoCoincidencia(por) {
    var t = (por || []).indexOf('telefono') !== -1;
    var e = (por || []).indexOf('email') !== -1;
    return t && e ? 'teléfono y email' : t ? 'teléfono' : 'email';
  }

  /** Trocea una lista de operaciones para lotes de Firestore (límite real: 500 por batch). */
  function trocear(lista, tam) {
    var t = tam || 450;
    var out = [];
    for (var i = 0; i < (lista || []).length; i += t) out.push(lista.slice(i, i + t));
    return out;
  }

  var api = {
    normalizarEmailIdentidad: normalizarEmailIdentidad,
    normalizarTelefonoIdentidad: normalizarTelefonoIdentidad,
    variantesTelefonoRegistro: variantesTelefonoRegistro,
    fechaLocalMadrid: fechaLocalMadrid,
    hoyLocalMadrid: hoyLocalMadrid,
    esFechaNegocioValida: esFechaNegocioValida,
    fechaNegocioLead: fechaNegocioLead,
    fechaRegistroLead: fechaRegistroLead,
    fechaConversionLead: fechaConversionLead,
    fechaHumana: fechaHumana,
    fechaHoraHumana: fechaHoraHumana,
    rangoMesActualMadrid: rangoMesActualMadrid,
    fechaEnRango: fechaEnRango,
    buscarCoincidenciasIdentidad: buscarCoincidenciasIdentidad,
    textoCoincidencia: textoCoincidencia,
    trocear: trocear,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BesoulIdentidad = api;
})(typeof window !== 'undefined' ? window : globalThis);
