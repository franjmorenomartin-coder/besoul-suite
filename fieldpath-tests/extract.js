// FIELDPATH-P0: extrae VERBATIM los dos writers de besoulSuite/agenda que tenían el mismo hallazgo
// que agenda.html (claves de punto interpretadas como ruta anidada real) pero sin corregir --
// mismo patrón de brace-matching que el resto de la suite.
const fs = require('fs');
const path = require('path');

function extractBalanced(html, startIndex, openChar, closeChar) {
  let i = html.indexOf(openChar, startIndex);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === openChar) depth++;
    else if (html[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  return i;
}
function extractFunction(html, name) {
  const re = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  const end = extractBalanced(html, m.index, '{', '}');
  return html.slice(m.index, end);
}

const finanzasHtml = fs.readFileSync(path.join(__dirname, '..', 'finanzas.html'), 'utf8');
const crmHtml = fs.readFileSync(path.join(__dirname, '..', 'crm.html'), 'utf8');

const finanzasParts = ['payloadParaUpdateFirestoreFinanzas', 'guardarCatalogoActividadesNube'].map(n => extractFunction(finanzasHtml, n));
fs.writeFileSync(path.join(__dirname, 'finanzas_fieldpath_extract.js'), finanzasParts.join('\n\n'));

const crmParts = [
  'ahoraISO', 'claveAgendaDesdeFechaPrueba', 'formatoHoraAgendaDesdeMinutos', 'formatoFechaAgendaLocalDesdeDate',
  'debeVersePruebaEnAgenda', 'objetoPruebaAgendaCRM', 'sincronizarPruebaAgendaDesdeLead',
].map(n => extractFunction(crmHtml, n));
fs.writeFileSync(path.join(__dirname, 'crm_fieldpath_extract.js'), crmParts.join('\n\n'));

console.log('OK, bloques extraidos: finanzas=' + finanzasParts.length + ' crm=' + crmParts.length);
