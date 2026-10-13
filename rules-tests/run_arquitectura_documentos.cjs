// ARQ-V1-MIGRACION-IMPL — batería de integración de la nueva arquitectura contra el Firebase
// Emulator, con el SDK real de Firestore y las reglas REALES del repositorio (nunca reglas
// simplificadas: todas las escrituras de prueba pasan por firestore.rules, también las de admin).
//
//   firebase emulators:exec --only firestore --project demo-besoul-suite \
//     "node rules-tests/run_arquitectura_documentos.cjs <respaldo.json>"
//
// El respaldo real solo se carga en el emulador local (nunca sale del equipo ni se escribe en el
// repositorio). La salida solo contiene recuentos, rutas y PASS/FAIL, nunca datos de clientes.
//
// Bloques: A migración real + verificación desde el servidor · B reglas/permisos · C guardados y
// concurrencia con la fusión REAL de agenda.html · D sincronización incremental y consumo medido.
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app').default;
require('firebase/compat/firestore');
const D = require('../besoul-datos.js');

const PROJECT_ID = 'demo-besoul-suite';
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
const RESPALDO = process.argv[2];
const { Timestamp, FieldValue } = firebase.firestore;

let pass = 0, fail = 0; const fallos = [];
function check(desc, ok, detalle) { ok ? pass++ : (fail++, fallos.push(desc)); console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc}${ok || detalle === undefined ? '' : ` :: ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`}`); }
async function permitido(desc, p) { try { await assertSucceeds(p); check(desc, true); } catch (e) { check(desc, false, `DENEGADO: ${String(e.message).split('\n')[0]}`); } }
async function denegado(desc, p) { try { await assertFails(p); check(desc, true); } catch (e) { check(desc, false, 'PERMITIDO'); } }
const espera = ms => new Promise(r => setTimeout(r, ms));

// --- funciones REALES de agenda.html (fusión, limpieza de copias, bloques de 15 min) ---
const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');
function extraer(nombre) {
  const m = new RegExp(`function\\s+${nombre}\\s*\\(`).exec(html); if (!m) throw new Error(nombre);
  const re = /\)\s*\{/g; re.lastIndex = m.index; let i = re.exec(html).index, p = 0;
  for (; i < html.length; i++) { if (html[i] === '{') p++; else if (html[i] === '}' && --p === 0) { i++; break; } }
  return html.slice(m.index, i);
}
const constante = n => new RegExp(`const\\s+${n}\\s*=\\s*[^;]+;`).exec(html)[0];
const agendaFn = new Function(
  [constante('BS_CAMPOS_AGENDA_POR_TRAINER'), constante('BS_DISP_SUBMAPAS'), constante('BS_DISP_METADATOS'), constante('BS_CAMPOS_FICHA_NO_SESION'),
    ...['esObjetoPlanoAgenda', 'quitarCopiasFichaDeSesiones', 'elementosCampoAgenda', 'recomponerCampoAgenda', 'valorVacioCampoAgenda', 'fusionarCampoTresVias',
      'canonicalizarValorDiagnostico', 'igualdadCanonica', 'clavesBloqueSesion', 'minutosDesdeHorario', 'claveDesdeFechaYMinutos', 'formatoMinutosHorario'].map(extraer),
    'return { fusionarCampoTresVias, quitarCopiasFichaDeSesiones, clavesBloqueSesion };'].join('\n'))();

// Respaldo exportado desde el navegador: {__ts: ISO} -> Timestamp real.
function revivir(v) {
  if (Array.isArray(v)) return v.map(revivir);
  if (v && typeof v === 'object') {
    if (Object.keys(v).length === 1 && typeof v.__ts === 'string') return Timestamp.fromDate(new Date(v.__ts));
    const o = {}; Object.keys(v).forEach(k => { o[k] = revivir(v[k]); }); return o;
  }
  return v;
}

// Contador de consumo propio por "usuario" para medir cada operación.
function medir() { return D.crearContador(); }

async function main() {
  const testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: HOST, port: Number(PORT) } });
  await testEnv.clearFirestore();
  const respaldo = RESPALDO ? JSON.parse(fs.readFileSync(RESPALDO, 'utf8')) : null;
  const agendaReal = respaldo ? revivir(respaldo.besoulSuite.agenda) : null;
  const perfiles = { 'admin@x.com': { rol: 'admin', trainerKey: 'admin', activo: true }, 'pta@x.com': { rol: 'pt', trainerKey: 'pta', activo: true }, 'ptb@x.com': { rol: 'pt', trainerKey: 'ptb', activo: true }, 'inactivo@x.com': { rol: 'pt', trainerKey: 'pta', activo: false } };
  const trainersReales = agendaReal ? Object.keys(agendaReal.agenda || {}).filter(t => Object.keys(agendaReal.agenda[t] || {}).length).slice(0, 3) : [];
  trainersReales.forEach((t, i) => { perfiles[`real${i}@x.com`] = { rol: 'pt', trainerKey: t, activo: true }; });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [email, p] of Object.entries(perfiles)) await db.collection('besoulUsers').doc(email).set({ ...p, email, nombre: email });
    if (agendaReal) await db.collection('besoulSuite').doc('agenda').set(agendaReal);
    await db.collection('besoulSuite').doc('finanzas').set({ centros: {} });
  });
  const como = email => testEnv.authenticatedContext(email.replace(/[^a-z0-9]/gi, '_'), { email }).firestore();
  const admin = como('admin@x.com'), pta = como('pta@x.com'), ptb = como('ptb@x.com'), inactivo = como('inactivo@x.com');
  const anonimo = testEnv.unauthenticatedContext().firestore();
  const consumoTabla = [];

  // ============================================================== A. MIGRACIÓN REAL
  if (agendaReal) {
    console.log('\n=== A. Migración del respaldo real (reglas reales, sesión de admin) ===');
    const original = (await admin.collection('besoulSuite').doc('agenda').get()).data();
    const { docs, noTransformable } = D.docsDesdeLegado(original);
    check('A1 todo el contenido es transformable', noTransformable.length === 0, noTransformable.slice(0, 5));
    const t0 = Date.now();
    for (let i = 0; i < docs.length; i += 50) {
      const b = admin.batch();
      docs.slice(i, i + 50).forEach(d => b.set(admin.collection(D.COL[d.col]).doc(d.id), { ...d.data, rev: 1, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: 'migracion:test' }));
      try { await b.commit(); } catch (e) {
        for (const d of docs.slice(i, i + 50)) {
          try { await admin.collection(D.COL[d.col]).doc(d.id).set({ ...d.data, rev: 1, actualizadoEn: FieldValue.serverTimestamp(), actualizadoPor: 'migracion:test' }); }
          catch (e2) { throw new Error(`Migración rechazada en ${d.col} (${e2.code})`); }
        }
      }
    }
    const msMigracion = Date.now() - t0;
    check(`A2 migración escrita por admin con las reglas reales (${docs.length} documentos, ${msMigracion} ms)`, true);
    const leidos = {};
    for (const col of ['semanas', 'clientes', 'trainers', 'historico', 'notas', 'legado', 'config']) {
      const s = await admin.collection(D.COL[col]).get(); leidos[col] = {}; s.docs.forEach(d => { leidos[col][d.id] = d.data(); });
    }
    const reconstruido = D.legadoDesdeDocs(leidos);
    const difs = D.diferencias(original, reconstruido, '', [], 20);
    check('A3 verificación DESDE EL SERVIDOR: documento original == reconstruido desde los documentos nuevos', difs.length === 0, difs);
    const tot = Object.values(leidos).reduce((a, c) => a + Object.keys(c).length, 0);
    check('A4 número de documentos en el servidor == generados', tot === docs.length, `${tot} vs ${docs.length}`);
    // Idempotencia: reintentar la creación de un documento ya migrado es rechazado por reglas (rev 1 ya existe).
    const d0 = docs.find(d => d.col === 'clientes');
    await denegado('A5 re-migrar sin control no puede sobrescribir (rev=1 sobre documento existente denegado)', admin.collection(D.COL.clientes).doc(d0.id).set({ ...d0.data, rev: 1, actualizadoEn: FieldValue.serverTimestamp() }));
    // Documento antiguo congelado.
    await denegado('A6 besoulSuite/agenda congelado: admin no puede escribir', admin.collection('besoulSuite').doc('agenda').update({ ultimaActualizacionLocal: 'x' }));
    await denegado('A7 besoulSuite/agenda congelado: un PT (app antigua) no puede escribir', como('real0@x.com').collection('besoulSuite').doc('agenda').update({ [`agenda.${trainersReales[0]}`]: {} }));
    await denegado('A8 besoulSuite/agenda: un PT ya no puede leer el documento con todos los clientes', como('real0@x.com').collection('besoulSuite').doc('agenda').get());
    await permitido('A9 besoulSuite/agenda: admin puede leerlo (respaldo de solo lectura)', admin.collection('besoulSuite').doc('agenda').get());

    // PT real: solo sus documentos, y todos los suyos.
    const tkReal = trainersReales[0];
    const ptReal = como('real0@x.com');
    const c = medir();
    let datosPT = null;
    const sinc = D.crearSincronizador({ firestore: ptReal, Timestamp, alcance: { trainerKey: tkReal }, cache: D.cacheMemoria(), claveCache: 'x', contador: c, onDatos: (d, m) => { if (m.desdeServidor) datosPT = d; }, onError: (e, col) => console.log('  [sync PT real] error', col, e.code, String(e.message).slice(0, 160)) });
    await sinc.iniciar();
    for (let i = 0; i < 100 && !datosPT; i++) await espera(100);
    sinc.parar();
    check('A10 un PT real sincroniza su agenda completa (sesiones idénticas al original)', datosPT && D.igual(datosPT.agenda[tkReal], original.agenda[tkReal]));
    check('A11 ...sus fichas idénticas al original', datosPT && D.igual(datosPT.clientes[tkReal] || [], original.clientes[tkReal] || []));
    check('A12 ...y NO recibe datos de ningún otro entrenador', datosPT && Object.keys(datosPT.agenda).every(t => t === tkReal) && Object.keys(datosPT.clientes).every(t => t === tkReal));
    await denegado('A13 un PT real no puede consultar las semanas de otro entrenador', ptReal.collection(D.COL.semanas).where('trainerKey', '==', trainersReales[1]).get());
    await denegado('A14 un PT real no puede consultar todas las fichas sin filtrar por su entrenador', ptReal.collection(D.COL.clientes).get());
    consumoTabla.push({ operacion: `Abrir Agenda PT real (primera vez en el dispositivo, ${tkReal.replace(/[aeiou]/g, '*')})`, lecturas: c.lecturas, escrituras: c.escrituras });
  }

  // ============================================================== B. REGLAS
  console.log('\n=== B. Reglas y permisos (datos sintéticos) ===');
  const lunes = '2026-10-12';
  const semana = (tk, extra) => ({ ...D.contenidoSemana(tk, lunes, { sesiones: { [`${lunes}_10:00`]: { id: `c_${tk}`, nombre: 'X', duracionMin: 45 } } }), rev: 1, actualizadoEn: FieldValue.serverTimestamp(), ...(extra || {}) });
  await permitido('B1 PT crea su semana (rev 1, hora del servidor)', pta.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).set(semana('pta')));
  await denegado('B2 PT no puede crear la semana de otro entrenador', pta.collection(D.COL.semanas).doc(D.idSemana('ptb', lunes)).set(semana('ptb')));
  await denegado('B3 id de documento incoherente con trainerKey/semana denegado', pta.collection(D.COL.semanas).doc(D.idSemana('pta', '2026-10-19')).set(semana('pta')));
  await denegado('B4 creación sin hora del servidor denegada', pta.collection(D.COL.semanas).doc(D.idSemana('pta', '2026-10-26')).set({ ...D.contenidoSemana('pta', '2026-10-26', {}), rev: 1, actualizadoEn: Timestamp.now() }));
  await denegado('B5 actualización con rev=1 (versión de creación) denegada', pta.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).set(semana('pta', { rev: 1 })));
  await permitido('B6 actualización con rev+1 permitida', pta.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).set(semana('pta', { rev: 2 })));
  await denegado('B7 PT no puede cambiar el trainerKey de su documento', pta.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).set(semana('ptb', { rev: 3, semana: lunes })));
  await denegado('B8 nadie puede borrar documentos (ni admin): lápidas', admin.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).delete());
  await denegado('B9 PT no puede leer la semana de otro PT', ptb.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).get());
  await permitido('B10 admin lee cualquier semana', admin.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).get());
  await denegado('B11 usuario inactivo no lee', inactivo.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).get());
  await denegado('B12 anónimo no lee', anonimo.collection(D.COL.semanas).doc(D.idSemana('pta', lunes)).get());
  const ficha = (tk, id, rev, extra) => ({ ...D.contenidoCliente(tk, { id, nombre: 'Cliente', telefono: '6', email: 'c@x' }, 0), rev, actualizadoEn: FieldValue.serverTimestamp(), ...(extra || {}) });
  await permitido('B13 PT crea su ficha', pta.collection(D.COL.clientes).doc('cA1').set(ficha('pta', 'cA1', 1)));
  await denegado('B14 PT no puede crear una ficha para otro entrenador', pta.collection(D.COL.clientes).doc('cB1').set(ficha('ptb', 'cB1', 1)));
  await denegado('B15 PT no puede traspasar su ficha a otro entrenador', pta.collection(D.COL.clientes).doc('cA1').set(ficha('ptb', 'cA1', 2)));
  await permitido('B16 admin sí puede traspasar una ficha (rev+1)', admin.collection(D.COL.clientes).doc('cA1').set(ficha('ptb', 'cA1', 2)));
  await denegado('B17 tras el traspaso, el PT anterior ya no la lee', pta.collection(D.COL.clientes).doc('cA1').get());
  await permitido('B18 PT crea su documento de entrenador (sin actividades)', pta.collection(D.COL.trainers).doc('pta').set({ trainerKey: 'pta', disponibilidad: { semanal: {} }, actividades: null, rev: 1, actualizadoEn: FieldValue.serverTimestamp() }));
  await denegado('B19 PT no puede autoasignarse actividades (solo admin desde Finanzas)', pta.collection(D.COL.trainers).doc('pta').set({ trainerKey: 'pta', disponibilidad: { semanal: {} }, actividades: ['pilates'], rev: 2, actualizadoEn: FieldValue.serverTimestamp() }));
  await permitido('B20 admin asigna actividades a un PT', admin.collection(D.COL.trainers).doc('pta').set({ trainerKey: 'pta', disponibilidad: { semanal: {} }, actividades: ['pilates'], rev: 2, actualizadoEn: FieldValue.serverTimestamp() }));
  await permitido('B21 PT cambia su disponibilidad sin tocar actividades', pta.collection(D.COL.trainers).doc('pta').set({ trainerKey: 'pta', disponibilidad: { semanal: { 1: { activo: true } } }, actividades: ['pilates'], rev: 3, actualizadoEn: FieldValue.serverTimestamp() }));
  await denegado('B22 PT no lee la configuración de otro entrenador', ptb.collection(D.COL.trainers).doc('pta').get());
  await permitido('B23 PT crea su nota', pta.collection(D.COL.notas).doc(`pta__${lunes}_10:00`).set({ ...D.contenidoNota(`pta__${lunes}_10:00`, 'nota'), rev: 1, actualizadoEn: FieldValue.serverTimestamp() }));
  await denegado('B24 PT no puede escribir la nota de otro PT (antes posible con el mapa plano)', ptb.collection(D.COL.notas).doc(`pta__${lunes}_10:00`).set({ ...D.contenidoNota(`pta__${lunes}_10:00`, 'otra'), rev: 2, actualizadoEn: FieldValue.serverTimestamp() }));
  await permitido('B25 PT lee la configuración global de actividades', (async () => { await testEnv.withSecurityRulesDisabled(async ctx => ctx.firestore().collection(D.COL.config).doc('global').set({ campos: {}, rev: 1, actualizadoEn: Timestamp.now() })); return pta.collection(D.COL.config).doc('global').get(); })());
  await denegado('B26 PT no puede cambiar la configuración global', pta.collection(D.COL.config).doc('global').set({ campos: { catalogoActividades: {} }, rev: 2, actualizadoEn: FieldValue.serverTimestamp() }));
  await denegado('B27 PT no lee los campos raíz heredados (solo admin)', pta.collection(D.COL.legado).doc('raiz').get());
  await permitido('B28 PT publica SU horario público', pta.collection('besoulPublicSchedule').doc('pta').set({ trainerKey: 'pta' }));
  await denegado('B29 PT ya no puede sobrescribir el horario público de otro entrenador', pta.collection('besoulPublicSchedule').doc('ptb').set({ trainerKey: 'ptb' }));
  await permitido('B30 el portal (anónimo) sigue leyendo el horario público', anonimo.collection('besoulPublicSchedule').doc('pta').get());
  await permitido('B31 PT puede leer (para crearla) una semana suya que aún no existe', pta.collection(D.COL.semanas).doc(D.idSemana('pta', '2030-01-07')).get());
  await denegado('B32 PT no puede sondear una semana inexistente de otro entrenador', pta.collection(D.COL.semanas).doc(D.idSemana('ptb', '2030-01-07')).get());
  await denegado('B33 PT no puede sondear el documento inexistente de otro entrenador', pta.collection(D.COL.trainers).doc('nadie').get());
  await permitido('B34 PT consulta su documento de entrenador filtrando por trainerKey', pta.collection(D.COL.trainers).where('trainerKey', '==', 'pta').get());

  // ============================================================== C. GUARDADOS Y CONCURRENCIA
  console.log('\n=== C. Guardados reales (fusión de agenda.html) y concurrencia ===');
  const tkC = 'pta';
  const baseVacia = { clientes: [], agenda: {}, pruebasCRM: {}, disponibilidadReservas: {}, historicoClientes: {} };
  async function vista(dbx, tk) {
    // Vista actual del servidor para un entrenador (forma legado de UN tk), como la que mantiene la app.
    const col = async c => { const s = await dbx.collection(D.COL[c]).where('trainerKey', '==', tk).get(); const o = {}; s.docs.forEach(d => { o[d.id] = d.data(); }); return o; };
    const docs = { semanas: await col('semanas'), clientes: await col('clientes'), trainers: await col('trainers'), historico: await col('historico'), notas: await col('notas') };
    const l = D.legadoDesdeDocs(docs);
    return { clientes: l.clientes[tk] || [], agenda: l.agenda[tk] || {}, pruebasCRM: l.pruebasCRM[tk] || {}, disponibilidadReservas: l.disponibilidadReservas[tk] || {}, historicoClientes: l.historicoClientes[tk] || {} };
  }
  const guardar = (dbx, tk, base, local, contador, notas) => D.guardarScope({ firestore: dbx, FieldValue, tk, base, local, notas: notas || { base: {}, local: {} }, notasTocadas: Object.keys((notas || {}).local || {}), fusionar: agendaFn.fusionarCampoTresVias, limpiarAgenda: agendaFn.quitarCopiasFichaDeSesiones, bloqueSesion: agendaFn.clavesBloqueSesion, actor: 'test', contador });
  const conCambio = (b, fn) => { const l = JSON.parse(JSON.stringify(b)); fn(l); return l; };
  const S = extra => ({ id: 'cliC', nombre: 'Cliente C', duracionMin: 45, ...(extra || {}) });
  let b0 = await vista(pta, tkC);
  // C1: crear sesión (medición de consumo de la operación).
  let cm = medir();
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-14_09:00'] = S(); }), cm);
  let v = await vista(pta, tkC);
  check('C1 crear sesión: confirmada en el servidor', !!v.agenda['2026-10-14_09:00']);
  consumoTabla.push({ operacion: 'Crear sesión (PT)', lecturas: cm.lecturas + 1, escrituras: cm.escrituras, nota: '+1 lectura de reglas (perfil)' });
  // C2: dos usuarios (admin y PT) cambian SESIONES DISTINTAS de la misma semana a la vez -> ambos se guardan.
  b0 = await vista(pta, tkC);
  const r2 = await Promise.allSettled([
    guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-15_10:00'] = S(); })),
    guardar(admin, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-16_11:00'] = S({ nombre: 'Otra' }); })),
  ]);
  v = await vista(admin, tkC);
  check('C2 admin y PT guardan sesiones distintas de la misma semana a la vez: ambas confirmadas', r2.every(r => r.status === 'fulfilled') && !!v.agenda['2026-10-15_10:00'] && !!v.agenda['2026-10-16_11:00'], r2.map(r => r.status + (r.reason ? ':' + r.reason.code : '')));
  // C3: dos usuarios reservan el MISMO hueco a la vez -> exactamente uno gana, el otro conflicto.
  b0 = await vista(pta, tkC);
  const r3 = await Promise.allSettled([
    guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-14_12:00'] = S({ nombre: 'Uno' }); })),
    guardar(admin, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-14_12:00'] = S({ nombre: 'Dos' }); })),
  ]);
  check('C3 mismo hueco a la vez: exactamente uno se guarda y el otro recibe conflicto', r3.filter(r => r.status === 'fulfilled').length === 1 && r3.filter(r => r.status === 'rejected' && r.reason.code === 'conflict').length === 1, r3.map(r => r.status));
  // C4: huecos SOLAPADOS (12:30 y 12:45) a la vez -> nunca dos sesiones solapadas.
  b0 = await vista(pta, tkC);
  await Promise.allSettled([
    guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-14_16:30'] = S(); })),
    guardar(admin, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-14_16:45'] = S({ nombre: 'Solapa' }); })),
  ]);
  v = await vista(admin, tkC);
  check('C4 dos reservas solapadas (16:30 y 16:45) a la vez: nunca quedan ambas', !(v.agenda['2026-10-14_16:30'] && v.agenda['2026-10-14_16:45']));
  // C5: solape con una sesión YA guardada (no concurrente) -> rechazado por la invariante del servidor.
  b0 = await vista(pta, tkC);
  let e5 = null; try { await guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-14_09:15'] = S({ nombre: 'Encima' }); })); } catch (e) { e5 = e; }
  check('C5 sesión que se solapa con otra ya guardada (09:00 vs 09:15): rechazada', e5 && e5.code === 'conflict' && (e5.conflictos || []).some(c => c.solape));
  // C6: sesión de 60 min respeta su duración (09:45 se solapa con 09:00+60').
  b0 = await vista(pta, tkC);
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-17_09:00'] = S({ duracionMin: 60 }); }));
  b0 = await vista(pta, tkC);
  let e6 = null; try { await guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-17_09:45'] = S(); })); } catch (e) { e6 = e; }
  check('C6 la duración real de la sesión (60 min) se respeta al comprobar solapes', !!e6 && e6.code === 'conflict');
  // C7: mover una sesión a otra SEMANA (dos documentos en una transacción).
  b0 = await vista(pta, tkC);
  cm = medir();
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-21_09:00'] = l.agenda['2026-10-14_09:00']; delete l.agenda['2026-10-14_09:00']; }), cm);
  v = await vista(pta, tkC);
  check('C7 mover una sesión a otra semana: sale de una y entra en la otra, atómico', !v.agenda['2026-10-14_09:00'] && !!v.agenda['2026-10-21_09:00']);
  consumoTabla.push({ operacion: 'Mover sesión a otra semana (PT)', lecturas: cm.lecturas + 1, escrituras: cm.escrituras });
  // C8: recurrencia de 12 semanas = 12 documentos en UNA transacción.
  b0 = await vista(pta, tkC);
  cm = medir();
  await guardar(pta, tkC, b0, conCambio(b0, l => { for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(2026, 10, 2 + 7 * i)).toISOString().slice(0, 10); l.agenda[`${d}_18:00`] = S({ recurrente: true, serieRecurrenteId: 'serie1' }); } }), cm);
  v = await vista(pta, tkC);
  check('C8 recurrencia de 12 semanas: 12 sesiones con su serie, en una sola transacción', Object.values(v.agenda).filter(s => s.serieRecurrenteId === 'serie1').length === 12);
  consumoTabla.push({ operacion: 'Crear recurrencia de 12 semanas', lecturas: cm.lecturas + 1, escrituras: cm.escrituras });
  // C9: admin edita la ficha y el PT crea una sesión a la vez -> ambos se guardan.
  b0 = await vista(pta, tkC);
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.clientes.push({ id: 'cliC', nombre: 'Cliente C', telefono: '6', email: 'c@x', modalidad: 'A' }); }));
  b0 = await vista(pta, tkC);
  cm = medir();
  const r9 = await Promise.allSettled([
    guardar(admin, tkC, b0, conCambio(b0, l => { l.clientes[0].telefono = '7'; }), cm),
    guardar(pta, tkC, b0, conCambio(b0, l => { l.agenda['2026-10-15_13:00'] = S(); })),
  ]);
  v = await vista(pta, tkC);
  check('C9 admin cambia la ficha mientras el PT crea una sesión: ambos confirmados', r9.every(r => r.status === 'fulfilled') && v.clientes[0].telefono === '7' && !!v.agenda['2026-10-15_13:00'], r9.map(r => r.status));
  consumoTabla.push({ operacion: 'Modificar ficha (admin)', lecturas: cm.lecturas + 1, escrituras: cm.escrituras });
  // C10: admin y PT cambian el MISMO campo de la misma ficha -> conflicto explicado, nada perdido.
  b0 = await vista(pta, tkC);
  const r10 = await Promise.allSettled([
    guardar(admin, tkC, b0, conCambio(b0, l => { l.clientes[0].modalidad = 'B'; })),
    guardar(pta, tkC, b0, conCambio(b0, l => { l.clientes[0].modalidad = 'C'; })),
  ]);
  check('C10 misma ficha cambiada por ambos: uno se guarda y el otro recibe conflicto (sin pérdida silenciosa)', r10.filter(r => r.status === 'fulfilled').length === 1 && r10.some(r => r.status === 'rejected' && r.reason.code === 'conflict'));
  // C11: bloquear un día (excepción) y ocultar slots -> en la semana correcta; disponibilidad semanal -> entrenador.
  b0 = await vista(pta, tkC);
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.disponibilidadReservas = { ...l.disponibilidadReservas, semanal: { 1: { activo: true, bloques: [{ inicio: '09:00', fin: '14:00' }] } }, excepciones: { '2026-10-20': { activo: false } }, bloqueos: { '2026-10-22': ['10:00'] } }; }));
  v = await vista(pta, tkC);
  check('C11 bloqueo de día, slots ocultos y disponibilidad semanal guardados y releídos', v.disponibilidadReservas.excepciones['2026-10-20'].activo === false && v.disponibilidadReservas.bloqueos['2026-10-22'][0] === '10:00' && v.disponibilidadReservas.semanal[1].activo === true);
  // C12: borrar una ficha = lápida (el dato se conserva, la app deja de verla).
  b0 = await vista(pta, tkC);
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.clientes = []; }));
  v = await vista(pta, tkC);
  const lapida = (await pta.collection(D.COL.clientes).doc('cliC').get()).data();
  check('C12 borrar una ficha deja una lápida (no se borra el documento)', v.clientes.length === 0 && lapida && lapida.eliminado === true && lapida.ficha && lapida.ficha.id === 'cliC');
  // C13: histórico mensual congelado: escribir y releer.
  b0 = await vista(pta, tkC);
  await guardar(pta, tkC, b0, conCambio(b0, l => { l.historicoClientes = { cliC: { '2026-09': { facturacionPrevista: 120, sesionesAgendadas: 8 } } }; }));
  v = await vista(pta, tkC);
  check('C13 histórico mensual (precio de su momento) guardado y releído', v.historicoClientes.cliC['2026-09'].facturacionPrevista === 120);
  // C14: nota de hueco.
  b0 = await vista(pta, tkC);
  await guardar(pta, tkC, b0, b0, null, { base: {}, local: { [`pta__2026-10-15_10:00`]: 'Traer toalla' } });
  check('C14 nota de hueco guardada como documento propio', ((await pta.collection(D.COL.notas).doc('pta__2026-10-15_10:00').get()).data() || {}).texto === 'Traer toalla');
  // C15: sin cambios no se escribe nada.
  b0 = await vista(pta, tkC);
  cm = medir();
  const r15 = await guardar(pta, tkC, b0, b0, cm);
  check('C15 guardado sin cambios: 0 lecturas y 0 escrituras', r15.sinCambios === true && cm.lecturas === 0 && cm.escrituras === 0);
  // C16: un PT no puede guardar en el ámbito de otro (las reglas lo rechazan aunque la app lo intente).
  const bB = await vista(admin, 'ptb');
  let e16 = null; try { await guardar(pta, 'ptb', bB, conCambio(bB, l => { l.agenda['2026-10-14_09:00'] = S(); })); } catch (e) { e16 = e; }
  check('C16 un PT intentando guardar en la agenda de otro: permission-denied', e16 && /permission|PERMISSION/.test(String(e16.code || e16.message)));
  // C17: base vieja (pantalla desactualizada) cambiando lo mismo que otro ya cambió -> conflicto, no pisa.
  const viejo = await vista(pta, tkC);
  await guardar(admin, tkC, viejo, conCambio(viejo, l => { l.agenda['2026-10-15_10:00'].nombre = 'Cambio admin'; }));
  let e17 = null; try { await guardar(pta, tkC, viejo, conCambio(viejo, l => { l.agenda['2026-10-15_10:00'].nombre = 'Cambio PT'; })); } catch (e) { e17 = e; }
  v = await vista(pta, tkC);
  check('C17 pantalla desactualizada no pisa el cambio confirmado de otro (conflicto)', e17 && e17.code === 'conflict' && v.agenda['2026-10-15_10:00'].nombre === 'Cambio admin');
  // C18: pantalla desactualizada que cambia OTRA cosa -> se fusiona sin perder lo ajeno.
  await guardar(pta, tkC, viejo, conCambio(viejo, l => { l.agenda['2026-10-16_15:00'] = S({ nombre: 'Nueva' }); }));
  v = await vista(pta, tkC);
  check('C18 pantalla desactualizada que cambia otra sesión: se fusiona y conserva el cambio ajeno', v.agenda['2026-10-15_10:00'].nombre === 'Cambio admin' && !!v.agenda['2026-10-16_15:00']);

  // ============================================================== D. SINCRONIZACIÓN Y CONSUMO
  console.log('\n=== D. Sincronización incremental y consumo medido ===');
  const cacheA = D.cacheMemoria();
  async function abrir(dbx, alcance, cache, clave) {
    const c = medir(); let datos = null;
    const s = D.crearSincronizador({ firestore: dbx, Timestamp, alcance, cache, claveCache: clave, contador: c, onDatos: (d, m) => { if (m.desdeServidor) datos = d; } });
    await s.iniciar();
    for (let i = 0; i < 100 && !datos; i++) await espera(100);
    return { s, c, get datos() { return datos; } };
  }
  let ap = await abrir(pta, { trainerKey: 'pta' }, cacheA, 'pta');
  check('D1 primera apertura: el PT recibe sus datos', !!ap.datos && Object.keys(ap.datos.agenda.pta || {}).length > 0);
  const lecturasPrimera = ap.c.lecturas;
  consumoTabla.push({ operacion: 'Abrir Agenda PT sintético (primera vez)', lecturas: lecturasPrimera + 6, escrituras: 0, nota: '+6 lecturas de reglas (1 por consulta)' });
  await espera(700); ap.s.parar();
  ap = await abrir(pta, { trainerKey: 'pta' }, cacheA, 'pta');
  check('D2 reapertura sin cambios: solo 1 lectura mínima por consulta (6), sin descargar el histórico', ap.c.lecturas <= 6, ap.c.lecturas);
  check('D3 reapertura: datos idénticos a la primera apertura', !!ap.datos && D.igual(ap.datos.agenda.pta, (await vista(pta, 'pta')).agenda));
  consumoTabla.push({ operacion: 'Reabrir Agenda PT (sin cambios desde la última vez)', lecturas: ap.c.lecturas + 6, escrituras: 0, nota: 'incluye reglas' });
  // D4: un cambio en otro dispositivo llega en tiempo real y cuesta 1 lectura por documento cambiado.
  const antes = ap.c.lecturas;
  const bD = await vista(admin, 'pta');
  await guardar(admin, 'pta', bD, conCambio(bD, l => { l.agenda['2026-10-23_08:00'] = S({ nombre: 'Desde admin' }); }));
  for (let i = 0; i < 50 && !(ap.datos && ap.datos.agenda.pta['2026-10-23_08:00']); i++) await espera(100);
  check('D4 cambio hecho por admin aparece en tiempo real en el dispositivo del PT', !!(ap.datos && ap.datos.agenda.pta['2026-10-23_08:00']));
  check('D5 sincronizar ese cambio cuesta 1 lectura (1 documento de semana)', ap.c.lecturas - antes === 1, ap.c.lecturas - antes);
  consumoTabla.push({ operacion: 'Sincronizar un cambio ajeno (por dispositivo conectado)', lecturas: ap.c.lecturas - antes, escrituras: 0 });
  ap.s.parar();
  // D6: el admin con caché solo descarga los cambios.
  const cacheAdm = D.cacheMemoria();
  let ad = await abrir(admin, { todos: true }, cacheAdm, 'adm');
  const lecturasAdmin1 = ad.c.lecturas; await espera(700); ad.s.parar();
  ad = await abrir(admin, { todos: true }, cacheAdm, 'adm');
  check('D6 admin: la reapertura no vuelve a descargar todo', ad.c.lecturas < lecturasAdmin1 / 5 || ad.c.lecturas <= 8, `${lecturasAdmin1} -> ${ad.c.lecturas}`);
  consumoTabla.push({ operacion: `Abrir Agenda/Finanzas/Dashboard admin (primera vez, ${agendaReal ? 'datos reales' : 'sintético'})`, lecturas: lecturasAdmin1 + 8, escrituras: 0 });
  consumoTabla.push({ operacion: 'Reabrir Agenda/Finanzas/Dashboard admin (sin cambios)', lecturas: ad.c.lecturas + 8, escrituras: 0 });
  ad.s.parar();
  // D7: la caché nunca habilita guardar: los datos de caché se emiten con desdeServidor=false.
  let emisiones = [];
  const sC = D.crearSincronizador({ firestore: pta, Timestamp, alcance: { trainerKey: 'pta' }, cache: cacheA, claveCache: 'pta', onDatos: (d, m) => emisiones.push(m.desdeServidor) });
  await sC.iniciar(); for (let i = 0; i < 50 && !emisiones.includes(true); i++) await espera(100); sC.parar();
  check('D7 la copia local se marca como NO confirmada y después llega la confirmación del servidor', emisiones[0] === false && emisiones.includes(true));

  console.log('\n=== CONSUMO MEDIDO POR OPERACIÓN (emulador, reglas reales) ===');
  consumoTabla.forEach(f => console.log(`  ${f.operacion.padEnd(70)} lecturas=${String(f.lecturas).padStart(4)} escrituras=${String(f.escrituras).padStart(3)}${f.nota ? '  (' + f.nota + ')' : ''}`));
  fs.writeFileSync(path.join(__dirname, 'consumo_medido.json'), JSON.stringify(consumoTabla, null, 2));
  await testEnv.cleanup();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail) console.log('FALLOS:\n - ' + fallos.join('\n - '));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('ERROR FATAL:', e && e.code, e && e.message, e && e.stack && e.stack.split(String.fromCharCode(10)).slice(0, 4).join(' | ')); process.exit(1); });
