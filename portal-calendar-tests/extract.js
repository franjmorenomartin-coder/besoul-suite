// PORTAL-MONTHLY-CALENDAR: extrae VERBATIM las dos funciones con lógica real del calendario
// mensual -- una de agenda.html (qué sesiones se publican) y una de portal-cliente.html (qué
// estado/color le corresponde a un día), mismo patrón de brace-matching que el resto de la suite.
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

const agendaHtml = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');
const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-cliente.html'), 'utf8');

const agendaParts = ['calendarioSesionesClienteParaPortal', 'formatoFechaLocal'].map(n => extractFunction(agendaHtml, n));
fs.writeFileSync(path.join(__dirname, 'agenda_calendar_extract.js'), agendaParts.join('\n\n'));

const portalParts = ['dateISO', 'dayIndexMonSun', 'estadoDiaCalendarioMensual', 'badgeEstadoSesion'].map(n => extractFunction(portalHtml, n));
fs.writeFileSync(path.join(__dirname, 'portal_calendar_extract.js'), portalParts.join('\n\n'));

console.log('OK, bloques extraidos: agenda=' + agendaParts.length + ' portal=' + portalParts.length);
