// ARQ-V1-MIGRACION-IMPL — ciclo COMPLETO de recuperación con las páginas reales contra el emulador:
//   1) corte (reglas definitivas + migración) y un cambio confirmado en la app NUEVA;
//   2) activación de CONTINGENCIA (reglas de contingencia + documento agendaContingencia) y trabajo
//      con la app ANTERIOR (rama CONTINGENCIA-V1-2026-10-13);
//   3) vuelta: reglas definitivas + reincorporación + app nueva.
// Comprueba que no se pierde ningún cambio confirmado, que el documento original no cambia nunca y
// que en contingencia la estructura nueva no admite escrituras.
//   CONTINGENCIA_DIR=<worktree de CONTINGENCIA-V1-2026-10-13> firebase emulators:exec --only auth,firestore \
//     --config .firebase.review-local.json --project demo-besoul-revision "node .review-local/agenda-persistencia/arq_contingencia_e2e.cjs"
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');
const D = require('../../besoul-datos.js');
const RAIZ = path.join(__dirname, '..', '..');
const CONT_DIR = process.env.CONTINGENCIA_DIR;
if (!CONT_DIR) throw new Error('Falta CONTINGENCIA_DIR');
const PROYECTO = 'demo-besoul-revision';
const FS = 'http://127.0.0.1:8085';
const DOCS = `${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const NUEVA = 'http://127.0.0.1:5561', ANTERIOR = 'http://127.0.0.1:5563';
let pass = 0, fail = 0;
function check(desc, ok, det) { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok || det === undefined ? '' : ` :: ${JSON.stringify(det)}`}`); }
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
}
const escribir = async (ruta, datos) => { const r = await fetch(`${DOCS}/${ruta}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: valor(datos).mapValue.fields }) }); if (!r.ok) throw new Error(await r.text()); };
const leer = async ruta => { const r = await fetch(`${DOCS}/${ruta}`, { headers: owner }); if (r.status === 404) return null; const j = await r.json(); return desde({ mapValue: { fields: j.fields || {} } }); };
async function listar(col) { const out = {}; let t = ''; do { const r = await fetch(`${DOCS}/${col}?pageSize=300${t ? `&pageToken=${t}` : ''}`, { headers: owner }); const j = await r.json(); (j.documents || []).forEach(d => { out[decodeURIComponent(d.name.split('/').pop())] = desde({ mapValue: { fields: d.fields || {} } }); }); t = j.nextPageToken || ''; } while (t); return out; }
async function vistaNueva() { const g = {}; for (const c of ['semanas', 'clientes', 'trainers', 'historico', 'notas', 'legado', 'config']) g[c] = await listar(D.COL[c]); return D.legadoDesdeDocs(g); }
async function reglas(archivo) {
  const r = await fetch(`${FS}/emulator/v1/projects/${PROYECTO}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(archivo, 'utf8') }] } }) });
  if (!r.ok) throw new Error('reglas: ' + await r.text());
}
const huella = v => crypto.createHash('sha256').update(JSON.stringify(D.canon(v))).digest('hex');

let browser;
async function abrir(base, email, pagina = 'agenda.html') {
  if (!browser) browser = await chromium.launch({ executablePath: process.env.BS_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await (await browser.newContext()).newPage();
  page.__dialogos = []; page.__errores = [];
  page.on('dialog', d => { page.__dialogos.push(d.message().slice(0, 160)); (d.type() === 'beforeunload' ? d.dismiss() : d.accept()).catch(() => {}); });
  page.on('pageerror', e => page.__errores.push(String(e.message).slice(0, 160)));
  await page.goto(`${base}/${pagina}?emulador=1`);
  await page.waitForSelector('#login-user, #app-content', { timeout: 30000 });
  if (await page.isVisible('#login-user').catch(() => false)) { await page.fill('#login-user', email); await page.fill('#login-pass', 'RevisionLocal2026!'); await page.click('button[onclick="ejecutarLogin()"]'); }
  await page.waitForFunction(() => window.bsUltimoServidorConocido && !document.getElementById('app-content').classList.contains('hidden'), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  return page;
}
const guardado = p => p.waitForFunction(() => /Guardado en el servidor/.test((document.getElementById('bs-estado-guardado') || {}).innerText || ''), null, { timeout: 25000 });

(async () => {
  const s1 = spawn('node', [path.join(__dirname, '..', 'serve.cjs'), '5561'], { stdio: 'ignore' });
  // servidor estático de la app ANTERIOR (contingencia): mismo serve.cjs, raíz = worktree de contingencia
  const s2 = spawn('node', [path.join(CONT_DIR, '.review-local', 'serve.cjs'), '5563'], { stdio: 'ignore' });
  process.on('exit', () => { [s1, s2].forEach(s => { try { s.kill(); } catch (e) { /* parado */ } }); });
  if (spawnSync('node', [path.join(__dirname, '..', 'seed.cjs')], { stdio: 'inherit' }).status !== 0) throw new Error('seed');
  const hoy = new Date(); const dia = n => { const d = new Date(hoy); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  // Datos de partida con sesiones PASADAS (antes de "desde") y futuras.
  const orig = await leer('besoulSuite/agenda');
  const semanal = {}; for (let i = 1; i <= 7; i++) semanal[i] = { activo: true, bloques: [{ inicio: '07:00', fin: '21:00' }] };
  orig.disponibilidadReservas = { laura: { semanal, excepciones: { [dia(-40)]: { activo: false, bloques: [] } }, bloqueos: {}, recurrenteSemanal: true } };
  const rosa = orig.clientes.laura.find(c => c.id === 'cli_rosa_ficticia');
  orig.agenda = { laura: { [`${dia(-40)}_10:00`]: { ...rosa, duracionMin: 45, contratoCliente: rosa.contratoCliente }, [`${dia(3)}_10:00`]: { ...rosa, duracionMin: 45 } } };
  await escribir('besoulSuite/agenda', orig);
  const huellaOriginal = huella(await leer('besoulSuite/agenda'));

  // ---- 1) CORTE ----
  await reglas(path.join(RAIZ, 'firestore.rules'));
  for (const d of D.docsDesdeLegado(await leer('besoulSuite/agenda')).docs) await escribir(`${D.COL[d.col]}/${encodeURIComponent(d.id)}`, { ...d.data, rev: 1, actualizadoEn: new Date(), actualizadoPor: 'migracion:e2e' });
  const ptNueva = await abrir(NUEVA, 'laura.revision@example.test');
  const X = `${dia(4)}_11:00`;
  await ptNueva.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [X, 'cli_rosa_ficticia']); await guardado(ptNueva);
  check('R1 tras el corte, un cambio confirmado en la app nueva (sesión X)', !!((await vistaNueva()).agenda.laura || {})[X]);

  // ---- 2) CONTINGENCIA ----
  await reglas(path.join(RAIZ, 'scripts', 'corte', 'firestore.contingencia.rules'));
  const adminNueva = await abrir(NUEVA, 'admin.revision@example.test');
  await adminNueva.addScriptTag({ content: fs.readFileSync(path.join(RAIZ, 'scripts', 'migrar-agenda-documentos.js'), 'utf8') });
  const desdeCont = dia(-7);
  const sim = await adminNueva.evaluate(d => prepararContingenciaBesoul({ desde: d }), desdeCont);
  check('R2 simulación de contingencia: ida y vuelta sin cambios y tamaño holgado', sim.idaYVueltaSinCambios === true && sim.bytes < 900000, sim);
  const prep = await adminNueva.evaluate(d => prepararContingenciaBesoul({ desde: d, ejecutar: true }), desdeCont);
  check('R3 documento de contingencia creado y verificado desde el servidor', prep.verificacionServidor === 'IDÉNTICO', prep);
  // La app nueva ya no puede escribir (estructura nueva congelada en contingencia).
  const Z = `${dia(5)}_12:00`;
  await ptNueva.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [Z, 'cli_rosa_ficticia']); await espera(5000);
  check('R4 en contingencia, la app nueva NO puede escribir en la estructura nueva (y avisa)', !((await vistaNueva()).agenda.laura || {})[Z] && ptNueva.__dialogos.some(m => /no se ha guardado|NO se ha guardado|permiso/i.test(m)), ptNueva.__dialogos.slice(-2));
  // La app ANTERIOR trabaja sobre agendaContingencia.
  const ptAnterior = await abrir(ANTERIOR, 'laura.revision@example.test');
  check('R5 la app anterior (contingencia) ve la sesión X hecha tras el corte', await ptAnterior.evaluate(c => !!((dbAgenda || {}).laura || {})[c], X));
  const Y = `${dia(6)}_09:00`;
  await ptAnterior.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [Y, 'cli_rosa_ficticia']); await guardado(ptAnterior);
  await ptAnterior.evaluate(async () => { editarFicha('cli_rosa_ficticia'); document.getElementById('cust-phone').value = '611000999'; await guardarCliente(); });
  await espera(1500);
  const cont = await leer('besoulSuite/agendaContingencia');
  check('R6 la app anterior guarda en agendaContingencia (sesión Y y cambio de ficha)', !!cont.agenda.laura[Y] && cont.clientes.laura.find(c => c.id === 'cli_rosa_ficticia').telefono === '611000999');
  check('R7 el documento original NO ha cambiado', huella(await leer('besoulSuite/agenda')) === huellaOriginal);
  // Consulta del HISTÓRICO COMPLETO durante la contingencia: app nueva en /consulta/ (solo lectura).
  const consulta = await abrir(ANTERIOR, 'laura.revision@example.test', 'consulta/agenda.html');
  const vistaConsulta = await consulta.evaluate(([viejo, x]) => ({ modo: window.BS_MODO_CONSULTA === true, franja: !!document.getElementById('bs-franja-consulta'), viejo: !!((dbAgenda || {}).laura || {})[viejo], x: !!((dbAgenda || {}).laura || {})[x], fichas: ((dbClientes || {}).laura || []).length }), [`${dia(-40)}_10:00`, X]);
  check('R7b en contingencia, /consulta/ muestra el histórico COMPLETO (sesión de hace 40 días, anterior a "desde") y lo hecho tras el corte', vistaConsulta.modo && vistaConsulta.franja && vistaConsulta.viejo && vistaConsulta.x && vistaConsulta.fichas > 0, vistaConsulta);
  const antesConsulta = huella(await vistaNueva());
  await consulta.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [`${dia(8)}_10:00`, 'cli_rosa_ficticia']); await espera(2500);
  check('R7c /consulta/ es de solo lectura: un intento de guardar no escribe nada y avisa', huella(await vistaNueva()) === antesConsulta && consulta.__dialogos.some(m => /Modo consulta|no se ha guardado|NO se ha guardado/i.test(m)), consulta.__dialogos.slice(-2));
  const dashConsulta = await (async () => { const p = await (await browser.newContext()).newPage(); p.on('dialog', d => d.accept().catch(() => {})); await p.goto(`${ANTERIOR}/consulta/dashboard.html?emulador=1`); await p.waitForFunction(() => window.firebase && firebase.apps.length, null, { timeout: 30000 }); await p.evaluate(() => firebase.auth().signInWithEmailAndPassword('admin.revision@example.test', 'RevisionLocal2026!')); await p.waitForFunction(() => typeof agendaData !== 'undefined' && agendaData && agendaData.agenda && Object.keys(agendaData.agenda.laura || {}).length > 0, null, { timeout: 30000 }); return p.evaluate(v => !!agendaData.agenda.laura[v], `${dia(-40)}_10:00`); })();
  check('R7d el Dashboard de consulta (admin) ve el histórico completo durante la contingencia', dashConsulta === true);

  // ---- 3) VUELTA ----
  await reglas(path.join(RAIZ, 'firestore.rules'));
  const simR = await adminNueva.evaluate(() => reincorporarContingenciaBesoul());
  check('R8 simulación de reincorporación: solo los documentos cambiados en contingencia', simR.documentosACambiar > 0 && simR.documentosACambiar <= 4, simR);
  const ejR = await adminNueva.evaluate(() => reincorporarContingenciaBesoul({ ejecutar: true }));
  check('R9 reincorporación ejecutada y verificada desde el servidor', ejR.verificacionServidor === 'IDÉNTICO A LA CONTINGENCIA', ejR);
  const fin = await vistaNueva();
  check('R10 nada se pierde: X (antes de la contingencia) e Y (durante) están en la estructura nueva', !!fin.agenda.laura[X] && !!fin.agenda.laura[Y]);
  check('R11 el cambio de ficha hecho en contingencia está en la estructura nueva', fin.clientes.laura.find(c => c.id === 'cli_rosa_ficticia').telefono === '611000999');
  check('R12 lo anterior a "desde" queda intacto (sesión pasada con sus campos y día bloqueado)', !!fin.agenda.laura[`${dia(-40)}_10:00`] && 'contratoCliente' in fin.agenda.laura[`${dia(-40)}_10:00`] && fin.disponibilidadReservas.laura.excepciones[dia(-40)].activo === false);
  const ptVuelta = await abrir(NUEVA, 'laura.revision@example.test');
  check('R13 la app nueva, tras volver, muestra todo (X e Y)', await ptVuelta.evaluate(([x, y]) => !!dbAgenda.laura[x] && !!dbAgenda.laura[y], [X, Y]));
  const W = `${dia(7)}_10:00`;
  await ptVuelta.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [W, 'cli_rosa_ficticia']); await guardado(ptVuelta);
  check('R14 tras volver, la app nueva guarda con normalidad', !!(await vistaNueva()).agenda.laura[W]);
  check('R15 el documento original sigue sin cambios al final del ciclo', huella(await leer('besoulSuite/agenda')) === huellaOriginal);
  check('R16 sin errores JavaScript en las páginas', [ptNueva, adminNueva, ptAnterior, ptVuelta].every(p => !p.__errores.length), [ptNueva, adminNueva, ptAnterior, ptVuelta].flatMap(p => p.__errores));
  await browser.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERROR FATAL:', e.message); if (browser) await browser.close().catch(() => {}); process.exit(1); });
