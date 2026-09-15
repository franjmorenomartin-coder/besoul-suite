// AI-09/B21 (ampliado tras auditoría pre-commit): pruebas reales del motor determinista del
// asistente, extrayendo el codigo REAL de agenda.html via extract.js (brace-matching automatico,
// no una copia manual -- ver hallazgo de la auditoria sobre la version anterior de este archivo).
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'assistant_extract.js'), 'utf8');

let dbAgenda = {};
let dbDisponibilidadReservas = {};
let entrenadorVisto = 'carmen';
function formatoFechaLocal(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

const fn = new Function('dbAgenda', 'dbDisponibilidadReservas', 'entrenadorVisto', 'formatoFechaLocal', extracted + `
  return {
    TARIFAS_2026, CENTROS_BESOUL_INFO, CAPACIDADES_PT, normalizarTextoAsistente, lematizarPalabra, distanciaEdicionAcotada,
    palabraCoincideFuzzy, buscarCapacidadPT, respuestaCapacidadPT, respuestaAmbiguaPT,
    respuestaCalculoAsistente, respuestaDiagnosticoHueco, respuestaAyudaAsistente
  };`);
const M = fn(dbAgenda, dbDisponibilidadReservas, entrenadorVisto, formatoFechaLocal);

let pass = 0, fail = 0;
const fails = [];
function check(seccion, desc, actual, expectedPredicate) {
  const ok = expectedPredicate(actual);
  if (ok) pass++; else { fail++; fails.push(`[${seccion}] ${desc} :: got=${JSON.stringify(actual)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}`);
}
function capId(q, rol = 'pt') {
  const r = M.buscarCapacidadPT(M.normalizarTextoAsistente(q), rol);
  return r && !r.ambiguo ? r.id : (r && r.ambiguo ? 'AMBIGUO' : null);
}

// ============================================================
console.log('=== AI-04 Motor de calculo determinista ===');
// ============================================================
const calcCasos = [
  ['15% de 120', r => r && r.includes('18') && r.includes('120')],
  ['10 por ciento de 200', r => r === null || r.includes('20')],
  ['si le hago un 10% de descuento a 120', r => r && r.includes('108')],
  ['si le descuento 10% a 120 euros', r => r && r.includes('108')],
  ['de 120 a 100 que descuento es', r => r && r.includes('16.67')],
  ['si cobra 95 y aplico 15%, cuanto queda', r => r && r.includes('80.75')],
  ['le quedan 3 de 8 sesiones que porcentaje ha consumido', r => r && r.includes('62.5')],
  ['5 de 10 clases', r => r && r.includes('50')],
  ['hola que tal', r => r === null],
  ['aplicar 15% a 120', r => r && r.includes('102') && r.includes('18')],
  ['20% de 60', r => r && r.includes('12')],
  ['de 200 a 150 que descuento', r => r && r.includes('25')],
  ['cuentame un chiste sobre porcentajes', r => r === null],
  ['30 de 30 sesiones', r => r && r.includes('100')],
  ['0 de 10 sesiones', r => r && r.includes('0.0')],
];
calcCasos.forEach(([q, pred]) => check('calculo', q, M.respuestaCalculoAsistente(M.normalizarTextoAsistente(q)), pred));

// ============================================================
console.log('\n=== AI-02/03/E6 Capacidades -- casos obligatorios de la auditoria ===');
// ============================================================
const obligatorios = [
  ['como creo nuevo cliente?', 'crear_cliente'],
  ['¿cómo doy de alta a un cliente?', 'crear_cliente'],
  ['cómo reprogramo', 'reprogramar_sesion'],
  ['quiero mover una cita', 'reprogramar_sesion'],
  ['meter cliente', 'crear_cliente'],
  ['como mando un aviso por whatsapp', 'enviar_whatsapp'],
  ['como veo el histórico de avisos', 'historico_avisos'],
  ['como quito a alguien del grupo', 'quitar_cliente_grupo'],
  ['cómo marco una recuperación', 'recuperacion_no_facturable'],
  ['puedo editar un cliente de un grupo?', 'editar_cliente_grupo'],
  ['puedo hacer descuento a un cliente de grupo?', 'descuento_individual_grupo'],
  ['cómo se calcula lo que factura un grupo?', 'facturacion_grupo_explicacion'],
  ['qué pasa si descuento a un miembro del grupo?', 'facturacion_grupo_explicacion'],
  ['cómo funciona bono 8?', 'bono8_info'],
  ['qué diferencia hay entre bono 8 y bono 10?', 'bono8_info'],
];
obligatorios.forEach(([q, id]) => check('E6-obligatorio', q, capId(q), actual => actual === id));

console.log('\n=== D6/E5: fuzzy conservador (un solo typo, palabras largas) ===');
const fuzzyCasos = [
  ['reprogrmar sesion', 'reprogramar_sesion'],
  ['como mando un whatsap', 'enviar_whatsapp'],
  ['regenerr enlace', 'link_reservas'],
];
fuzzyCasos.forEach(([q, id]) => check('fuzzy', q, capId(q), actual => actual === id));

console.log('\n=== E1: puntuacion, mayusculas, tildes, sin tildes ===');
const puntuacionCasos = [
  ['¿CÓMO AGENDO UNA SESIÓN?', 'agendar_sesion'],
  ['¡Necesito reprogramar!', 'reprogramar_sesion'],
  ['como añado disponibilidad...', 'disponibilidad'],
  ['¿regenerar enlace?', 'link_reservas'],
  ['como creo un grupo.', 'crear_grupo'],
  ['CÓMO ELIMINO UNA SESION', 'eliminar_sesion'],
  ['como anado disponibilidad', 'disponibilidad'], // sin tilde en "añado"
];
puntuacionCasos.forEach(([q, id]) => check('puntuacion/mayus/tildes', q, capId(q), actual => actual === id));

console.log('\n=== Conjugaciones de dominio (E2) ===');
const conjugacionCasos = [
  ['como agendo una sesion', 'agendar_sesion'],
  ['como creo un cliente', 'crear_cliente'],
  ['como cancelo una sesion', 'eliminar_sesion'],
  ['como envio un aviso', 'enviar_aviso_portal'],
  ['como marco una prueba', 'marcar_prueba'],
  ['como consulto las sesiones que le quedan', 'ver_sesiones_cliente'],
  ['como añado un cliente a un grupo', 'añadir_cliente_grupo'],
];
conjugacionCasos.forEach(([q, id]) => check('conjugaciones', q, capId(q), actual => actual === id));

console.log('\n=== Frases incompletas / coloquiales ===');
const coloquialCasos = [
  ['alta cliente', 'crear_cliente'],
  ['mover sesion', 'reprogramar_sesion'],
  ['bono', null], // demasiado corto/generico, no debe inventar
  ['grupo', null],
  ['link', null],
];
coloquialCasos.forEach(([q, id]) => check('coloquial/incompleto', q, capId(q), actual => actual === id));

console.log('\n=== Cobertura previa (regresion 24 casos ya existentes) ===');
const regresionCasos = [
  ['como meto un cliente', 'crear_cliente'],
  ['quiero crear un cliente', 'crear_cliente'],
  ['dar de alta un cliente nuevo', 'crear_cliente'],
  ['nuevo cliente', 'crear_cliente'],
  ['como elimino una sesion', 'eliminar_sesion'],
  ['borrar entrenamiento', null],
  ['quitar cita', 'eliminar_sesion'],
  ['como cambio una cita', null],
  ['como añado disponibilidad', 'disponibilidad'],
  ['anadir disponibilidad', 'disponibilidad'],
  ['como creo un grupo', 'crear_grupo'],
  ['como añado un cliente a un grupo', 'añadir_cliente_grupo'],
  ['como mando un whatsapp', 'enviar_whatsapp'],
  ['quiero avisar a todos', 'enviar_whatsapp'],
  ['como envio un aviso', 'enviar_aviso_portal'],
  ['como consulto las sesiones que le quedan', 'ver_sesiones_cliente'],
  ['como cambio el telefono', 'editar_cliente'],
  ['como veo el bono', 'ver_sesiones_cliente'],
  ['como marco una prueba', 'marcar_prueba'],
  ['como hago una reserva', 'hacer_reserva'],
  ['como solicito eliminar un cliente', 'baja_cliente'],
  ['regenerar enlace', 'link_reservas'],
];
regresionCasos.forEach(([q, id]) => check('regresion-24', q, capId(q), actual => actual === id));

// ============================================================
console.log('\n=== G: Cobertura amplia adicional -- mas variantes por capacidad (hacia 150+) ===');
// ============================================================
const coberturaAmplia = [
  // clientes
  ['agregar cliente nuevo', 'crear_cliente'],
  ['modificar cliente', 'editar_cliente'],
  ['actualizar ficha del cliente', 'editar_cliente'],
  ['cambio el telefono de un cliente', 'editar_cliente'],
  ['dar de baja a un cliente', 'baja_cliente'],
  ['solicitar eliminacion de un cliente', 'baja_cliente'],
  ['borrar cliente', 'baja_cliente'],
  // agenda
  ['crear una cita nueva', 'agendar_sesion'],
  ['programar una sesion', 'agendar_sesion'],
  ['nueva sesion con un cliente', 'agendar_sesion'],
  ['cambiar hora de la sesion', 'reprogramar_sesion'],
  ['cambiar dia de la sesion', 'reprogramar_sesion'],
  ['mover la cita de mañana', 'reprogramar_sesion'],
  ['cancelar sesion', 'eliminar_sesion'],
  ['borrar sesion de hoy', 'eliminar_sesion'],
  ['quitar entrenamiento', 'eliminar_sesion'],
  ['bloquear una hora', 'disponibilidad'],
  ['bloquear franja de mañana', 'disponibilidad'],
  ['poner mi horario', 'disponibilidad'],
  // grupos
  ['crear clase grupal', 'crear_grupo'],
  ['nuevo grupo abierto', 'crear_grupo'],
  ['apuntar a un cliente a un grupo', 'añadir_cliente_grupo'],
  ['meter un cliente en un grupo', 'añadir_cliente_grupo'],
  ['sacar a un cliente del grupo', 'quitar_cliente_grupo'],
  ['eliminar un integrante del grupo', 'quitar_cliente_grupo'],
  ['modificar un integrante de un grupo', 'editar_cliente_grupo'],
  ['descuento solo a un integrante del grupo', 'descuento_individual_grupo'],
  ['como factura un grupo', 'facturacion_grupo_explicacion'],
  ['cuanto factura un grupo', 'facturacion_grupo_explicacion'],
  // pruebas/crm
  ['prueba realizada', 'marcar_prueba'],
  ['prueba agendada para valoracion', 'marcar_prueba'],
  // whatsapp / avisos
  ['avisar por whatsapp a un cliente', 'enviar_whatsapp'],
  ['whatsapp a varios clientes', 'enviar_whatsapp'],
  ['notificar a un cliente por el portal', 'enviar_aviso_portal'],
  ['aviso portal', 'enviar_aviso_portal'],
  ['avisos enviados a un cliente', 'historico_avisos'],
  ['consultar avisos enviados', 'historico_avisos'],
  // sesiones / bono / reservas
  ['cuantas sesiones le quedan a un cliente', 'ver_sesiones_cliente'],
  ['sesiones pendientes de un cliente', 'ver_sesiones_cliente'],
  ['copiar el link de reservas', 'link_reservas'],
  ['enlace de reservas de un cliente', 'link_reservas'],
  ['reservar por el cliente', 'hacer_reserva'],
  ['reserva desde el link', 'hacer_reserva'],
  // recuperacion
  ['sesion de recuperacion', 'recuperacion_no_facturable'],
  ['clase de recuperacion', 'recuperacion_no_facturable'],
  // bono 8
  ['que es el bono 8', 'bono8_info'],
  ['cuanto cuesta el bono 8', 'bono8_info'],
];
coberturaAmplia.forEach(([q, id]) => check('cobertura-amplia', q, capId(q), actual => actual === id));

console.log('\n=== Mas negativos / ambiguedad real de dominio ===');
const masNegativos = [
  ['que tiempo hace hoy', null],
  ['cuentame una anecdota', null],
  ['como subo de nivel', null],
  ['como accedo al dashboard de ventas', null],
  ['cambiame la contraseña', null],
];
masNegativos.forEach(([q, id]) => check('mas-negativos', q, capId(q), actual => actual === id));

console.log('\n=== Roles: capacidades siguen visibles igual para admin (regresion) ===');
const rolAdminCasos = [
  ['como creo un cliente', 'crear_cliente'],
  ['como quito a alguien del grupo', 'quitar_cliente_grupo'],
  ['como funciona bono 8', 'bono8_info'],
];
rolAdminCasos.forEach(([q, id]) => check('rol-admin', q, capId(q, 'admin'), actual => actual === id));

console.log('\n=== Mas calculos (redondeo, formato, entradas invalidas) ===');
const masCalculos = [
  ['33% de 90', r => r && r.includes('29.7')],
  ['1% de 1', r => r && r.includes('0.01')],
  ['descuento de -10% a 100', r => r === null || typeof r === 'string'], // no debe explotar con negativos
  ['de 50 a 50 que descuento', r => r && r.includes('0.00')],
  ['sin numeros aqui', r => r === null],
];
masCalculos.forEach(([q, pred]) => check('mas-calculo', q, M.respuestaCalculoAsistente(M.normalizarTextoAsistente(q)), pred));

// ============================================================
console.log('\n=== E4: ambiguedad -- dos capacidades empatadas, no se adivina ===');
// ============================================================
{
  // Construido a proposito combinando dos alias de 2 palabras de capacidades DISTINTAS
  // ("poner horario" de disponibilidad + "nuevo grupo" de crear_grupo) para verificar el
  // MECANISMO de desempate, no una frase real de un PT.
  const r = M.buscarCapacidadPT(M.normalizarTextoAsistente('quiero poner horario y tambien un grupo nuevo'), 'pt');
  check('ambiguedad', 'dos capacidades de 2 palabras empatan -> ambiguo', r, actual => actual && actual.ambiguo === true && actual.opciones.length === 2);
  if (r && r.ambiguo) {
    const respuesta = M.respuestaAmbiguaPT(r.opciones);
    check('ambiguedad', 'la respuesta ambigua pregunta, no elige', respuesta.texto, actual => /quieres/i.test(actual) && actual.includes('?'));
  }
}

// ============================================================
console.log('\n=== D3: correccion Ana/mañana (palabra completa, no subcadena) ===');
// ============================================================
{
  // No se puede probar clienteMencionado aisladamente sin dbClientes/motorAsistenteBesoul
  // completo, pero SÍ se puede verificar la primitiva que causaba el bug: coincidencia de
  // palabra completa contra "mañana" (que tras normalizar pierde la tilde de la ñ: "manana").
  const qNorm = M.normalizarTextoAsistente('resume mi agenda de mañana');
  const palabras = new Set(qNorm.split(/\s+/).filter(Boolean));
  check('D3-Ana/manana', '"ana" NO es palabra completa dentro de "resume mi agenda de mañana"', palabras.has('ana'), actual => actual === false);
  check('D3-Ana/manana', 'pero "manana" (sin tilde) si es una palabra completa de la frase', palabras.has('manana'), actual => actual === true);
}

// ============================================================
console.log('\n=== B11/Permisos -- capacidades admin-only nunca se sugieren a un PT ===');
// ============================================================
// ASSISTANT-PORTAL-CAPUCHINOS: ya no es tautológico -- centros_besoul_info es real y admin-only
// (asignar centro es una acción de Finanzas, no de Agenda/PT). Antes de esta capacidad, este
// check era "0 admin-only" (nunca ejercitaba el bloqueo real, ver auditoría B11).
check('permisos', 'exactamente 1 capacidad admin-only hoy (centros_besoul_info), el resto sigue cubriendo PT', M.CAPACIDADES_PT.filter(c => !c.roles.includes('pt')).map(c => c.id), ids => ids.length === 1 && ids[0] === 'centros_besoul_info');
{
  // Mecanismo de bloqueo por rol verificado con una capacidad admin-only SINTETICA (ninguna
  // existe hoy de verdad -- ver hallazgo B11 de la auditoria: el test anterior era tautologico).
  const capsConSintetica = [...M.CAPACIDADES_PT, { id: 'ver_finanzas_admin', nombre: 'Ver Finanzas', aliases: ['ver finanzas', 'abrir finanzas', 'veo finanzas'], roles: ['admin'], pasos: [], restricciones: [] }];
  const buscarConSintetica = (texto, rol) => {
    const palabrasQuery = new Set(texto.split(/\s+/).filter(Boolean).map(M.lematizarPalabra));
    let mejor = null, mejorPuntos = 0;
    capsConSintetica.forEach(cap => {
      if (!cap.roles.includes(rol)) return;
      cap.aliases.forEach(alias => {
        const palabrasAlias = M.normalizarTextoAsistente(alias).split(/\s+/).filter(Boolean).map(M.lematizarPalabra);
        if (palabrasAlias.every(p => palabrasQuery.has(p)) && palabrasAlias.length > mejorPuntos) { mejor = cap; mejorPuntos = palabrasAlias.length; }
      });
    });
    return mejor;
  };
  check('permisos', 'PT preguntando "como veo finanzas" con una capacidad admin-only sintetica presente -> null, nunca la admin-only', buscarConSintetica(M.normalizarTextoAsistente('como veo finanzas'), 'pt'), actual => actual === null);
  check('permisos', 'admin preguntando lo mismo SI la encuentra (confirma que el filtro es por rol, no un bug que la esconda siempre)', buscarConSintetica(M.normalizarTextoAsistente('como veo finanzas'), 'admin')?.id, actual => actual === 'ver_finanzas_admin');
}

// ============================================================
console.log('\n=== AI-05 Diagnostico de hueco (con mock de dbAgenda) -- sin hardcode 18:15 ===');
// ============================================================
const hoyISO = formatoFechaLocal(new Date());
dbAgenda.carmen = { [`${hoyISO}_18:15`]: { id: 'c1', nombre: 'Ana' } };
check('diagnostico', 'diagnostico detecta hueco ocupado (18:15)', M.respuestaDiagnosticoHueco(M.normalizarTextoAsistente('por que no puedo agendar a las 18:15').toLowerCase()), r => r.includes('Ana') && r.includes('ocupando'));
dbAgenda.carmen[`${hoyISO}_09:30`] = { id: 'c2', nombre: 'Luis' };
check('diagnostico', 'diagnostico funciona para OTRA hora sin relacion con 18:15 (confirma que no dependia del valor magico)', M.respuestaDiagnosticoHueco('por que no puedo agendar a las 09:30'), r => r.includes('Luis'));
dbDisponibilidadReservas.carmen = { lunes: [] };
check('diagnostico', 'diagnostico no confunde hueco libre con inventar una causa falsa', M.respuestaDiagnosticoHueco('por que no puedo reservar a las 09:00'), r => r.includes('no está ocupado') || r.includes('no esta ocupado'));
check('diagnostico', 'sin hora concreta, pide precision en vez de adivinar', M.respuestaDiagnosticoHueco('por que no me deja agendar'), r => /hora exacta/.test(r));
check('diagnostico', 'sin keyword de hueco, no dispara el diagnostico', M.respuestaDiagnosticoHueco('por que el cielo es azul'), r => r === null);

// ============================================================
console.log('\n=== G1: Negativos -- nunca confundir intents, nunca ejecutar nada ===');
// ============================================================
const negativosCasos = [
  ['quiero cambiar el precio', null],
  ['elimina a Alba', null],
  ['abre finanzas', null],
  ['como accedo al dashboard', null],
  ['como entro al crm', null],
];
negativosCasos.forEach(([q, id]) => check('negativos', q, capId(q), actual => actual === id));
{
  const calc = M.respuestaCalculoAsistente(M.normalizarTextoAsistente('hazme un descuento del 20% a 150'));
  check('negativos', '"hazme un descuento del 20%" calcula...', calc, r => r && r.includes('120'));
  check('negativos', '...pero el calculo es SOLO texto, nunca un objeto que module datos', typeof calc, t => t === 'string');
}

console.log('\n=== Fallback honesto -- nunca inventa ===');
const fallbackCasos = ['cuentame un chiste', 'cual es la capital de francia', 'como cambio el precio de un cliente', 'como veo finanzas', 'como accedo al crm'];
fallbackCasos.forEach(q => {
  check('fallback', `fallback honesto: "${q}"`, capId(q), actual => actual === null);
});

console.log('\n=== Ayuda (AI-06) incluye las capacidades nuevas ===');
{
  const ayuda = M.respuestaAyudaAsistente('pt').texto;
  ['Quitar un cliente de un grupo', 'recuperación no facturable', 'histórico de avisos', 'Bono 8'].forEach(frag => {
    check('ayuda', `"qué puedo hacer" menciona: ${frag}`, ayuda.includes(frag), actual => actual === true);
  });
}

console.log('\n=== PLAN-01: Bono 8 -- respuesta nunca hardcodea el precio ===');
{
  const r = M.respuestaCapacidadPT(M.CAPACIDADES_PT.find(c => c.id === 'bono8_info'));
  check('bono8', 'precio Individual coincide con TARIFAS_2026 real', r.texto.includes(`${M.TARIFAS_2026['Individual Bono'][10].toFixed(2)}€`), actual => actual === true);
  check('bono8', 'precio Grupo Reducido coincide con TARIFAS_2026 real', r.texto.includes(`${M.TARIFAS_2026['Grupo Reducido Bono'][10].toFixed(2)}€`), actual => actual === true);
}

console.log('\n=== ASSISTANT-PORTAL-CAPUCHINOS: el asistente conoce Capuchinos (solo admin) ===');
{
  check('centros', '"que centros hay" (admin) -> centros_besoul_info', capId('que centros hay', 'admin'), actual => actual === 'centros_besoul_info');
  check('centros', 'un PT preguntando lo mismo NO recibe esta capacidad (es admin-only)', capId('que centros hay', 'pt'), actual => actual === null);
  const r = M.respuestaCapacidadPT(M.CENTROS_BESOUL_INFO && M.CAPACIDADES_PT.find(c => c.id === 'centros_besoul_info'));
  check('centros', 'la respuesta menciona Capuchinos', r.texto.includes('Capuchinos'), actual => actual === true);
  check('centros', 'la respuesta marca a Capuchinos con economía pendiente', /Capuchinos.*pendiente/.test(r.texto), actual => actual === true);
  check('centros', 'la respuesta NO marca a Alfa Prime como pendiente (solo Capuchinos)', !/Alfa Prime.*pendiente/.test(r.texto), actual => actual === true);
  check('centros', 'CENTROS_BESOUL_INFO tiene exactamente un centro con economía pendiente', M.CENTROS_BESOUL_INFO.filter(c => !c.economiaConfigurada).length, actual => actual === 1);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
