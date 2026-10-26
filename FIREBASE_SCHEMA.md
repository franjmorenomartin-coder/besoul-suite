# Firebase Schema - BESOUL Suite

## `besoulUsers/{email}`

Internal user profile.

Typical fields:

- `email`
- `nombre`
- `rol`: `admin` or `pt`
- `trainerKey`
- `activo`
- `ocultarResumenEconomico` (boolean, optional; IGOR-RESUMEN-ECONOMICO, 2026-10-26): set by an admin
  only. When `true`, Agenda hides the trainer's aggregated economic summaries (revenue KPIs, billing
  forecast, agenda value, deviation, open-group profitability). Individual client prices stay
  visible and editable. Only the exact value `true` hides; missing/`false` keeps today's view. It is
  a UI preference, not a security boundary (the PT still reads their own fichas). The Agenda profile
  save uses `set` with merge, so the flag is preserved.

Rules:

- Admin can read and manage users.
- PT can read own profile.
- Do not change `trainerKey` once the trainer has production data unless there is a migration plan.

## Agenda en documentos independientes (ARQ-V1-MIGRACION-IMPL, vigente tras el corte)

Fuente de verdad de la Agenda tras el corte. Código: `besoul-datos.js` (transformación, sincronización
incremental, guardado transaccional). Detalle y procedimiento: `docs/arquitectura-firestore/06_IMPLEMENTACION.md`.

| Colección | ID | Contenido | Acceso |
|---|---|---|---|
| `besoulAgendaSemanas` | `{trainerKey}__{lunes YYYY-MM-DD}` | `sesiones{clave}`, `pruebasCRM{clave}`, `excepciones{fecha}`, `bloqueos{fecha}`, `leadsPrueba[]` | PT: solo las suyas · admin: todas |
| `besoulClientes` | `{clientId}` | `ficha{}`, `trainerKey`, `orden`, `leadId`, `eliminado` (lápida) | PT: solo las suyas · traspaso solo admin |
| `besoulTrainers` | `{trainerKey}` | `disponibilidad{semanal,...}`, `actividades` (solo admin), presencia | PT: el suyo |
| `besoulHistoricoClientes` | `{trainerKey}__{clientId}__{YYYY-MM}` | `datos{}` (resumen mensual congelado) | PT: los suyos |
| `besoulNotas` | `{trainerKey}__{clave}` | `texto`, `eliminado` | PT: las suyas (sin trainerKey: solo admin) |
| `besoulAgendaConfig` | `global` | `campos{catalogoActividades, tarifasActividadVersiones, repartoActividadVersiones}` | lectura usuarios activos · escritura admin |
| `besoulAgendaLegado` | `raiz` | campos raíz sueltos del documento antiguo, verbatim | solo admin |

Todos llevan `rev` (1 al crear, >1 al actualizar), `actualizadoEn` = hora del servidor (obligatorio por
reglas; base de la sincronización incremental) y `actualizadoPor`. No se borra ningún documento.

## `besoulSuite/agenda` (CONGELADO tras el corte: solo lectura admin, respaldo)

Main agenda document (histórico; antes del corte era la fuente de verdad).

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

Write semantics from `agenda.html` (HOTFIX-V1-AGENDA-PERSISTENCIA-P0, 2026-10-08; document shape unchanged):

- Each save is a transaction that updates only the affected trainer's sub-maps
  (`clientes.<trainerKey>`, `agenda.<trainerKey>`, `pruebasCRM.<trainerKey>`,
  `disponibilidadReservas.<trainerKey>`, `historicoClientes.<trainerKey>`). It is cancelled
  (conflict) if another session changed that same trainer's data in the meantime.
- `notas` is still a flat map (`<trainerKey>__<slotKey>` → text), but it is no longer rewritten
  whole. Only the keys changed by the session are written (`notas.<key>`), and a deleted note is
  removed with `FieldValue.delete()`.

Concurrency (HOTFIX-V1-AGENDA-SYNC-P0, 2026-10-09; document shape unchanged, rules unchanged; see
`docs/AGENDA_SYNC_P0.md`):

- Inside the transaction, each trainer sub-map is merged **per element** (three-way: what the tab
  last saw from the server / what the tab has now / what the server has now). Elements are: session
  by slot key (`agenda`, `pruebasCRM`), client card by `id` (`clientes`), `semanal.<day>`,
  `excepciones.<date>` and `bloqueos.<date>` (`disponibilidadReservas`), and history key
  (`historicoClientes`).
- Changes by different users to different elements of the same trainer are both kept (before, the
  whole save was cancelled). The value written is always "server now + this tab's changes".
- Real conflict = the same element changed by both, the same session moved or deleted by both in
  different ways, or two new overlapping sessions (45-minute block). Then nothing is written, and
  the user is told which element conflicts.
- A sub-map is only written if its merged value differs from the server; with no changes, nothing
  is written.

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
- Writes (FIX-FINANZAS-GUARDADO-SEGURO, 2026-10-23; see `docs/FINANZAS_GUARDADO_SEGURO.md`):
  - The client only writes after a server snapshot has been received, and only the changed
    second-level paths (`gastos.2026-10`, `trainerSettings.igor`…) in a transaction with a
    per-path conflict check (`besoul-finanzas-guardado.js`). Never the whole document.
  - Rules (`finanzasSinVaciado()`): `update` is denied if it empties a critical map that had entries
    (`trainerSettings`, `trainerSettingsVersiones`, `centros`, `centrosVersiones`, `otrosIngresos`,
    `gastos`, `historico`; `historico` may be emptied only when `historicoBorrado` changes in the same
    write) or removes more than one entry of `trainerSettings`, `trainerSettingsVersiones`, `centros`
    or `centrosVersiones`. `delete` of the document is denied. Read: admin only.
  - `guardadoSeguroEn` (timestamp): written with `serverTimestamp()` on every write by the current
    `finanzas.html` and the restoration tool. Rules (`finanzasEscrituraSegura()`) require
    `guardadoSeguroEn == request.time` on create/update, so an old cached version (full-document
    `set`) cannot write at all. Not read by the engine.
- Employee trainers (IGOR-RESUMEN-ECONOMICO, 2026-10-26). All optional and versioned in
  `trainerSettingsVersiones` (desde/hasta, never retroactive):
  - `trainerSettings.{key}.sistemaPago: 'empleado'`: 100 % of the trainer's billing goes to BESOUL
    (no tiers, no PT share, no commission on billing).
  - `trainerSettings.{key}.costeEmpresaMensual` (number): company labour cost, analysis reference.
  - `trainerSettings.{key}.canonAtribuidoMensual` (number): agreed canon attributed to the trainer,
    analysis only (used when > 0, otherwise the automatic centre share). Never added to
    `total.canones`: the centre canon is still computed once by the engine.
  - `trainerSettings.{key}.incentivoModelo` (`'opcion_b'`, or missing = pending): 5 € per eligible
    individual client + 10 € per eligible group of 3 or more, once per client/group per month.
  - `gastos.{mes}[].trainerKey` (optional): attributes an expense to a trainer for analysis; the
    expense still counts once in the monthly total. Category `Incentivos` added; payroll uses `Sueldos`.
- Fields added only by the selective restoration tool (`scripts/restaurar-finanzas-selectivo.js`),
  if it is ever executed:
  - `auditoriaRestauraciones.{id}`: `{accion: 'restauracion'|'reversion', fecha, por, motivo, rutas,
    origen?, actualizado?, huellaAntes?, de?}`. Audit only; not read by the engine.
  - `historicoLegadoRestaurado`: the legacy `historico` array from old backups (e.g. «JUNIO 2026»),
    kept for reference only; not read by the engine.
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

Date fields (HOTFIX-CRM-DUPLICADOS-FECHA-ALTA, see `docs/CRM_FECHAS_Y_DUPLICADOS.md`):

- `createdAt` (ISO UTC) -- when the lead was registered in Besoul. System/audit date,
  **immutable** (enforced by `firestore.rules`).
- `fechaAltaReal` (`YYYY-MM-DD`, Madrid calendar) -- "Fecha de alta real": when the person really
  joined. Admin-editable, every change logged in `historial` (`campo: 'fechaAltaReal'`,
  `valorAnterior`, `valorNuevo`, `userEmail`, `fecha`). Missing on historical records; readers
  fall back to the Madrid date of `createdAt` (unchanged behaviour until corrected).
- `convertedAt` (ISO UTC) + `fechaConversion` (`YYYY-MM-DD`, Madrid) -- when the conversion to an
  Agenda client was registered.

Lead ids for CRM-created leads are reserved when the "Nuevo lead" form opens and written with a
transaction, so retries never create a second document.

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
