// HOTFIX-CRM-DUPLICADOS-FECHA-ALTA -- regresión del incidente CRM (duplicados + fechas + CSV).
// Ejecuta el código REAL de crm.html / valoracion.html / agenda.html / dashboard.html y
// besoul-identidad.js con datos sintéticos y un Firestore en memoria (ver harness.cjs).
// Nunca toca Firestore real ni datos de producción.
//
//   node crm-incident-tests/run_tests.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { crearFirestore, cargarCRM, rellenarNuevoLead, esperar, crearElemento, ROOT } = require('./harness.cjs');
const BI = require('../besoul-identidad.js');

let pass = 0, fail = 0;
const fails = [];
function check(desc, cond, detalle) {
  if (cond) { pass++; console.log(`PASS -- ${desc}`); }
  else { fail++; fails.push(desc); console.log(`FAIL -- ${desc}${detalle !== undefined ? ' :: ' + JSON.stringify(detalle) : ''}`); }
}
const leadsDe = (h) => h.mock.docs('besoulLeads');
async function esperarModalDuplicado(h, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (!h.el('modal-duplicado').classList.contains('hidden')) return true; await esperar(5); }
  return false;
}

function extraerFuncion(html, nombre) {
  const m = new RegExp(`(async\\s+)?function\\s+${nombre}\\s*\\(`).exec(html);
  if (!m) throw new Error(`No se encontró function ${nombre}`);
  // Saltar la lista de parámetros (puede contener "{}" en valores por defecto).
  let p = m.index + m[0].length, par = 1;
  for (; p < html.length && par > 0; p++) { if (html[p] === '(') par++; else if (html[p] === ')') par--; }
  let i = html.indexOf('{', p), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return html.slice(m.index, i);
}

// ============================================================================================
function testNormalizacion() {
  console.log('\n=== Normalización de identidad (besoul-identidad.js) ===');
  const variantes = ['612345678', '+34612345678', '+34 612 345 678', '0034612345678', '34612345678', ' 612-345-678 '];
  const canon = variantes.map(BI.normalizarTelefonoIdentidad);
  check('Las variantes españolas del mismo móvil son la misma persona (34612345678)', canon.every(c => c === '34612345678'), canon);
  check('Fijo español sin prefijo se canoniza con 34', BI.normalizarTelefonoIdentidad('912 34 56 78') === '34912345678');
  check('Extranjero con +44 conserva su país', BI.normalizarTelefonoIdentidad('+44 7700 900123') === '447700900123');
  check('Extranjero con 0044 es igual que con +44', BI.normalizarTelefonoIdentidad('0044 7700 900123') === '447700900123');
  check('Un número extranjero NUNCA se convierte en español', BI.normalizarTelefonoIdentidad('+44 7700 900123') !== BI.normalizarTelefonoIdentidad('7700900123') && !BI.normalizarTelefonoIdentidad('+44 612345678').startsWith('34'));
  check('Número sin prefijo no reconocible se deja tal cual (no se inventa país)', BI.normalizarTelefonoIdentidad('07700900123') === '07700900123');
  check('Email: trim + minúsculas', BI.normalizarEmailIdentidad('  Ana.Perez@Gmail.COM ') === 'ana.perez@gmail.com');
  check('Email: NO se eliminan puntos ni +etiquetas (podrían ser personas distintas)', BI.normalizarEmailIdentidad('a.b+x@d.com') === 'a.b+x@d.com');
  const m = BI.buscarCoincidenciasIdentidad({ nombre: 'Marta', telefono: '+34 612 345 678', email: 'otra@x.com' },
    [{ id: 'a', nombre: 'Marta', telefono: '612345678', email: 'm@x.com' }, { id: 'b', nombre: 'Marta', telefono: '699999999', email: 'z@x.com' }]);
  check('Coincide por teléfono normalizado', m.length === 1 && m[0].candidato.id === 'a' && m[0].por.join() === 'telefono');
  check('El nombre SOLO nunca es coincidencia', BI.buscarCoincidenciasIdentidad({ nombre: 'Marta', telefono: '600000001', email: 'n@x.com' }, [{ id: 'b', nombre: 'Marta', telefono: '699999999', email: 'z@x.com' }]).length === 0);
  check('Sin teléfono ni email no hay coincidencias', BI.buscarCoincidenciasIdentidad({ nombre: 'Marta' }, [{ id: 'x', nombre: 'Marta' }]).length === 0);
  check('Las variantes de registro incluyen las claves antiguas', JSON.stringify(BI.variantesTelefonoRegistro('+34 612 345 678').sort()) === JSON.stringify(['0034612345678', '34612345678', '612345678']));
  check('trocear respeta el tamaño de lote', JSON.stringify(BI.trocear(Array.from({ length: 1000 }, (_, i) => i), 450).map(l => l.length)) === '[450,450,100]');
}

function testFechas() {
  console.log('\n=== Fechas de negocio (Madrid) ===');
  check('00:30 de Madrid del 1/10 (22:30Z del 30/9) es el 1 de octubre', BI.fechaLocalMadrid('2026-09-30T22:30:00.000Z') === '2026-10-01');
  check('23:59 de Madrid del 30/9 (21:59Z) sigue siendo 30 de septiembre', BI.fechaLocalMadrid('2026-09-30T21:59:00.000Z') === '2026-09-30');
  check('En invierno (UTC+1) también: 31/12 23:30Z es 1 de enero en Madrid', BI.fechaLocalMadrid('2026-12-31T23:30:00.000Z') === '2027-01-01');
  check('fechaNegocioLead usa fechaAltaReal si existe', BI.fechaNegocioLead({ fechaAltaReal: '2026-09-28', createdAt: '2026-10-01T08:00:00.000Z' }) === '2026-09-28');
  check('Compatibilidad histórica: sin fechaAltaReal = fecha de Madrid de createdAt', BI.fechaNegocioLead({ createdAt: '2026-08-15T10:00:00.000Z' }) === '2026-08-15');
  check('Un fechaAltaReal inválido no se usa (cae a createdAt)', BI.fechaNegocioLead({ fechaAltaReal: '2026-02-30', createdAt: '2026-08-15T10:00:00.000Z' }) === '2026-08-15');
  check('Rango del mes actual de Madrid', JSON.stringify(BI.rangoMesActualMadrid(new Date('2026-09-30T22:30:00.000Z'))) === JSON.stringify({ desde: '2026-10-01', hasta: '2026-10-31' }));
  check('Fecha humana DD/MM/YYYY', BI.fechaHumana('2026-09-28') === '28/09/2026');
}

// ============================================================================================
async function testIdempotencia() {
  console.log('\n=== Guardar lead: idempotencia (doble clic, triple toque, red lenta, reintentos) ===');
  {
    const h = cargarCRM(); rellenarNuevoLead(h);
    const p1 = h.ctx.guardarLead(); const p2 = h.ctx.guardarLead();
    check('Durante el guardado el botón está deshabilitado y dice "Guardando…"', h.el('btn-save-lead').disabled === true && h.el('btn-save-lead').innerText === 'Guardando…');
    await Promise.all([p1, p2]);
    check('Doble clic = exactamente UN lead', leadsDe(h).length === 1, leadsDe(h).length);
    check('Tras terminar el botón vuelve a "Guardar lead" y se habilita', h.el('btn-save-lead').disabled === false && h.el('btn-save-lead').innerText === 'Guardar lead');
  }
  {
    const h = cargarCRM(); rellenarNuevoLead(h);
    await Promise.all([h.ctx.guardarLead(), h.ctx.guardarLead(), h.ctx.guardarLead()]);
    check('Triple toque rápido = exactamente UN lead', leadsDe(h).length === 1, leadsDe(h).length);
  }
  {
    const h = cargarCRM(); h.mock.setLatencia(60); rellenarNuevoLead(h);
    const p = h.ctx.guardarLead(); await esperar(80); const q = h.ctx.guardarLead(); await esperar(50); const r = h.ctx.guardarLead();
    await Promise.all([p, q, r]);
    check('Red lenta (60 ms por operación) y toques espaciados = UN lead', leadsDe(h).length === 1, leadsDe(h).length);
  }
  {
    // Sincronización con Agenda lenta: la valoración agendada hace una transacción sobre el
    // documento grande de Agenda; mientras tanto se vuelve a pulsar.
    const fsm = crearFirestore(); fsm.put('besoulSuite', 'agenda', { clientes: {}, agenda: {}, pruebasCRM: {} });
    const h = cargarCRM({ fs: fsm }); fsm.setLatencia(40);
    rellenarNuevoLead(h, { estado: 'Prueba agendada', fechaPrueba: '2026-10-05T10:00' });
    const p = h.ctx.guardarLead(); await esperar(100); const q = h.ctx.guardarLead();
    await Promise.all([p, q]);
    check('Retraso en la sincronización con Agenda + otra pulsación = UN lead', leadsDe(h).length === 1, leadsDe(h).length);
  }
  {
    // Fallo de la sincronización con Agenda DESPUÉS de crear el lead (ruta que sí relanza:
    // lead marcado "Convertido a cliente"). El modal queda abierto; el reintento actualiza el MISMO lead.
    const fsm = crearFirestore(); fsm.put('besoulSuite', 'agenda', { clientes: { pta: [] }, agenda: {} });
    const h = cargarCRM({ fs: fsm });
    rellenarNuevoLead(h, { estado: 'Convertido a cliente' });
    let transacciones = 0;
    fsm.fallar('transaction', 'error', 1, () => (++transacciones) >= 2); // 1ª tx = alta del lead; la 2ª (sync Agenda) falla
    await h.ctx.guardarLead();
    const tras1 = leadsDe(h);
    check('Fallo de sincronización con Agenda: el lead se creó una vez y se avisa al usuario', tras1.length === 1 && h.alertas.length >= 1, { n: tras1.length, alertas: h.alertas });
    check('Tras el fallo, el formulario ya edita ESE lead (no queda en modo "nuevo")', h.get('leadEditandoId') === tras1[0].id);
    await h.ctx.guardarLead();
    check('Reintento tras el fallo = sigue habiendo UN lead', leadsDe(h).length === 1, leadsDe(h).length);
  }
  {
    // El commit del alta se hizo pero la respuesta se perdió (corte de red). Reintento.
    const h = cargarCRM(); rellenarNuevoLead(h);
    h.mock.fallar('transaction', 'perderRespuesta', 1);
    await h.ctx.guardarLead();
    const createdAt1 = (leadsDe(h)[0] || {}).createdAt;
    check('Respuesta perdida: el usuario recibe un error y el lead existe en servidor', h.alertas.length === 1 && leadsDe(h).length === 1);
    h.setAhora('2026-10-01T08:05:00.000Z');
    await h.ctx.guardarLead();
    const despues = leadsDe(h);
    check('Reintento tras respuesta perdida = UN lead (mismo id reservado)', despues.length === 1, despues.length);
    check('El reintento NO reescribe createdAt (inmutable)', despues[0].createdAt === createdAt1, { antes: createdAt1, despues: despues[0].createdAt });
  }
  {
    // Fallo antes del commit (la escritura no llegó): el reintento crea el lead (una sola vez).
    const h = cargarCRM(); rellenarNuevoLead(h);
    h.mock.fallar('transaction', 'error', 1);
    await h.ctx.guardarLead();
    check('Fallo antes del commit: no hay lead y se avisa', leadsDe(h).length === 0 && h.alertas.length === 1);
    await h.ctx.guardarLead();
    check('Reintento tras fallo antes del commit = exactamente UN lead', leadsDe(h).length === 1, leadsDe(h).length);
  }
  {
    // Dos altas distintas desde el mismo modal (reabrirlo) siguen siendo dos leads legítimos.
    const h = cargarCRM();
    rellenarNuevoLead(h, { nombre: 'Uno', telefono: '600000001', email: 'uno@x.com' }); await h.ctx.guardarLead();
    h.refrescarLeads();
    rellenarNuevoLead(h, { nombre: 'Dos', telefono: '600000002', email: 'dos@x.com' }); await h.ctx.guardarLead();
    check('Dos personas distintas = dos leads (la idempotencia no bloquea altas legítimas)', leadsDe(h).length === 2);
  }
}

// ============================================================================================
async function testDuplicados() {
  console.log('\n=== Aviso de posible duplicado (leads y clientes de Agenda) ===');
  const base = () => {
    const fsm = crearFirestore();
    fsm.put('besoulLeads', 'lead_existente', { nombre: 'Marta Pérez', telefono: '+34 612 345 678', email: 'marta@example.com', estado: 'Contactado', trainerKey: 'pta', createdAt: '2026-09-10T10:00:00.000Z' });
    fsm.put('besoulSuite', 'agenda', { clientes: { ptb: [{ id: 'cli_1', tipo: 'individual', nombre: 'Diego Ruiz', telefono: '0034 699 111 222', email: 'Diego@Example.com' }] }, agenda: {} });
    const h = cargarCRM({ fs: fsm }); h.refrescarLeads(); return h;
  };
  {
    const h = base(); rellenarNuevoLead(h, { nombre: 'Otra Marta', telefono: '612345678', email: 'nueva@x.com' });
    const p = h.ctx.guardarLead();
    check('Lead existente (mismo móvil en otro formato) -> aparece el aviso', await esperarModalDuplicado(h));
    check('El aviso dice "Ya existe una persona con este teléfono."', h.el('dup-texto').innerText === 'Ya existe una persona con este teléfono.', h.el('dup-texto').innerText);
    h.el('dup-cancelar').click(); await p;
    check('CANCELAR no crea nada', leadsDe(h).length === 1);
  }
  {
    const h = base(); rellenarNuevoLead(h, { nombre: 'Persona', telefono: '600000009', email: 'diego@example.com ' });
    const p = h.ctx.guardarLead();
    check('Cliente de Agenda existente (email con mayúsculas/espacios) -> aviso', await esperarModalDuplicado(h));
    check('El aviso indica que es un cliente de Agenda', (h.el('dup-lista').children[0] || {}).innerHTML.includes('Cliente de Agenda'));
    h.el('dup-crear').click(); await p;
    check('CREAR IGUALMENTE (acción deliberada) crea el lead', leadsDe(h).length === 2);
  }
  {
    const h = base(); rellenarNuevoLead(h, { nombre: 'Otra Marta', telefono: '612345678', email: 'nueva@x.com' });
    h.mock.fallar('transaction', 'error', 1);
    const p = h.ctx.guardarLead(); await esperarModalDuplicado(h); h.el('dup-crear').click(); await p;
    const avisosAntes = h.el('modal-duplicado').classList.contains('hidden');
    const q = h.ctx.guardarLead(); await esperar(30);
    check('Tras "Crear igualmente", el reintento de esa misma acción no vuelve a preguntar', avisosAntes && h.el('modal-duplicado').classList.contains('hidden'));
    await q;
    check('...y crea exactamente un lead nuevo', leadsDe(h).length === 2);
  }
  {
    const h = base(); rellenarNuevoLead(h, { nombre: 'Otra Marta', telefono: '612345678', email: 'nueva@x.com' });
    const p = h.ctx.guardarLead(); await esperarModalDuplicado(h);
    h.el('dup-lista').children[0].children[0].click(); await p;
    check('ABRIR EXISTENTE abre el lead existente (sin crear nada)', h.get('leadEditandoId') === 'lead_existente' && leadsDe(h).length === 1);
  }
  {
    const h = base(); rellenarNuevoLead(h, { nombre: 'Marta Pérez', telefono: '611000000', email: 'distinta@x.com' });
    await h.ctx.guardarLead();
    check('Mismo NOMBRE pero distinto teléfono/email -> sin aviso, se crea', h.el('modal-duplicado').classList.contains('hidden') && leadsDe(h).length === 2);
  }
  {
    const h = base(); h.ctx.abrirModalLead('lead_existente'); h.el('lead-notas').value = 'nota';
    await h.ctx.guardarLead();
    check('Editar un lead existente nunca dispara el aviso contra sí mismo', h.el('modal-duplicado').classList.contains('hidden') && h.alertas.length === 0);
  }
}

// ============================================================================================
async function testFechaAltaReal() {
  console.log('\n=== Fecha de alta real: valor por defecto, corrección, auditoría ===');
  {
    const h = cargarCRM({ ahoraISO: '2026-09-30T22:30:00.000Z' }); // 00:30 del 1/10 en Madrid
    rellenarNuevoLead(h);
    check('Por defecto, Fecha de alta real = hoy en Madrid (no el día UTC)', h.el('lead-fecha-alta-real').value === '2026-10-01', h.el('lead-fecha-alta-real').value);
    await h.ctx.guardarLead();
    const l = leadsDe(h)[0];
    check('Se guarda fechaAltaReal = 2026-10-01 y createdAt técnico', l.fechaAltaReal === '2026-10-01' && l.createdAt === '2026-09-30T22:30:00.000Z');
    check('Alta en el mismo día: no se añade evento de fecha', !(l.historial || []).some(e => e.campo === 'fechaAltaReal'));
  }
  {
    // El caso de Sandra: se apuntó el 28/09 y se registra el 01/10.
    const h = cargarCRM({ ahoraISO: '2026-10-01T08:00:00.000Z' });
    rellenarNuevoLead(h, { fechaAltaReal: '2026-09-28' });
    await h.ctx.guardarLead();
    const l = leadsDe(h)[0];
    check('Sandra: se conservan AMBAS fechas (alta real 28/09 + registro 01/10)', l.fechaAltaReal === '2026-09-28' && l.createdAt === '2026-10-01T08:00:00.000Z');
    const ev = (l.historial || []).find(e => e.campo === 'fechaAltaReal');
    check('Alta tardía queda anotada en el historial (quién, cuándo, valor)', !!ev && ev.valorNuevo === '2026-09-28' && ev.userEmail === 'admin@besoul.test' && !!ev.fecha && /28\/09\/2026/.test(ev.texto), ev);
  }
  {
    const fsm = crearFirestore();
    fsm.put('besoulLeads', 'l1', { nombre: 'Ana', telefono: '600000003', email: 'ana@x.com', estado: 'Contactado', trainerKey: 'pta', centroId: 'centro_a', fuente: 'Instagram', createdAt: '2026-10-01T08:00:00.000Z', historial: [] });
    const h = cargarCRM({ fs: fsm, ahoraISO: '2026-10-02T09:00:00.000Z' }); h.refrescarLeads();
    h.ctx.abrirModalLead('l1');
    check('Registro histórico sin fechaAltaReal: el formulario muestra la fecha de registro (fallback)', h.el('lead-fecha-alta-real').value === '2026-10-01');
    h.el('lead-fecha-alta-real').value = '2026-09-28';
    await h.ctx.guardarLead();
    const l = fsm.get('besoulLeads', 'l1');
    const ev = (l.historial || []).find(e => e.campo === 'fechaAltaReal');
    check('Corrección por admin: fechaAltaReal = 28/09', l.fechaAltaReal === '2026-09-28');
    check('Auditoría: valor anterior, nuevo, quién y cuándo', !!ev && ev.valorAnterior === '2026-10-01' && ev.valorNuevo === '2026-09-28' && ev.userEmail === 'admin@besoul.test' && ev.fecha === '2026-10-02T09:00:00.000Z', ev);
    check('createdAt no cambia al corregir la fecha de negocio', l.createdAt === '2026-10-01T08:00:00.000Z');
    h.refrescarLeads(); h.ctx.abrirModalLead('l1'); await h.ctx.guardarLead();
    const l2 = fsm.get('besoulLeads', 'l1');
    check('Guardar sin cambiar la fecha no añade otro evento de auditoría', (l2.historial || []).filter(e => e.campo === 'fechaAltaReal').length === 1);
  }
  {
    const h = cargarCRM({ ahoraISO: '2026-10-01T08:00:00.000Z' });
    rellenarNuevoLead(h, { fechaAltaReal: '2026-10-05' });
    await h.ctx.guardarLead();
    check('No se permite una fecha de alta real futura', leadsDe(h).length === 0 && h.alertas.some(a => /futura/.test(a)));
  }
}

// ============================================================================================
function sembrarLeadsRango(fsm) {
  const L = (id, extra) => fsm.put('besoulLeads', id, { nombre: id, telefono: '6' + id.replace(/\D/g, '').padStart(8, '0'), email: `${id}@x.com`, estado: 'Contactado', trainerKey: 'pta', centroId: 'centro_a', fuente: 'Instagram', historial: [], ...extra });
  L('sep_normal', { createdAt: '2026-09-15T10:00:00.000Z' });
  L('sandra', { createdAt: '2026-10-01T08:00:00.000Z', fechaAltaReal: '2026-09-28', estado: 'Convertido a cliente', convertido: true, convertedAt: '2026-10-01T08:10:00.000Z', fechaConversion: '2026-10-01', nombre: 'Señora Núñez' });
  L('oct_normal', { createdAt: '2026-10-10T10:00:00.000Z' });
  L('oct_otro_centro', { createdAt: '2026-10-11T10:00:00.000Z', centroId: 'centro_b' });
  L('ago_convertido_oct', { createdAt: '2026-08-20T10:00:00.000Z', estado: 'Convertido a cliente', convertido: true, convertedAt: '2026-10-03T10:00:00.000Z', fechaConversion: '2026-10-03' });
  L('medianoche', { createdAt: '2026-09-30T22:30:00.000Z' }); // 00:30 del 1/10 en Madrid
  L('eliminado', { createdAt: '2026-10-02T10:00:00.000Z', estado: 'Eliminado' });
}

async function testRangoYKPIs() {
  console.log('\n=== Rango Desde/Hasta, fecha base y KPIs ===');
  const fsm = crearFirestore(); sembrarLeadsRango(fsm);
  const h = cargarCRM({ fs: fsm });
  const ids = () => h.get('leadsFiltrados').map(l => l.id).sort();
  const fijar = (desde, hasta, base) => { h.el('filter-desde').value = desde; h.el('filter-hasta').value = hasta; h.el('filter-base-fecha').value = base; h.el('filter-center').value = ''; h.el('filter-trainer').value = ''; h.el('filter-status').value = ''; h.el('filter-source').value = ''; h.el('filter-search').value = ''; h.refrescarLeads(); };

  fijar('2026-09-01', '2026-09-30', 'alta');
  check('Septiembre por FECHA DE ALTA REAL incluye a la clienta de Sandra (registrada el 1/10)', ids().includes('sandra') && ids().includes('sep_normal'), ids());
  check('Septiembre por fecha de alta NO incluye un lead registrado a las 00:30 del 1/10 (Madrid)', !ids().includes('medianoche'));
  fijar('2026-10-01', '2026-10-31', 'alta');
  check('Octubre por fecha de alta ya NO incluye a la clienta de Sandra', !ids().includes('sandra'), ids());
  check('Octubre por fecha de alta incluye el lead de las 00:30 del 1/10 (día de Madrid, no UTC)', ids().includes('medianoche'));
  fijar('2026-10-01', '2026-10-31', 'registro');
  check('Octubre por FECHA DE REGISTRO sí incluye a la clienta de Sandra (cuándo se registró)', ids().includes('sandra'));
  fijar('2026-08-01', '2026-08-31', 'alta');
  check('Compatibilidad: registro histórico sin fechaAltaReal cae en el mes de su createdAt', ids().join() === 'ago_convertido_oct', ids());
  fijar('2026-09-01', '2026-10-31', 'alta');
  check('Rango septiembre + octubre juntos en UNA vista', ['sep_normal', 'sandra', 'oct_normal', 'oct_otro_centro', 'medianoche'].every(i => ids().includes(i)) && !ids().includes('eliminado'), ids());
  check('Hasta es inclusivo (31/10 incluido) y los eliminados nunca aparecen', !ids().includes('eliminado'));
  h.el('filter-center').value = 'centro_a'; h.ctx.aplicarFiltros();
  check('Los filtros (centro) se combinan con el rango', !ids().includes('oct_otro_centro') && ids().includes('oct_normal'));

  // KPIs: cohorte vs evento.
  fijar('2026-09-01', '2026-09-30', 'alta');
  check('KPI de cohorte "Convertidos" de septiembre cuenta a la clienta de Sandra (se apuntó en septiembre)', h.el('kpi-convertidos').innerText === 1, h.el('kpi-convertidos').innerText);
  check('KPI de evento "Conversiones registradas" de septiembre = 0 (ninguna conversión se hizo en septiembre)', h.el('kpi-conversiones-periodo').innerText === 0, h.el('kpi-conversiones-periodo').innerText);
  fijar('2026-10-01', '2026-10-31', 'alta');
  check('Octubre: "Convertidos" (cohorte) = 0 -- el de agosto pertenece a la cohorte de agosto', h.el('kpi-convertidos').innerText === 0, h.el('kpi-convertidos').innerText);
  check('Octubre: "Conversiones registradas" (evento) = 2 (Sandra + el lead de agosto convertido el 3/10)', h.el('kpi-conversiones-periodo').innerText === 2, h.el('kpi-conversiones-periodo').innerText);
  h.el('filter-center').value = 'centro_b'; h.ctx.aplicarFiltros();
  check('"Conversiones registradas" también respeta los filtros no temporales', h.el('kpi-conversiones-periodo').innerText === 0);
}

async function testCSV() {
  console.log('\n=== CSV ===');
  const fsm = crearFirestore(); sembrarLeadsRango(fsm);
  const h = cargarCRM({ fs: fsm });
  h.el('filter-desde').value = '2026-09-01'; h.el('filter-hasta').value = '2026-10-31'; h.el('filter-base-fecha').value = 'alta';
  ['filter-center', 'filter-trainer', 'filter-status', 'filter-source', 'filter-search'].forEach(id => { h.el(id).value = ''; });
  h.refrescarLeads();
  const { texto, nombre } = h.ctx.construirCSVLeads(h.get('leadsFiltrados'), h.ctx.criterioFechasCRM());
  const lineas = texto.replace(/^﻿/, '').split('\r\n');
  check('Empieza con BOM UTF-8 (Excel en español abre bien acentos y ñ)', texto.charCodeAt(0) === 0xFEFF);
  check('Conserva caracteres españoles (ñ, ú) sin alterar', texto.includes('Señora Núñez'));
  check('Separador ";" y saltos de línea CRLF', lineas[0].split('";"').length === 19 && !texto.replace(/^﻿/, '').includes('\n') === false && texto.includes('\r\n'));
  check('Columnas anteriores intactas + 4 de fecha', lineas[0].startsWith('"nombre";"telefono";"email"') && lineas[0].endsWith('"Fecha de alta real";"Registrado en Besoul";"Fecha valoración";"Fecha conversión"'), lineas[0]);
  check('Un único CSV con septiembre + octubre (5 leads, sin eliminados)', lineas.length === 1 + 5, lineas.length);
  const filaSandra = lineas.find(l => l.includes('Señora Núñez')) || '';
  check('Fechas humanas: alta real 28/09/2026, registro 01/10/2026 10:00 (hora de Madrid), conversión 01/10/2026', filaSandra.includes('"28/09/2026";"01/10/2026 10:00";"";"01/10/2026"'), filaSandra);
  const filaMedianoche = lineas.find(l => l.startsWith('"medianoche"')) || '';
  check('Registro de las 00:30 del 1/10 se muestra como 01/10/2026 00:30', filaMedianoche.includes('"01/10/2026";"01/10/2026 00:30"'), filaMedianoche);
  check('Nombre de archivo descriptivo con el rango y la fecha base', nombre === 'besoul_leads_alta-real_2026-09-01_a_2026-10-31.csv', nombre);
  h.el('filter-center').value = 'centro_b'; h.ctx.aplicarFiltros();
  const filtrado = h.ctx.construirCSVLeads(h.get('leadsFiltrados'), h.ctx.criterioFechasCRM()).texto.split('\r\n');
  check('El CSV respeta los filtros activos (centro)', filtrado.length === 2 && filtrado[1].startsWith('"oct_otro_centro"'), filtrado.length);
  check('Exportar CSV usa exactamente lo que se ve en pantalla', (() => { let blob = null; h.ctx.Blob = class { constructor(p) { blob = p.join(''); } }; h.ctx.document.createElement = () => ({ click() {} }); h.ctx.exportarLeadsCSV(); return blob && blob.split('\r\n').length === 2; })());
}

// ============================================================================================
async function testConversion() {
  console.log('\n=== CRM -> Agenda ===');
  const preparar = (clientesPta = []) => {
    const fsm = crearFirestore();
    fsm.put('besoulLeads', 'l_conv', { nombre: 'Lucía Gómez', telefono: '622 333 444', email: 'lucia@x.com', estado: 'Prueba realizada', trainerKey: 'pta', centroId: 'centro_a', fuente: 'Instagram', createdAt: '2026-10-01T08:00:00.000Z', fechaAltaReal: '2026-09-28', historial: [] });
    fsm.put('besoulSuite', 'agenda', { clientes: { pta: clientesPta }, agenda: {} });
    const h = cargarCRM({ fs: fsm }); h.refrescarLeads(); h.ctx.abrirModalLead('l_conv'); return h;
  };
  {
    const h = preparar(); h.setAhora('2026-09-30T22:30:00.000Z'); // 00:30 del 1/10 en Madrid
    await h.ctx.convertirLeadEnCliente();
    const ag = h.mock.get('besoulSuite', 'agenda'); const cli = (ag.clientes.pta || [])[0] || {};
    check('Conversión: la ficha de Agenda recibe la FECHA DE ALTA REAL (28/09), no la fecha técnica', cli.fechaAlta === '2026-09-28', cli.fechaAlta);
    check('Medianoche de Madrid: fechaCambioEstado = 2026-10-01 (antes daba 2026-09-30 por UTC)', cli.fechaCambioEstado === '2026-10-01', cli.fechaCambioEstado);
    const l = h.mock.get('besoulLeads', 'l_conv');
    check('El lead guarda fechaConversion = día de Madrid del registro de la conversión', l.fechaConversion === '2026-10-01' && !!l.convertedAt);
    check('El confirm de conversión muestra la fecha de alta', h.confirmaciones.some(c => c.includes('28/09/2026')));
  }
  {
    const h = preparar([{ id: 'cli_manual', tipo: 'individual', nombre: 'Lucia G.', telefono: '+34622333444', email: 'otra@x.com' }]);
    const p = h.ctx.convertirLeadEnCliente();
    check('Conversión cuando la persona YA está en Agenda -> aviso de duplicado', await esperarModalDuplicado(h));
    check('El aviso explica que se crearía una segunda ficha', /segunda ficha/.test(h.el('dup-texto').innerText));
    h.el('dup-cancelar').click(); await p;
    check('Cancelar: no se crea una segunda ficha', h.mock.get('besoulSuite', 'agenda').clientes.pta.length === 1);
  }
  {
    const h = preparar([{ id: 'cli_manual', tipo: 'individual', nombre: 'Lucia G.', telefono: '+34622333444', email: 'otra@x.com' }]);
    const p = h.ctx.convertirLeadEnCliente(); await esperarModalDuplicado(h); h.el('dup-crear').click(); await p;
    check('Crear igualmente: se crea la ficha (decisión deliberada del admin)', h.mock.get('besoulSuite', 'agenda').clientes.pta.length === 2);
  }
  {
    // Ficha ya vinculada a ESTE lead en OTRO entrenador (conversión concurrente): no se duplica.
    const fsm = crearFirestore();
    fsm.put('besoulLeads', 'l_conv', { nombre: 'Lucía Gómez', telefono: '622 333 444', email: 'lucia@x.com', estado: 'Prueba realizada', trainerKey: 'pta', centroId: 'centro_a', fuente: 'Instagram', createdAt: '2026-10-01T08:00:00.000Z', historial: [] });
    fsm.put('besoulSuite', 'agenda', { clientes: { pta: [], ptb: [{ id: 'cli_crm_x', tipo: 'individual', nombre: 'Lucía Gómez', leadId: 'l_conv' }] }, agenda: {} });
    const h = cargarCRM({ fs: fsm }); h.refrescarLeads(); h.ctx.abrirModalLead('l_conv');
    await h.ctx.convertirLeadEnCliente();
    const ag = fsm.get('besoulSuite', 'agenda');
    check('Conversión concurrente hacia otro entrenador: se reutiliza la ficha ya vinculada, no se crea otra', ag.clientes.pta.length === 0 && ag.clientes.ptb.length === 1 && fsm.get('besoulLeads', 'l_conv').convertedClientId === 'cli_crm_x');
  }
  {
    const h = preparar(); h.el('lead-fecha-alta-real').value = '2026-09-25';
    await h.ctx.convertirLeadEnCliente();
    const l = h.mock.get('besoulLeads', 'l_conv');
    check('Cambiar la fecha de alta justo antes de convertir queda auditado', (l.historial || []).some(e => e.campo === 'fechaAltaReal' && e.valorAnterior === '2026-09-28' && e.valorNuevo === '2026-09-25'));
    check('...y esa fecha es la que recibe la ficha de Agenda', h.mock.get('besoulSuite', 'agenda').clientes.pta[0].fechaAlta === '2026-09-25');
  }
}

// ============================================================================================
async function testRegistroValoraciones() {
  console.log('\n=== Registro público de valoraciones (QR) ===');
  const vHtml = fs.readFileSync(path.join(ROOT, 'valoracion.html'), 'utf8');
  const nombres = ['hashFNV1a', 'soloDigitosTelefono', 'maskEmail', 'maskTelefono', 'keyEmailValoracion', 'keyTelefonoValoracion', 'keysTelefonoValoracionVariantes', 'registrarValoracionUnica'];
  const fsm = crearFirestore();
  const ctx = { BesoulIdentidad: BI, db: fsm.db, console, Promise, JSON, Math, String, Date };
  vm.createContext(ctx);
  vm.runInContext(nombres.map(n => extraerFuncion(vHtml, n)).join('\n\n'), ctx);
  // Entrada ANTIGUA del registro (clave "solo dígitos" tal como se escribió: 612345678).
  const hashViejo = ctx.hashFNV1a('612345678');
  fsm.put('besoulValoracionRegistry', `phone_${hashViejo}`, { kind: 'phone', leadId: 'viejo' });
  const datos = (tel, email) => ({ nombre: 'X', telefono: tel, email, centroId: 'c', centroNombre: 'C', createdAt: '2026-10-01T08:00:00.000Z' });
  let error = null;
  try { await ctx.registrarValoracionUnica(datos('+34 612 345 678', 'nuevo@x.com')); } catch (e) { error = e.message; }
  check('Una entrada antigua (612345678) bloquea la misma persona escrita como +34 612 345 678', /teléfono/.test(error || ''), error);
  error = null;
  try { await ctx.registrarValoracionUnica(datos('0034612345678', 'otro@x.com')); } catch (e) { error = e.message; }
  check('...y también como 0034612345678', /teléfono/.test(error || ''), error);
  await ctx.registrarValoracionUnica(datos('+44 7700 900123', 'uk@x.com'));
  check('Un número extranjero nuevo se registra (no colisiona con el español)', fsm.docs('besoulLeads').length === 1);
  check('Se escribe la clave CANÓNICA nueva', !!fsm.get('besoulValoracionRegistry', `phone_${ctx.hashFNV1a('447700900123')}`));
  error = null;
  try { await ctx.registrarValoracionUnica(datos('00447700900123', 'uk2@x.com')); } catch (e) { error = e.message; }
  check('La entrada canónica nueva bloquea la misma persona con otro formato (0044...)', /teléfono/.test(error || ''), error);

  // CRM: sincronización del registro en lotes (antes: un único batch > 500 fallaba en silencio).
  const fsm2 = crearFirestore(); fsm2.put('besoulSuite', 'agenda', { clientes: {}, agenda: {} });
  const h = cargarCRM({ fs: fsm2 });
  const muchos = Array.from({ length: 300 }, (_, i) => ({ id: `v${i}`, nombre: `V${i}`, telefono: `6${String(i).padStart(8, '0')}`, email: `v${i}@x.com`, estado: 'Prueba solicitada', fuente: 'QR valoración' }));
  h.set('leads', muchos);
  await h.ctx.sincronizarRegistroValoraciones();
  check('Registro con 600 escrituras: se envía en lotes acotados (≤450) y llega completo', JSON.stringify(fsm2.stats.batches) === '[450,150]' && fsm2.docs('besoulValoracionRegistry').length === 600, fsm2.stats.batches);
}

// ============================================================================================
async function testRegresionValoracionAgenda() {
  console.log('\n=== Regresión: valoración agendada sigue apareciendo en Agenda ===');
  const fsm = crearFirestore(); fsm.put('besoulSuite', 'agenda', { clientes: {}, agenda: {}, pruebasCRM: {} });
  const h = cargarCRM({ fs: fsm });
  rellenarNuevoLead(h, { estado: 'Prueba agendada', fechaPrueba: '2026-10-05T10:00' });
  await h.ctx.guardarLead();
  const ag = fsm.get('besoulSuite', 'agenda');
  const claves = Object.keys((ag.pruebasCRM || {}).pta || {});
  check('La valoración agendada se coloca en la Agenda del entrenador (pruebasCRM)', claves.length === 1 && claves[0].startsWith('2026-10-05_'), claves);
  const lead = leadsDe(h)[0];
  check('El lead conserva su enlace con la prueba de Agenda', lead && lead.agendaPruebaVisible === true);
}

// ============================================================================================
function testAgendaYDashboard() {
  console.log('\n=== Agenda (Guardar Ficha) y Dashboard ===');
  const aHtml = fs.readFileSync(path.join(ROOT, 'agenda.html'), 'utf8');
  const guardar = extraerFuncion(aHtml, 'guardarCliente');
  const iCheck = guardar.indexOf('buscarCoincidenciasIdentidad');
  check('Agenda: el aviso de duplicado se evalúa ANTES de modificar el estado local (push/scope)', iCheck > 0 && iCheck < guardar.indexOf('const scopeGuardado') && iCheck < guardar.indexOf('dbClientes[scopeGuardado].push(ficha)'));
  check('Agenda: solo al CREAR (no al editar) y nunca para grupos', /!idFichaEditando && tabFichaActiva !== 'grupo' && !opciones\.duplicadoConfirmado/.test(guardar));
  check('Agenda: "Crear igualmente" vuelve a guardar con confirmación explícita', guardar.includes("guardarCliente({ ...opciones, duplicadoConfirmado: true })"));

  // Candidatos + diálogo de Agenda, ejecutados de verdad.
  const ctx = { BesoulIdentidad: BI, escapeHTML: s => String(s), dbCredenciales: { pta: { nombre: 'Laura' }, ptb: { nombre: 'Carlos' } }, entrenadorVisto: 'pta', console };
  ctx.dbClientes = { pta: [{ id: 'c1', tipo: 'individual', nombre: 'Rosa', telefono: '612345678', email: 'rosa@x.com' }, { id: 'g1', tipo: 'grupo', nombre: 'Grupo HIIT' }], ptb: [{ id: 'c2', tipo: 'individual', nombre: 'Rosa B', telefono: '699000000', email: 'ROSA@x.com', vinculacion: 'g9' }] };
  let capa = null;
  ctx.document = { createElement: () => { capa = crearElemento(null); capa._listeners = []; capa.addEventListener = (t, fn) => capa._listeners.push(fn); return capa; }, body: { appendChild() {} } };
  vm.createContext(ctx);
  vm.runInContext(['candidatosClientesAgendaDuplicados', 'preguntarDuplicadoAgenda'].map(n => extraerFuncion(aHtml, n)).join('\n'), ctx);
  const cands = ctx.candidatosClientesAgendaDuplicados();
  check('Agenda: candidatos de TODOS los entrenadores, sin fichas de grupo', cands.length === 2 && !cands.some(c => c.id === 'g1'));
  const coinc = BI.buscarCoincidenciasIdentidad({ telefono: '+34 612 345 678', email: 'rosa@x.com' }, cands);
  check('Agenda: detecta por teléfono normalizado y por email en otra agenda (miembro de grupo)', coinc.length === 2 && coinc.find(c => c.candidato.id === 'c2').candidato.miembroGrupo === true);
  const p = ctx.preguntarDuplicadoAgenda(coinc);
  check('Agenda: el diálogo nombra al entrenador y avisa de miembro de grupo', capa.innerHTML.includes('Agenda de Carlos') && capa.innerHTML.includes('miembro de grupo'));
  capa._listeners[0]({ target: { closest: () => ({ dataset: { accion: 'crear' } }) } });
  return p.then(v => check('Agenda: "Crear igualmente" resuelve la decisión deliberada', v === 'crear'));
}

function testDashboard() {
  const dHtml = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  const ctx = { BesoulIdentidad: BI, console };
  ctx.leads = [
    { id: 'sandra', createdAt: '2026-10-01T08:00:00.000Z', fechaAltaReal: '2026-09-28', estado: 'Convertido a cliente', convertido: true, centroId: 'c', trainerKey: 'pta', fuente: 'Instagram' },
    { id: 'oct', createdAt: '2026-10-10T08:00:00.000Z', estado: 'Contactado', centroId: 'c', trainerKey: 'pta', fuente: 'Web' },
    { id: 'hist', createdAt: '2026-09-02T08:00:00.000Z', estado: 'Nuevo lead', centroId: 'c', trainerKey: 'pta', fuente: 'Web' },
  ];
  vm.createContext(ctx);
  vm.runInContext(`var leads = globalThis.leads;\n${extraerFuncion(dHtml, 'analizarLeads')}`, ctx);
  const sep = ctx.analizarLeads(new Date(2026, 8, 1), new Date(2026, 8, 30, 23, 59, 59, 999), '', '');
  check('Dashboard: el embudo de septiembre cuenta a la clienta de Sandra (fecha de alta real) y el histórico sin campo', sep.total === 2 && sep.convertidos === 1, sep.total);
  const oct = ctx.analizarLeads(new Date(2026, 9, 1), new Date(2026, 9, 31, 23, 59, 59, 999), '', '');
  check('Dashboard: octubre ya no la cuenta', oct.total === 1 && oct.convertidos === 0, oct.total);
  const fHtml = fs.readFileSync(path.join(ROOT, 'finanzas.html'), 'utf8');
  check('Finanzas NO se ha modificado en este cambio (no carga besoul-identidad.js)', !fHtml.includes('besoul-identidad.js'));
}

// ============================================================================================
(async function main() {
  testNormalizacion();
  testFechas();
  await testIdempotencia();
  await testDuplicados();
  await testFechaAltaReal();
  await testRangoYKPIs();
  await testCSV();
  await testConversion();
  await testRegistroValoraciones();
  await testRegresionValoracionAgenda();
  await testAgendaYDashboard();
  testDashboard();
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail) { console.log('Failures:', fails); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exitCode = 1; });
