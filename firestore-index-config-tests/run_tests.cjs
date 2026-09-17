// FIRESTORE-INDEX-P0: valida la configuración declarativa de índices/field-overrides que corrige
// "too many index entries for entity /besoulSuite/agenda", y que ningún cambio se ha colado fuera
// de ese alcance (Rules/Functions/Storage/Hosting intactos). No emula Firestore -- valida el JSON
// real del repo contra el código fuente real (mismo espíritu de "nunca una copia manual" que el
// resto de la suite: lee los archivos reales, no una versión re-tecleada).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function leerJSON(nombre) { return JSON.parse(fs.readFileSync(path.join(ROOT, nombre), 'utf8')); }
function leerTexto(nombre) { return fs.readFileSync(path.join(ROOT, nombre), 'utf8'); }

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}
function checkTrue(desc, actual) { check(desc, !!actual, true); }

// ============================================================
console.log('=== 1. Configuración parseable ===');
// ============================================================
let indexesConfig, firebaseConfig, firebaserc;
{
  let parseOk = true;
  try { indexesConfig = leerJSON('firestore.indexes.json'); } catch (e) { parseOk = false; console.log('  error:', e.message); }
  check('firestore.indexes.json es JSON válido', parseOk, true);
  try { firebaseConfig = leerJSON('firebase.json'); } catch (e) { parseOk = false; console.log('  error:', e.message); }
  check('firebase.json es JSON válido', !!firebaseConfig, true);
  try { firebaserc = leerJSON('.firebaserc'); } catch (e) { console.log('  error:', e.message); }
  check('.firebaserc es JSON válido', !!firebaserc, true);
}

// ============================================================
console.log('\n=== 2. Configuración del proyecto coherente con el projectId real ===');
// ============================================================
{
  // El projectId NUNCA se inventa: se extrae literalmente del firebaseConfig ya desplegado en
  // producción (idéntico en las 5 páginas que inicializan Firebase).
  const paginas = ['agenda.html', 'portal-cliente.html', 'finanzas.html', 'dashboard.html', 'crm.html'];
  const projectIds = paginas.map(p => {
    const m = leerTexto(p).match(/projectId:\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  });
  check('las 5 páginas de la app usan el MISMO projectId real', new Set(projectIds).size, 1);
  check('.firebaserc apunta exactamente a ese projectId real (no uno inventado)', firebaserc.projects && firebaserc.projects.default, projectIds[0]);
}

// ============================================================
console.log('\n=== 3. firebase.json no toca Hosting/Functions/Storage -- el frontend sigue en GitHub Pages ===');
// ============================================================
{
  check('firebase.json NO declara "hosting" (el frontend sigue desplegándose por GitHub Pages, no Firebase Hosting)', 'hosting' in firebaseConfig, false);
  check('firebase.json NO declara "functions"', 'functions' in firebaseConfig, false);
  check('firebase.json NO declara "storage"', 'storage' in firebaseConfig, false);
  check('firebase.json SÍ declara "firestore" (rules + indexes)', 'firestore' in firebaseConfig, true);
  check('firebase.json apunta a firestore.rules (el archivo YA existente, sin crear uno nuevo)', firebaseConfig.firestore?.rules, 'firestore.rules');
  check('firebase.json apunta a firestore.indexes.json', firebaseConfig.firestore?.indexes, 'firestore.indexes.json');
}

// ============================================================
console.log('\n=== 4. firestore.rules NO se ha modificado por este hotfix ===');
// ============================================================
{
  // Confirma que la regla de LECTURA de besoulSuite/agenda (cualquier usuario activo) sigue
  // intacta -- este hotfix es de índices, nunca de permisos. HARDENING-PRE-BASELINE-v3.2.1
  // (2026-09-17): la línea única "allow read, write: if isActiveUser()..." se sustituyó
  // DELIBERADAMENTE por "allow read: ..." + "allow write: if ... (aislamiento por trainerKey,
  // FASE 2)" -- ver firestore.rules y rules-tests/run_fase2_tests.cjs. Se actualiza la cadena
  // esperada a la mitad que sigue siendo invariante (lectura), no a la de escritura, que
  // cambió intencionadamente y ya tiene su propia cobertura dedicada.
  const rules = leerTexto('firestore.rules');
  checkTrue('firestore.rules conserva la regla de LECTURA de besoulSuite/agenda sin cambios', rules.includes("allow read: if isActiveUser() && docId == 'agenda';"));
}

// ============================================================
console.log('\n=== 5. Sin índices compuestos inventados -- no hacían falta (cero queries sobre besoulSuite) ===');
// ============================================================
{
  check('"indexes" (compuestos) está vacío -- no se ha creado ningún índice compuesto nuevo', indexesConfig.indexes, []);
}

// ============================================================
console.log('\n=== 6. Ningún wildcard peligroso: el fieldPath "*" solo existe donde se ha demostrado que es seguro ===');
// ============================================================
{
  const overrides = indexesConfig.fieldOverrides || [];
  const wildcards = overrides.filter(o => o.fieldPath === '*');
  check('como mucho hay un wildcard, y es para besoulSuite (la única colección auditada sin ninguna query)', wildcards.map(w => w.collectionGroup), ['besoulSuite']);

  // La precondición real de seguridad: NINGÚN .where()/.orderBy()/array-contains en TODO el
  // frontend debe apuntar a la colección "besoulSuite" -- si algún día alguien añadiera una query
  // así, este test debe fallar para que nadie despliegue el wildcard sin re-auditar.
  const paginasFrontend = ['agenda.html', 'portal-cliente.html', 'finanzas.html', 'dashboard.html', 'crm.html'];
  let quereyASobreBesoulSuite = false;
  paginasFrontend.forEach(p => {
    const src = leerTexto(p);
    // Cualquier "collection('besoulSuite')" o "collection(\"besoulSuite\")" seguido (en las
    // siguientes ~120 columnas) de .where/.orderBy sin pasar antes por .doc( indicaría una query
    // real sobre el propio megadocumento -- no una simple referencia a un documento concreto.
    const regex = /collection\((['"])besoulSuite\1\)([\s\S]{0,120})/g;
    let m;
    while ((m = regex.exec(src))) {
      const siguiente = m[2];
      const primerDoc = siguiente.indexOf('.doc(');
      const primerWhere = siguiente.search(/\.where\(|\.orderBy\(/);
      if (primerWhere !== -1 && (primerDoc === -1 || primerWhere < primerDoc)) quereyASobreBesoulSuite = true;
    }
  });
  check('ninguna query real (.where/.orderBy) apunta a la colección besoulSuite en todo el frontend', quereyASobreBesoulSuite, false);
}

// ============================================================
console.log('\n=== 7-12. Campos auditados exentos (evidencia: sin ninguna query sobre ellos en todo el repo) ===');
// ============================================================
{
  const overrides = indexesConfig.fieldOverrides || [];
  const exento = (campo) => overrides.some(o => o.collectionGroup === 'besoulSuite' && o.fieldPath === campo && Array.isArray(o.indexes) && o.indexes.length === 0);
  ['disponibilidadReservas', 'agenda', 'clientes', 'historicoClientes', 'notas', 'pruebasCRM', 'catalogoActividades', 'trainerActividades', 'tarifasActividadVersiones', 'repartoActividadVersiones'].forEach(campo => {
    check(`"${campo}" está exento de indexación automática (indexes: [])`, exento(campo), true);
  });
}

// ============================================================
console.log('\n=== 13. Las colecciones que SÍ necesitan sus propios índices no quedan tocadas por error ===');
// ============================================================
{
  // besoulLeads/besoulNotifications/besoulReservas/etc. tienen queries reales (.where trainerKey,
  // audience...) y dependen de SUS PROPIOS índices automáticos de campo simple -- ninguna entrada
  // de fieldOverrides de este hotfix debe tocar esas colecciones.
  const overrides = indexesConfig.fieldOverrides || [];
  const colectionesConQueryReal = ['besoulLeads', 'besoulNotifications', 'besoulReservas', 'besoulSolicitudesEliminacion', 'besoulCancelacionesCliente'];
  const tocadas = overrides.filter(o => colectionesConQueryReal.includes(o.collectionGroup));
  check('ninguna fieldOverride toca una colección que SÍ tiene queries reales', tocadas, []);
  check('todas las fieldOverrides de este archivo son exclusivamente para "besoulSuite"', overrides.every(o => o.collectionGroup === 'besoulSuite'), true);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
