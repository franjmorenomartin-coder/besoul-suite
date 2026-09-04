// CLIENT-08 (2026-09-04) — Cloud Function PREPARADA, NO DESPLEGADA.
//
// Traducción 1:1 del contrato ya documentado en CLIENT_PORTAL_ARCHITECTURE.md, sección 5bis
// (escrito durante la fase anterior, verificado de nuevo aquí antes de traducirlo a código real).
// Implementa exactamente lo mismo que procesarCancelacionCliente() en agenda.html ejecuta hoy
// del lado del PT autenticado -- misma lógica, migrada a un trigger de servidor para dejar de
// depender de que agenda.html esté abierta.
//
// POR QUÉ NO ESTÁ DESPLEGADA (las tres condiciones de CLIENT_PORTAL_ARCHITECTURE.md siguen sin
// cumplirse en este entorno):
//   (a) requiere un proyecto de Cloud Functions activo con facturación habilitada (los triggers
//       Firestore de 2ª generación -- onDocumentCreated -- corren sobre Cloud Run/Eventarc, que
//       exige el plan Blaze, no Spark);
//   (b) requiere credenciales de servicio/Firebase CLI autenticado, que este entorno no tiene;
//   (c) requiere autorización explícita para tocar infraestructura de producción, que no se ha
//       dado en esta fase (instrucción expresa: "NO desplegar Functions").
// No se ha ejecutado `firebase init functions`, no existe `firebase.json`, no se ha instalado
// ninguna dependencia de este package.json, y no se ha llamado a `firebase deploy` desde aquí.
//
// QUÉ CAMBIA EN EL CLIENTE SI ESTO SE DESPLIEGA ALGÚN DÍA: nada. portal-cliente.html ya crea el
// documento besoulCancelacionesCliente con la forma exacta que esta función espera -- cero
// cambios en el cliente. agenda.html conserva iniciarModuloCancelacionesCliente() como mecanismo
// de refuerzo/fallback visual (el PT ve el cambio reflejado sin recargar), pero deja de ser el
// ÚNICO camino de procesamiento -- esta función pasa a ser la vía primaria y determinista.
//
// Requiere, además, que se despliegue la propuesta de Rules de besoulCancelacionesCliente
// documentada en CLIENT_PORTAL_ARCHITECTURE.md sección 4 (tampoco desplegada) para que
// portal-cliente.html pueda siquiera CREAR el documento que dispara este trigger -- y que
// CANCELACION_PORTAL_HABILITADA se cambie a true en portal-cliente.html (CLIENT-07) para que el
// botón vuelva a ser operativo. Ninguna de las dos cosas se ha hecho en esta fase.

'use strict';

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { initializeApp } = require('firebase-admin/app');

initializeApp();

const CANCELACIONES_COLLECTION = 'besoulCancelacionesCliente';
const PUBLIC_CLIENTS_COLLECTION = 'besoulPublicClients';
const SUITE_COLLECTION = 'besoulSuite';
const AGENDA_DOC_ID = 'agenda';

/**
 * Paso 3 del contrato: recalcula si la cancelación sigue dentro de plazo, usando SIEMPRE la hora
 * del propio servidor (Date.now() en el runtime de la función) y el cancelacionMinHoras releído
 * de besoulPublicClients en este mismo momento -- nunca un valor que viaje en el payload del
 * cliente, aunque el payload lo incluya.
 */
function calcularDentroDePlazo(fechaISO, hora, cancelacionMinHorasReal) {
  const fechaHoraSesion = new Date(`${fechaISO}T${hora}:00`);
  const ahoraServidor = new Date();
  const horas = (fechaHoraSesion.getTime() - ahoraServidor.getTime()) / 3600000;
  return horas >= cancelacionMinHorasReal;
}

exports.procesarCancelacionClienteBackend = onDocumentCreated(
  { document: `${CANCELACIONES_COLLECTION}/{id}`, region: 'europe-west1' },
  async (event) => {
    const db = getFirestore();
    const snap = event.data;
    if (!snap) return;
    const solicitudId = event.params.id;
    const solicitudRef = snap.ref;
    const solicitud = snap.data() || {};

    // Paso 6: idempotencia -- si el trigger se re-entrega (Cloud Functions garantiza
    // "at least once", no "exactly once"), y la solicitud ya no está 'pendiente', salir sin
    // repetir ningún efecto. Releer el propio documento (no confiar en snap, que es el estado
    // EN EL MOMENTO DE LA CREACIÓN, no necesariamente el estado actual si esto es un reintento).
    const solicitudActualSnap = await solicitudRef.get();
    const solicitudActual = solicitudActualSnap.data() || {};
    if (solicitudActual.estado !== 'pendiente') {
      console.log(`[CANCELACION_BACKEND] ${solicitudId}: ya no está pendiente (estado=${solicitudActual.estado}), salida idempotente sin repetir efectos.`);
      return;
    }

    const { token, clientId, trainerKey, clave } = solicitud;
    if (!token || !clientId || !trainerKey || !clave) {
      await solicitudRef.set({ estado: 'error', motivoError: 'payload_incompleto', procesadaEn: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    // Paso 1: validar token/clientId/trainerKey contra besoulPublicClients -- mismo cross-check
    // que ya protegen las Rules propuestas de besoulReservas.create y de esta misma colección
    // (CLIENT_PORTAL_ARCHITECTURE.md sección 4).
    const publicClientSnap = await db.collection(PUBLIC_CLIENTS_COLLECTION).doc(token).get();
    if (!publicClientSnap.exists) {
      await solicitudRef.set({ estado: 'error', motivoError: 'token_no_encontrado', procesadaEn: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    const publicClient = publicClientSnap.data() || {};
    if (publicClient.clientId !== clientId || publicClient.trainerKey !== trainerKey) {
      await solicitudRef.set({ estado: 'error', motivoError: 'token_no_coincide_con_cliente', procesadaEn: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    // cancelacionMinHoras SIEMPRE se relee de besoulPublicClients en este paso, ignorando
    // cualquier valor que pudiera venir en el payload de la solicitud -- exactamente igual de
    // estricto que procesarCancelacionCliente() hoy en agenda.html.
    const cancelacionMinHorasReal = parseInt(publicClient.cancelacionMinHoras, 10) || 6;

    // clave siempre en formato "YYYY-MM-DD_HH:MM" -- se deriva de la propia clave (como hace
    // procesarCancelacionCliente() hoy), no de los campos fechaISO/hora sueltos del payload, para
    // no depender de que ambas representaciones coincidan si algo las desincroniza algún día.
    const [fechaISO, hora] = String(clave).split('_');
    const claveNota = `${trainerKey}__${clave}`; // mismo formato que claveNotaAgenda() en agenda.html

    // Paso 2 + 3 + 4/5 + paso 6 (parte de la transaction): todo dentro de una única Firestore
    // transaction que relee besoulSuite/agenda y confirma que la cita sigue siendo LA MISMA
    // (mismo clientId en esa clave) antes de tocarla -- evita una condición de carrera si el PT
    // movió/borró la cita manualmente entre la creación de la solicitud y este procesamiento.
    const agendaRef = db.collection(SUITE_COLLECTION).doc(AGENDA_DOC_ID);
    let resultado;
    try {
      resultado = await db.runTransaction(async (tx) => {
        const agendaSnap = await tx.get(agendaRef);
        const agendaData = agendaSnap.data() || {};
        const cita = (agendaData.agenda || {})[trainerKey]?.[clave];

        if (!cita || cita.id !== clientId) {
          return { estado: 'error', motivoError: 'cita_no_encontrada_o_no_coincide' };
        }

        const dentroDePlazo = calcularDentroDePlazo(fechaISO, hora, cancelacionMinHorasReal);

        if (dentroDePlazo) {
          // >= plazo: liberar el hueco, no consume sesión. También limpia la nota asociada
          // (mismo efecto colateral que fijarNotaAgenda(clave,'') en agenda.html), usando la
          // clave determinista trainerKey__clave directamente -- evita la ambigüedad que tendría
          // fijarNotaAgenda() si se llamara con el entrenadorVisto de una sesión de admin distinta
          // al trainerKey real de esta cita.
          tx.update(agendaRef, {
            [`agenda.${trainerKey}.${clave}`]: FieldValue.delete(),
            [`notas.${claveNota}`]: FieldValue.delete(),
            actualizadoEn: FieldValue.serverTimestamp()
          });
          return { estado: 'procesada', dentroDePlazoAplicado: true };
        } else {
          // < plazo: nunca se borra -- se marca y sigue consumiendo sesión (mismos dos campos que
          // escribe procesarCancelacionCliente() hoy: estadoCancelacion + canceladaEn).
          tx.update(agendaRef, {
            [`agenda.${trainerKey}.${clave}.estadoCancelacion`]: 'cancelada_fuera_plazo',
            [`agenda.${trainerKey}.${clave}.canceladaEn`]: new Date().toISOString(),
            actualizadoEn: FieldValue.serverTimestamp()
          });
          return { estado: 'procesada', dentroDePlazoAplicado: false };
        }
      });
    } catch (err) {
      console.error(`[CANCELACION_BACKEND] ${solicitudId}: fallo en transaction:`, err);
      await solicitudRef.set({ estado: 'error', motivoError: 'fallo_transaction', procesadaEn: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    // Paso 7: idempotencia end-to-end -- el resultado final de la solicitud queda escrito de
    // forma que un reintento posterior (mismo evento, o disparo manual repetido) entra en el
    // early-exit del principio de esta función en cuanto lea este mismo set().
    await solicitudRef.set({
      ...resultado,
      procesadaEn: FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[CANCELACION_BACKEND] ${solicitudId}: procesada, dentroDePlazoAplicado=${resultado.dentroDePlazoAplicado}`);
  }
);
