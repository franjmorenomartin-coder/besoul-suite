// PORTAL-SLOTS-P0: extrae VERBATIM la cadena completa Agenda -> publicarReservasPublicas() ->
// besoulPublicSchedule/besoulPublicClients (agenda.html) + el generador de slots real del Portal
// (portal-cliente.html) + la auditoría de identidad trainerKey (agenda.html) -- mismo patrón de
// brace-matching que el resto de la suite, nunca una reimplementación paralela.
const fs = require('fs');
const path = require('path');

function extractBalanced(html, startIndex, openChar, closeChar) {
  let i = html.indexOf(openChar, startIndex);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === openChar) depth++;
    else if (html[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  return i;
}
function extractFunction(html, name) {
  const re = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  // El cuerpo de la función empieza en el "{" que sigue al CIERRE de la lista de parámetros, no en
  // el primer "{" tras el nombre -- un parámetro desestructurado (p.ej. "(trainerKey, { fs })")
  // tiene su propio "{...}" antes del cuerpo real, y balancear desde ahí corta la función en seco.
  const finParametros = extractBalanced(html, m.index + m[0].length - 1, '(', ')');
  const end = extractBalanced(html, finParametros, '{', '}');
  return html.slice(m.index, end);
}
function extractSimpleConst(html, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const simple ${name}`);
  return m[0];
}

const agendaHtml = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');
const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-cliente.html'), 'utf8');

const agendaFunciones = [
  'formatoFechaLocal', 'normalizarEstadoCliente', 'estadoClienteFicha', 'clienteActivoParaAgenda',
  'esGrupoAbierto', 'capacidadGrupoAbierto', 'asistentesGrupoAbierto', 'clavesBloqueSesion',
  'minutosDesdeHorario', 'claveDesdeFechaYMinutos', 'formatoMinutosHorario',
  'sesionesClienteParaPortal', 'calendarioSesionesClienteParaPortal', 'nombreEntrenador',
  'publicarReservasPublicasParaTrainer', 'publicarReservasPublicas', 'normalizarTrainerKey',
  'diasDisponibilidadActivaTrainer', 'construirAuditoriaTrainerKey', 'disponibilidadReservasPorDefecto',
  // Cadena real de calcularContadorClases() (nunca un stub): PORTAL-SLOTS-P0 GLOBAL encontró que
  // contarSesionesAgendadas() leía el global entrenadorVisto en vez del trainerKey real del cliente
  // publicado -- exacta, no una aproximación, para poder probar el fix con datos reales.
  'calcularContadorClases', 'contarSesionesAgendadas', 'sesionesContratadasFicha', 'sumarMeses',
  'fichaBaseParaContador', 'buscarFichaPorId', 'formatoFechaCorta', 'etiquetaMesDesdeClave',
  'esCitaPruebaCRM',
];
const agendaConsts = ['BS_PUBLIC_CLIENTS_COLLECTION', 'BS_PUBLIC_SCHEDULE_COLLECTION', 'CANCELACION_MIN_HORAS_DEFAULT'];
const agendaParts = [...agendaConsts.map(n => extractSimpleConst(agendaHtml, n)), ...agendaFunciones.map(n => extractFunction(agendaHtml, n))];
fs.writeFileSync(path.join(__dirname, 'agenda_slots_extract.js'), agendaParts.join('\n\n'));

const portalFunciones = [
  'dateISO', 'timeToMin', 'minToTime', 'dayIndexMonSun', 'normalizarDiaTexto',
  'parseBloqueosCliente', 'bloqueadoPorCliente', 'normalizarBloques', 'fusionarBloques',
  'bloquesDisponibilidadFechaCliente', 'slotBloqueadoPorPT', 'slotOcupado', 'bloqueLibre',
  'intervalosOcupadosDentroBloque', 'huecosLibresFecha', 'iniciosEficientesHueco', 'generarSlotsReserva',
];
const portalParts = portalFunciones.map(n => extractFunction(portalHtml, n));
fs.writeFileSync(path.join(__dirname, 'portal_slots_extract.js'), portalParts.join('\n\n'));

console.log('OK, bloques extraidos: agenda=' + agendaParts.length + ' portal=' + portalParts.length);
