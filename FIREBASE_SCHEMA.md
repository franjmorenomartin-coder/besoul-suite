# Firebase Schema - BESOUL Suite

## `besoulUsers/{email}`

Internal user profile.

Typical fields:

- `email`
- `nombre`
- `rol`: `admin` or `pt`
- `trainerKey`
- `activo`

Rules:

- Admin can read and manage users.
- PT can read own profile.
- Do not change `trainerKey` once the trainer has production data unless there is a migration plan.

## `besoulSuite/agenda`

Main agenda document.

Contains operational data such as:

- clients.
- groups.
- agenda entries by trainer/date/slot.
- notes.
- recurring sessions.
- non-billable/recovery session marks.
- internal agenda configuration.

Important rules:

- Sessions are 45 minutes.
- The agenda grid uses 15-minute slots.
- One session blocks 3 slots.
- Trial sessions from CRM are visible but not billable.

## `besoulSuite/finanzas`

Main finance document.

Contains:

- trainer finance configuration.
- centers.
- center cost rules.
- company expenses.
- monthly history.
- special pacts.
- trainer ranges and canon configuration.

Important rules:

- Finanzas is admin-only.
- Historical closing must not be overwritten accidentally.
- Monthly memberships bill the whole month.
- Packs/single sessions bill only scheduled billable sessions.

## `besoulLeads/{leadId}`

CRM leads and trials.

Typical fields:

- `nombre`
- `telefono`
- `email`
- `estado`
- `fuente`
- `medio`
- `centro`
- `trainerKey`
- `fechaPrueba`
- `horaPrueba`
- `notas`
- `notasEntrenador`
- `convertido`

Important statuses:

- Nuevo lead.
- Contactado.
- Pendiente de respuesta.
- Prueba solicitada.
- Prueba agendada.
- Prueba realizada.
- Convertido a cliente.
- Perdido.
- Reactivar más adelante.

## `besoulPublicClients/{token}`

Minimal public customer profile for reservation links and the client portal (`portal-cliente.html`).

This collection must never contain financial data, internal notes or sensitive information.

Purpose:

- Allow `reservas.html` and `portal-cliente.html` to identify a customer by private token (capability URL, no separate login).
- Show only the customer's own booking/session data needed for self-service.

**SEC-06 (2026-09-04) — esquema público final**, auditado campo por campo contra el `batch.set(...)` real que escribe `agenda.html` (`publicarReservasPublicas()`), sin discrepancias entre lo documentado y lo que el código realmente escribe:

| Campo | Contenido |
|---|---|
| `token` | El mismo token de la URL (own identity, not a secret shown to anyone else) |
| `clientId`, `clientName` | Su propio id/nombre |
| `trainerKey`, `trainerName` | Su entrenador asignado |
| `centroId`, `centroNombre` | Su centro |
| `email`, `telefono` | Sus propios datos de contacto |
| `activo`, `reservasOnlineActivas` | Flags de si su acceso de autogestión está habilitado |
| `restriccionesReservas`, `reservasBloqueadasTexto` | Bloqueos horarios de SU ficha únicamente |
| `sesionesContratadas`, `sesionesUsadas`, `sesionesPendientes`, `periodoSesiones` | Su propio contador de sesiones |
| `proximaSesion`, `proximasSesiones` (máx. 5), `sesionesRecientes` (máx. 3) | Sus propias citas (fecha/hora/clave) |
| `cancelacionMinHoras` | Plazo de cancelación configurado en su ficha |
| `avisos` (máx. 10) | `{id, fecha, contenido}` -- avisos enviados a este cliente concreto |
| `updatedAt` | Timestamp de última sincronización |

**Explícitamente ausente, confirmado leyendo el `batch.set` completo, no solo revisado a ojo** (exactamente los items que este ticket pedía excluir): rentabilidad, canon/reparto 50/35/15 ni ningún dato de Finanzas; datos de cualquier OTRO cliente del mismo entrenador (documento 1:1 por token, nunca una lista); contratos/PDFs firmados; notas internas del PT (`notaEntrenador`, notas de agenda). Detalle de por qué el aislamiento entre clientes es real (no solo "no debería pasar") en `SECURITY_AUDIT_PORTAL.md`.

## `besoulPublicSchedule/{trainerKey}`

Public availability by trainer for the reservation portal.

Purpose:

- Store days and time windows in which the trainer is operative.
- The customer portal uses this plus current agenda occupancy to calculate available slots.

## `besoulReservas/{reservaId}`

Booking requests.

Typical fields:

- `estado`: `pendiente`, `aceptada`, `rechazada`, `cancelada`
- `token`
- `clientId`
- `trainerKey`
- `fechaISO`
- `hora`
- `clave`
- `duracionMin`: 45
- `createdAt`
- `clienteNombre`

Important rule:

- External customer can only create a pending request.
- Internal user must accept/reject.
- Accepted request creates a real agenda session.
