// ARQ-V1-MIGRACION-IMPL — comprobación automatizada (sin tocar V2): los bloques de V2 desplegados en
// producción (reglas y exenciones de índice) siguen byte a byte en los archivos que se van a desplegar.
//   node scripts/corte/verificar-v2-intacto.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const raiz = path.join(__dirname, '..', '..');
const lineas = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
const h = a => crypto.createHash('sha256').update(a.join('\n')).digest('hex');
const prod = lineas(path.join(__dirname, 'firestore.rules.PRODUCCION-2026-10-02.reconstruido'));
const cabecera = prod.slice(3, 15), bloque = prod.slice(374, 494);
const contiene = (L, seg) => { const t = h(seg); for (let i = 0; i + seg.length <= L.length; i++) if (h(L.slice(i, i + seg.length)) === t) return i + 1; return 0; };
let ok = true;
const comprobar = (desc, cond) => { console.log(`${cond ? 'OK  ' : 'FALLO'} ${desc}`); ok = ok && cond; };
comprobar('reconstrucción de producción: 500 líneas, SHA-256 076ad23e8b145d62…', prod.length === 500 && h(prod).startsWith('076ad23e8b145d62'));
[['firestore.rules (corte)', path.join(raiz, 'firestore.rules')], ['firestore.contingencia.rules', path.join(__dirname, 'firestore.contingencia.rules')]].forEach(([n, f]) => {
  const L = lineas(f);
  comprobar(`${n}: cabecera V2 (12 líneas) idéntica`, contiene(L, cabecera) > 0);
  comprobar(`${n}: bloque V2 (120 líneas) idéntico`, contiene(L, bloque) > 0);
});
const idx = JSON.parse(fs.readFileSync(path.join(raiz, 'firestore.indexes.json'), 'utf8'));
const V2 = ['clients|id', 'sessions|sessionId', 'historico|clienteId', 'notes|texto', 'besoulMigrationQuarantine|texto', 'besoulMigrationQuarantine|originalEntry', 'trainers|actividadesAutorizadas', 'besoulFinance|catalogoActividades', 'besoulFinance|tarifasActividadVersiones', 'besoulFinance|repartoActividadVersiones', 'sessions|asistentesGrupoAbierto'];
const presentes = V2.filter(k => idx.fieldOverrides.some(o => `${o.collectionGroup}|${o.fieldPath}` === k));
comprobar(`firestore.indexes.json: 11/11 exenciones de V2 presentes (${presentes.length})`, presentes.length === 11);
comprobar('firestore.indexes.json: ningún índice compuesto sobre colecciones de V2', !idx.indexes.some(i => ['clients', 'sessions', 'historico', 'notes', 'trainers', 'besoulFinance', 'besoulMigrationQuarantine', 'besoulUsersV2', 'availability'].includes(i.collectionGroup)));
console.log(ok ? '\nV2 INTACTO en los archivos de despliegue.' : '\nATENCIÓN: V2 NO está intacto. No desplegar.');
process.exit(ok ? 0 : 1);
