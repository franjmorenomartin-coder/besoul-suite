// HOTFIX-CRM-DUPLICADOS-FECHA-ALTA -- pruebas del interruptor de revisión local
// (besoul-entorno-local.js). Demuestra que el dominio de producción NO puede activar el modo
// emulador bajo ninguna combinación, y que en local solo se activa con petición explícita.
//   node crm-incident-tests/entorno_local_tests.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('../besoul-entorno-local.js');

let pass = 0, fail = 0; const fails = [];
function check(desc, cond) { if (cond) { pass++; console.log(`PASS -- ${desc}`); } else { fail++; fails.push(desc); console.log(`FAIL -- ${desc}`); } }
function almacen(inicial = {}) { const m = { ...inicial }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; }
const L = (href) => { const u = new URL(href); return { hostname: u.hostname, protocol: u.protocol, search: u.search }; };

console.log('\n=== Producción y cualquier host no local: NUNCA modo emulador ===');
const prohibidos = [
  'https://app.besoulfitness.com/crm.html?emulador=1',
  'http://app.besoulfitness.com/crm.html?emulador=1',
  'https://app.besoulfitness.com/agenda.html',
  'https://franjmorenomartin-coder.github.io/besoul-suite/crm.html?emulador=1',
  'https://localhost.evil.example/crm.html?emulador=1',
  'http://localhost.besoulfitness.com/crm.html?emulador=1',
  'http://127.0.0.1.nip.io/crm.html?emulador=1',
  'http://192.168.1.20:5560/crm.html?emulador=1',
  'https://localhost/crm.html?emulador=1',
];
prohibidos.forEach(h => check(`No activa: ${h}`, E.decidirModoEmulador(L(h), almacen({ bs_modo_emulador_local: '1' })) === null));
check('Producción con el flag "recordado" en almacenamiento tampoco activa', E.decidirModoEmulador(L('https://app.besoulfitness.com/crm.html'), almacen({ bs_modo_emulador_local: '1' })) === null);

console.log('\n=== Localhost: solo con petición explícita ===');
check('localhost SIN ?emulador=1 y sin recuerdo: comportamiento normal', E.decidirModoEmulador(L('http://localhost:5560/crm.html'), almacen()) === null);
const a = almacen();
const m = E.decidirModoEmulador(L('http://127.0.0.1:5560/crm.html?emulador=1'), a);
check('127.0.0.1 con ?emulador=1 activa el emulador', !!m && m.firestore.host === '127.0.0.1' && m.firestore.port === 8085 && m.authUrl === 'http://127.0.0.1:9099');
check('El proyecto es demo-* (no puede resolver a un proyecto real)', m.projectId === 'demo-besoul-revision' && m.projectId.startsWith('demo-'));
check('Se recuerda en la sesión de ESE origen local para navegar CRM -> Agenda', E.decidirModoEmulador(L('http://127.0.0.1:5560/agenda.html'), a) !== null);
check('?emulador=0 lo apaga y borra el recuerdo', E.decidirModoEmulador(L('http://127.0.0.1:5560/crm.html?emulador=0'), a) === null && E.decidirModoEmulador(L('http://127.0.0.1:5560/crm.html'), a) === null);
check('[::1] también es local', E.decidirModoEmulador({ hostname: '[::1]', protocol: 'http:', search: '?emulador=1' }, almacen()) !== null);
const cfg = E.configFirebaseEmulador({ projectId: 'besoul-suite', apiKey: 'REAL' }, m);
check('La configuración en modo emulador no contiene NADA del proyecto real', cfg.projectId === 'demo-besoul-revision' && !JSON.stringify(cfg).includes('besoul-suite') && cfg.apiKey !== 'REAL');

console.log('\n=== Ejecución real del script en una página de producción simulada ===');
function cargarEnPagina(href) {
  let inicializado = null; let emuladores = [];
  const firebase = {
    initializeApp: (c) => { inicializado = c; return {}; },
    auth: () => ({ useEmulator: (u) => emuladores.push(['auth', u]) }),
    firestore: () => ({ useEmulator: (h, p) => emuladores.push(['firestore', h, p]) }),
  };
  const u = new URL(href);
  const ctx = { console: { warn() {}, error() {}, log() {} }, URLSearchParams, firebase, document: { readyState: 'complete', body: { appendChild() {} }, getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {} }), addEventListener() {} } };
  ctx.window = ctx; ctx.window.location = { hostname: u.hostname, protocol: u.protocol, search: u.search }; ctx.window.sessionStorage = almacen();
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'besoul-entorno-local.js'), 'utf8'), ctx);
  ctx.firebase.initializeApp({ projectId: 'besoul-suite', apiKey: 'REAL' });
  return { modo: ctx.BESOUL_MODO_EMULADOR, inicializado, emuladores };
}
const prod = cargarEnPagina('https://app.besoulfitness.com/crm.html?emulador=1');
check('En producción initializeApp recibe la configuración REAL sin cambios', prod.modo === null && prod.inicializado.projectId === 'besoul-suite' && prod.emuladores.length === 0);
const local = cargarEnPagina('http://127.0.0.1:5560/crm.html?emulador=1');
check('En local con ?emulador=1 initializeApp recibe el proyecto demo y conecta Auth + Firestore al emulador', local.inicializado.projectId === 'demo-besoul-revision' && local.emuladores.length === 2);

console.log('\n=== Las páginas cargan el interruptor después del SDK y antes de su propio código ===');
['crm.html', 'agenda.html', 'dashboard.html'].forEach(f => {
  const h = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const sdk = h.indexOf('firebase-app-compat.js'), sw = h.indexOf('besoul-entorno-local.js'), init = h.indexOf('initializeApp(');
  check(`${f}: SDK < interruptor < initializeApp`, sdk > -1 && sw > sdk && init > sw);
});
const seed = fs.readFileSync(path.join(__dirname, '..', '.review-local', 'seed.cjs'), 'utf8');
check('El seed solo apunta a 127.0.0.1 y a un proyecto demo-*', /const PROYECTO = 'demo-besoul-revision'/.test(seed) && !/besoul-suite\b/.test(seed.replace(/demo-besoul-revision/g, '')) && /127\.0\.0\.1/.test(seed));
check('firebase.json (despliegue) no se ha modificado para la revisión local', !fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8').includes('review'));

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail) { console.log('Failures:', fails); process.exitCode = 1; }
