// CENTER-CATALOG-CAPUCHINOS: extrae DEFAULT_CENTROS + economiaCentroConfigurada() de
// finanzas.html/dashboard.html y CENTROS_FALLBACK de crm.html, verbatim, para confirmar que
// anadir Capuchinos no altera los centros existentes y que la economia pendiente se detecta bien.
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
function extractConst(html, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\{`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró const ${name}`);
  const end = extractBalanced(html, m.index, '{', '}');
  return html.slice(m.index, end) + ';';
}
function extractFn(html, name) {
  const re = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = re.exec(html);
  if (!m) throw new Error(`No se encontró function ${name}`);
  const end = extractBalanced(html, m.index, '{', '}');
  return html.slice(m.index, end);
}

const finanzasHtml = fs.readFileSync(path.join(__dirname, '..', 'finanzas.html'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const crmHtml = fs.readFileSync(path.join(__dirname, '..', 'crm.html'), 'utf8');

fs.writeFileSync(path.join(__dirname, 'centros_finanzas_extract.js'), [
  extractConst(finanzasHtml, 'DEFAULT_CENTROS'),
  extractFn(finanzasHtml, 'economiaCentroConfigurada')
].join('\n\n'));

fs.writeFileSync(path.join(__dirname, 'centros_dashboard_extract.js'), [
  extractConst(dashboardHtml, 'DEFAULT_CENTROS'),
  extractFn(dashboardHtml, 'economiaCentroConfigurada')
].join('\n\n'));

fs.writeFileSync(path.join(__dirname, 'centros_crm_extract.js'), [
  extractConst(crmHtml, 'CENTROS_FALLBACK')
].join('\n\n'));

console.log('OK, catalogos de centros extraidos (finanzas/dashboard/crm).');
