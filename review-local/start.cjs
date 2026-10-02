// HOTFIX-CRM-DUPLICADOS-FECHA-ALTA -- UN comando para la revisión local:
//   node review-local/start.cjs
// 1) arranca el Firebase Emulator (Auth + Firestore) del proyecto ficticio demo-besoul-revision
//    con las reglas de ESTE repositorio (firebase.review-local.json),
// 2) carga datos ficticios (review-local/seed.cjs),
// 3) sirve las páginas en http://127.0.0.1:5560 (solo este equipo).
// Necesita Java 21+ (lo exige el emulador). Ctrl+C lo para todo. Nunca toca el proyecto real.
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PROYECTO = 'demo-besoul-revision';
const hijos = [];
const lanzar = (cmd, args, opts) => { const c = spawn(cmd, args, { cwd: RAIZ, shell: process.platform === 'win32', ...opts }); hijos.push(c); return c; };
const pararTodo = () => hijos.forEach(c => { try { c.kill(); } catch (e) { /* ya parado */ } });
process.on('SIGINT', () => { pararTodo(); process.exit(0); });

(async () => {
  console.log('[revisión] Arrancando Firebase Emulator (Auth + Firestore, proyecto ficticio)...');
  const emu = lanzar('npx', ['--yes', 'firebase-tools@latest', 'emulators:start', '--only', 'auth,firestore', '--config', 'firebase.review-local.json', '--project', PROYECTO], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('El emulador no arrancó en 120 s (¿Java 21 instalado? ¿puertos 8085/9099 libres?)')), 120000);
    const leer = b => { const s = b.toString(); process.stdout.write(s); if (/All emulators ready/i.test(s)) { clearTimeout(t); ok(); } };
    emu.stdout.on('data', leer); emu.stderr.on('data', b => process.stderr.write(b.toString()));
  });
  const seed = spawnSync('node', ['review-local/seed.cjs'], { cwd: RAIZ, stdio: 'inherit' });
  if (seed.status !== 0) { pararTodo(); process.exit(1); }
  lanzar('node', ['review-local/serve.cjs', '5560'], { stdio: 'inherit' });
  console.log('\n================================================================');
  console.log(' REVISIÓN LOCAL LISTA (emulador + datos ficticios, nada es producción)');
  console.log('   CRM:       http://127.0.0.1:5560/crm.html?emulador=1');
  console.log('   Agenda:    http://127.0.0.1:5560/agenda.html?emulador=1');
  console.log('   Dashboard: http://127.0.0.1:5560/dashboard.html?emulador=1');
  console.log('   Admin:  admin.revision@example.test   Contraseña: RevisionLocal2026!');
  console.log('   PT:     laura.revision@example.test   (misma contraseña)');
  console.log(' Ctrl+C para pararlo todo.');
  console.log('================================================================\n');
})().catch(e => { console.error(e.message); pararTodo(); process.exit(1); });
