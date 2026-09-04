// SEC-AGENDA-WRITE-ISOLATION -- pruebas reales contra el emulador de Firestore, no inspección
// visual. Ejecutado con `firebase emulators:exec` (arranca el emulador, corre esto, lo apaga).
import { readFileSync } from 'fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc, setDoc, deleteField } from 'firebase/firestore';

const PROJECT_ID = 'besoul-rules-test';

const SEED_AGENDA = {
  clientes: { ptA: [{ id: 'c1', nombre: 'Cliente de PT A' }], ptB: [{ id: 'c2', nombre: 'Cliente de PT B' }] },
  agenda: { ptA: { '2026-09-10_10:00': { id: 'c1', nombre: 'Cliente de PT A' } }, ptB: { '2026-09-10_11:00': { id: 'c2', nombre: 'Cliente de PT B' } } },
  disponibilidadReservas: { ptA: { lunes: [] }, ptB: { lunes: [] } },
  historicoClientes: { ptA: {}, ptB: {} },
  pruebasCRM: { ptA: {}, ptB: {} },
  notas: { 'ptA__2026-09-10_10:00': 'nota de A' },
  actualizadoEn: new Date(),
  ultimaActualizacionLocal: new Date().toISOString(),
};

let testEnv;
let results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${name}${detail ? ' :: ' + detail : ''}`);
}

async function run() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('./firestore.rules.candidate', 'utf8'),
      host: '127.0.0.1',
      port: 8089,
    },
  });

  // Seed: perfiles besoulUsers + documento besoulSuite/agenda inicial, sin pasar por Rules.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'besoulUsers', 'pta@test.com'), { activo: true, rol: 'pt', trainerKey: 'ptA' });
    await setDoc(doc(db, 'besoulUsers', 'ptb@test.com'), { activo: true, rol: 'pt', trainerKey: 'ptB' });
    await setDoc(doc(db, 'besoulUsers', 'inactivo@test.com'), { activo: false, rol: 'pt', trainerKey: 'ptA' });
    await setDoc(doc(db, 'besoulUsers', 'admin@test.com'), { activo: true, rol: 'admin', trainerKey: 'admin' });
    // sinperfil@test.com deliberadamente SIN documento en besoulUsers.
    await setDoc(doc(db, 'besoulSuite', 'agenda'), SEED_AGENDA);
    await setDoc(doc(db, 'besoulSuite', 'finanzas'), { canonFijo: 300 });
  });

  const ptA = testEnv.authenticatedContext('uidA', { email: 'pta@test.com' }).firestore();
  const ptB = testEnv.authenticatedContext('uidB', { email: 'ptb@test.com' }).firestore();
  const inactivo = testEnv.authenticatedContext('uidInactivo', { email: 'inactivo@test.com' }).firestore();
  const sinPerfil = testEnv.authenticatedContext('uidSinPerfil', { email: 'sinperfil@test.com' }).firestore();
  const admin = testEnv.authenticatedContext('uidAdmin', { email: 'admin@test.com' }).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();

  const agendaPathFor = (db) => doc(db, 'besoulSuite', 'agenda');

  // ---- PT A: lectura completa del documento monolítico (sigue permitida, arquitectura sin migrar) ----
  try {
    await assertSucceeds(getDoc(agendaPathFor(ptA)));
    record('PT A puede leer Agenda (monolítica, sin migrar)', true);
  } catch (e) { record('PT A puede leer Agenda (monolítica, sin migrar)', false, e.message); }

  // ---- PT A: escritura legítima sobre su propia rama, campo por campo ----
  const camposPropios = [
    ['clientes.ptA', [{ id: 'c1', nombre: 'Cliente de PT A (editado)' }]],
    ['agenda.ptA', { '2026-09-10_10:00': { id: 'c1', nombre: 'Cliente de PT A (editado)' } }],
    ['disponibilidadReservas.ptA', { lunes: [{ desde: '09:00', hasta: '13:00' }] }],
    ['historicoClientes.ptA', { '2026-08': { c1: { sesiones: 4 } } }],
    ['pruebasCRM.ptA', { '2026-09-11_09:00': { id: 'lead1' } }],
  ];
  for (const [campo, valor] of camposPropios) {
    try {
      await assertSucceeds(updateDoc(agendaPathFor(ptA), { [campo]: valor, actualizadoEn: new Date(), ultimaActualizacionLocal: new Date().toISOString() }));
      record(`PT A puede modificar ${campo}`, true);
    } catch (e) { record(`PT A puede modificar ${campo}`, false, e.message); }
  }

  // ---- PT A: escritura NO legítima sobre la rama de PT B ----
  const camposAjenos = [
    ['clientes.ptB', [{ id: 'c2', nombre: 'HACKEADO' }]],
    ['agenda.ptB', { '2026-09-10_11:00': { id: 'c2', nombre: 'HACKEADO' } }],
    ['disponibilidadReservas.ptB', { lunes: [{ desde: '00:00', hasta: '23:59' }] }],
    ['historicoClientes.ptB', { '2026-08': {} }],
    ['pruebasCRM.ptB', { '2026-09-11_09:00': { id: 'leadX' } }],
  ];
  for (const [campo, valor] of camposAjenos) {
    try {
      await assertFails(updateDoc(agendaPathFor(ptA), { [campo]: valor, actualizadoEn: new Date(), ultimaActualizacionLocal: new Date().toISOString() }));
      record(`PT A NO puede modificar ${campo} (de PT B)`, true);
    } catch (e) { record(`PT A NO puede modificar ${campo} (de PT B)`, false, e.message); }
  }

  // ---- Escritura múltiple legítima (simula guardarEstadoNubeAgenda(): varios campos propios a la vez) ----
  try {
    await assertSucceeds(updateDoc(agendaPathFor(ptA), {
      'clientes.ptA': [{ id: 'c1', nombre: 'Multi-campo OK' }],
      'agenda.ptA': { '2026-09-12_10:00': { id: 'c1' } },
      actualizadoEn: new Date(),
      ultimaActualizacionLocal: new Date().toISOString(),
    }));
    record('PT A puede escribir varios campos propios a la vez (guardarEstadoNubeAgenda real)', true);
  } catch (e) { record('PT A puede escribir varios campos propios a la vez (guardarEstadoNubeAgenda real)', false, e.message); }

  // ---- Escritura múltiple donde UNO de los campos toca a otro trainer -> debe fallar entera ----
  try {
    await assertFails(updateDoc(agendaPathFor(ptA), {
      'clientes.ptA': [{ id: 'c1', nombre: 'Mezcla' }],
      'agenda.ptB': { '2026-09-13_10:00': { id: 'c2' } }, // <- ajeno, cuela dentro del mismo update
      actualizadoEn: new Date(),
    }));
    record('Update mixto (propio + ajeno) falla ENTERO, no parcialmente', true);
  } catch (e) { record('Update mixto (propio + ajeno) falla ENTERO, no parcialmente', false, e.message); }

  // ---- notas: PT A puede escribir CUALQUIER clave, incluida una que no es suya (riesgo residual confirmado) ----
  try {
    await assertSucceeds(updateDoc(agendaPathFor(ptA), { 'notas.ptB__2026-09-10_11:00': 'nota escrita por PT A sobre una cita de PT B' }));
    record('notas: PT A SÍ puede escribir una clave de notas de OTRO trainer (riesgo residual confirmado, no mitigado por FASE 2)', true);
  } catch (e) { record('notas: PT A SÍ puede escribir una clave de notas de OTRO trainer (riesgo residual confirmado, no mitigado por FASE 2)', false, 'INESPERADO: ' + e.message); }

  // ---- Usuario autenticado SIN perfil en besoulUsers -> DENY ----
  try {
    await assertFails(getDoc(agendaPathFor(sinPerfil)));
    record('Usuario Auth sin perfil besoulUsers: lectura DENEGADA', true);
  } catch (e) { record('Usuario Auth sin perfil besoulUsers: lectura DENEGADA', false, e.message); }
  try {
    await assertFails(updateDoc(agendaPathFor(sinPerfil), { 'clientes.ptA': [] }));
    record('Usuario Auth sin perfil besoulUsers: escritura DENEGADA', true);
  } catch (e) { record('Usuario Auth sin perfil besoulUsers: escritura DENEGADA', false, e.message); }

  // ---- Usuario activo:false -> DENY ----
  try {
    await assertFails(getDoc(agendaPathFor(inactivo)));
    record('Usuario activo:false: lectura DENEGADA', true);
  } catch (e) { record('Usuario activo:false: lectura DENEGADA', false, e.message); }
  try {
    await assertFails(updateDoc(agendaPathFor(inactivo), { 'clientes.ptA': [] }));
    record('Usuario activo:false: escritura DENEGADA', true);
  } catch (e) { record('Usuario activo:false: escritura DENEGADA', false, e.message); }

  // ---- No autenticado -> DENY ----
  try {
    await assertFails(getDoc(agendaPathFor(anon)));
    record('No autenticado: lectura DENEGADA', true);
  } catch (e) { record('No autenticado: lectura DENEGADA', false, e.message); }

  // ---- ADMIN: mantiene operaciones legítimas, incluidas las que cruzan varios trainerKeys ----
  try {
    await assertSucceeds(getDoc(agendaPathFor(admin)));
    record('ADMIN puede leer Agenda', true);
  } catch (e) { record('ADMIN puede leer Agenda', false, e.message); }
  try {
    // Simula sincronizarPruebaAgendaDesdeLead()/convertirLeadEnCliente() (crm.html): un solo
    // write que toca clientes.ptA Y agenda.ptB a la vez -- solo el admin puede hacer esto.
    await assertSucceeds(updateDoc(agendaPathFor(admin), {
      'clientes.ptA': [{ id: 'c1', nombre: 'Tocado por admin' }],
      'agenda.ptB': { '2026-09-14_10:00': { id: 'c2' } },
      actualizadoEn: new Date(),
      ultimaActualizacionLocal: new Date().toISOString(),
    }));
    record('ADMIN puede escribir cruzando varios trainerKeys en un mismo update (crm.html real)', true);
  } catch (e) { record('ADMIN puede escribir cruzando varios trainerKeys en un mismo update (crm.html real)', false, e.message); }
  try {
    // Simula guardarCatalogoActividadesNube() (finanzas.html): campos NO listados en la
    // whitelist de FASE 2 en absoluto (catalogoActividades/trainerActividades/etc.) -- deben
    // seguir funcionando para admin porque isAdmin() bypasa el chequeo entero, no por estar
    // en la whitelist.
    await assertSucceeds(updateDoc(agendaPathFor(admin), { 'catalogoActividades.pilates': { nombre: 'Pilates', precio: 40 } }));
    record('ADMIN puede escribir catalogoActividades.* (finanzas.html real, campo fuera de la whitelist de FASE 2)', true);
  } catch (e) { record('ADMIN puede escribir catalogoActividades.* (finanzas.html real, campo fuera de la whitelist de FASE 2)', false, e.message); }

  // ---- PT (no admin) intentando tocar un campo fuera de la whitelist -> debe fallar ----
  try {
    await assertFails(updateDoc(agendaPathFor(ptA), { 'catalogoActividades.pilates': { nombre: 'Pilates hackeado', precio: 1 } }));
    record('PT A NO puede escribir catalogoActividades.* (fuera de la whitelist de FASE 2 para no-admin)', true);
  } catch (e) { record('PT A NO puede escribir catalogoActividades.* (fuera de la whitelist de FASE 2 para no-admin)', false, e.message); }

  // ================== FASE 9: los otros 4 candidatos del ruleset (evaluación, no solo Agenda) ==================

  // ---- besoulLeads (SEC-04): PT ya NO puede crear/editar leads; admin sí; formulario público sí ----
  try {
    await assertFails(setDoc(doc(ptA, 'besoulLeads', 'leadX'), { trainerKey: 'ptA', nombre: 'Intento PT', estado: 'Nuevo' }));
    record('besoulLeads: PT A NO puede crear un lead propio (SEC-04)', true);
  } catch (e) { record('besoulLeads: PT A NO puede crear un lead propio (SEC-04)', false, e.message); }
  try {
    await assertSucceeds(setDoc(doc(admin, 'besoulLeads', 'leadAdmin'), { trainerKey: 'ptA', nombre: 'Creado por admin', estado: 'Nuevo' }));
    record('besoulLeads: ADMIN puede crear un lead', true);
  } catch (e) { record('besoulLeads: ADMIN puede crear un lead', false, e.message); }
  try {
    await assertSucceeds(setDoc(doc(anon, 'besoulLeads', 'leadPublico'), { trainerKey: '', nombre: 'Prueba publica', estado: 'Prueba solicitada', fuente: 'QR valoración' }));
    record('besoulLeads: formulario público (sin auth) SÍ puede crear un lead de prueba', true);
  } catch (e) { record('besoulLeads: formulario público (sin auth) SÍ puede crear un lead de prueba', false, e.message); }
  try {
    await assertFails(updateDoc(doc(ptA, 'besoulLeads', 'leadAdmin'), { nombre: 'Editado por PT' }));
    record('besoulLeads: PT A NO puede editar un lead existente (ni siquiera de su propio trainerKey)', true);
  } catch (e) { record('besoulLeads: PT A NO puede editar un lead existente (ni siquiera de su propio trainerKey)', false, e.message); }

  // ---- besoulPublicClients (SEC-04/SEC-05): ownership real por trainerKey ----
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'besoulPublicClients', 'res_tokenA'), { token: 'res_tokenA', trainerKey: 'ptA', clientId: 'c1', activo: true });
  });
  try {
    await assertSucceeds(updateDoc(doc(ptA, 'besoulPublicClients', 'res_tokenA'), { activo: false }));
    record('besoulPublicClients: PT A puede revocar (activo:false) el token de SU PROPIO cliente', true);
  } catch (e) { record('besoulPublicClients: PT A puede revocar (activo:false) el token de SU PROPIO cliente', false, e.message); }
  try {
    await assertFails(updateDoc(doc(ptB, 'besoulPublicClients', 'res_tokenA'), { activo: false }));
    record('besoulPublicClients: PT B NO puede tocar el token de un cliente de PT A', true);
  } catch (e) { record('besoulPublicClients: PT B NO puede tocar el token de un cliente de PT A', false, e.message); }
  try {
    await assertSucceeds(updateDoc(doc(admin, 'besoulPublicClients', 'res_tokenA'), { activo: false }));
    record('besoulPublicClients: ADMIN puede tocar el token de cualquier cliente', true);
  } catch (e) { record('besoulPublicClients: ADMIN puede tocar el token de cualquier cliente', false, e.message); }

  // ---- besoulReservas.create (auditoría 2026-09-02): cross-check real token/clientId/trainerKey ----
  try {
    await assertSucceeds(setDoc(doc(anon, 'besoulReservas', 'res1'), {
      estado: 'pendiente', token: 'res_tokenA', clientId: 'c1', trainerKey: 'ptA', duracionMin: 45,
    }));
    record('besoulReservas: reserva con token/clientId/trainerKey COINCIDENTES se acepta', true);
  } catch (e) { record('besoulReservas: reserva con token/clientId/trainerKey COINCIDENTES se acepta', false, e.message); }
  try {
    await assertFails(setDoc(doc(anon, 'besoulReservas', 'res2'), {
      estado: 'pendiente', token: 'res_tokenA', clientId: 'c-OTRO-CLIENTE', trainerKey: 'ptA', duracionMin: 45,
    }));
    record('besoulReservas: clientId que NO coincide con el token real -> DENEGADO (suplantación)', true);
  } catch (e) { record('besoulReservas: clientId que NO coincide con el token real -> DENEGADO (suplantación)', false, e.message); }

  await testEnv.cleanup();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pruebas OK.`);
  if (failed.length) {
    console.log('\nFALLOS:');
    failed.forEach(f => console.log(` - ${f.name}: ${f.detail}`));
    process.exitCode = 1;
  }
}

run().catch(err => { console.error('ERROR FATAL EN LAS PRUEBAS:', err); process.exitCode = 1; });
