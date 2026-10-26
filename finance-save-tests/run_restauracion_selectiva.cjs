// FIX-FINANZAS-GUARDADO-SEGURO: pruebas de scripts/restaurar-finanzas-selectivo.js contra el emulador,
// como admin y con las reglas del repo. Datos SINTÉTICOS con la forma del incidente del 10-10:
// "origen" = estado bueno; "servidor" = estado vaciado + 2 gastos posteriores legítimos.
//
//   firebase emulators:exec --only firestore --project demo-besoul-restauracion "node finance-save-tests/run_restauracion_selectiva.cjs"
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const NM = path.join(RAIZ, 'rules-tests', 'node_modules');
const { initializeTestEnvironment } = require(path.join(NM, '@firebase/rules-unit-testing'));
const firebaseCompat = require(path.join(NM, 'firebase/compat/app'));
require(path.join(NM, 'firebase/compat/firestore'));
const R = require(path.join(RAIZ, 'scripts', 'restaurar-finanzas-selectivo.js'));

const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
const ADMIN = 'admin@x.com';
let pass = 0, fail = 0; const fallos = [];
function check(desc, ok, detalle = '') { if (ok) pass++; else { fail++; fallos.push(desc); } console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${!ok && detalle ? ' :: ' + detalle : ''}`); }
async function falla(promesa) { try { await promesa; return null; } catch (e) { return e; } }

const centro = (id, extra = {}) => ({ id, nombre: id.toUpperCase(), orden: 1, canonFijo: 0, ptsIncluidos: 0, canonPt: 0, canonPtReducidoDesde: 0, canonPtReducido: 0, activo: true, ...extra });
const GASTOS_ANTIGUOS = { '2026-09': [{ concepto: 'Gestoría', importe: 200 }] };
const ORIGEN = {
  trainerSettings: { pt_a: { sistemaPago: 'rango3', canonFijoIndependiente: 800 }, pt_b: { centroId: 'fantasy' }, pt_c: { computaCanonCentro: false } },
  trainerSettingsVersiones: { pt_a: [{ desde: '2026-09', canonFijoIndependiente: 800 }] },
  centrosVersiones: { inacua: [{ desde: '0000-01', canonFijo: 1233.82, _legacy: true }, { desde: '2026-09', canonFijo: 1200 }] },
  otrosIngresos: { '2026-07': [{ concepto: 'Toalla', importe: 16 }], '2026-08': [{ concepto: 'Ajuste', importe: 25 }] },
  centros: { alfa_prime: centro('alfa_prime', { canonFijo: 300, canonPt: 200 }), inacua: centro('inacua', { canonFijo: 1200, canonPtReducido: 60.5 }), c1: centro('c1', { activo: false }) },
  historico: [{ periodo: 'JUNIO 2026', fact: 6998 }],
  gastos: GASTOS_ANTIGUOS,
};
const SERVIDOR = { // tras el incidente
  trainerSettings: {}, trainerSettingsVersiones: {}, centrosVersiones: {}, otrosIngresos: {}, historico: {}, auditoriaCierres: {},
  centros: { alfa_prime: centro('alfa_prime'), inacua: centro('inacua', { canonFijo: 1200, canonPtReducido: 60 }) },
  gastos: { ...GASTOS_ANTIGUOS, '2026-10': [{ concepto: 'Fantasy', importe: 615.98 }, { concepto: 'Flyers', importe: 400 }] },
  pts: { 'pt-1': { nombre: 'Legado' } },
};
const respaldo = (fin, exportadoEn) => ({ exportadoEn, besoulSuite: { finanzas: JSON.parse(JSON.stringify(fin)) } });
const APROBADAS = ['trainerSettings.pt_a', 'trainerSettings.pt_b', 'trainerSettings.pt_c', 'trainerSettingsVersiones.pt_a', 'centrosVersiones.inacua', 'otrosIngresos.2026-07', 'otrosIngresos.2026-08'];

async function main() {
  const reglasNuevas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
  // Reglas ANTERIORES de Finanzas (las de producción hoy), reconstruidas sustituyendo el bloque nuevo.
  const reglasAnteriores = reglasNuevas
    .replace("      allow read: if isAdmin() && docId == 'finanzas';\n      allow create: if isAdmin() && docId == 'finanzas' && finanzasEscrituraSegura();\n      allow update: if isAdmin() && docId == 'finanzas' && finanzasEscrituraSegura() && finanzasSinVaciado();", "      allow read, write: if isAdmin() && docId == 'finanzas';");
  if (reglasAnteriores.includes('finanzasSinVaciado();')) throw new Error('No se pudieron reconstruir las reglas anteriores');

  for (const [nombreReglas, reglas] of [['reglas NUEVAS', reglasNuevas], ['reglas ANTERIORES', reglasAnteriores]]) {
    console.log(`\n######## ${nombreReglas} ########`);
    const env = await initializeTestEnvironment({ projectId: 'demo-besoul-restauracion-' + (reglas === reglasNuevas ? 'n' : 'a'), firestore: { rules: reglas, host: HOST, port: Number(PORT) } });
    const db = env.authenticatedContext('uid_admin', { email: ADMIN }).firestore();
    const api = R.crear({ firestore: db, FieldValue: firebaseCompat.firestore.FieldValue, FieldPath: firebaseCompat.firestore.FieldPath, actor: ADMIN });
    const sembrar = async () => { await env.clearFirestore(); await env.withSecurityRulesDisabled(async c => { const d = c.firestore(); await d.collection('besoulUsers').doc(ADMIN).set({ rol: 'admin', activo: true, email: ADMIN }); await d.collection('besoulSuite').doc('finanzas').set(SERVIDOR); }); };
    const leer = async () => { let d; await env.withSecurityRulesDisabled(async c => { d = (await c.firestore().collection('besoulSuite').doc('finanzas').get()).data(); }); return d; };
    const sinMeta = d => { const c = { ...d }; delete c.actualizadoEn; delete c.actualizadoPor; return c; };
    const origen = respaldo(ORIGEN, '2026-10-09T12:24:15.113Z'), actualizado = respaldo(SERVIDOR, '2026-10-23T09:00:00.000Z');

    await sembrar();
    const plan = await api.planificar({ origen, actualizado, rutasAprobadas: APROBADAS });
    check('simulación: no escribe nada', R.igual(sinMeta(await leer()), SERVIDOR));
    check('simulación: clasifica rutas (7 restaurables aprobadas, centros con otro valor = requiere_decision)', plan.aEscribir.length === 7 && plan.rutas.find(r => r.ruta === 'centros.alfa_prime').estado === 'requiere_decision' && plan.rutas.find(r => r.ruta === 'centros.c1').estado === 'restaurable', JSON.stringify(plan.porEstado));
    check('simulación: "historico" antiguo va aparte (historicoLegadoRestaurado), nunca a historico', plan.rutas.some(r => r.ruta === 'historicoLegadoRestaurado') && !plan.rutas.some(r => r.campo === 'historico'));
    check('simulación: gastos nunca son candidatos', !plan.rutas.some(r => r.campo === 'gastos'));
    check('simulación: sin cambios desde el respaldo actualizado', Array.isArray(plan.camposCambiadosTrasRespaldo) && plan.camposCambiadosTrasRespaldo.length === 0, JSON.stringify(plan.camposCambiadosTrasRespaldo));

    let e = await falla(api.ejecutar({ plan, confirmacion: 'si', motivo: 'x' }));
    check('ejecutar sin la frase de confirmación: rechazado y sin escrituras', !!e && R.igual(sinMeta(await leer()), SERVIDOR));

    // Cambio en el servidor entre simulación y ejecución -> no se escribe nada.
    await env.withSecurityRulesDisabled(async c => { await c.firestore().collection('besoulSuite').doc('finanzas').update({ 'gastos.2026-10': [{ concepto: 'Fantasy', importe: 615.98 }] }); });
    e = await falla(api.ejecutar({ plan, confirmacion: R.CONFIRMAR, motivo: 'prueba' }));
    check('documento cambiado tras la simulación: rechazado', !!e && /cambiado desde la simulación/.test(e.message), e && e.message);

    await sembrar();
    const plan2 = await api.planificar({ origen, actualizado, rutasAprobadas: [...APROBADAS, 'centros.alfa_prime'] });
    check('ruta aprobada con otro valor en el servidor y sin "sobrescribir": plan bloqueado', plan2.bloqueos.some(b => b.startsWith('centros.alfa_prime')));
    e = await falla(api.ejecutar({ plan: plan2, confirmacion: R.CONFIRMAR, motivo: 'prueba' }));
    check('plan con bloqueos: no se escribe nada', !!e && R.igual(sinMeta(await leer()), SERVIDOR));

    await env.withSecurityRulesDisabled(async c => { await c.firestore().collection('besoulSuite').doc('finanzas').update({ 'trainerSettings.pt_a': { sistemaPago: 'rango1' } }); });
    const plan3 = await api.planificar({ origen, actualizado, rutasAprobadas: APROBADAS });
    check('configuración reintroducida tras el respaldo actualizado: "cambiado_tras_respaldo" y bloqueado', plan3.rutas.find(r => r.ruta === 'trainerSettings.pt_a').estado === 'cambiado_tras_respaldo' && plan3.bloqueos.length > 0);

    await sembrar();
    const plan4 = await api.planificar({ origen, actualizado, rutasAprobadas: [...APROBADAS, 'centros.alfa_prime'], sobrescribir: ['centros.alfa_prime'] });
    const r = await api.ejecutar({ plan: plan4, confirmacion: R.CONFIRMAR, motivo: 'restauración de prueba' });
    let d = await leer();
    check('ejecutar: restaura exactamente las rutas aprobadas', r.rutasEscritas.length === 8 && R.igual(d.trainerSettings, ORIGEN.trainerSettings) && R.igual(d.trainerSettingsVersiones, ORIGEN.trainerSettingsVersiones) && R.igual(d.centrosVersiones, ORIGEN.centrosVersiones) && R.igual(d.otrosIngresos, ORIGEN.otrosIngresos));
    check('ejecutar: centros.alfa_prime sobrescrito (aprobado) y c1 NO (no aprobado)', R.igual(d.centros.alfa_prime, ORIGEN.centros.alfa_prime) && !('c1' in d.centros) && R.igual(d.centros.inacua, SERVIDOR.centros.inacua));
    check('ejecutar: gastos posteriores (octubre) intactos', R.igual(d.gastos, SERVIDOR.gastos));
    check('ejecutar: historico y demás campos intactos', R.igual(d.historico, {}) && R.igual(d.pts, SERVIDOR.pts) && !('historicoLegadoRestaurado' in d));
    const aud = d.auditoriaRestauraciones && d.auditoriaRestauraciones[r.id];
    check('ejecutar: auditoría con motivo, rutas, origen y huella', !!aud && aud.motivo === 'restauración de prueba' && aud.rutas.length === 8 && aud.origen.exportadoEn === '2026-10-09T12:24:15.113Z' && !!aud.huellaAntes);
    const planOtra = await api.planificar({ origen, actualizado: null, rutasAprobadas: APROBADAS });
    check('repetir la simulación tras restaurar: todo "ya_restaurado", nada que escribir', planOtra.aEscribir.length === 0 && planOtra.rutas.filter(x => APROBADAS.includes(x.ruta)).every(x => x.estado === 'ya_restaurado'));

    // Reversión.
    e = await falla(api.revertir({ reversion: r.reversion, confirmacion: 'no', motivo: 'x' }));
    check('revertir sin la frase de confirmación: rechazado', !!e);
    const antesRev = await leer();
    e = await falla(api.revertir({ reversion: r.reversion, confirmacion: R.CONFIRMAR_REVERSION, motivo: 'prueba de reversión' }));
    d = await leer();
    // La reversión no depende de volver a vaciar: solo devuelve su valor anterior a lo SOBRESCRITO
    // (centros.alfa_prime); lo que estaba ausente se mantiene y se lista. Igual con las dos reglas.
    check(`revertir (${nombreReglas}): ok`, !e, e && e.message);
    check('revertir: centros.alfa_prime vuelve a su valor anterior', R.igual(d.centros.alfa_prime, SERVIDOR.centros.alfa_prime));
    check('revertir: las 7 rutas que estaban ausentes se mantienen (nada se vacía)', R.igual(d.trainerSettings, ORIGEN.trainerSettings) && R.igual(d.trainerSettingsVersiones, ORIGEN.trainerSettingsVersiones) && R.igual(d.centrosVersiones, ORIGEN.centrosVersiones) && R.igual(d.otrosIngresos, ORIGEN.otrosIngresos));
    check('revertir: gastos y resto intactos', R.igual(d.gastos, antesRev.gastos) && R.igual(d.pts, antesRev.pts) && R.igual(d.centros.inacua, antesRev.centros.inacua));
    const audRev = d.auditoriaRestauraciones && d.auditoriaRestauraciones['rev_' + r.id];
    check('revertir: auditoría con rutas revertidas y rutas que se mantienen', !!audRev && audRev.rutas.length === 1 && audRev.seMantienen.length === 7 && !!d.auditoriaRestauraciones[r.id]);

    await sembrar();
    const p5 = await api.planificar({ origen, actualizado, rutasAprobadas: APROBADAS });
    const r5 = await api.ejecutar({ plan: p5, confirmacion: R.CONFIRMAR, motivo: 'x' });
    const antes5 = await leer();
    e = await falla(api.revertir({ reversion: r5.reversion, confirmacion: R.CONFIRMAR_REVERSION, motivo: 'x' }));
    check('revertir una restauración que solo rellenó rutas ausentes: nada que revertir, sin escrituras', !!e && /no hay nada que revertir/.test(e.message) && R.igual(await leer(), antes5), e && e.message);

    await sembrar();
    const p6 = await api.planificar({ origen, actualizado, rutasAprobadas: [...APROBADAS, 'centros.alfa_prime'], sobrescribir: ['centros.alfa_prime'] });
    const r6 = await api.ejecutar({ plan: p6, confirmacion: R.CONFIRMAR, motivo: 'x' });
    await env.withSecurityRulesDisabled(async c => { await c.firestore().collection('besoulSuite').doc('finanzas').update({ 'centros.alfa_prime.canonFijo': 333 }); });
    const antes6 = await leer();
    e = await falla(api.revertir({ reversion: r6.reversion, confirmacion: R.CONFIRMAR_REVERSION, motivo: 'x' }));
    check('revertir cuando una ruta sobrescrita se editó después: rechazado sin cambios', !!e && /han cambiado desde la restauración/.test(e.message) && R.igual(await leer(), antes6));

    if (reglas === reglasNuevas) {
      // Con las reglas nuevas, la restauración funciona sobre el estado vaciado real (rellena mapas
      // vacíos), así que las reglas pueden desplegarse ANTES de restaurar.
      await sembrar();
      const p7 = await api.planificar({ origen, actualizado, rutasAprobadas: [...APROBADAS, 'centros.alfa_prime'], sobrescribir: ['centros.alfa_prime'] });
      e = await falla(api.ejecutar({ plan: p7, confirmacion: R.CONFIRMAR, motivo: 'x' }));
      check('reglas NUEVAS: la restauración autorizada se permite sobre el documento vaciado', !e, e && e.message);
      const sinMarca = await falla(db.collection('besoulSuite').doc('finanzas').update({ 'trainerSettings.pt_a': ORIGEN.trainerSettings.pt_a }));
      check('reglas NUEVAS: una escritura sin la marca guardadoSeguroEn (versión antigua / script ajeno) -> DENEGADA', !!sinMarca && /PERMISSION_DENIED|permission/i.test(String(sinMarca.code || sinMarca.message)));
    }
    await env.cleanup();
  }
  console.log(`\nRESULTADO: ${pass} PASS · ${fail} FAIL`);
  if (fail) { console.log('Fallos:\n - ' + fallos.join('\n - ')); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
