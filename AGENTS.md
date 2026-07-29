# BESOUL Suite - Instructions for Codex Agents

## Mission

BESOUL Suite is a production web app for managing a personal training business with multiple centers, trainers, clients, CRM, finances, dashboard analytics and customer booking requests.

The mission is to professionalize the app without breaking existing production functionality.

## Current stack

- Static HTML/CSS/JavaScript.
- Firebase Authentication.
- Firestore.
- GitHub Pages.
- Progressive Web App with `manifest.json` and `sw.js`.
- No Firebase Storage at this stage.
- No external backend unless explicitly approved.

## Production rule

This app is already used in production. Do not break existing behavior.

Before editing:
1. Inspect the relevant file.
2. Understand the current data model.
3. Propose a small plan.
4. Make the smallest safe change.
5. Validate login, agenda, CRM, finances, dashboard, reservations and PWA.

## Main files

- `index.html`: main portal.
- `agenda.html`: trainer agenda, clients, groups, availability and reservations.
- `crm.html`: leads, trials and lead-to-client conversion.
- `finanzas.html`: trainer economics, ranges, center costs, company expenses and monthly history.
- `dashboard.html`: executive analytics.
- `reservas.html`: public/private customer booking request portal.
- `manifest.json`: PWA metadata.
- `sw.js`: service worker.
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`: PWA icons.

## Roles

- `admin`: full access.
- `pt`: trainer access limited to own trainerKey-related data.
- external customer: token-based booking request only; no login and no internal data.

## Critical business rules

- A normal session lasts 45 minutes.
- Calendar slots are 15 minutes.
- One normal session blocks 3 slots.
- CRM trials appear in agenda but are not billable.
- Recovery / non-billable sessions must not count in finance.
- Monthly memberships bill the whole month.
- Session packs and single sessions bill only according to billable scheduled sessions.
- Group members must not duplicate individual revenue.
- Real clients require phone and email.
- The customer booking portal starts as request-only, not direct booking.
- Trainer defines operative availability.
- Customer only sees available slots within trainer availability.
- A booking request stays `pendiente` until admin/PT accepts or rejects.
- When accepted, a real agenda session is created and blocks 45 minutes.

## Firestore collections

- `besoulUsers/{email}`
- `besoulSuite/agenda`
- `besoulSuite/finanzas`
- `besoulLeads/{leadId}`
- `besoulPublicClients/{token}`
- `besoulPublicSchedule/{trainerKey}`
- `besoulReservas/{reservaId}`

If adding or modifying collections, update `FIREBASE_SCHEMA.md`.

## Security principles

- Authenticated internal users only for admin/PT modules.
- Admin has full access.
- PT only sees their own trainerKey-related data.
- External booking portal reads only public token-based documents.
- External booking portal can only create pending reservation requests.
- No secrets in the repository.
- Do not store passwords in source files or documentation.
- Do not expose broad public list/read.
- Finanzas must remain admin-only.
- Dashboard is read-only.

## Coding rules

- Prefer small incremental changes.
- Do not rewrite large files without approval.
- Avoid duplicated business logic; extract shared logic carefully.
- Keep GitHub Pages compatibility.
- Keep PWA compatibility.
- Preserve mobile layouts.
- Avoid global variable conflicts.
- Use clear Spanish UI labels.
- Use defensive checks before reading nested data.
- Preserve existing Firestore document shapes unless a migration is planned.
- Never change existing `trainerKey` values without a migration plan.

## Manual testing checklist

After relevant changes, verify:

1. Login works.
2. Admin can access all modules.
3. PT can only access allowed data.
4. Agenda loads.
5. A session can be created.
6. A session blocks 45 minutes.
7. A session can be moved/deleted.
8. CRM lead can be created.
9. CRM trial appears in Agenda.
10. Lead can be converted to client.
11. Finance calculations still load.
12. Dashboard loads and does not write data.
13. Booking link opens without login.
14. Booking request is created as pending.
15. Booking request can be accepted.
16. Accepted request creates an agenda session.
17. PWA still installs and icon appears.
18. Browser console has no critical errors.

## Response / PR style

When finishing a task, report:

- Files changed.
- What changed.
- Why it changed.
- How it was tested.
- Risks or pending checks.
