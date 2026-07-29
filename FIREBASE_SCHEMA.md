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

Minimal public customer profile for reservation links.

This collection must never contain financial data, internal notes or sensitive information.

Expected purpose:

- Allow `reservas.html` to identify a customer by private token.
- Show only the customer name, trainer, center and booking options needed.

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
