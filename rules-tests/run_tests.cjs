// HARDENING-PRE-BASELINE-v3.2.1 -- Section 7/19/20/21 of the hardening brief: pruebas REALES de
// autorizacion contra firestore.rules, usando el Firebase Emulator Suite oficial
// (@firebase/rules-unit-testing). Nunca toca Firestore real: projectId 'demo-besoul-suite' (el
// prefijo demo- fuerza al SDK a modo emulador puro, sin ninguna ruta posible hacia produccion).
//
// Roles cubiertos: ANONIMO, AUTH SIN PERFIL, PT A ACTIVO, PT B ACTIVO, PT INACTIVO, ADMIN,
// CLIENTE PORTAL (token). Cada Rule importante tiene un POSITIVE test y un NEGATIVE test.
//
// Ejecutar (desde la raiz del repo):
//   firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_tests.cjs"

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = 'demo-besoul-suite';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

let pass = 0, fail = 0;
const fails = [];
async function checkOk(desc, promise) {
  try { await assertSucceeds(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc + ' :: ' + e.message); console.log(`FAIL -- ${desc} :: esperaba PERMITIDO, fue DENEGADO (${e.message.split('\n')[0]})`); }
}
async function checkDenied(desc, promise) {
  try { await assertFails(promise); pass++; console.log(`PASS -- ${desc}`); }
  catch (e) { fail++; fails.push(desc + ' :: esperaba DENEGADO, fue PERMITIDO'); console.log(`FAIL -- ${desc} :: esperaba DENEGADO, fue PERMITIDO`); }
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host: '127.0.0.1', port: 8080 },
  });

  // --- Fixture data, escrita SALTANDO las Rules (mecanismo oficial de setup de pruebas, nunca
  // usado para probar comportamiento de la app) ---
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('besoulUsers').doc('pta@x.com').set({ nombre: 'PT A', rol: 'pt', trainerKey: 'pta', activo: true, email: 'pta@x.com' });
    await db.collection('besoulUsers').doc('ptb@x.com').set({ nombre: 'PT B', rol: 'pt', trainerKey: 'ptb', activo: true, email: 'ptb@x.com' });
    await db.collection('besoulUsers').doc('ptinactivo@x.com').set({ nombre: 'PT Inactivo', rol: 'pt', trainerKey: 'ptinactivo', activo: false, email: 'ptinactivo@x.com' });
    await db.collection('besoulUsers').doc('admin@x.com').set({ nombre: 'Admin', rol: 'admin', trainerKey: 'admin', activo: true, email: 'admin@x.com' });

    await db.collection('besoulSuite').doc('agenda').set({
      clientes: { pta: [{ id: 'ca1', nombre: 'Cliente de A' }], ptb: [{ id: 'cb1', nombre: 'Cliente de B' }] },
      agenda: { pta: {}, ptb: {} }, pruebasCRM: { pta: {}, ptb: {} },
      disponibilidadReservas: { pta: {}, ptb: {} }, historicoClientes: { pta: {}, ptb: {} }, notas: {},
    });
    await db.collection('besoulSuite').doc('finanzas').set({ centros: {} });

    await db.collection('besoulLeads').doc('lead1').set({ trainerKey: 'pta', nombre: 'Lead de A', estado: 'Prueba solicitada' });

    await db.collection('besoulPublicClients').doc('res_tokenA00000000000000000000').set({
      trainerKey: 'pta', clientId: 'ca1', clientName: 'Cliente de A', avisosLeidos: [],
    });
    await db.collection('besoulPublicSchedule').doc('pta').set({ trainerName: 'PT A', disponibilidad: {} });

    await db.collection('besoulReservas').doc('reserva1').set({ trainerKey: 'pta', estado: 'pendiente', token: 'res_tokenA00000000000000000000', clientId: 'ca1', fechaISO: '2026-10-01', hora: '09:00', clave: '2026-10-01_09:00', duracionMin: 45 });

    await db.collection('besoulSolicitudesEliminacion').doc('sol1').set({ trainerKey: 'pta', solicitadoPor: 'pta', estado: 'pendiente' });

    await db.collection('besoulNotifications').doc('notif1').set({ audience: 'trainer', trainerKey: 'pta', type: 'info', title: 'x', message: 'x', read: false });
  });

  const anon = testEnv.unauthenticatedContext().firestore();
  const sinPerfil = testEnv.authenticatedContext('uid_sinperfil', { email: 'sinperfil@x.com' }).firestore();
  const ptA = testEnv.authenticatedContext('uid_pta', { email: 'pta@x.com' }).firestore();
  const ptB = testEnv.authenticatedContext('uid_ptb', { email: 'ptb@x.com' }).firestore();
  const ptInactivo = testEnv.authenticatedContext('uid_ptinactivo', { email: 'ptinactivo@x.com' }).firestore();
  const admin = testEnv.authenticatedContext('uid_admin', { email: 'admin@x.com' }).firestore();

  // ============================================================
  console.log('\n=== besoulSuite/agenda ===');
  // ============================================================
  await checkOk('ADMIN lee besoulSuite/agenda', admin.collection('besoulSuite').doc('agenda').get());
  await checkOk('PT A (activo) lee besoulSuite/agenda', ptA.collection('besoulSuite').doc('agenda').get());
  await checkDenied('PT INACTIVO NO puede leer besoulSuite/agenda', ptInactivo.collection('besoulSuite').doc('agenda').get());
  await checkDenied('AUTH SIN PERFIL NO puede leer besoulSuite/agenda', sinPerfil.collection('besoulSuite').doc('agenda').get());
  await checkDenied('ANONIMO NO puede leer besoulSuite/agenda', anon.collection('besoulSuite').doc('agenda').get());
  await checkOk('PT A puede escribir su propia porción (clientes.pta) de besoulSuite/agenda', ptA.collection('besoulSuite').doc('agenda').update({ 'clientes.pta': [{ id: 'ca1', nombre: 'Editado por A' }] }));
  // HARDENING-PRE-BASELINE-v3.2.1 (continuación, FASE 2 activada 2026-09-17): el hallazgo P0 de
  // la auditoría maestra (PT A podía escribir clientes.<otroTrainerKey>) queda cerrado aquí --
  // ya no es un test "informativo", es la aserción de seguridad real. Cobertura exhaustiva por
  // campo/rol en run_fase2_tests.cjs.
  await checkDenied('PT A YA NO puede escribir clientes.ptb (de OTRO PT) -- hallazgo P0 cerrado por FASE 2', ptA.collection('besoulSuite').doc('agenda').update({ 'clientes.ptb': [{ id: 'hackeado', nombre: 'PT A escribió esto' }] }));

  // ============================================================
  console.log('\n=== besoulSuite/finanzas ===');
  // ============================================================
  await checkOk('ADMIN lee/escribe besoulSuite/finanzas', admin.collection('besoulSuite').doc('finanzas').update({ centros: { x: 1 } }));
  await checkDenied('PT A NO puede leer besoulSuite/finanzas', ptA.collection('besoulSuite').doc('finanzas').get());
  await checkDenied('ANONIMO NO puede leer besoulSuite/finanzas', anon.collection('besoulSuite').doc('finanzas').get());

  // ============================================================
  console.log('\n=== besoulUsers ===');
  // ============================================================
  await checkOk('un usuario lee su PROPIO perfil', ptA.collection('besoulUsers').doc('pta@x.com').get());
  await checkDenied('PT A NO puede leer el perfil de PT B', ptA.collection('besoulUsers').doc('ptb@x.com').get());
  await checkOk('ADMIN lee cualquier perfil', admin.collection('besoulUsers').doc('ptb@x.com').get());
  await checkDenied('PT A NO puede escribir/promocionarse a sí mismo (solo admin puede)', ptA.collection('besoulUsers').doc('pta@x.com').update({ rol: 'admin' }));
  await checkOk('ADMIN puede editar cualquier perfil', admin.collection('besoulUsers').doc('pta@x.com').update({ nombre: 'PT A editado' }));

  // ============================================================
  console.log('\n=== besoulLeads ===');
  // ============================================================
  await checkOk('PT A lee sus propios leads (trainerKey=pta)', ptA.collection('besoulLeads').doc('lead1').get());
  await checkDenied('PT B NO puede leer los leads de PT A', ptB.collection('besoulLeads').doc('lead1').get());
  await checkDenied('PT A (activo) NO puede CREAR leads directamente (SEC-04: solo admin o formulario público)', ptA.collection('besoulLeads').doc('lead_nuevo_pt').set({ trainerKey: 'pta', nombre: 'x', estado: 'Prueba solicitada' }));
  await checkOk('ADMIN puede crear leads', admin.collection('besoulLeads').doc('lead_admin').set({ trainerKey: 'pta', nombre: 'x', estado: 'Prueba solicitada' }));
  await checkOk('ANONIMO puede crear un lead público válido (isPublicTrialLead)', anon.collection('besoulLeads').doc('lead_publico').set({
    nombre: 'Juan Público', telefono: '600000000', email: 'juan@x.com', centroId: 'c1', centroNombre: 'Centro 1',
    estado: 'Prueba solicitada', fuente: 'QR valoración', medioCaptacion: '', captadorNombre: '',
    trainerKey: '', trainerName: '', objetivo: '', horarioPreferido: '', tipoPrueba: 'Valoración inicial',
    duracionPrueba: '45 min', notas: '', notaEntrenadorPrueba: '', createdAt: '', updatedAt: '',
    createdByEmail: '', createdByName: '', updatedByEmail: '', updatedByName: '', convertido: false,
    origenPublico: 'valoracion.html', origenQR: true, sourceParam: '', campana: '', valoracionUnica: false, leadId: '',
  }));
  await checkDenied('ANONIMO NO puede crear un lead con forma inválida (p.ej. estado manipulado)', anon.collection('besoulLeads').doc('lead_publico_malo').set({
    nombre: 'x', telefono: 'x', email: 'x', centroId: 'x', centroNombre: 'x',
    estado: 'Convertido a cliente', fuente: 'QR valoración', trainerKey: '', trainerName: '',
    tipoPrueba: 'Valoración inicial', duracionPrueba: '45 min', convertido: false,
    origenPublico: 'valoracion.html', origenQR: true,
  }));

  // ============================================================
  console.log('\n=== besoulPublicClients (Portal cliente, capability token) ===');
  // ============================================================
  const TOKEN_A = 'res_tokenA00000000000000000000';
  await checkOk('CUALQUIERA (anónimo) puede leer una ficha pública por su token exacto', anon.collection('besoulPublicClients').doc(TOKEN_A).get());
  await checkDenied('CLIENTE (portal) NO puede LISTAR besoulPublicClients (list:false, sin poder enumerar)', anon.collection('besoulPublicClients').limit(1).get());
  await checkOk('un GET a un token inventado/manipulado no está bloqueado por permisos (get:true), pero no existe -- confirma que no hay forma de distinguir "denegado" de "no existe" (mitigado por la entropía del token, no por la Rule)', (async () => {
    const snap = await anon.collection('besoulPublicClients').doc('res_tokenManipuladoInventado0000').get();
    if (snap.exists) throw new Error('un token inventado NO debería coincidir con ningún documento real');
  })());
  await checkOk('PT A puede crear su propio besoulPublicClients (trainerKey=pta)', ptA.collection('besoulPublicClients').doc('res_nuevoTokenDeA0000000000000').set({ trainerKey: 'pta', clientId: 'nuevo', clientName: 'x' }));
  await checkDenied('PT A NO puede crear un besoulPublicClients a nombre de OTRO trainerKey', ptA.collection('besoulPublicClients').doc('res_tokenFalsoDeB000000000000').set({ trainerKey: 'ptb', clientId: 'x', clientName: 'x' }));
  await checkOk('QA 2026-09-17: ADMIN SÍ puede crear un besoulPublicClients a nombre de OTRO trainerKey (viendo-como ese PT, publicando un cliente nuevo)', admin.collection('besoulPublicClients').doc('res_tokenCreadoPorAdmin00000000').set({ trainerKey: 'ptb', clientId: 'nuevo', clientName: 'x' }));
  await checkOk('CLIENTE (portal, sin auth) puede actualizar SOLO avisosLeidos de su propia ficha', anon.collection('besoulPublicClients').doc(TOKEN_A).update({ avisosLeidos: ['aviso1'] }));
  await checkDenied('CLIENTE (portal, sin auth) NO puede tocar ningún otro campo (p.ej. sesionesContratadas)', anon.collection('besoulPublicClients').doc(TOKEN_A).update({ sesionesContratadas: 999 }));

  // ============================================================
  console.log('\n=== besoulPublicSchedule ===');
  // ============================================================
  await checkOk('ANONIMO puede leer el horario público de un PT (doc ID = trainerKey)', anon.collection('besoulPublicSchedule').doc('pta').get());
  await checkOk('PT A puede publicar/actualizar su propio horario', ptA.collection('besoulPublicSchedule').doc('pta').set({ trainerName: 'PT A', disponibilidad: {} }));
  await checkDenied('ANONIMO NO puede escribir el horario público de nadie', anon.collection('besoulPublicSchedule').doc('pta').set({ trainerName: 'hackeado' }));

  // ============================================================
  console.log('\n=== besoulReservas ===');
  // ============================================================
  await checkOk('PT A lee sus propias reservas', ptA.collection('besoulReservas').doc('reserva1').get());
  await checkDenied('PT B NO puede leer las reservas de PT A', ptB.collection('besoulReservas').doc('reserva1').get());
  await checkOk('CLIENTE (portal, con token A real) puede crear una reserva coherente con su propio token/clientId/trainerKey', anon.collection('besoulReservas').doc('reserva_nueva_de_A').set({
    estado: 'pendiente', token: TOKEN_A, clientId: 'ca1', trainerKey: 'pta', fechaISO: '2026-10-02', hora: '10:00', clave: '2026-10-02_10:00', duracionMin: 45,
  }));
  await checkDenied('CLIENTE (portal) NO puede crear una reserva SUPLANTANDO a otro clientId con el mismo token', anon.collection('besoulReservas').doc('reserva_suplantada').set({
    estado: 'pendiente', token: TOKEN_A, clientId: 'OTRO_CLIENTE_QUE_NO_ES_ca1', trainerKey: 'pta', fechaISO: '2026-10-03', hora: '11:00', clave: '2026-10-03_11:00', duracionMin: 45,
  }));
  await checkDenied('CLIENTE (portal) NO puede crear una reserva con un token que no existe', anon.collection('besoulReservas').doc('reserva_token_falso').set({
    estado: 'pendiente', token: 'res_tokenQueNoExiste00000000000', clientId: 'x', trainerKey: 'pta', fechaISO: '2026-10-04', hora: '12:00', clave: '2026-10-04_12:00', duracionMin: 45,
  }));

  // ============================================================
  console.log('\n=== besoulSolicitudesEliminacion ===');
  // ============================================================
  await checkOk('PT A lee sus propias solicitudes de eliminación', ptA.collection('besoulSolicitudesEliminacion').doc('sol1').get());
  await checkDenied('PT B NO puede leer las solicitudes de PT A', ptB.collection('besoulSolicitudesEliminacion').doc('sol1').get());
  await checkOk('PT A puede crear una solicitud para sí mismo', ptA.collection('besoulSolicitudesEliminacion').doc('sol_nueva_de_a').set({ trainerKey: 'pta', solicitadoPor: 'pta', estado: 'pendiente' }));
  await checkDenied('PT A NO puede crear una solicitud a nombre de OTRO trainerKey', ptA.collection('besoulSolicitudesEliminacion').doc('sol_falsa').set({ trainerKey: 'ptb', solicitadoPor: 'pta', estado: 'pendiente' }));
  await checkOk('ADMIN puede resolver (aprobar) una solicitud pendiente, solo tocando los campos permitidos', admin.collection('besoulSolicitudesEliminacion').doc('sol1').update({ estado: 'aprobada', revisadoPor: 'admin@x.com', revisadoEn: new Date().toISOString() }));
  await checkDenied('PT A NO puede resolver/aprobar solicitudes (solo admin)', ptA.collection('besoulSolicitudesEliminacion').doc('sol1').update({ estado: 'rechazada' }));
  await checkDenied('nadie puede BORRAR una solicitud (se conservan como auditoría)', admin.collection('besoulSolicitudesEliminacion').doc('sol1').delete());

  // ============================================================
  console.log('\n=== besoulNotifications ===');
  // ============================================================
  await checkOk('PT A lee sus propias notificaciones (audience:trainer, trainerKey:pta)', ptA.collection('besoulNotifications').doc('notif1').get());
  await checkDenied('PT B NO puede leer las notificaciones de PT A', ptB.collection('besoulNotifications').doc('notif1').get());
  await checkOk('un usuario activo puede crear una notificación dirigida a OTRO trainerKey (diseño deliberado)', ptA.collection('besoulNotifications').doc('notif_de_a_para_b').set({ audience: 'trainer', trainerKey: 'ptb', type: 'info', title: 'x', message: 'x', read: false }));
  await checkOk('el destinatario real puede marcarla leída (whitelist read/readAt)', ptA.collection('besoulNotifications').doc('notif1').update({ read: true, readAt: new Date().toISOString() }));
  await checkDenied('nadie puede reescribir el CONTENIDO de una notificación ya creada', ptA.collection('besoulNotifications').doc('notif1').update({ message: 'contenido reescrito' }));
  await checkDenied('CLIENTE (portal, sin auth) NO puede acceder a besoulNotifications (incompatible arquitectónicamente)', anon.collection('besoulNotifications').doc('notif1').get());

  // ============================================================
  console.log('\n=== besoulCancelacionesCliente (propuesta, NO desplegada -- catch-all deny) ===');
  // ============================================================
  await checkDenied('sin Rule desplegada, CUALQUIER intento (incluso admin) cae en el catch-all deny-all', admin.collection('besoulCancelacionesCliente').doc('c1').set({ trainerKey: 'pta' }));
  await checkDenied('...tampoco un cliente con token puede crear una', anon.collection('besoulCancelacionesCliente').doc('c2').set({ token: TOKEN_A }));

  // ============================================================
  console.log('\n=== Catch-all: cualquier colección no listada, deny-all para todos ===');
  // ============================================================
  await checkDenied('ADMIN tampoco tiene acceso a una colección inventada/no listada', admin.collection('coleccionQueNoExisteEnLasRules').doc('x').get());

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); }

  await testEnv.cleanup();
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
