// AI-09/B21 (revisado tras auditoría): extracción automática por nombre con conteo de
// delimitadores balanceados -- ya NO es una copia manual (el hallazgo de la auditoría fue
// exactamente que "assistant_extract.js" se llamaba a sí mismo "extracción" pero era una copia a
// mano sin ningún mecanismo real de sincronización). Mismo patrón que finance-tests/extract.js.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');

function extractBalanced(startIndex, openChar, closeChar) {
  let i = html.indexOf(openChar, startIndex);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === openChar) depth++;
    else if (html[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  return i;
}

function extractFunction(name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  const end = extractBalanced(m.index, '{', '}');
  return html.slice(m.index, end);
}

function extractTarifas2026() {
  const re = /const\s+TARIFAS_2026\s*=\s*\{/;
  const m = re.exec(html);
  if (!m) throw new Error('No se encontró TARIFAS_2026');
  const end = extractBalanced(m.index, '{', '}');
  const derivaciones = [...html.matchAll(/TARIFAS_2026\["[^"]+"\]\s*=\s*\{[^}]*\};/g)].map(x => x[0]).join('\n');
  return html.slice(m.index, end) + ';\n' + derivaciones;
}

function extractConst(name, openChar, closeChar) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\${openChar}`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const ${name}`);
  const end = extractBalanced(m.index, openChar, closeChar);
  return html.slice(m.index, end) + ';';
}

const parts = [
  extractTarifas2026(),
  extractConst('CENTROS_BESOUL_INFO', '[', ']'),
  extractConst('CAPACIDADES_PT', '[', ']'),
  extractFunction('normalizarTextoAsistente'),
  extractConst('LEMAS_VERBOS_ASISTENTE', '{', '}'),
  extractFunction('lematizarPalabra'),
  extractFunction('distanciaEdicionAcotada'),
  extractFunction('palabraCoincideFuzzy'),
  extractFunction('buscarCapacidadPT'),
  extractFunction('respuestaCapacidadPT'),
  extractFunction('respuestaAmbiguaPT'),
  extractFunction('respuestaCalculoAsistente'),
  extractFunction('respuestaDiagnosticoHueco'),
  extractFunction('respuestaAyudaAsistente')
];

fs.writeFileSync(path.join(__dirname, 'assistant_extract.js'), parts.join('\n\n'));
console.log('OK, bloques extraídos:', parts.length);
