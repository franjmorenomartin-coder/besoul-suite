// HARDENING-PRE-BASELINE-v3.2.1: prueba real de limpiarCacheSensibleBesoul() (extraído verbatim
// de agenda.html) contra un localStorage simulado -- antes de logout existen, después de logout
// las claves sensibles (multi-PT/PII) desaparecen, y las preferencias inocuas de UI permanecen.
const fs = require('fs');
const path = require('path');
const extracted = fs.readFileSync(path.join(__dirname, 'logout_cache_extract.js'), 'utf8');

// Object.keys(localStorage) funciona en un navegador real porque las claves guardadas SON
// propiedades enumerables del propio objeto Storage -- el código real (limpiarCacheSensibleBesoul)
// depende exactamente de eso. El mock replica ese detalle: los datos viven como propiedades
// enumerables propias, y getItem/setItem/removeItem se definen NO enumerables para no aparecer
// ellos mismos en Object.keys(), igual que en el Storage real.
function crearLocalStorageFalso(inicial = {}) {
  const store = { ...inicial };
  Object.defineProperties(store, {
    getItem: { value(k) { return k in this && typeof this[k] === 'string' ? this[k] : null; }, enumerable: false },
    setItem: { value(k, v) { this[k] = String(v); }, enumerable: false },
    removeItem: { value(k) { delete this[k]; }, enumerable: false },
  });
  return store;
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// ============================================================
console.log('=== ANTES de logout: todas las claves de fixture existen ===');
// ============================================================
const fixture = {
  bs_db_clientes_v6: '{"a":[{"id":"c1"}],"b":[{"id":"c2"}]}',
  bs_db_agenda_v6: '{"a":{},"b":{}}',
  bs_db_credenciales_v6: '{"a":{"nombre":"PT A"},"b":{"nombre":"PT B"}}',
  bs_db_disponibilidad_reservas_v6: '{"a":{}}',
  bs_db_historico_clientes_v6: '{"a":{}}',
  bs_db_leads_pruebas_crm_v6: '{"a":{}}',
  bs_db_notas_v6: '{"a__nota1":"x"}',
  bs_db_pruebas_crm_v6: '{"a":{}}',
  'bs_backup_semana_a_2026-38': '{"clientes":[{"id":"c1"}]}',
  'bs_backup_semana_b_2026-38': '{"clientes":[{"id":"c2"}]}',
  bs_modo_agenda_slots_v1: 'compacto',
};
const localStorage = crearLocalStorageFalso(fixture);
Object.keys(fixture).forEach(k => check(`antes de logout: "${k}" existe`, localStorage.getItem(k) !== null, true));

// ============================================================
console.log('\n=== Ejecuta limpiarCacheSensibleBesoul() (equivalente real a logout()) ===');
// ============================================================
const M = new Function('localStorage', extracted + '\nreturn { limpiarCacheSensibleBesoul };')(localStorage);
M.limpiarCacheSensibleBesoul();

// ============================================================
console.log('\n=== DESPUÉS de logout: claves sensibles (multi-PT/PII) han desaparecido ===');
// ============================================================
[
  'bs_db_clientes_v6', 'bs_db_agenda_v6', 'bs_db_credenciales_v6',
  'bs_db_disponibilidad_reservas_v6', 'bs_db_historico_clientes_v6',
  'bs_db_leads_pruebas_crm_v6', 'bs_db_notas_v6', 'bs_db_pruebas_crm_v6',
  'bs_backup_semana_a_2026-38', 'bs_backup_semana_b_2026-38',
].forEach(k => check(`después de logout: "${k}" NO existe`, localStorage.getItem(k), null));

// ============================================================
console.log('\n=== DESPUÉS de logout: preferencia de UI inocua SIGUE existiendo ===');
// ============================================================
check('bs_modo_agenda_slots_v1 se conserva (no es PII, es una preferencia de UI)', localStorage.getItem('bs_modo_agenda_slots_v1'), 'compacto');

// ============================================================
console.log('\n=== Robustez: no lanza si localStorage no está disponible ===');
// ============================================================
{
  // Simula un modo privado en el que TOCAR localStorage lanza (comportamiento real de algunos
  // navegadores) -- Object.keys() sobre un Proxy con ownKeys() que lanza reproduce exactamente eso.
  const localStorageRoto = new Proxy({}, { ownKeys() { throw new Error('localStorage no disponible (modo privado)'); } });
  let lanzo = false;
  try {
    const M2 = new Function('localStorage', extracted + '\nreturn { limpiarCacheSensibleBesoul };')(localStorageRoto);
    M2.limpiarCacheSensibleBesoul();
  } catch (e) { lanzo = true; }
  check('no lanza aunque Object.keys(localStorage) falle', lanzo, false);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
