# Roadmap - BESOUL Suite

## Phase 1 - Stabilization

- Keep current production app stable.
- Document business rules and Firestore schema.
- Verify Firestore rules.
- Verify PWA installation and icon behavior.
- Check browser console errors.
- Ensure backup/export procedure before major changes.

## Phase 2 - Professional UI / UX

- Unify visual design across all modules.
- Improve mobile navigation.
- Improve forms and validation messages.
- Make admin/PT permissions more visible.
- Improve empty states and error states.
- Make customer booking portal more polished.

## Phase 3 - Booking requests

- Improve trainer availability editor.
- Improve request management.
- Add booking request history.
- Add cancellation flow.
- Add automatic reminders or notifications when infrastructure allows.
- Keep direct booking disabled until the operation is validated.

## Phase 4 - Code quality

- Extract shared Firebase initialization.
- Extract shared authentication and permissions.
- Extract date/time utilities.
- Extract money/finance utilities.
- Extract agenda slot/blocking logic.
- Reduce duplicated code while preserving behavior.

## Phase 5 - Professional architecture

- Consider migration to Firebase Hosting.
- Add custom domain when available.
- Consider Cloud Functions for notifications and secure server-side actions.
- Consider Vite + React + TypeScript once business logic is stable and documented.
- Add automated tests for finance, agenda slot blocking, bookings and permissions.

## Phase 6 - Advanced platform

- Customer app evolution.
- Trainer app experience.
- Executive reporting and PDF/CSV exports.
- WhatsApp/email notifications.
- Audit log.
- Backup and restore tooling.
