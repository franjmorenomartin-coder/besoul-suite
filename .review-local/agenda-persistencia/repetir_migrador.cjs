// ARQ-V1-MIGRACION-IMPL — ejecuta N veces la prueba del migrador real (cada una con un emulador
// limpio y una sesión recién iniciada) y resume cuántas pasan y el diagnóstico de cada fallo.
//   node .review-local/agenda-persistencia/repetir_migrador.cjs <N> [script]
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const N = Number(process.argv[2] || 10);
const script = process.argv[3] || '.review-local/agenda-persistencia/arq_migrador_e2e.cjs';
const raiz = path.join(__dirname, '..', '..');
const resultados = [];
for (let i = 1; i <= N; i++) {
  const t0 = Date.now();
  const r = spawnSync(`firebase emulators:exec --only auth,firestore --config .firebase.review-local.json --project demo-besoul-revision "node ${script}"`, { cwd: raiz, encoding: 'utf8', shell: true, env: { ...process.env, ...(process.env.EXTRA_ENV ? JSON.parse(process.env.EXTRA_ENV) : {}) } });
  const salida = `${r.stdout || ''}\n${r.stderr || ''}`;
  const resumen = (salida.match(/\d+ PASS \/ \d+ FAIL/) || ['SIN RESUMEN'])[0];
  const error = (salida.match(/ERROR FATAL:[^\n]*(\n[^\n]*){0,2}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 700);
  const fallos = (salida.match(/^FAIL --.*$/mg) || []).join(' | ').slice(0, 400);
  resultados.push({ i, ok: r.status === 0, resumen, segundos: Math.round((Date.now() - t0) / 1000), error, fallos });
  console.log(`ejecución ${i}: ${r.status === 0 ? 'PASA' : 'FALLA'} · ${resumen} · ${Math.round((Date.now() - t0) / 1000)} s${error ? ' · ' + error : ''}${fallos ? ' · ' + fallos : ''}`);
}
console.log(`\nTOTAL: ${resultados.filter(x => x.ok).length}/${N} ejecuciones superadas`);
