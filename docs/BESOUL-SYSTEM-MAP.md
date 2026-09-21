# BESOUL System Map

Written 2026-09-21, during the SAVE INCIDENT investigation, so future sessions don't have to
reconstruct this from scratch. Grounded in the actual repo (grep/read, not memory) as of `main`
commit `72a31ed` (frontend) and `firestore.rules`/`firestore.indexes.json` as deployed to
`besoul-suite` on 2026-09-18. See also `BESOUL-FIRESTORE-MAP.md` (the data model in detail) and
`BESOUL-DATA-FLOWS.md` (diagrams, including the trainer save flow this incident is about).

## 1. Entry points

No build pipeline. Every page is a single, self-contained `.html` file (Firebase Web compat SDK
loaded via `<script>` tags, no bundler, no framework) served as-is by **GitHub Pages** from `main`.
Firebase Hosting exists as a configured site but does **not** serve the frontend — confirmed by
`firestore-index-config-tests/run_tests.cjs`'s own assertions ("`firebase.json` NO declara
`hosting`") and by every deploy this project has ever done using `--only firestore:*` targets only.

| File | Role |
|---|---|
| `index.html` | Landing/login entry (`BESOUL Suite`) |
| `agenda.html` | **The main app.** PT's own agenda/clients/calendar, and Admin's "ver como PT" view of the same. ~9000+ lines. |
| `crm.html` | Lead management (CRM) — admin-only past login gate (ROLE-01) |
| `finanzas.html` | Pricing/activity catalog, financial config — admin-only |
| `dashboard.html` | Cross-trainer aggregate metrics — **admin-only**, enforced both by Firestore Rules (`isAdmin()`) and a client-side guard (`perfil.rol !== 'admin'` throws) |
| `portal-cliente.html` | Unauthenticated client-facing booking portal (token-based "capability URL", no login) |
| `valoracion.html`, `prueba.html` | Public, unauthenticated trial-signup forms (feed `besoulLeads` via `isPublicTrialLead()`) |
| `sw.js` | Service worker — network-first, `skipWaiting()` + `clients.claim()` (the most aggressive update strategy available; ruled out as a staleness source during the earlier false-conflict investigation, no fix ever needed there) |
| `manifest.json` / `manifest-portal.json` | PWA manifests — separate `start_url`/`scope` isolating the client-portal install flow from the PT/admin one |

**Firebase initialization**: every page defines its own `const BS_FIREBASE_CONFIG = {...}` (or
`firebaseConfig` in `portal-cliente.html`) — identical project config, duplicated per file (no
shared module to import, consistent with "no build pipeline"). Every page guards with
`if (!firebase.apps.length) firebase.initializeApp(...)`. `agenda.html` calls this guarded
initializer from **two** separate setup functions (main app bootstrap, and a second one — both
idempotent, confirmed no double-init risk).

**Auth initialization**: Firebase Auth (email/password), gated by a `besoulUsers/{email}` profile
document — `rol` (`pt`|`admin`) and `activo` (boolean) live there, not in the Auth user record
itself. See §8 for how this flows into Rules.

## 2. Applications / areas

- **ADMIN**: `dashboard.html` (aggregate view) + admin-mode inside `agenda.html`/`crm.html`/
  `finanzas.html` (same HTML file, different capabilities gated by `isAdmin()` client-side checks
  mirroring the server-side Rules). Admin's signature capability inside `agenda.html`: **"ver como
  PT"** — sets `entrenadorVisto` to any trainerKey and operates against that trainer's data,
  authorized server-side by the `isAdmin()` bypass present on every `besoulSuite/agenda` write.
- **TRAINER / PT**: `agenda.html` in its normal (non-admin) mode — own clients, own calendar, own
  availability, own CRM leads (read-only), own notes.
- **CLIENT / PORTAL**: `portal-cliente.html` (booking, no login — a token in the URL IS the
  identity, the same "capability URL" model as `besoulPublicClients/{token}`), plus
  `valoracion.html`/`prueba.html` (pre-client, public trial signup, feeds the CRM as a lead).

## 3. Data access

**No DAL exists for V1.** Every V1 page talks to Firestore directly via the Web compat SDK
(`firebase.firestore().collection(...).doc(...)`) — no repository layer, no adapter, no shared
helper module (each page re-implements what it needs). This is a known, accepted characteristic of
this codebase, not an oversight.

**V2 has a DAL** (`dal/`), built during the DATA-ARCHITECTURE-V2 phase — **not wired into any page
yet** (`dal/config.js` defaults to `mode: 'v1'`, and no `<script>` tag in any HTML file references
`dal/`). Structure: `dal/v1Adapter.js` (read-only wrapper over V1's real shape, used only by the
migrator/verifier), `dal/v2/*Repository.js` (one per V2 collection — trainer, client, session,
availability, note, historico, finance, user, quarantine), `dal/index.js` (facade picking
V1-vs-V2 by `dal/config.js`). See `BESOUL-FIRESTORE-MAP.md` §V2 for the full collection list.

**Listeners** (`onSnapshot`, all in `agenda.html`, all V1, all scoped to the currently authenticated
user's own visibility):
| Listener | Target | Purpose |
|---|---|---|
| `window.bsAgendaCloudDocRef.onSnapshot(...)` | `besoulSuite/agenda` (the whole monolith doc) | Drives `aplicarEstadoNubeAgenda()` — see §10, the save flow |
| `consultaLeadsPermitidosAgenda(firestore).onSnapshot(...)` | `besoulLeads` (own trainerKey or all, if admin) | "Pruebas" cards in the PT's own Agenda |
| `window.bsNotificacionesUnsub` | `besoulNotifications` (own trainerKey or all) | Notification badge/panel |
| `window.bsEliminacionUnsub` | `besoulSolicitudesEliminacion` | Deletion-request review flow |
| `window.bsReservasUnsub` | `besoulReservas` | Incoming portal booking requests |
| `window.bsCancelacionesUnsub` | `besoulCancelacionesCliente` | Client-initiated cancellation requests |

**Transactions**: exactly one, `docRef.firestore.runTransaction(...)` inside
`guardarEstadoNubeAgenda()` — read-compare-write concurrency control for the trainer save flow (the
subject of this incident; full trace in §10).

**Batch writes**: `publicarReservasPublicas()` (called after every successful agenda save) publishes
to `besoulPublicClients`/`besoulPublicSchedule` per-trainer, isolated by trainerKey so one trainer's
publish failure can't affect another's (a real fix from an earlier phase, PORTAL-PUBLICATION-P0).

**Local cache**: `localStorage` only (no `sessionStorage` usage anywhere in the repo — confirmed by
grep). Keys, all versioned `_v6`/`_v1`: `bs_db_credenciales_v6`, `bs_db_clientes_v6`,
`bs_db_agenda_v6`, `bs_db_pruebas_crm_v6`, `bs_db_disponibilidad_reservas_v6`,
`bs_db_notas_v6`, `bs_db_historico_clientes_v6`, `bs_db_leads_pruebas_crm_v6`,
`bs_modo_agenda_slots_v1`. Written by `aplicarEstadoNubeAgenda()` as an **offline mirror** of the
last known server state (read back on next load before the network round-trip completes) — never
the source of truth, never consulted by the save-conflict comparison (see §10;
`window.bsUltimoServidorConocido`, a separate in-memory-only variable, is what that comparison
uses).

## 4. Firestore data model (real, as deployed)

See `BESOUL-FIRESTORE-MAP.md` for the full field-level tree. Summary:

```
besoulSuite/agenda            -- V1 MONOLITH: clientes/agenda/pruebasCRM/disponibilidadReservas/
                                  historicoClientes/notas for ALL trainers, one document
besoulSuite/finanzas          -- V1 pricing/activity catalog, one document, admin-only
besoulUsers/{email}           -- V1 identity (rol, trainerKey, activo) -- keyed by email
besoulLeads/{leadId}          -- CRM leads, top-level, own trainerKey field
besoulPublicClients/{token}   -- public booking-link projection (capability URL)
besoulPublicSchedule/{trainerKey}
besoulPublicConfig/centros
besoulValoracionRegistry/{keyId}
besoulReservas/{reservaId}    -- incoming portal booking requests
besoulNotifications/{notifId}
besoulSolicitudesEliminacion/{solicitudId}
besoulCancelacionesCliente/{id}  -- Rules exist (catch-all deny until a proposal is deployed;
                                     no evidence this is live -- see BESOUL-FIRESTORE-MAP.md)

besoulUsersV2/{uid}                              -- V2 identity, uid-keyed, NOT used by any page
trainers/{trainerKey}                            -- V2 operational profile
trainers/{trainerKey}/clients/{clientId}
trainers/{trainerKey}/sessions/{sessionId}
trainers/{trainerKey}/availability/current
trainers/{trainerKey}/historico/{mesKey}_{clientId}
trainers/{trainerKey}/notes/{noteKey}
besoulFinance/config                             -- V2 relocation of besoulSuite/finanzas
besoulMigrationQuarantine/{quarantineId}          -- V2 migration audit trail (admin-only, global)
```

## 5. V1 architecture

One document (`besoulSuite/agenda`) holds **every trainer's** clients, sessions, availability,
history, and CRM-trial mirror, keyed internally by trainerKey. Firestore has no partial-document
read, so **every** active session reading this document reads *all* trainers' data on every load —
a known, documented, accepted limitation (`AGENDA_MONOLITHIC_RISK.md`, pre-dates this phase).
Writes are scoped by trainerKey via dotted-FieldPath `update()` calls (`'clientes.<trainerKey>':
[...]`), enforced server-side by FASE 2 Rules (§8). Identity resolves through
`besoulUsers/{email}` via the Auth token's email claim.

## 6. V2 architecture

Trainer-scoped subcollections under `trainers/{trainerKey}/**`, each document independent (no
shared monolith, no cross-trainer contention possible by construction). Identity resolves through
`besoulUsersV2/{uid}` via the Auth UID (not email) — a deliberately separate, non-overlapping
identity chain from V1's, so V2's Rules can never alter what a V1 request is allowed to do (proven
by a byte-for-byte diff of the V1-copied Rules section, both at design time and again immediately
before the 2026-09-18 production deploy). Full design rationale: `DATA_ARCHITECTURE_V2.md`.

## 7. V1 ↔ V2 relationship

| | V1 | V2 |
|---|---|---|
| **Reads** | Every page, every load (`besoulSuite/agenda`, `besoulUsers`, etc.) | Nothing — no page ever reads a V2 collection |
| **Writes** | Every save (`agenda.html`), CRM (`crm.html`), finance config (`finanzas.html`) | Only the migrator (`scripts/migrate-v1-to-v2.cjs --apply`), run once manually on 2026-09-18 |
| **Synchronized / copied** | — | V2 was populated with a **one-time additive copy** from V1 on 2026-09-18 (998 operational docs + 2 quarantined records). Verified equivalent at copy time (`verify-v1-v2.cjs`: all rows MATCH) and re-verified after the Rules/indexes deploy (still MATCH). **No ongoing sync exists** — V1 has continued to receive real writes since, and V2 has NOT been updated to reflect them (no dual-write, no shadow-write, by explicit design — see `ROLLBACK_V2.md`). |
| **NOT connected yet** | — | The DAL (`dal/`), the V2 Rules/indexes (deployed but unused), the whole V2 collection tree |
| **Source of truth** | **YES — exclusively.** | No. V2 is a validated-but-inert copy, safe to discard/regenerate at will (it has never been written to by a real user action). |

**Practical consequence for this incident**: since `agenda.html` only ever reads/writes
`besoulSuite/agenda` (V1) and V2 is completely inert, V2 cannot be a contributing factor to a save
failure in `agenda.html` by construction — there is no code path connecting them yet. This was
verified, not assumed (see the incident report).

## 8. Firestore Rules map

| Collection | App(s) | Module | Operation | Role required |
|---|---|---|---|---|
| `besoulUsers/{email}` | all | login bootstrap | `get` own | any signed-in user |
| | `dashboard.html`, admin UI | user management | `get,list,create,update,delete` | admin |
| `besoulSuite/agenda` | `agenda.html` | `aplicarEstadoNubeAgenda`/`guardarEstadoNubeAgenda` | `read` | active user (any role) |
| | `agenda.html` | `guardarEstadoNubeAgenda` (transaction) | `write`, own trainerKey slice only (FASE 2) | active user; admin bypasses the trainerKey restriction |
| `besoulSuite/finanzas` | `finanzas.html` | catalog/pricing editor | `read,write` | admin only |
| `besoulLeads/{leadId}` | `agenda.html` (read), `crm.html` (write), `valoracion.html`/`prueba.html` (public create) | CRM | `read` own trainerKey; `create` admin or public-trial-shape; `update,delete` admin | pt (read-own) / admin / anonymous (create, whitelisted shape) |
| `besoulPublicClients/{token}` | `portal-cliente.html` (read/limited update), `agenda.html` (publish) | booking capability link | `get` public; `create` own trainerKey or admin; `update` own/admin/anonymous-whitelist-only (`avisosLeidos`); `delete` admin | anonymous / pt-own / admin |
| `besoulPublicSchedule/{trainerKey}` | `portal-cliente.html`, `agenda.html` | published availability | `get` public; `create,update,delete` active user | anonymous (read) / pt (write) |
| `besoulReservas/{reservaId}` | `portal-cliente.html` (create), `agenda.html` (read/manage) | booking requests | `create` public, cross-validated against a real `besoulPublicClients` doc; `read,update,delete` own trainerKey or admin | anonymous (create) / pt-own / admin |
| `besoulNotifications/{notifId}` | `agenda.html` | notification panel | `create` any active user (cross-trainerKey allowed, no sensitive data); `read` own or admin; `update` whitelisted (`read`,`readAt`) | active user |
| `besoulSolicitudesEliminacion/{id}` | `agenda.html` | client deletion requests | `create` own trainerKey (or admin on behalf of); `read` own/admin; `update` admin only, whitelisted | pt-own / admin |
| **V2**: `besoulUsersV2/{uid}` | none (design-only) | — | `get` own; self-`update` whitelist (never rol/trainerKey/activo); admin full | active user / admin |
| **V2**: `trainers/{trainerKey}/**` (5 subcollections) | none | — | `get,list,write` own trainerKey or admin | active user (own) / admin |
| **V2**: `besoulFinance/config` | none | — | `read,write` | admin only |
| **V2**: `besoulMigrationQuarantine/{id}` | none | — | `read,write` | admin only, **not** trainer-scoped |
| everything else | — | — | catch-all `deny` | nobody, including admin |

Full matrix + empirical Emulator proof: `SECURITY_MODEL_V2.md`, `rules-v2-tests/`, `rules-tests/`.

## 9. Firestore index map

| Index | Query it serves |
|---|---|
| `besoulSuite.*` (wildcard, no auto-index) | N/A — no query ever targets `besoulSuite` as a collection (every access is `.doc('agenda')`/`.doc('finanzas')` by literal ID, never a `.where()`/`.orderBy()`); exempted specifically to avoid the "too many index entries for entity /besoulSuite/agenda" incident this field-override config was originally built to fix |
| `clients.id` (COLLECTION + COLLECTION_GROUP) | `ClientRepository.listAllTrainers()` — V2, unused by any page yet |
| `sessions.sessionId` (COLLECTION + COLLECTION_GROUP) | `SessionRepository.listAllTrainers()` — V2, unused |
| `historico.clienteId` (COLLECTION + COLLECTION_GROUP) | pre-enabled for a future admin cross-trainer historico view — V2, unused |
| `notes.texto`, `besoulMigrationQuarantine.texto`/`originalEntry`, `trainers.actividadesAutorizadas`, `besoulFinance.{catalogoActividades,tarifasActividadVersiones,repartoActividadVersiones}`, `sessions.asistentesGrupoAbierto` | exempted (no query targets them; large/never-queried fields, kept unindexed on purpose) |

**Important, demonstrated fact**: the trainer save flow (`besoulSuite/agenda`) never performs a
Firestore *query* at all — every read is `.doc('agenda').get()` or `tx.get(docRef)`, a direct
document lookup by ID. Direct document lookups never consult any index, V1 or V2, built or building.
This is why the 3 collectionGroup indexes that were still `CREATING` right after the 2026-09-18
deploy could not have caused (and did not cause) the save incident — confirmed by tracing the actual
code path, not by assumption.

## 10. Save flows

### TRAINER SAVE FLOW (the one this incident is about)

```
User edits a field in agenda.html (client, session, availability, note, ...)
  ↓
programarGuardadoNubeAgenda(trainerKeyScope?)     -- debounced 350ms, fire-and-forget
  ↓  (after debounce settles)
guardarEstadoNubeAgenda(trainerKeyScope)
  ↓
scope = trainerKeyScope || entrenadorVisto        -- refuses to save with no known scope
  ↓
payload = estadoLocalAgendaParaNube(scope)        -- builds a TARGETED payload: only
  ↓                                                    {clientes.<scope>, agenda.<scope>,
  ↓                                                    pruebasCRM.<scope>, disponibilidadReservas.<scope>,
  ↓                                                    historicoClientes.<scope>, notas, ultimaActualizacionLocal}
valorInvalidoParaFirestore(payload)               -- blocks BEFORE any network call if anything is
  ↓                                                    undefined/NaN/function/circular
payload.actualizadoEn = serverTimestamp()
  ↓
docRef.firestore.runTransaction(async tx => {
    actual = (await tx.get(docRef)).data()         -- FRESH read of besoulSuite/agenda
    compare CAMPOS_CONCURRENCIA_COMPARABLES fields
      window.bsUltimoServidorConocido[campo][scope]  vs  actual[campo][scope]
      (JSON.stringify equality, per field)
    if different  → throw { code: 'conflict' }
    else           → tx.update(docRef, ...payloadParaUpdateFirestore(payload))  -- dotted FieldPath update
})
  ↓ (on success)
window.bsUltimoServidorConocido updated for [campo][scope]        -- THE FIX for this incident
  ↓
publicarReservasPublicas()                         -- best-effort, doesn't affect the save's own result
  ↓
{ ok: true }
```

**On conflict** (`.catch`): logs `[BESOUL CONFLICT DIAG]` (no PII — hashes/counts/booleans only),
returns `{ ok: false, err: { code: 'conflict', message: '...cambios más recientes de este
entrenador...' } }` — the exact message this incident is about.

**Where `window.bsUltimoServidorConocido` (the concurrency baseline) is set**:
1. `aplicarEstadoNubeAgenda(data)` — every time the `onSnapshot` listener on `besoulSuite/agenda`
   fires (page load, or any change to the document by anyone, any trainer). Captured via
   `JSON.parse(JSON.stringify(...))` from the raw snapshot data, **before** any local aliasing
   assignment (`dbAgenda = data.agenda`, etc.) — the fix for an earlier false-conflict incident
   (contamination via `sincronizarPruebasCRMDentroDeAgenda()` mutating an aliased object).
2. **(new, this incident's fix)** `guardarEstadoNubeAgenda()`'s own success path — updates just the
   `[campo][scope]` slice this tab itself just wrote, deep-copied, so a second save from the same
   tab doesn't have to wait for the listener's network round-trip to know what it itself just did.

Document/collection: `besoulSuite/agenda` (single document, V1, `firestore.rules` `match
/besoulSuite/{docId}`). See `BESOUL-DATA-FLOWS.md` for the Mermaid sequence diagram.
