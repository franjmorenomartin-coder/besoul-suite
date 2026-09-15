// Extrae funciones/consts individuales de agenda.html por nombre, usando conteo de llaves --
// evita arrastrar código de inicialización ajeno (window/localStorage a nivel superior) que un
// simple recorte de rango de líneas sí arrastraría.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');

function extractFunction(name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  const start = m.index;
  let i = html.indexOf('{', start);
  let depth = 0;
  const bodyStart = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

function extractConst(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const ${name}`);
  const start = m.index;
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // Bono 8 se deriva del Bono 10 en 2 statements sueltos justo después de esta const (PLAN-01) --
  // se buscan literalmente en vez de asumir que están pegados sin comentarios/blancos de por medio.
  const derivaciones = [...html.matchAll(/TARIFAS_2026\["[^"]+"\]\s*=\s*\{[^}]*\};/g)].map(x => x[0]).join('\n');
  return html.slice(start, i) + '\n' + derivaciones;
}

const names = [
  'sesionesContratadasFicha', 'buscarFichaPorId', 'fichaBaseParaContador', 'tarifaBaseFicha',
  'multiplicadorFacturacionFicha', 'normalizarPorcentajeDescuento', 'formatoPorcentajeDescuento',
  'obtenerDescuentoFicha', 'aplicarDescuentoImporte', 'esGrupoAbierto', 'esFichaMiembroGrupo',
  'importeEfectivoCliente', 'fichasMiembrosGrupo', 'calcularFacturacionGrupoTotal',
  'calcularFacturacionBaseSinDescuento', 'calcularFacturacionEstadisticaMiembro',
  'calcularFacturacionFicha'
];

const parts = [extractConst('TARIFAS_2026'), ...names.map(extractFunction)];
fs.writeFileSync(path.join(__dirname, 'finance_extract.js'), parts.join('\n\n'));
console.log('OK, funciones extraídas:', names.length + 1);
