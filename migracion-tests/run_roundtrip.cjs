// ARQ-V1-MIGRACION-IMPL: integridad de la transformación besoulSuite/agenda -> documentos ->
// besoulSuite/agenda, sobre un RESPALDO REAL (ruta por argumento; el respaldo nunca se copia al
// repositorio y este script solo imprime recuentos y rutas, nunca datos de clientes).
//   node migracion-tests/run_roundtrip.cjs <respaldo.json>
const fs = require('fs');
const crypto = require('crypto');
const D = require('../besoul-datos.js');

const ruta = process.argv[2];
if (!ruta) { console.error('Uso: node migracion-tests/run_roundtrip.cjs <respaldo.json>'); process.exit(2); }
const respaldo = JSON.parse(fs.readFileSync(ruta, 'utf8'));
// Los respaldos exportados desde el navegador serializan los Timestamp como {__ts: ISO}.
const agenda = respaldo.besoulSuite.agenda;

let pass = 0, fail = 0;
function check(desc, ok, detalle) { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok || !detalle ? '' : ` :: ${detalle}`}`); }
const tamano = v => Buffer.byteLength(JSON.stringify(v));

const t0 = Date.now();
const { docs, noTransformable } = D.docsDesdeLegado(agenda);
const porCol = {}; docs.forEach(d => { porCol[d.col] = (porCol[d.col] || 0) + 1; });
console.log('Documentos generados por colección:', JSON.stringify(porCol), `· total ${docs.length} · ${Date.now() - t0} ms`);
check('ningún dato queda sin transformar', noTransformable.length === 0, noTransformable.slice(0, 10).join(', '));

const ids = new Set();
let dup = 0, idsInvalidos = 0;
docs.forEach(d => { const k = `${d.col}/${d.id}`; if (ids.has(k)) dup++; ids.add(k); if (!d.id || d.id.includes('/') || d.id === '.' || d.id === '..' || /^__.*__$/.test(d.id)) idsInvalidos++; });
check('identificadores de documento únicos', dup === 0, `${dup} duplicados`);
check('identificadores de documento válidos para Firestore', idsInvalidos === 0, `${idsInvalidos} inválidos`);

const maxPorCol = {};
docs.forEach(d => { const b = tamano(d.data); if (!maxPorCol[d.col] || b > maxPorCol[d.col].bytes) maxPorCol[d.col] = { bytes: b, id: d.col === 'semanas' ? d.id.replace(/^.*__/, '<tk>__') : '(oculto)' }; });
console.log('Documento más grande por colección (bytes JSON):', JSON.stringify(maxPorCol));
check('ningún documento supera 100 KB (límite Firestore 1 MiB)', Object.values(maxPorCol).every(x => x.bytes < 100 * 1024));

// Ida y vuelta EXACTA.
const reconstruido = D.legadoDesdeDocs(D.agrupar(docs));
const difs = D.diferencias(agenda, reconstruido, '', [], 50);
check('ida y vuelta EXACTA: documento original == reconstruido desde los documentos nuevos', difs.length === 0, difs.slice(0, 20).join(' | '));

// Recuentos y huellas por entrenador (sesiones, fichas, disponibilidad, histórico, pruebas, notas).
const huella = v => crypto.createHash('sha256').update(JSON.stringify(D.canon(v === undefined ? null : v))).digest('hex').slice(0, 16);
const tks = new Set([...Object.keys(agenda.clientes || {}), ...Object.keys(agenda.agenda || {}), ...Object.keys(agenda.disponibilidadReservas || {}), ...Object.keys(agenda.historicoClientes || {})]);
let distintos = 0;
const tabla = [];
tks.forEach(tk => {
  const fila = { tk: tk.replace(/[aeiou]/g, '*') };
  ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes'].forEach(c => {
    const a = (agenda[c] || {})[tk], b = (reconstruido[c] || {})[tk];
    if (huella(a) !== huella(b)) distintos++;
  });
  fila.sesiones = Object.keys((agenda.agenda || {})[tk] || {}).length;
  fila.fichas = ((agenda.clientes || {})[tk] || []).length;
  fila.historicoMeses = Object.values((agenda.historicoClientes || {})[tk] || {}).reduce((n, m) => n + Object.keys(m || {}).length, 0);
  tabla.push(fila);
});
check('huella SHA-256 idéntica por entrenador y campo (5 campos × todos los entrenadores)', distintos === 0, `${distintos} distintos`);
const tot = k => tabla.reduce((n, f) => n + f[k], 0);
console.log(`Totales: sesiones ${tot('sesiones')} · fichas ${tot('fichas')} · meses de histórico ${tot('historicoMeses')} · notas ${Object.keys(agenda.notas || {}).length} · entrenadores ${tks.size}`);

// Idempotencia: transformar dos veces da exactamente los mismos documentos.
const segunda = D.docsDesdeLegado(agenda).docs;
check('transformación determinista (dos ejecuciones = mismos documentos)', D.igual(docs, segunda));
// Transformar lo reconstruido vuelve a dar los mismos documentos (punto fijo).
check('punto fijo: transformar(reconstruir(docs)) == docs', D.igual(D.docsDesdeLegado(reconstruido).docs.sort((x, y) => (x.col + x.id).localeCompare(y.col + y.id)), docs.slice().sort((x, y) => (x.col + x.id).localeCompare(y.col + y.id))));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
