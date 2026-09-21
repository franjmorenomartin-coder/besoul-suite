# BESOUL Firestore Map

Full collection/document/subcollection tree, both V1 (source of truth) and V2 (inert copy), with
field shapes and cross-references to Rules and indexes. Companion to `BESOUL-SYSTEM-MAP.md` and
`BESOUL-DATA-FLOWS.md`. For the full design rationale behind V2's shape, see
`DATA_ARCHITECTURE_V2.md`; for the full Rules rationale, `SECURITY_MODEL_V2.md`.

## V1 (production, source of truth)

### `besoulSuite/agenda` — the monolith, ONE document for ALL trainers

```
{
  clientes:              { [trainerKey]: [ { id, nombre, tipo: 'individual'|'grupo', vinculacion?, ... } ] },
  agenda:                { [trainerKey]: { [clave 'fechaISO_HH:MM']: { ...client fields spread in, duracionMin, esPruebaCRM?, ... } } },
  pruebasCRM:             { [trainerKey]: { [clave]: { ...same shape as agenda entries, esPruebaCRM/tipoCita/modalidad marking it a trial } } },
  disponibilidadReservas: { [trainerKey]: { semanal, excepciones, bloqueos, recurrenteSemanal, actualizadoEn } },
  historicoClientes:      { [trainerKey]: { [clienteId]: { [claveMes 'YYYY-MM']: { clienteId, nombre, tipo, mes, sesionesContratadas, sesionesAgendadas, facturacionPrevista, facturacionReal, ... } } } },
  notas:                  { ["trainerKey__clave"]: "texto libre" },      -- FLAT map, not nested by trainerKey
  actualizadoEn:          serverTimestamp(),
  ultimaActualizacionLocal: ISO string
}
```

- **Rules**: `match /besoulSuite/{docId}`. `read`: any active user, whole document (no partial read
  possible). `write` (docId=='agenda'): admin unconditionally, or active user restricted to
  `affectedKeys().hasOnly([clientes,agenda,disponibilidadReservas,historicoClientes,pruebasCRM,notas,actualizadoEn,ultimaActualizacionLocal])`
  **and** each of the 5 nested maps' own diff restricted to `[myTrainerKey()]`. `notas` is
  deliberately **not** isolated this way — CEL's `affectedKeys().all(...)` was proven (Emulator,
  not assumed) to reject at evaluation time; accepted residual risk, documented since the FASE 2
  design phase.
- **Index**: none — every access is `.doc('agenda').get()`/`tx.get()`, never a query. Wildcard
  `fieldOverride` (`besoulSuite.*`, empty `indexes`) exempts the whole collection from Firestore's
  automatic single-field indexing (this is what closed the original "too many index entries for
  entity" incident this config exists to prevent from recurring).
- **Known structural problems** (why V2 exists, not yet acted on for V1): one document = one
  contention domain for every trainer; a session historically embedded the full client object at
  booking time (`agenda.html:6928`); `integrantesObj` duplicates group-membership data that also
  exists as separate member records.

### `besoulSuite/finanzas`

```
{ centros, catalogoActividades, tarifasActividadVersiones, repartoActividadVersiones, trainerActividades: { [trainerKey]: [...] } }
```
Rules: same `match /besoulSuite/{docId}` block, `docId=='finanzas'` → admin-only read+write.

### `besoulUsers/{email}` — V1 identity, keyed by email

```
{ nombre, rol: 'pt'|'admin', trainerKey, activo, email }
```
Rules: `get` own (by email match, exists or not); `get,list,create,update,delete` admin only.

### `besoulLeads/{leadId}`

```
{ trainerKey, nombre, telefono, email, centroId, centroNombre, estado, fuente, trainerName,
  objetivo, horarioPreferido, tipoPrueba, duracionPrueba, notas, notaEntrenadorPrueba,
  createdAt, updatedAt, convertido, origenPublico, origenQR, leadId, ... }
```
Rules: `read` admin or own-trainerKey-active-user; `create` admin or `isPublicTrialLead()`
(strict whitelist, anonymous, from `valoracion.html`/`prueba.html`); `update,delete` admin only.

### `besoulPublicClients/{token}`

```
{ trainerKey, clientId, avisosLeidos: [] }
```
Rules: `get` fully public; `list` denied; `create` own-trainerKey or admin; `update` own-trainerKey
(can't reassign trainerKey), admin, or anonymous-whitelisted-to-`avisosLeidos`-only; `delete` admin.

### `besoulPublicSchedule/{trainerKey}`
`get` public, `list` denied, `create/update/delete` active user only.

### `besoulPublicConfig/centros`, `besoulValoracionRegistry/{keyId}`
Small public-read, admin/active-user-write or whitelisted-anonymous-create collections. Unchanged,
low-traffic, not involved in this incident.

### `besoulReservas/{reservaId}`

```
{ estado: 'pendiente'|..., token, clientId, trainerKey, fechaISO, hora, clave, duracionMin: 45 }
```
Rules: `create` public but cross-validated against a real `besoulPublicClients/{token}` doc
(`clientId`/`trainerKey` must match); `read,update,delete` own-trainerKey or admin.

### `besoulNotifications/{notifId}`

```
{ audience: 'trainer'|'admin', trainerKey?, type, title, message, read: false, readAt? }
```
Rules: `create` any active user (cross-trainerKey allowed, no sensitive data); `read` own or admin;
`update` whitelisted to `[read, readAt]`; never `delete`.

### `besoulSolicitudesEliminacion/{solicitudId}`

```
{ estado: 'pendiente'|'aprobada'|'rechazada', trainerKey, solicitadoPor, revisadoPor?, revisadoEn?, notasAdmin? }
```
Rules: `create` own-trainerKey (or admin on behalf of); `read` own/admin; `update` admin only,
whitelisted, only from `pendiente`; never `delete`.

### `besoulCancelacionesCliente/{id}`
Referenced in a `CLIENT_PORTAL_ARCHITECTURE.md` proposal and a prepared-but-undeployed Cloud
Function (`functions/cancelacionCliente.js`). No `match` block for it exists in the currently live
`firestore.rules` — it falls through to the catch-all `deny`. Not part of this incident.

## V2 (inert copy, `besoul-suite`, populated once on 2026-09-18)

### `besoulUsersV2/{uid}`
```
{ uid, email, nombre, rol: 'admin'|'pt', trainerKey, activo, createdAt, updatedAt, legacyEmailKey,
  telefono?, avatarUrl?, avatarPath? }
```
Rules: `get` own; self-`update` whitelisted to `[telefono,avatarUrl,avatarPath,nombre]` (never
rol/trainerKey/activo, double-enforced); admin full access.

### `trainers/{trainerKey}`
```
{ trainerKey, nombre, rol, activo, centroId, centroNombre, actividadesAutorizadas: [], ownerUid,
  createdAt, updatedAt }
```
Rules: `get` own or admin; `list,write` admin only.

#### `trainers/{trainerKey}/clients/{clientId}`
1:1 field copy of a V1 `clientes[trainerKey][i]` entry, minus `integrantesObj` (group rosters are
now a live query: `where('vinculacion','==',groupId)`, never a stored mirror).

#### `trainers/{trainerKey}/sessions/{sessionId}`
```
{ sessionId, clientId, clienteNombreCache, startAt, endAt, claveLegacy, activity, status,
  source: 'manual'|'crm_trial'|'reserva_portal', esPruebaCRM, leadId, recuperacionNoFacturable,
  noFacturable, origenReservaCliente, solicitudReservaId, recurrente, serieRecurrenteId,
  grupoAbierto, capacidadGrupoAbierto, asistentesGrupoAbierto: [], createdAt, updatedAt, createdBy }
```
References `clientId` only — never embeds the client object (the structural fix for the false-
conflict bug class this whole project has repeatedly hit on the V1 side).

#### `trainers/{trainerKey}/availability/current`
Same shape as V1's `disponibilidadReservasPorDefecto()` — unchanged, kept as-is deliberately.

#### `trainers/{trainerKey}/historico/{mesKey}_{clientId}`
ONE independent document per (trainer, month, client) — not a shared per-month document (a hot-
document/contention risk found and fixed *before* any real data was created — `ADR_001`).

#### `trainers/{trainerKey}/notes/{noteKey}`
```
{ clave, texto, updatedAt, updatedBy }
```
Real, isolatable subcollection — replaces V1's flat, un-isolatable `notas` map.

All 5 subcollections above share one Rules shape: `get,list,write` allowed for admin or the
active user whose `trainerKey` matches the path. 3 `collectionGroup` Rules additionally allow
`list` for admin cross-trainer aggregation (`clients`, `sessions`, `historico` — proven empirically
to require the `{path=**}` wildcard form, not just the nested `match`).

### `besoulFinance/config`
Field-for-field relocation of `besoulSuite/finanzas`. Admin-only, same as V1.

### `besoulMigrationQuarantine/{quarantineId}`
```
{ kind: 'orphanSession'|'orphanNote', quarantinedAt, quarantineReason, sourceCollection, ...kind-specific }
```
Global, deliberately **not** trainer-scoped (an unmatched-prefix note has no reliable trainerKey to
scope under at all). Admin-only. Holds exactly the 2 V1 records the migrator could not safely
resolve automatically (1 orphaned session, 1 orphaned note) — preserved verbatim, never dropped,
never guessed onto a trainer/client. `ADR_002`.

## Index summary

| Field | Scope | Status (as of 2026-09-21) | Serves |
|---|---|---|---|
| `clients.id` | COLLECTION + COLLECTION_GROUP | READY | `ClientRepository.listAllTrainers()` (V2, unused) |
| `sessions.sessionId` | COLLECTION + COLLECTION_GROUP | READY | `SessionRepository.listAllTrainers()` (V2, unused) |
| `historico.clienteId` | COLLECTION + COLLECTION_GROUP | READY | pre-enabled for a future admin view (V2, unused) |
| everything else touched by `firestore.indexes.json` | exempted (`indexes: []`) | N/A | never queried, kept unindexed on purpose |

No composite indexes exist or are needed (every real query in the DAL is single-field equality;
`besoulSuite/agenda` is never queried at all, only fetched by ID).

## Rules ↔ Firestore project state

Live ruleset as of this document: deployed 2026-09-18 (release `updateTime`
`2026-09-18T11:14:04Z`), confirmed byte-identical to `firestore.rules` at repo HEAD via the
official (read-only) Firebase Rules API both immediately after that deploy and again during this
incident's investigation — nobody has changed it since. `firestore.indexes.json` similarly
unchanged since that same deploy.
