// ARQ-V1-MIGRACION-IMPL — sesiones dañadas por actualizarNombreEnAgendaSiCambia() (corregido en
// 89b31e1): cada guardado de ficha sustituía las sesiones del entrenador por el objeto de la ficha.
// Compara DOS respaldos (anterior y posterior) y clasifica cada sesión presente en ambos:
//   RECUPERABLE_CON_CERTEZA  la única diferencia es la pérdida de campos propios de la sesión
//                            (duración, recurrencia, cancelación, origen de reserva, avisos...):
//                            se restauran exactamente los valores del respaldo anterior.
//   REVISION_MANUAL          cambiaron condiciones económicas de una sesión ANTERIOR al respaldo
//                            antiguo (posible reescritura con la tarifa actual): se propone el valor
//                            del respaldo anterior, pero puede haber sido una corrección legítima.
//   SIN_ACCION               solo cambió el contacto (nombre/teléfono/email, propagación prevista) o
//                            reaparecieron los 5 campos de portal/contrato (redundantes).
// Solo LEE dos archivos locales y escribe el informe y la propuesta FUERA del repositorio.
//   node scripts/informe-sesiones-danadas.cjs <respaldo_anterior.json> <respaldo_posterior.json> <carpeta_salida>
'use strict';
const fs = require('fs');
const path = require('path');
const [, , rutaA, rutaB, salida] = process.argv;
if (!rutaA || !rutaB || !salida) { console.error('Uso: node scripts/informe-sesiones-danadas.cjs <anterior.json> <posterior.json> <carpeta_salida_fuera_del_repo>'); process.exit(2); }
if (path.resolve(salida).startsWith(path.resolve(__dirname, '..'))) { console.error('La salida contiene datos de clientes: debe estar FUERA del repositorio.'); process.exit(2); }
const agendaDe = ruta => { const j = JSON.parse(fs.readFileSync(ruta, 'utf8')); return (j.besoulSuite || {}).agenda || j; };
const A = agendaDe(rutaA), B = agendaDe(rutaB);
const fechaA = (JSON.parse(fs.readFileSync(rutaA, 'utf8')).exportadoEn || '').slice(0, 10);

const PROPIOS = ['duracionMin', 'recurrente', 'serieRecurrenteId', 'recurrenteCreadaEn', 'recurrenteOrigen', 'estadoCancelacion', 'canceladaEn', 'origenReservaCliente', 'solicitudReservaId', 'avisosPortal', 'asistentesGrupoAbierto', 'tipoCita', 'esPruebaCRM', 'noSumaFacturacion', 'recuperacionNoFacturable', 'noFacturable'];
const ECONOMICOS = ['integrantesObj', 'modalidad', 'modalidadId', 'descuentoPct', 'factor', 'tipoCompra', 'planSesiones', 'tipoFacturacion', 'numPersonas', 'segmentoId', 'actividadEspecialId', 'precio', 'tarifa', 'fechaCompra'];
const CONTACTO = ['nombre', 'telefono', 'email'];
const PORTAL = ['contratoCliente', 'restriccionesReservas', 'reservaToken', 'reservasBloqueadasTexto', 'reservasOnlineActivas'];
const igual = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const informe = { anterior: path.basename(rutaA), posterior: path.basename(rutaB), totales: {}, porEntrenador: {} };
const propuesta = { certeza: [], revisionManual: [] };
let comparadas = 0;
Object.keys(A.agenda || {}).forEach(tk => Object.keys(A.agenda[tk] || {}).forEach(clave => {
  const a = A.agenda[tk][clave], b = ((B.agenda || {})[tk] || {})[clave];
  if (!a || !b || a.id !== b.id) return; // movida, borrada o reasignada: no es este daño
  comparadas++;
  const perdidos = PROPIOS.filter(k => k in a && !(k in b));
  const cambiadosPropios = PROPIOS.filter(k => k in a && k in b && !igual(a[k], b[k]));
  const economicos = ECONOMICOS.filter(k => !igual(a[k], b[k]));
  const contacto = CONTACTO.filter(k => !igual(a[k], b[k]));
  const otros = Object.keys({ ...a, ...b }).filter(k => ![...PROPIOS, ...ECONOMICOS, ...CONTACTO, ...PORTAL].includes(k) && !igual(a[k], b[k]));
  const anterior = clave.slice(0, 10) < fechaA;
  const fila = { trainerKey: tk, clave };
  let clase = 'SIN_ACCION';
  if (perdidos.length) { clase = 'RECUPERABLE_CON_CERTEZA'; propuesta.certeza.push({ ...fila, restaurar: Object.fromEntries(perdidos.map(k => [k, a[k]])) }); }
  if (economicos.length && anterior) { clase = clase === 'SIN_ACCION' ? 'REVISION_MANUAL' : `${clase}+REVISION_MANUAL`; propuesta.revisionManual.push({ ...fila, campos: economicos, valorAnterior: Object.fromEntries(economicos.map(k => [k, a[k]])), valorActual: Object.fromEntries(economicos.map(k => [k, b[k]])) }); }
  if (cambiadosPropios.length || otros.length) { clase += '+OTROS_CAMBIOS'; }
  informe.totales[clase] = (informe.totales[clase] || 0) + 1;
  const t = informe.porEntrenador[tk] = informe.porEntrenador[tk] || {};
  t[clase] = (t[clase] || 0) + 1;
}));
informe.totales.sesionesComparadas = comparadas;
informe.camposPerdidosRecuperables = propuesta.certeza.reduce((m, x) => { Object.keys(x.restaurar).forEach(k => { m[k] = (m[k] || 0) + 1; }); return m; }, {});
informe.camposEconomicosARevisar = propuesta.revisionManual.reduce((m, x) => { x.campos.forEach(k => { m[k] = (m[k] || 0) + 1; }); return m; }, {});
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(salida, 'informe-sesiones-danadas.json'), JSON.stringify(informe, null, 2));
fs.writeFileSync(path.join(salida, 'propuesta-recuperacion.json'), JSON.stringify(propuesta, null, 2));
console.log(JSON.stringify({ totales: informe.totales, camposPerdidosRecuperables: informe.camposPerdidosRecuperables, camposEconomicosARevisar: informe.camposEconomicosARevisar, sesionesConCerteza: propuesta.certeza.length, sesionesRevisionManual: propuesta.revisionManual.length }, null, 1));
console.log(`Informe y propuesta (con datos de clientes) en: ${salida}`);
