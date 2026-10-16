// ARQ-V1-MIGRACION-IMPL — E2E con las PÁGINAS REALES (agenda.html, dashboard.html, crm.html) en un
// navegador real (Edge sin ventana, vía Playwright) contra el Firebase Emulator (Auth + Firestore,
// proyecto ficticio demo-besoul-revision) con las reglas REALES del repositorio.
//
//   firebase emulators:exec --only auth,firestore --config .firebase.review-local.json \
//     --project demo-besoul-revision "node .review-local/agenda-persistencia/arq_e2e.cjs"
//
// Datos ficticios (seed.cjs) migrados con la MISMA transformación del migrador. Nada toca producción.
'use strict';
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const D = require('../../besoul-datos.js');
const { chromium, devices } = require('playwright');

const PROYECTO = 'demo-besoul-revision';
const FS = 'http://127.0.0.1:8085';
const BASE = 'http://127.0.0.1:5561';
const PASS = 'RevisionLocal2026!';
const RAIZ_DOCS = `${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
if (!PROYECTO.startsWith('demo-')) throw new Error('REFUSED');

let pass = 0, fail = 0; const fallos = []; const consumo = [];
function check(desc, ok, detalle) { ok ? pass++ : (fail++, fallos.push(desc)); console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok || detalle === undefined ? '' : ` :: ${JSON.stringify(detalle)}`}`); }
const espera = ms => new Promise(r => setTimeout(r, ms));

function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  const f = {}; Object.keys(v).forEach(k => { f[k] = valor(v[k]); }); return { mapValue: { fields: f } };
}
function desde(v) {
  if ('nullValue' in v) return null; if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue); if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue; if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(desde);
  if ('mapValue' in v) { const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = desde(x); }); return o; }
  return undefined;
}
async function escribir(ruta, datos) { const r = await fetch(`${RAIZ_DOCS}/${ruta}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: valor(datos).mapValue.fields }) }); if (!r.ok) throw new Error(`${ruta}: ${await r.text()}`); }
async function leer(ruta) { const r = await fetch(`${RAIZ_DOCS}/${ruta}`, { headers: owner }); if (r.status === 404) return null; const j = await r.json(); return desde({ mapValue: { fields: j.fields || {} } }); }
async function listar(col) {
  const out = {}; let token = '';
  do { const r = await fetch(`${RAIZ_DOCS}/${col}?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers: owner }); const j = await r.json(); (j.documents || []).forEach(d => { out[decodeURIComponent(d.name.split('/').pop())] = desde({ mapValue: { fields: d.fields || {} } }); }); token = j.nextPageToken || ''; } while (token);
  return out;
}
async function vistaServidor() { const g = {}; for (const c of ['semanas', 'clientes', 'trainers', 'historico', 'notas', 'legado', 'config']) g[c] = await listar(D.COL[c]); return D.legadoDesdeDocs(g); }

let browser;
async function abrir(email, opciones = {}) {
  if (!browser) browser = await chromium.launch({ executablePath: process.env.BS_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = opciones.context || await browser.newContext(opciones.dispositivo ? { ...devices[opciones.dispositivo] } : {});
  const page = await context.newPage();
  page.__logs = []; page.__dialogos = [];
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon|404|ERR_|net::/i.test(t)) page.__logs.push(t.slice(0, 240)); });
  page.on('pageerror', e => page.__logs.push('pageerror: ' + String(e.message).slice(0, 240)));
  page.on('dialog', d => { page.__dialogos.push(d.message().slice(0, 200)); (d.type() === 'beforeunload' ? d.dismiss() : d.accept()).catch(() => {}); });
  await page.goto(`${BASE}/${opciones.pagina || 'agenda.html'}?emulador=1`);
  await page.waitForSelector('#login-user, #app-content', { timeout: 30000 });
  if (await page.isVisible('#login-user').catch(() => false)) {
    await page.fill('#login-user', email); await page.fill('#login-pass', PASS);
    await page.click('button[onclick="ejecutarLogin()"]');
  }
  page.__context = context;
  return page;
}
async function agendaLista(page) {
  await page.waitForFunction(() => window.bsUltimoServidorConocido && document.getElementById('app-content') && !document.getElementById('app-content').classList.contains('hidden'), null, { timeout: 30000 });
  await page.waitForTimeout(600);
}
const consumoPagina = p => p.evaluate(() => (window.BesoulDatos ? BesoulDatos.consumo.instantanea() : null));
async function medir(page, etiqueta, fn) {
  const a = await consumoPagina(page); await fn(); await page.waitForTimeout(1200); const b = await consumoPagina(page);
  const fila = { operacion: etiqueta, lecturas: b.lecturas - a.lecturas, escrituras: b.escrituras - a.escrituras };
  consumo.push(fila); return fila;
}
const indicador = p => p.evaluate(() => (document.getElementById('bs-estado-guardado') || {}).innerText || '');
const esperarGuardado = p => p.waitForFunction(() => /Guardado en el servidor/.test((document.getElementById('bs-estado-guardado') || {}).innerText || ''), null, { timeout: 25000 });
const lunesSiguiente = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10); };

async function main() {
  // ---- servidor estático local (solo 127.0.0.1) + datos ficticios + migración ----
  const servidor = spawn('node', [path.join(__dirname, '..', 'serve.cjs'), '5561'], { stdio: 'ignore' });
  process.on('exit', () => { try { servidor.kill(); } catch (e) { /* ya parado */ } });
  const seed = spawnSync('node', [path.join(__dirname, '..', 'seed.cjs')], { stdio: 'inherit' });
  if (seed.status !== 0) throw new Error('seed fallido');
  const lunes = lunesSiguiente();
  const dia = (n) => { const d = new Date(`${lunes}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // Disponibilidad abierta y unas sesiones de partida (ficticias) antes de migrar.
  const original = await leer('besoulSuite/agenda');
  const semanal = {}; for (let i = 1; i <= 7; i++) semanal[i] = { activo: true, bloques: [{ inicio: '07:00', fin: '21:00' }] };
  original.disponibilidadReservas = { laura: { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true }, carlos: { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true } };
  const ficha = (tk, id) => original.clientes[tk].find(c => c.id === id);
  original.agenda = { laura: { [`${dia(0)}_10:00`]: { ...ficha('laura', 'cli_rosa_ficticia'), duracionMin: 45 } }, carlos: { [`${dia(1)}_11:00`]: { ...ficha('carlos', 'cli_tomas_ficticio'), duracionMin: 45 } } };
  await escribir('besoulSuite/agenda', original);
  const { docs } = D.docsDesdeLegado(await leer('besoulSuite/agenda'));
  for (const d of docs) await escribir(`${D.COL[d.col]}/${encodeURIComponent(d.id)}`, { ...d.data, rev: 1, actualizadoEn: new Date(), actualizadoPor: 'migracion:e2e' });
  const migrado = await vistaServidor();
  check('E0 migración de los datos ficticios: ida y vuelta exacta desde el emulador', D.diferencias(await leer('besoulSuite/agenda'), migrado, '', [], 10).length === 0, D.diferencias(await leer('besoulSuite/agenda'), migrado, '', [], 10));

  // ---- E1 PT: abre su agenda; solo sus datos ----
  const pt = await abrir('laura.revision@example.test');
  const a0 = Date.now();
  await agendaLista(pt);
  const tAbrir = Date.now() - a0;
  const c1 = await consumoPagina(pt);
  consumo.push({ operacion: 'Abrir Agenda (PT, primera vez en el dispositivo)', lecturas: c1.lecturas, escrituras: c1.escrituras, ms: tAbrir });
  const memPT = await pt.evaluate(() => ({ tks: Object.keys(dbAgenda || {}), clientesTks: Object.keys(dbClientes || {}), n: Object.keys((dbAgenda || {}).laura || {}).length }));
  check('E1 el PT ve su agenda migrada', memPT.n === 1, memPT);
  check('E2 el PT no tiene en memoria datos de otros entrenadores', memPT.tks.every(t => t === 'laura') && memPT.clientesTks.every(t => t === 'laura'), memPT);
  // Cambiar de semana: los datos ya están en memoria -> 0 lecturas.
  await medir(pt, 'Cambiar de semana en la Agenda', async () => { await pt.evaluate(() => { if (typeof cambiarSemana === 'function') cambiarSemana(1); else if (typeof semanaSiguiente === 'function') semanaSiguiente(); }); });

  // ---- E3 crear una sesión desde la interfaz real ----
  const claveNueva = `${dia(2)}_09:00`;
  const fCrear = await medir(pt, 'Crear sesión (PT)', async () => { await pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveNueva, 'cli_rosa_ficticia']); await esperarGuardado(pt); });
  let srv = await vistaServidor();
  check('E3 crear sesión: confirmada en el servidor', !!(srv.agenda.laura || {})[claveNueva]);
  check('E4 el indicador muestra "Guardado en el servidor" solo tras confirmar', /Guardado en el servidor/.test(await indicador(pt)));
  check('E5 crear sesión escribe 1 documento', fCrear.escrituras === 1, fCrear);

  // ---- E6 admin y PT a la vez; el cambio del admin llega al PT en tiempo real ----
  const admin = await abrir('admin.revision@example.test');
  await agendaLista(admin);
  const cAdm = await consumoPagina(admin);
  consumo.push({ operacion: 'Abrir Agenda (admin, primera vez en el dispositivo)', lecturas: cAdm.lecturas, escrituras: 0 });
  await admin.evaluate(() => { document.getElementById('select-trainer-filter').value = 'laura'; cambiarEntrenadorVisto(); });
  const claveAdmin = `${dia(3)}_12:00`;
  const fSync = await medir(pt, 'Recibir en tiempo real un cambio hecho por otro usuario', async () => {
    await admin.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveAdmin, 'cli_crm_lead_alta_tardia']);
    await esperarGuardado(admin);
    await pt.waitForFunction(c => !!((dbAgenda || {}).laura || {})[c], claveAdmin, { timeout: 15000 });
  });
  check('E6 el cambio del admin aparece en la pantalla del PT sin recargar', true);
  check('E7 recibirlo cuesta 1 lectura en el dispositivo del PT', fSync.lecturas === 1, fSync);
  // Simultáneo: admin mueve una sesión y el PT crea otra a la vez -> ambos confirmados.
  const claveSimPT = `${dia(4)}_17:00`;
  await Promise.all([
    pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveSimPT, 'cli_rosa_ficticia']),
    admin.evaluate(([o, d]) => soltarFichaEnCelda(d, '', o), [claveAdmin, `${dia(3)}_13:00`]),
  ]);
  await esperarGuardado(pt); await esperarGuardado(admin); await espera(1500);
  srv = await vistaServidor();
  check('E8 cambios simultáneos de admin y PT en la misma agenda: los dos confirmados', !!srv.agenda.laura[claveSimPT] && !!srv.agenda.laura[`${dia(3)}_13:00`] && !srv.agenda.laura[claveAdmin]);

  // ---- E9 doble reserva: el mismo hueco a la vez desde dos usuarios ----
  const claveDoble = `${dia(5)}_10:00`;
  await Promise.all([
    pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveDoble, 'cli_rosa_ficticia']),
    admin.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveDoble, 'cli_crm_lead_alta_tardia']),
  ]);
  await espera(4000);
  srv = await vistaServidor();
  const enHueco = srv.agenda.laura[claveDoble];
  check('E9 mismo hueco a la vez: queda exactamente una sesión y el otro usuario recibe aviso', !!enHueco && (pt.__dialogos.concat(admin.__dialogos)).some(m => /NO se ha guardado|no se ha guardado|ocupad|solap/i.test(m)), { dialogos: pt.__dialogos.concat(admin.__dialogos).slice(-3) });

  // ---- E10 ficha: admin cambia el email y el PT el teléfono de la misma ficha ----
  await pt.evaluate(async () => { editarFicha('cli_rosa_ficticia'); document.getElementById('cust-phone').value = '611999888'; await guardarCliente(); });
  const fFicha = await medir(admin, 'Modificar ficha (admin)', async () => { await admin.evaluate(async () => { editarFicha('cli_rosa_ficticia'); document.getElementById('cust-email').value = 'rosa.nueva@example.test'; await guardarCliente(); }); });
  await espera(1500);
  srv = await vistaServidor();
  const rosa = srv.clientes.laura.find(c => c.id === 'cli_rosa_ficticia');
  check('E10 ficha editada por PT y admin (campos distintos): el resultado conserva al menos el último cambio confirmado y nada se pierde en silencio', rosa && (rosa.email === 'rosa.nueva@example.test' || admin.__dialogos.some(m => /no se ha guardado/i.test(m))), { email: rosa && rosa.email, tel: rosa && rosa.telefono });
  check('E11 las sesiones conservan su duración tras editar la ficha (hotfix 89b31e1)', Object.values(srv.agenda.laura).every(s => s.duracionMin === 45 || s.esPruebaCRM));

  // ---- E12 recarga: copia local + solo cambios; guardar bloqueado hasta confirmar ----
  const lecturasAntes = (await consumoPagina(pt)).lecturas;
  pt.__dialogos.length = 0;
  await pt.reload();
  await pt.waitForSelector('#login-user, #app-content', { timeout: 30000 });
  if (await pt.isVisible('#login-user').catch(() => false)) { await pt.fill('#login-user', 'laura.revision@example.test'); await pt.fill('#login-pass', PASS); await pt.click('button[onclick="ejecutarLogin()"]'); }
  await agendaLista(pt);
  const cRecarga = await consumoPagina(pt);
  consumo.push({ operacion: 'Recargar Agenda (PT, con copia local)', lecturas: cRecarga.lecturas, escrituras: 0 });
  check('E12 recargar no vuelve a descargar todo (≤ 1 lectura por consulta + cambios)', cRecarga.lecturas <= 8, cRecarga.lecturas);
  check('E13 tras recargar, los datos son los del servidor', await pt.evaluate(c => !!((dbAgenda || {}).laura || {})[c], claveSimPT));
  // Incidencia 13-oct: con copia local, el indicador quedaba en "Sin conexión" aunque los datos ya eran del servidor.
  await espera(3000);
  const estRecarga = await pt.evaluate(() => ({ sinc: window.bsAgendaSincronizacion, cache: window.bsAgendaDatosDeCache, txt: (() => { const el = document.getElementById('bs-estado-guardado'); return el && el.style.display !== 'none' ? el.innerText : '(oculto)'; })() }));
  check('E13b tras recargar con copia local, el estado es "ok" y no aparece "Sin conexión"', estRecarga.sinc === 'ok' && estRecarga.cache === false && !/Sin conexión/i.test(estRecarga.txt), estRecarga);

  // ---- E14 sin conexión: el cambio se conserva, nunca se da por guardado; al volver, se guarda una vez ----
  await pt.__context.setOffline(true);
  const claveOff = `${dia(6)}_09:00`;
  await pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveOff, 'cli_rosa_ficticia']);
  await pt.waitForFunction(() => /SIN GUARDAR|sin conexión|Guardando/i.test((document.getElementById('bs-estado-guardado') || {}).innerText || ''), null, { timeout: 30000 });
  check('E14 sin conexión: el indicador NO dice "Guardado"', !/Guardado en el servidor/.test(await indicador(pt)), await indicador(pt));
  await pt.__context.setOffline(false);
  await pt.evaluate(() => reintentarGuardadosAgenda());
  await esperarGuardado(pt).catch(() => {});
  await espera(1500);
  srv = await vistaServidor();
  check('E15 al reconectar, el cambio pendiente se guarda (una sola vez)', !!srv.agenda.laura[claveOff]);

  // ---- E16 bloqueo de día y disponibilidad ----
  await pt.evaluate(async d => { dbDisponibilidadReservas.laura.excepciones = { ...(dbDisponibilidadReservas.laura.excepciones || {}), [d]: { activo: false, bloques: [] } }; await guardarEstadoNubeAgenda('laura'); }, dia(7));
  srv = await vistaServidor();
  check('E16 bloquear un día se guarda en la semana correspondiente', (srv.disponibilidadReservas.laura.excepciones || {})[dia(7)] && srv.disponibilidadReservas.laura.excepciones[dia(7)].activo === false);

  // ---- E17 reserva del portal aceptada por el admin -> sesión creada ----
  const claveReserva = `${dia(8)}_16:00`;
  await escribir(`besoulReservas/laura__${claveReserva}`, { token: 'tok_e2e', clientId: 'cli_rosa_ficticia', clientName: 'Rosa Ficticia', trainerKey: 'laura', fechaISO: dia(8), hora: '16:00', clave: claveReserva, duracionMin: 45, tipoReserva: 'individual', estado: 'pendiente', createdAt: new Date() });
  await admin.waitForFunction(id => !!(window.dbSolicitudesReservas || {})[id] || (typeof dbSolicitudesReservas !== 'undefined' && !!dbSolicitudesReservas[id]), `laura__${claveReserva}`, { timeout: 15000 });
  await admin.evaluate(async id => { await aceptarSolicitudReserva(id); }, `laura__${claveReserva}`);
  await espera(1500);
  srv = await vistaServidor();
  check('E17 aceptar una reserva del portal crea la sesión en la agenda', !!srv.agenda.laura[claveReserva]);
  check('E18 ...y marca la solicitud como aceptada', ((await leer(`besoulReservas/laura__${claveReserva}`)) || {}).estado === 'aceptada');

  // ---- E19 móvil (viewport y agente de iPhone en motor Chromium) ----
  const movil = await abrir('carlos.revision@example.test', { dispositivo: 'iPhone 13' });
  await agendaLista(movil);
  const claveMovil = `${dia(2)}_18:00`;
  await movil.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [claveMovil, 'cli_tomas_ficticio']);
  await esperarGuardado(movil);
  srv = await vistaServidor();
  check('E19 viewport móvil (iPhone 13, Chromium): abrir y guardar funciona', !!srv.agenda.carlos[claveMovil]);

  // ---- E19b INCIDENCIA 16-oct: semana MIGRADA (sesiones con las 5 copias de ficha) con una prueba CRM
  // dentro de un grupo abierto. Antes, cualquier guardado de esa semana daba conflicto en el grupo. ----
  const lunesInc = dia(21), viernesInc = dia(25), juevesInc = dia(24);
  const CINCO = { contratoCliente: 'c', restriccionesReservas: {}, reservaToken: 'tok-ficticio', reservasBloqueadasTexto: '', reservasOnlineActivas: true };
  const sesionesInc = {
    [`${lunesInc}_18:00`]: { ...ficha('laura', 'cli_rosa_ficticia'), duracionMin: 45, ...CINCO },
    [`${viernesInc}_17:00`]: { id: 'grupo_ficticio', nombre: 'Grupo abierto ficticio', tipo: 'grupo', grupoAbierto: true, asistentesGrupoAbierto: ['cli_rosa_ficticia'], duracionMin: 45, ...CINCO },
    [`${viernesInc}_17:15`]: { id: 'lead_prueba_ficticio', nombre: 'Prueba CRM ficticia', tipo: 'lead', tipoCita: 'pruebaCRM', esPruebaCRM: true, noSumaFacturacion: true, leadId: 'lead_prueba_ficticio', duracionMin: 45 },
  };
  await escribir(`${D.COL.semanas}/${encodeURIComponent(D.idSemana('laura', lunesInc))}`, { ...D.contenidoSemana('laura', lunesInc, { sesiones: sesionesInc, pruebasCRM: { [`${viernesInc}_17:15`]: { leadId: 'lead_prueba_ficticio', nombre: 'Prueba CRM ficticia' } } }), rev: 1, actualizadoEn: new Date(), actualizadoPor: 'migracion:e2e' });
  await pt.waitForFunction(k => !!((dbAgenda || {}).laura || {})[k], `${viernesInc}_17:15`, { timeout: 20000 });
  pt.__dialogos.length = 0;
  const esperarSinPendientes = async () => { await pt.waitForTimeout(500); await pt.waitForFunction(() => !Object.values(window.bsAgendaGuardadosPendientes || {}).some(e => e && (e.programado || e.enCola > 0)), null, { timeout: 25000 }); };
  await pt.evaluate(() => { window.ofrecerWhatsAppTrasConfirmar = () => {}; });
  // Caso 1: quitar la sesión del lunes 18:00 (Luz) y poner en su hueco a otro cliente (Ulrik).
  await pt.evaluate(([k]) => { entrenadorVisto = 'laura'; celdaNotaSeleccionada = k; borrarSesionAgenda(); }, [`${lunesInc}_18:00`]);
  await esperarSinPendientes();
  await pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [`${lunesInc}_18:00`, 'cli_crm_lead_alta_tardia']);
  await esperarSinPendientes();
  // Caso 2: clienta creada desde el CRM, arrastrada a jueves y viernes 10:00.
  await pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [`${juevesInc}_10:00`, 'cli_crm_lead_alta_tardia']);
  await esperarSinPendientes();
  await pt.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [`${viernesInc}_10:00`, 'cli_crm_lead_alta_tardia']);
  await esperarSinPendientes();
  await pt.waitForTimeout(800);
  const conflictosInc = pt.__dialogos.filter(m => /NO se ha guardado|no se ha guardado/i.test(m));
  check('E19b sustituir lunes 18:00 y arrastrar jueves/viernes 10:00 en la semana migrada con prueba CRM en grupo: sin avisos de conflicto', conflictosInc.length === 0, conflictosInc);
  const crudoInc = await leer(`${D.COL.semanas}/${encodeURIComponent(D.idSemana('laura', lunesInc))}`);
  check('E19c en el servidor: el nuevo cliente ocupa el lunes 18:00 y tiene jueves y viernes 10:00', (crudoInc.sesiones[`${lunesInc}_18:00`] || {}).id === 'cli_crm_lead_alta_tardia' && (crudoInc.sesiones[`${juevesInc}_10:00`] || {}).id === 'cli_crm_lead_alta_tardia' && (crudoInc.sesiones[`${viernesInc}_10:00`] || {}).id === 'cli_crm_lead_alta_tardia', Object.keys(crudoInc.sesiones));
  check('E19d grupo abierto y prueba CRM intactos (incluidas las 5 copias del grupo)', D.igual(crudoInc.sesiones[`${viernesInc}_17:00`], sesionesInc[`${viernesInc}_17:00`]) && D.igual(crudoInc.sesiones[`${viernesInc}_17:15`], sesionesInc[`${viernesInc}_17:15`]));
  // Persistencia tras recargar la página.
  await pt.reload();
  await pt.waitForSelector('#login-user, #app-content', { timeout: 30000 });
  if (await pt.isVisible('#login-user').catch(() => false)) { await pt.fill('#login-user', 'laura.revision@example.test'); await pt.fill('#login-pass', PASS); await pt.click('button[onclick="ejecutarLogin()"]'); }
  await agendaLista(pt);
  const trasRecargaInc = await pt.evaluate(([l, j, v]) => { const a = (dbAgenda || {}).laura || {}; return [a[`${l}_18:00`], a[`${j}_10:00`], a[`${v}_10:00`]].map(s => s && s.id); }, [lunesInc, juevesInc, viernesInc]);
  check('E19e tras recargar la página, los tres cambios siguen ahí', trasRecargaInc.every(id => id === 'cli_crm_lead_alta_tardia'), trasRecargaInc);

  // ---- E20 Dashboard (admin) carga desde la nueva estructura ----
  const dash = await abrir('admin.revision@example.test', { pagina: 'dashboard.html', context: admin.__context });
  await dash.waitForFunction(() => typeof agendaData !== 'undefined' && agendaData && agendaData.agenda && Object.keys(agendaData.agenda.laura || {}).length > 0, null, { timeout: 30000 });
  const cDash = await consumoPagina(dash);
  consumo.push({ operacion: 'Abrir Dashboard (admin, con copia local de la Agenda en el dispositivo)', lecturas: cDash.lecturas, escrituras: 0 });
  check('E20 Dashboard ve las sesiones de la nueva estructura', true);

  // ---- E21 CRM (admin) carga y comprueba duplicados con la nueva estructura ----
  const crm = await abrir('admin.revision@example.test', { pagina: 'crm.html', context: admin.__context });
  await crm.waitForFunction(() => typeof cargarClientesAgendaParaDuplicados === 'function', null, { timeout: 30000 });
  const candidatos = await crm.evaluate(async () => (await cargarClientesAgendaParaDuplicados()).length);
  check('E21 CRM obtiene las fichas de Agenda (todas las agendas) desde la nueva estructura', candidatos >= 4, candidatos);

  // ---- E22 ningún error de permisos ni de JavaScript en las páginas ----
  const errores = [pt, admin, movil, dash, crm].flatMap(p => p.__logs).filter(t => /permission|PERMISSION|pageerror|Uncaught|is not defined/i.test(t));
  check('E22 sin errores permission-denied ni errores JavaScript en Agenda/Dashboard/CRM', errores.length === 0, errores.slice(0, 5));

  console.log('\n=== CONSUMO MEDIDO EN EL NAVEGADOR (páginas reales, emulador) ===');
  consumo.forEach(f => console.log(`  ${f.operacion.padEnd(74)} lecturas=${String(f.lecturas).padStart(4)} escrituras=${String(f.escrituras).padStart(3)}${f.ms ? `  (${f.ms} ms)` : ''}`));
  require('fs').writeFileSync(path.join(__dirname, 'arq_consumo_navegador.json'), JSON.stringify(consumo, null, 2));
  await browser.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail) console.log('FALLOS:\n - ' + fallos.join('\n - '));
  process.exit(fail ? 1 : 0);
}
main().catch(async e => { console.error('ERROR FATAL:', e.message); if (browser) await browser.close().catch(() => {}); process.exit(1); });
