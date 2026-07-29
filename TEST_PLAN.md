# Test Plan - BESOUL Suite

## Pre-release manual tests

### General

- Open `index.html`.
- Login as admin.
- Login as PT.
- Verify logout.
- Verify wrong user cannot access restricted module.

### Agenda

- Load week view.
- Create a 45-minute session.
- Verify it blocks 3 slots.
- Move a session.
- Delete a session.
- Add a note.
- Mark a session as recovery/non-billable as admin.
- Verify PT cannot access admin-only actions.
- Create/edit an individual client.
- Verify phone and email validation.
- Create/edit a group.
- Verify group members do not act as individually billable clients.
- Verify CRM trials appear in agenda and are not billable.

### CRM

- Create lead.
- Change lead status.
- Schedule trial.
- Verify trial appears in agenda.
- Convert lead to client.
- Verify converted lead does not duplicate trial.
- Verify PT only sees assigned leads.

### Finanzas

- Open as admin.
- Verify PT cannot access.
- Verify monthly memberships bill whole month.
- Verify packs/single sessions bill by scheduled billable sessions.
- Verify recovery/non-billable sessions do not count.
- Verify CRM trials do not count.
- Verify center cost allocation.
- Verify trainer ranges.
- Verify expenses by month.
- Verify historical month closing.

### Dashboard

- Open as admin.
- Verify data loads.
- Verify filters work.
- Verify charts do not write to Firestore.
- Verify export CSV if available.
- Verify no critical console errors.

### Reservas

- Generate/copy customer booking link.
- Open link in private/incognito window.
- Verify customer sees only their own booking options.
- Verify no internal data appears.
- Submit request.
- Verify request appears in Agenda > Reservas.
- Accept request.
- Verify agenda session is created and blocks 45 minutes.
- Reject request.
- Verify no agenda session is created.

### PWA

- Open on Android Chrome.
- Install app.
- Verify icon.
- Open from installed icon.
- Open on iPhone Safari.
- Add to Home Screen.
- Verify icon and app name.
