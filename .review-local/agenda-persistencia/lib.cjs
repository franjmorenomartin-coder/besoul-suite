'use strict';
// HOTFIX-V1-AGENDA-PERSISTENCIA-P0 -- arnés de reproducción con navegador real (Playwright) de la
// Agenda V1 contra el Firebase Emulator (proyecto ficticio demo-besoul-revision, 127.0.0.1).
// Se niega a ejecutarse contra cualquier destino que no sea local. Ver README.md de esta carpeta.
const { chromium } = require('playwright');

const PROYECTO = 'demo-besoul-revision';
const FS = 'http://127.0.0.1:8085';
const BASE = process.env.BASE || 'http://127.0.0.1:5560';
const PASS = 'RevisionLocal2026!';
if (!PROYECTO.startsWith('demo-') || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error('REFUSED: solo emulador local y páginas servidas en 127.0.0.1/localhost.');
const DOC = `${FS}/v1/projects/${PROYECTO}/databases/(default)/documents/besoulSuite/agenda`;
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  return { mapValue: { fields: campos(v) } };
}
function campos(o) { const f = {}; Object.keys(o).forEach(k => { f[k] = valor(o[k]); }); return f; }
function desde(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(desde);
  if ('mapValue' in v) { const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = desde(x); }); return o; }
  return undefined;
}
const RAIZ = `${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;
async function escribirRuta(ruta, datos) { const r = await fetch(`${RAIZ}/${ruta}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: campos(datos) }) }); if (!r.ok) throw new Error(await r.text()); }
async function leerRuta(ruta) { const r = await fetch(`${RAIZ}/${ruta}`, { headers: owner }); const j = await r.json(); return desde({ mapValue: { fields: j.fields || {} } }); }
async function leerDoc() {
  const r = await fetch(DOC, { headers: owner });
  const j = await r.json();
  return desde({ mapValue: { fields: j.fields || {} } });
}
async function escribirDoc(datos) {
  const r = await fetch(DOC, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: campos(datos) }) });
  if (!r.ok) throw new Error(await r.text());
}

function dispAbierta() {
  const semanal = {};
  for (let d = 1; d <= 7; d++) semanal[d] = { activo: true, bloques: [{ inicio: '06:00', fin: '22:00' }] };
  return { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true, actualizadoEn: '2026-10-01T00:00:00.000Z' };
}
function cliente(id, nombre, extra) {
  return { id, nombre, tipo: 'individual', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', fechaCompra: '', color: 'amber',
    descuentoPct: 0, estadoCliente: 'activo', fechaCambioEstado: '', observacionesEstado: '', telefono: '600000000', email: `${id}@example.test`,
    fechaAlta: '2026-06-01', contratoCliente: { firmado: false, nombreArchivo: '', tipoMime: '', contenidoBase64: '', subidaEn: '' }, ...extra };
}
async function resetAgenda(agendaExtra = {}) {
  await escribirDoc({
    clientes: {
      laura: [cliente('cli_rosa', 'Rosa Ficticia'), cliente('cli_ana', 'Ana Ficticia'), cliente('cli_eva', 'Eva Ficticia')],
      carlos: [cliente('cli_tomas', 'Tomas Ficticio'), cliente('cli_luis', 'Luis Ficticio')],
      adminrevision: [],
    },
    agenda: { laura: {}, carlos: {}, ...agendaExtra },
    pruebasCRM: {}, disponibilidadReservas: { laura: dispAbierta(), carlos: dispAbierta() }, historicoClientes: {}, notas: {},
  });
}

let browser;
async function navegador() {
  if (!browser) browser = await chromium.launch({ ...(process.env.BS_NAVEGADOR !== 'chromium' ? { executablePath: process.env.BS_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : {}), headless: true });
  return browser;
}
async function abrirSesion(email, etiqueta, ctx) {
  const b = await navegador();
  const context = ctx || await b.newContext();
  const page = await context.newPage();
  page.__logs = [];
  page.on('console', m => { const t = m.text(); if (/BESOUL Agenda]|Error guardando|CONFLICT]|conflict/i.test(t) && !/Leads leídos/.test(t)) page.__logs.push(`[${etiqueta}] ${m.type()}: ${t.slice(0, 300)}`); });
  page.on('dialog', d => { page.__logs.push(`[${etiqueta}] DIALOG ${d.type()}: ${d.message().slice(0, 300)}`); (d.type() === 'beforeunload' ? d.dismiss() : d.accept()).catch(() => {}); });
  page.__email = email;
  if (process.env.LAT) { const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: Number(process.env.LAT), downloadThroughput: -1, uploadThroughput: -1 }); }
  await page.goto(`${BASE}/agenda.html?emulador=1`);
  await listo(page);
  page.__ctx = context;
  return page;
}
async function listo(page) {
  const email = page.__email;
  await page.waitForFunction(() => {
    const app = document.getElementById('app-content');
    const login = document.getElementById('login-user');
    return (app && !app.classList.contains('hidden')) || (login && login.offsetParent !== null);
  }, null, { timeout: 30000 });
  if (await page.isVisible('#login-user').catch(() => false)) {
    await page.fill('#login-user', email);
    await page.fill('#login-pass', PASS);
    await page.click('button[onclick="ejecutarLogin()"]');
  }
  await page.waitForFunction(() => window.bsUltimoServidorConocido && document.getElementById('app-content') && !document.getElementById('app-content').classList.contains('hidden'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
}
async function recargar(page) { await page.reload(); await listo(page); }
// Lo que ve la pantalla: memoria (dbAgenda) + texto renderizado de la tabla de agenda
async function pantalla(page, trainer) {
  return page.evaluate(t => ({ claves: Object.keys((dbAgenda || {})[t] || {}).sort(), texto: document.body.innerText, notas: { ...(dbNotas || {}) } }), trainer);
}
const espera = ms => new Promise(r => setTimeout(r, ms));
async function cerrar() { if (browser) await browser.close(); }

module.exports = { escribirRuta, leerRuta, recargar, leerDoc, escribirDoc, resetAgenda, abrirSesion, pantalla, espera, cerrar, navegador };
