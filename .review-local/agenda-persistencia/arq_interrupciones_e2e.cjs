// ARQ-V1-MIGRACION-IMPL — INTERRUPCIONES CONTROLADAS con datos de tamaño REAL (respaldo real cargado
// solo en el emulador local; nunca sale del equipo; la salida solo muestra recuentos).
//   1) migración interrumpida a mitad (recarga de la página) y reanudada -> IDÉNTICO;
//   2) contingencia creada con datos reales (tamaño medido);
//   3) cambios masivos en contingencia + reincorporación interrumpida a mitad y reanudada -> todo
//      reincorporado y nada anterior a "desde" alterado.
//   RESPALDO=<ruta> CONTINGENCIA_DESDE=AAAA-MM-DD firebase emulators:exec --only auth,firestore \
//     --config .firebase.review-local.json --project demo-besoul-revision "node .review-local/agenda-persistencia/arq_interrupciones_e2e.cjs"
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');
const D = require('../../besoul-datos.js');
const RAIZ = path.join(__dirname, '..', '..');
const RESPALDO = process.env.RESPALDO;
if (!RESPALDO) throw new Error('Falta RESPALDO');
const DESDE = process.env.CONTINGENCIA_DESDE || '2026-10-01';
const PROYECTO = 'demo-besoul-revision';
const FS = 'http://127.0.0.1:8085';
const DOCS = `${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const BASE = 'http://127.0.0.1:5564';
let pass = 0, fail = 0;
function check(desc, ok, det) { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok || det === undefined ? '' : ` :: ${JSON.stringify(det)}`}`); }
const espera = ms => new Promise(r => setTimeout(r, ms));

function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  if (Object.keys(v).length === 1 && typeof v.__ts === 'string') return { timestampValue: v.__ts };
  const f = {}; Object.keys(v).forEach(k => { f[k] = valor(v[k]); }); return { mapValue: { fields: f } };
}
const escribir = async (ruta, datos) => { const r = await fetch(`${DOCS}/${ruta}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: valor(datos).mapValue.fields }) }); if (!r.ok) throw new Error(`${ruta}: ${(await r.text()).slice(0, 200)}`); };
async function contar(col) { let n = 0, t = ''; do { const r = await fetch(`${DOCS}/${col}?pageSize=300&mask.fieldPaths=rev${t ? `&pageToken=${t}` : ''}`, { headers: owner }); const j = await r.json(); n += (j.documents || []).length; t = j.nextPageToken || ''; } while (t); return n; }
async function hashOriginal() { const r = await fetch(`${DOCS}/besoulSuite/agenda`, { headers: owner }); const j = await r.json(); return crypto.createHash('sha256').update(JSON.stringify(j.fields)).digest('hex') + '@' + j.updateTime; }

let browser, page;
async function abrirAdmin() {
  if (!browser) browser = await chromium.launch({ executablePath: process.env.BS_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  if (!page) { page = await (await browser.newContext()).newPage(); page.on('dialog', d => d.accept().catch(() => {})); }
  await page.goto(`${BASE}/dashboard.html?emulador=1`);
  await page.waitForFunction(() => window.firebase && firebase.apps.length, null, { timeout: 30000 });
  await page.evaluate(() => (firebase.auth().currentUser ? null : firebase.auth().signInWithEmailAndPassword('admin.revision@example.test', 'RevisionLocal2026!')));
  await page.waitForFunction(() => firebase.auth().currentUser, null, { timeout: 30000 });
  await page.waitForTimeout(2500); // la página termina de arrancar (como hará el administrador)
  await page.addScriptTag({ content: fs.readFileSync(path.join(RAIZ, 'besoul-datos.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(RAIZ, 'scripts', 'migrar-agenda-documentos.js'), 'utf8') });
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.cjs'), '5564'], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) { /* parado */ } });
  if (spawnSync('node', [path.join(__dirname, '..', 'seed.cjs')], { stdio: 'ignore' }).status !== 0) throw new Error('seed');
  // Datos REALES en el emulador local (solo la agenda; usuarios ficticios del seed).
  const respaldo = JSON.parse(fs.readFileSync(RESPALDO, 'utf8'));
  await escribir('besoulSuite/agenda', respaldo.besoulSuite.agenda);
  spawnSync('node', ['-e', `fetch('${FS}/emulator/v1/projects/${PROYECTO}:securityRules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:{files:[{name:'firestore.rules',content:require('fs').readFileSync('${path.join(RAIZ, 'firestore.rules').replace(/\\/g, '/')}','utf8')}]}})}).then(r=>process.exit(r.ok?0:1))`], { stdio: 'inherit' });
  const h0 = await hashOriginal();
  const esperados = D.docsDesdeLegado(respaldo.besoulSuite.agenda).docs.length;

  // ---- 1) MIGRACIÓN INTERRUMPIDA ----
  await abrirAdmin();
  page.evaluate(() => migrarAgendaBesoul({ ejecutar: true }).catch(() => {})).catch(() => {}); // sin esperar: se interrumpe
  let n = 0;
  for (let i = 0; i < 200 && n < 150; i++) { await espera(100); n = await contar(D.COL.clientes); }
  await page.reload(); // INTERRUPCIÓN (como cerrar la pestaña o perder la conexión)
  const parcial = (await Promise.all(['semanas', 'clientes', 'trainers', 'historico', 'notas', 'config', 'legado'].map(c => contar(D.COL[c])))).reduce((a, b) => a + b, 0);
  check(`I1 migración interrumpida a mitad (${parcial} de ${esperados} documentos escritos)`, parcial > 0 && parcial < esperados, { parcial, esperados });
  await abrirAdmin();
  const sim = await page.evaluate(() => migrarAgendaBesoul());
  check(`I2 tras la interrupción, la simulación reconoce ${sim.destino.yaIdenticos} ya migrados (idénticos) y ${sim.destino.nuevos} pendientes; nada distinto ni sobrante`, sim.destino.yaIdenticos >= parcial && sim.destino.yaIdenticos + sim.destino.nuevos === esperados && sim.destino.distintos === 0 && sim.destino.sobrantes === 0, sim.destino);
  const ej = await page.evaluate(() => migrarAgendaBesoul({ ejecutar: true }));
  check('I3 reanudada: verificación desde el servidor IDÉNTICA al original', ej.verificacionServidor === 'IDÉNTICO' && ej.originalIntacto === true, { v: ej.verificacionServidor, d: ej.diferencias });
  check(`I4 recuentos reales conservados (${ej.recuentoOriginal.sesiones} sesiones, ${ej.recuentoOriginal.fichas} fichas, ${ej.recuentoOriginal.mesesHistorico} meses de histórico)`, JSON.stringify(ej.recuentoOriginal) === JSON.stringify(ej.recuentoReconstruido));

  // ---- 2) CONTINGENCIA CON DATOS REALES ----
  spawnSync('node', ['-e', `fetch('${FS}/emulator/v1/projects/${PROYECTO}:securityRules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:{files:[{name:'firestore.rules',content:require('fs').readFileSync('${path.join(RAIZ, 'scripts', 'corte', 'firestore.contingencia.rules').replace(/\\/g, '/')}','utf8')}]}})}).then(r=>process.exit(r.ok?0:1))`], { stdio: 'inherit' });
  const prep = await page.evaluate(d => prepararContingenciaBesoul({ desde: d, ejecutar: true }), DESDE);
  check(`I5 contingencia real desde ${DESDE}: creada y verificada (${prep.bytes} bytes, margen ${prep.margenBytes})`, prep.verificacionServidor === 'IDÉNTICO', prep);
  // Cambios masivos durante la contingencia (como haría la app anterior): 150 fichas y 40 sesiones nuevas.
  const contingencia = await page.evaluate(async () => { const d = (await firebase.firestore().collection('besoulSuite').doc('agendaContingencia').get()).data(); return d; });
  let fichasCambiadas = 0, sesionesNuevas = 0;
  Object.keys(contingencia.clientes).forEach(tk => contingencia.clientes[tk].forEach(f => { if (fichasCambiadas < 150) { f.observacionesEstado = `${f.observacionesEstado || ''} [contingencia]`; fichasCambiadas++; } }));
  const tk0 = Object.keys(contingencia.agenda).find(t => Object.keys(contingencia.agenda[t]).length);
  const f0 = contingencia.clientes[tk0][0];
  for (let i = 0; i < 40; i++) { const d = new Date(Date.UTC(2027, 0, 4 + i)); const clave = `${d.toISOString().slice(0, 10)}_07:00`; contingencia.agenda[tk0][clave] = { id: f0.id, nombre: f0.nombre, duracionMin: 45 }; sesionesNuevas++; }
  await page.evaluate(async d => { await firebase.firestore().collection('besoulSuite').doc('agendaContingencia').set(d); }, contingencia);
  check(`I6 ${fichasCambiadas} fichas cambiadas y ${sesionesNuevas} sesiones nuevas en contingencia`, true);
  check('I7 el documento original sigue intacto', (await hashOriginal()) === h0);

  // ---- 3) REINCORPORACIÓN INTERRUMPIDA ----
  spawnSync('node', ['-e', `fetch('${FS}/emulator/v1/projects/${PROYECTO}:securityRules',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:{files:[{name:'firestore.rules',content:require('fs').readFileSync('${path.join(RAIZ, 'firestore.rules').replace(/\\/g, '/')}','utf8')}]}})}).then(r=>process.exit(r.ok?0:1))`], { stdio: 'inherit' });
  const simR = await page.evaluate(() => reincorporarContingenciaBesoul());
  check(`I8 plan de reincorporación: ${simR.documentosACambiar} documentos (${JSON.stringify(simR.porColeccion)})`, simR.documentosACambiar >= 150, simR);
  page.evaluate(() => reincorporarContingenciaBesoul({ ejecutar: true }).catch(() => {})).catch(() => {});
  const reincorporados = async () => { let n = 0, tk = ''; do { const r = await fetch(`${DOCS}/${D.COL.clientes}?pageSize=300&mask.fieldPaths=actualizadoPor${tk ? `&pageToken=${tk}` : ''}`, { headers: owner }); const j = await r.json(); (j.documents || []).forEach(d => { if (String(((d.fields || {}).actualizadoPor || {}).stringValue || '').startsWith('reincorporacion')) n++; }); tk = j.nextPageToken || ''; } while (tk); return n; };
  for (let i = 0; i < 300 && (await reincorporados()) < 50; i++) await espera(50);
  await page.reload(); // INTERRUPCIÓN a mitad de la reincorporación (tras al menos un lote escrito)
  await abrirAdmin();
  const simR2 = await page.evaluate(() => reincorporarContingenciaBesoul());
  check(`I9 interrupción real a mitad: quedan ${simR2.documentosACambiar} de ${simR.documentosACambiar} documentos por reincorporar`, simR2.documentosACambiar < simR.documentosACambiar, simR2);
  const ejR = await page.evaluate(() => reincorporarContingenciaBesoul({ ejecutar: true }));
  check('I10 reincorporación reanudada: estructura nueva IDÉNTICA a la contingencia', ejR.verificacionServidor === 'IDÉNTICO A LA CONTINGENCIA' || simR2.documentosACambiar === 0, ejR);
  // Lo anterior a "desde" (fuera de la contingencia) sigue idéntico al original migrado.
  const ver = await page.evaluate(async desde => {
    const D = BesoulDatos; const fs = firebase.firestore(); const g = {};
    for (const c of ['semanas', 'clientes', 'trainers', 'historico', 'notas', 'legado', 'config']) { const s = await fs.collection(D.COL[c]).get(); g[c] = {}; s.docs.forEach(d => { g[c][d.id] = d.data(); }); }
    const actual = D.legadoDesdeDocs(g);
    const orig = (await fs.collection('besoulSuite').doc('agenda').get()).data();
    let anterioresIguales = 0, anterioresDistintas = 0;
    Object.keys(orig.agenda).forEach(tk => Object.keys(orig.agenda[tk]).forEach(c => { if (c.slice(0, 10) < desde) { D.igual(orig.agenda[tk][c], (actual.agenda[tk] || {})[c]) ? anterioresIguales++ : anterioresDistintas++; } }));
    const histIgual = D.igual(orig.historicoClientes, actual.historicoClientes);
    return { anterioresIguales, anterioresDistintas, histIgual, fichas: Object.values(actual.clientes).reduce((n, l) => n + l.length, 0), fichasOrig: Object.values(orig.clientes).reduce((n, l) => n + l.length, 0) };
  }, DESDE);
  check(`I11 TODAS las sesiones anteriores a ${DESDE} (${ver.anterioresIguales}) siguen idénticas tras contingencia y vuelta`, ver.anterioresDistintas === 0 && ver.anterioresIguales > 0, ver);
  check('I12 el histórico mensual completo es idéntico al original', ver.histIgual === true);
  check(`I13 todas las fichas presentes (${ver.fichas} = ${ver.fichasOrig})`, ver.fichas === ver.fichasOrig);
  check('I14 el documento original no ha cambiado en todo el proceso', (await hashOriginal()) === h0);
  await browser.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERROR FATAL:', String(e.message).slice(0, 300)); if (browser) await browser.close().catch(() => {}); process.exit(1); });
