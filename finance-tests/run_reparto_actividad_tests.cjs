// QA-BESOUL-MEGA-V3-CONT: regresión del ejemplo pedido explícitamente por el usuario --
// "Verónica / Alfa Prime / Pilates Máquina, 8 sesiones, 95€ -> 47,50 € PT / 33,25 € centro /
// 14,25 € BESOUL, sin restar dos veces el centro" -- contra el motor REAL extraído verbatim de
// finanzas.html (reparto_actividad_extract.js). Sin datos reales, sin Firestore.
const fs = require('fs');
const path = require('path');

const extracted = fs.readFileSync(path.join(__dirname, 'reparto_actividad_extract.js'), 'utf8');

// agendaData: solo se lee catalogoActividadesVivo()/tarifasActividadVersiones/
// repartoActividadVersiones -- vacío = "sin overrides", el catálogo por defecto
// (DEFAULT_CATALOGO_ACTIVIDADES, el mismo que vive en producción) manda tal cual.
const agendaData = { catalogoActividades: {}, tarifasActividadVersiones: {}, repartoActividadVersiones: {} };
// sesionesAgendadasFacturablesFichaMes() alimenta solo el campo informativo "sesionesAgendadas"
// (nunca el importe) para modalidades no-bono -- no está extraída aquí (depende de dbAgenda) y no
// afecta a ninguna de las cifras que este archivo verifica (total/reparto), así que se stubea.
const fn = new Function('agendaData', 'sesionesAgendadasFacturablesFichaMes', extracted + `
  return { DEFAULT_CATALOGO_ACTIVIDADES, distribuirReparto, validarSumaReparto, repartoEfectivoActividad, calcularFacturacionActividadFicha };
`);
const M = fn(agendaData, () => 0);

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// ============================================================
console.log('=== Ejemplo Verónica / Alfa Prime / Pilates Máquina: 8 sesiones, 95€ ===');
// ============================================================
{
  const reparto = M.DEFAULT_CATALOGO_ACTIVIDADES.pilates_maquina.reparto;
  check('el reparto real del catálogo suma 100% (50/35/15)', M.validarSumaReparto(reparto.partes), true);

  // Ficha real de cliente de actividad especial: Pilates Máquina, plan general, 8 sesiones.
  const ficha = { actividadEspecialId: 'pilates_maquina', modalidadId: 'plan', segmentoId: 'general', planSesiones: 8, numPersonas: 1 };
  const calc = M.calcularFacturacionActividadFicha(ficha, 'veronica', '2026-09', 'alfa_prime');
  check('el plan de 8 sesiones (general) vale 95€ en el catálogo real, no un importe inventado', calc.total, 95);
  check('el tipo se resuelve como actividad_mensual (plan, no bono)', calc.tipo, 'actividad_mensual');

  const partesEfectivas = M.repartoEfectivoActividad('pilates_maquina', '2026-09').partes;
  const split = M.distribuirReparto(calc.total, partesEfectivas);
  check('PT recibe 47,50 € (50% de 95€)', split.entrenador, 47.5);
  check('el centro recibe 33,25 € (35% de 95€)', split.centro, 33.25);
  check('BESOUL recibe 14,25 € (15% de 95€)', split.besoul, 14.25);
  check('la suma de las 3 partes es EXACTAMENTE el total (ni un céntimo de diferencia)', split.entrenador + split.centro + split.besoul, 95);

  // "Sin restar dos veces el centro": el importe que le corresponde al centro (33,25€) es
  // información aparte (ingresosActividades, ver finanzas.html) y NUNCA se resta también del
  // share de BESOUL -- lo único que compone bsBrutoTotal es split.besoul (14,25€), no
  // calc.total - split.centro (que sería 61,75€, una resta indebida).
  check('el share de BESOUL nunca resulta de restarle el centro al total (no hay doble resta)', split.besoul, calc.total - split.entrenador - split.centro);
  check('el share de BESOUL NO es calc.total menos el share del centro (esa sería la resta duplicada)', split.besoul === calc.total - split.centro, false);
}

// ============================================================
console.log('\n=== distribuirReparto(): método del mayor resto -- la suma nunca se desvía por redondeo ===');
// ============================================================
{
  // Un importe/; porcentajes que SÍ generan resto (85€ a 50/35/15 -> 42.5/29.75/12.75, todos
  // exactos aquí, así que se fuerza un caso con resto real: 10€ a 33/33/34).
  const split = M.distribuirReparto(10, [{ destino: 'a', pct: 33 }, { destino: 'b', pct: 33 }, { destino: 'c', pct: 34 }]);
  check('la suma de las partes es EXACTAMENTE el importe original pese al redondeo (33/33/34 de 10€)', split.a + split.b + split.c, 10);
}

// ============================================================
console.log('\n=== Otros centros/plantillas del catálogo real no se alteran por este ejemplo ===');
// ============================================================
{
  const cicloReparto = M.DEFAULT_CATALOGO_ACTIVIDADES.ciclo_indoor.reparto;
  check('Ciclo Indoor conserva su propio reparto 50/35/15 (no heredó nada de Pilates)', cicloReparto.partes.map(p => p.pct), [50, 35, 15]);
  check('Ciclo Indoor sigue asociado a alfa_prime (catálogo real, sin cambios)', M.DEFAULT_CATALOGO_ACTIVIDADES.ciclo_indoor.centroId, 'alfa_prime');
}

console.log(`\n${pass}/${pass + fail} pruebas OK.`);
if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
