# CRM — duplicados, fecha de alta real y CSV por rango

Branch `HOTFIX-CRM-DUPLICADOS-FECHA-ALTA` (from `main` a95e02c). Local only — not deployed.
Origin: the read-only incident audit (duplicate clients; Sandra could not export September and
October together and late-entered clients counted in the wrong month).

## 1. Duplicate prevention

| Path | Before | Now |
|---|---|---|
| CRM "Guardar lead" (new) | `.add()` with a random id on every click; button live for the whole save | Id reserved when the form opens; created in a transaction that never touches `createdAt` on retry; click lock + disabled button "Guardando…"; after creation the form edits that document, so any retry updates the same lead |
| CRM new lead | No identity check | Soft check by normalized phone/email against leads and all Agenda clients |
| CRM → Agenda conversion | Only "same lead, same trainer" | Soft check against Agenda by phone/email; inside the transaction the lead is also read and the already-linked client is searched across **all** trainers |
| Agenda "Guardar Ficha" (new individual) | No identity check | Same soft check across all trainers' clients, before any local state changes |
| Public QR form | Registry by email and by "digits only" phone | Canonical phone key + all legacy variant keys checked in the same transaction |
| CRM registry sync | One batch (fails silently > 500 writes) | Chunked batches of ≤ 450 |

The warning never merges, deletes or blocks: **Abrir existente / Crear igualmente / Cancelar**.
"Crear igualmente" is a deliberate action and is remembered only for that same pending save.

**Name alone is never identity.** Hard signals only: normalized phone, normalized email.

## 2. Normalization (`besoul-identidad.js`, shared by CRM, Agenda, QR, Dashboard)

- Email: trim + lowercase. Dots and `+tags` are kept (they can be different people).
- Phone → canonical digits with country code:
  `612345678`, `+34612345678`, `+34 612 345 678`, `0034612345678`, `34612345678` → `34612345678`.
  `+44 7700 900123` / `0044…` → `447700900123` (country preserved).
  A number without prefix that is not recognisably Spanish is kept as typed (no country invented).

## 3. Dates

| Concept | Field | UI | Editable |
|---|---|---|---|
| Registered in Besoul (audit) | `createdAt` | "Registrado en Besoul" | Never (Rules) |
| Real signup (business) | `fechaAltaReal` | "Fecha de alta real" | Admin (CRM is admin-only; Rules: lead update admin-only) |
| Conversion registered | `convertedAt` / `fechaConversion` | "Fecha conversión" | No |

- New leads default `fechaAltaReal` to **today in Madrid**. Leads from the public QR form do not
  write it (their Rules shape is unchanged); readers use the fallback, which is the same date.
- Compatibility: `fechaNegocio = fechaAltaReal ?? Madrid date of createdAt`. No migration.
- Every change is appended to `historial`: old value, new value, user, timestamp. A late entry
  (alta real ≠ today) is also logged at creation.
- All day boundaries use the **Europe/Madrid** calendar (00:30 on 1 October is October, not
  30 September UTC).

## 4. KPI semantics (decision)

Not a mechanical `createdAt` replacement:

- **Cohort metrics** — "leads that belong to this period": Leads, Contactados, Valoraciones
  solicitadas/realizadas, **Convertidos**, % conversión, Perdidos, fuente/centro/trainer top,
  and the Dashboard CRM funnel + "Conversión CRM". Grouped by the selected date basis, default
  **Fecha de alta real** (the CRM also offers "Fecha de registro").
- **Event metric** — "conversions that happened in this period": new KPI **Conversiones
  registradas**, by `fechaConversion` (Madrid date of `convertedAt`), with the same non-date
  filters.

Example (Sandra): person joined 28/09, entered and converted on 01/10.
September cohort: counted as lead and as *Convertido*. October: *Conversiones registradas* +1.
Both are true; each label says which question it answers.

## 5. CRM range and CSV

- Filters **Desde / Hasta** (inclusive Madrid days, default current month) + **Fecha** (alta real /
  registro). Screen, KPIs and CSV use exactly the same criteria (`criterioFechasCRM()`).
- CSV = what is on screen (range + centre/trainer/status/source/search). Previous columns kept
  with the same names; added *Fecha de alta real*, *Registrado en Besoul*, *Fecha valoración*,
  *Fecha conversión* (dd/mm/yyyy, times in Madrid). UTF-8 **with BOM**, `;` separator, CRLF.
  File name: `besoul_leads_<alta-real|registro>_<desde>_a_<hasta>.csv`.

## 6. CRM → Agenda

The client's "Fecha de alta" receives the lead's **Fecha de alta real** (shown in the confirm
dialog), not the technical conversion instant. `fechaCambioEstado` and `fechaConversion` use the
Madrid calendar (fixes the previous-day bug between 00:00 and 02:00).

## 7. Security / roles

- CRM remains admin-only. Trainers still cannot create or update leads (Rules unchanged there).
- New Rule: lead `createdAt` is immutable for everyone (including admin); a historical lead
  without it can still be edited but cannot be given one.
- Agenda "Fecha de alta" (client record) remains editable by the owning trainer, as before.
  Reviewed: **no company KPI reads it** — CRM/Dashboard reporting uses the lead's
  `fechaAltaReal`, which only admins can change. If reporting ever starts using the client
  field, it must first become admin-controlled or audited.

## 8. Known separate issues (not changed here)

- **KNOWN SEPARATE ISSUE — REQUIRES FINANCE AUDIT.** `finanzas.html` (and the Dashboard's
  Finance-derived figures) compute any month from the *current* list of active client records,
  with no date gating; monthly memberships count for the whole of any viewed month, and records
  that later become inactive disappear from past months. Not modified.
- Existing duplicates are **not** merged, deleted or tombstoned. A separate read-only duplicate
  audit is planned.
- Some committed `*_extract.js` snapshots on `main` were already stale versus `main`'s own
  `agenda.html` (e.g. `concurrency-tests` fails with its committed snapshot and passes once
  re-extracted). Pre-existing; left as is.
- `rules-tests/run_notas_feasibility_probe.cjs` reports 2/3 on `main`'s Rules too (pre-existing
  probe about the `notas` map).

## 9. Local review harness

`.review-local/` + `besoul-entorno-local.js`: emulator-only visual review with synthetic data.
Guard and usage in `.review-local/README.md` (localhost + http + explicit `?emulador=1`; demo
project id; production hostname can never activate it). The folder and its emulator config
(`.firebase.review-local.json`) start with a dot so GitHub Pages (Jekyll build) does not publish
them; `besoul-entorno-local.js` itself stays published because the pages load it (inert there).

## 10. Tests

- `node crm-incident-tests/run_tests.cjs` — 111 checks; runs the real page scripts with a
  controllable clock and an in-memory Firestore (latency, errors, lost-ack commits, 500-write
  batch limit).
- `rules-tests/run_tests.cjs` (Firestore emulator) — includes the createdAt / fechaAltaReal rules.
