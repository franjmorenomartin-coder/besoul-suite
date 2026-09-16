// FINANZAS-UX-V2: pruebas deterministas del selector dinámico de centro + panel de avisos
// colapsable, extraídos VERBATIM de finanzas.html (finanzas_ux_extract.js, brace-matching
// automático). Ningún test aquí toca Firestore ni cambia ninguna fórmula económica -- son
// puramente de presentación/estado local (localStorage simulado en memoria).
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'finanzas_ux_extract.js'), 'utf8');

// localStorage en memoria -- nunca toca disco/navegador real, y aisla cada test.
function crearLocalStorageFalso() {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store
  };
}

function crearDOMFalso() {
  const elementos = {};
  const el = id => {
    if (!elementos[id]) {
      elementos[id] = {
        _html: '', _hidden: false, _text: '',
        set innerHTML(v) { this._html = v; },
        get innerHTML() { return this._html; },
        set textContent(v) { this._text = v; },
        get textContent() { return this._text; },
        classList: { toggle(cls, force) { /* no-op suficiente para estos tests */ } }
      };
    }
    return elementos[id];
  };
  return { getElementById: el, _elementos: elementos };
}

function nuevoSandbox() {
  const localStorage = crearLocalStorageFalso();
  const document = crearDOMFalso();
  // renderAlertasCarrera() en sí (con todas sus dependencias de negocio: perfilesUsuarios,
  // dbFinanzas, fechaAltaSettings...) no forma parte de este archivo -- se cubre aparte. Aquí solo
  // se necesita que exista como no-op para que toggleAvisosCarrera()/ocultarAvisoCarrera() (que sí
  // se prueban de verdad) puedan invocarla sin reventar por referencia indefinida.
  const stub = 'function renderAlertasCarrera(){}\n';
  const fn = new Function('localStorage', 'document', stub + extracted + `
    return {
      set centroSeleccionadoFinanzas(v) { centroSeleccionadoFinanzas = v; },
      get centroSeleccionadoFinanzas() { return centroSeleccionadoFinanzas; },
      set calculoActual(v) { calculoActual = v; },
      economiaCentroConfigurada, renderSelectorCentrosFinanzas, renderComparativaCentrosFinanzas,
      renderCentrosResumen, seleccionarCentroFinanzas, avisosCarreraColapsado,
      setAvisosCarreraColapsado, avisosCarreraOcultosSet, setAvisosCarreraOcultosSet,
      toggleAvisosCarrera, ocultarAvisoCarrera, ocultarTodosAvisosCarrera,
      restaurarAvisosCarreraOcultos, dinero, numero, escapeHTML
    };`);
  const M = fn(localStorage, document);
  return { M, document, localStorage };
}

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// ============================================================
console.log('=== Selector dinámico de centro: "Todos" + un botón por centro real ===');
// ============================================================
{
  const { M, document } = nuevoSandbox();
  const centros = [
    { id: 'alfa_prime', nombre: 'Alfa Prime', economiaConfigurada: undefined },
    { id: 'inacua', nombre: 'Inacua', economiaConfigurada: undefined },
    { id: 'capuchinos', nombre: 'Capuchinos', economiaConfigurada: false },
  ];
  M.renderSelectorCentrosFinanzas(centros);
  const html = document.getElementById('centros-selector').innerHTML;
  check('el selector incluye "Todos"', html.includes('>Todos<') || html.includes('>Todos ') , true);
  check('el selector incluye Alfa Prime', html.includes('Alfa Prime'), true);
  check('el selector incluye Inacua', html.includes('Inacua'), true);
  check('el selector incluye Capuchinos', html.includes('Capuchinos'), true);
  check('Capuchinos (economía pendiente) lleva marca de aviso ⚠ en su botón', /Capuchinos\s*⚠/.test(html), true);
  check('Alfa Prime NO lleva marca de aviso (economía configurada por defecto)', /Alfa Prime\s*⚠/.test(html), false);
  check('cada pill llama a seleccionarCentroFinanzas con su propio id', html.includes("seleccionarCentroFinanzas('alfa_prime')") && html.includes("seleccionarCentroFinanzas('capuchinos')") && html.includes("seleccionarCentroFinanzas('todos')"), true);
}

// ============================================================
console.log('\n=== "Todos" = comparativa compacta con TODOS los centros (no tarjetas gigantes apiladas) ===');
// ============================================================
{
  const { M } = nuevoSandbox();
  const centros = [
    { id: 'alfa_prime', nombre: 'Alfa Prime', clientes: 12, facturacion: 1000, ptNeto: 500, bsBruto: 500, canon: 100, economiaConfigurada: undefined },
    { id: 'capuchinos', nombre: 'Capuchinos', clientes: 3, facturacion: 200, ptNeto: 100, bsBruto: 100, canon: 0, economiaConfigurada: false },
  ];
  const html = M.renderComparativaCentrosFinanzas(centros);
  check('la comparativa muestra Alfa Prime', html.includes('Alfa Prime'), true);
  check('la comparativa muestra Capuchinos', html.includes('Capuchinos'), true);
  check('Alfa Prime (configurado) muestra su neto real (500-100=400,00 €)', html.includes('400,00'), true);
  check('Capuchinos (NO configurado) muestra "Pendiente", no una cifra inventada', /Capuchinos[\s\S]*?Pendiente/.test(html), true);
  check('la comparativa nunca inventa un neto para Capuchinos (100-0=100,00 no debe atribuirse a él como neto)', /Capuchinos[\s\S]{0,400}?100,00\s*€<\/b>/.test(html), false);
}

// ============================================================
console.log('\n=== renderCentrosResumen(): "todos" pinta comparativa; un id concreto pinta SOLO ese centro a ancho completo ===');
// ============================================================
{
  const { M, document } = nuevoSandbox();
  const calculoActual = {
    centros: {
      alfa_prime: { id: 'alfa_prime', nombre: 'Alfa Prime', trainers: [], clientes: 5, facturacion: 300, ptNeto: 150, bsBruto: 150, canon: 0, economiaConfigurada: undefined },
      capuchinos: { id: 'capuchinos', nombre: 'Capuchinos', trainers: [], clientes: 1, facturacion: 80, ptNeto: 40, bsBruto: 40, canon: 0, economiaConfigurada: false },
    }
  };
  M.calculoActual = calculoActual;

  M.centroSeleccionadoFinanzas = 'todos';
  M.renderCentrosResumen();
  const htmlTodos = document.getElementById('centros-resumen').innerHTML;
  check('"todos": aparecen ambos centros en la comparativa', htmlTodos.includes('Alfa Prime') && htmlTodos.includes('Capuchinos'), true);

  M.centroSeleccionadoFinanzas = 'capuchinos';
  M.renderCentrosResumen();
  const htmlCapuchinos = document.getElementById('centros-resumen').innerHTML;
  check('centro="capuchinos": SOLO aparece Capuchinos (detalle completo)', htmlCapuchinos.includes('Capuchinos'), true);
  check('centro="capuchinos": Alfa Prime NO aparece en el detalle de Capuchinos', htmlCapuchinos.includes('Alfa Prime'), false);
  check('centro="capuchinos": muestra el aviso de economía pendiente en el detalle completo', htmlCapuchinos.includes('Economía pendiente de configurar'), true);

  M.centroSeleccionadoFinanzas = 'un_id_que_ya_no_existe';
  M.renderCentrosResumen();
  check('id de centro obsoleto/inexistente cae de vuelta a "todos" en vez de pintar vacío', M.centroSeleccionadoFinanzas, 'todos');
}

// ============================================================
console.log('\n=== Panel de avisos: colapso/ocultar es local (localStorage), nunca toca Firestore ===');
// ============================================================
{
  const { M, localStorage } = nuevoSandbox();
  check('por defecto el panel empieza colapsado', M.avisosCarreraColapsado(), true);
  M.toggleAvisosCarrera();
  check('toggle expande el panel', M.avisosCarreraColapsado(), false);
  M.toggleAvisosCarrera();
  check('toggle vuelve a colapsar', M.avisosCarreraColapsado(), true);

  check('ningún aviso oculto al inicio', [...M.avisosCarreraOcultosSet()], []);
  M.ocultarAvisoCarrera('carmen_sin_fecha');
  check('ocultar un aviso concreto lo añade al set de ocultos', [...M.avisosCarreraOcultosSet()], ['carmen_sin_fecha']);
  M.ocultarAvisoCarrera('carmen_r2_activo');
  check('ocultar un segundo aviso no pierde el primero', [...M.avisosCarreraOcultosSet()].sort(), ['carmen_r2_activo', 'carmen_sin_fecha']);
  M.restaurarAvisosCarreraOcultos();
  check('"restaurar ocultos" vacía el set por completo', [...M.avisosCarreraOcultosSet()], []);

  check('el estado se guarda literalmente en localStorage (no solo en memoria del proceso)', JSON.parse(localStorage.getItem('bs_finanzas_avisos_ocultos') || '[]'), []);
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
