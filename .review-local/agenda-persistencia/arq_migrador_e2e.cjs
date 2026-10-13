// ARQ-V1-MIGRACION-IMPL — prueba del MIGRADOR REAL (scripts/migrar-agenda-documentos.js) tal y como
// se ejecutará en el corte: en el navegador, con sesión de admin y las reglas REALES (emulador).
//   firebase emulators:exec --only auth,firestore --config .firebase.review-local.json \
//     --project demo-besoul-revision "node .review-local/agenda-persistencia/arq_migrador_e2e.cjs"
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');
const RAIZ = path.join(__dirname, '..', '..');
const BASE = 'http://127.0.0.1:5562';
let pass = 0, fail = 0;
function check(desc, ok, det) { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok || det === undefined ? '' : ` :: ${JSON.stringify(det)}`}`); }

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'serve.cjs'), '5562'], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) { /* parado */ } });
  if (spawnSync('node', [path.join(__dirname, '..', 'seed.cjs')], { stdio: 'inherit' }).status !== 0) throw new Error('seed');
  const browser = await chromium.launch({ executablePath: process.env.BS_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await (await browser.newContext()).newPage();
  const dialogos = []; page.on('dialog', d => { dialogos.push(d.message()); d.accept().catch(() => {}); });
  // Página antigua equivalente: CRM (carga Firebase en modo emulador). Se pegan los dos scripts como en el corte.
  await page.goto(`${BASE}/crm.html?emulador=1`);
  await page.waitForFunction(() => window.firebase && firebase.apps.length, null, { timeout: 30000 });
  await page.evaluate(() => firebase.auth().signInWithEmailAndPassword('admin.revision@example.test', 'RevisionLocal2026!'));
  await page.waitForFunction(() => firebase.auth().currentUser, null, { timeout: 30000 });
  await page.addScriptTag({ content: fs.readFileSync(path.join(RAIZ, 'besoul-datos.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(RAIZ, 'scripts', 'migrar-agenda-documentos.js'), 'utf8') });
  const sim = await page.evaluate(() => migrarAgendaBesoul());
  check('M1 simulación: ida y vuelta exacta y destino vacío, sin escribir', sim.idaYVueltaExacta === true && sim.destino.nuevos > 0 && !sim.escritos, sim.destino);
  const ej = await page.evaluate(() => migrarAgendaBesoul({ ejecutar: true }));
  check('M2 ejecución con reglas reales: documentos escritos', ej.escritos === sim.destino.nuevos, { escritos: ej.escritos });
  check('M3 verificación releyendo del servidor: IDÉNTICO al original', ej.verificacionServidor === 'IDÉNTICO', ej.diferencias);
  check('M4 el documento original no cambió durante la migración', ej.originalIntacto === true);
  const rep = await page.evaluate(() => migrarAgendaBesoul({ ejecutar: true }));
  check('M5 idempotente: repetirla no escribe nada (todo ya idéntico)', rep.escritos === 0 && rep.destino.yaIdenticos === sim.destino.nuevos, rep.destino);
  const rec = await page.evaluate(() => reconstruirAgendaBesoul());
  check('M6 reconstrucción inversa (simulación): mismo recuento que el original', JSON.stringify(rec.recuento) === JSON.stringify(sim.recuento), { rec: rec.recuento, orig: sim.recuento });
  await browser.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e.message); process.exit(1); });
