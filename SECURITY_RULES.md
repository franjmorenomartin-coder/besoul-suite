# Security Rules - BESOUL Suite

## Principles

- Internal modules require Firebase Authentication.
- Admin has full access.
- PT access must be limited to their own `trainerKey`.
- Customer reservation portal is token-based and public only for minimal data.
- External customers must not list collections.
- External customers must not read agenda, CRM, finances, users or internal notes.
- External customers can only create `pendiente` booking requests.
- Dashboard must be read-only.
- Finanzas must be admin-only in the UI and should remain protected by rules and application logic.

## Current Firestore rules

Use this as the expected full ruleset unless a controlled migration is approved.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null && request.auth.token.email != null;
    }

    function getProfile() {
      return get(/databases/$(database)/documents/besoulUsers/$(request.auth.token.email));
    }

    function userProfileExists() {
      return signedIn()
        && exists(/databases/$(database)/documents/besoulUsers/$(request.auth.token.email));
    }

    function isActiveUser() {
      return userProfileExists()
        && getProfile().data.activo == true;
    }

    function isAdmin() {
      return isActiveUser()
        && getProfile().data.rol == 'admin';
    }

    function myTrainerKey() {
      return getProfile().data.trainerKey;
    }

    match /besoulUsers/{email} {
      allow read: if isActiveUser()
        && (email == request.auth.token.email || isAdmin());

      allow create, update, delete: if isAdmin();
    }

    match /besoulSuite/{docId} {
      allow read, write: if isActiveUser()
        && docId in ['agenda', 'finanzas'];
    }

    match /besoulLeads/{leadId} {
      allow read: if isAdmin()
        || (isActiveUser() && resource.data.trainerKey == myTrainerKey());

      allow create: if isAdmin()
        || (isActiveUser() && request.resource.data.trainerKey == myTrainerKey());

      allow update: if isAdmin()
        || (
          isActiveUser()
          && resource.data.trainerKey == myTrainerKey()
          && request.resource.data.trainerKey == myTrainerKey()
        );

      allow delete: if isAdmin();
    }

    match /besoulPublicClients/{token} {
      allow get: if true;
      allow list: if false;
      allow create, update, delete: if isActiveUser();
    }

    match /besoulPublicSchedule/{trainerKey} {
      allow get: if true;
      allow list: if false;
      allow create, update, delete: if isActiveUser();
    }

    match /besoulReservas/{reservaId} {
      allow create: if request.resource.data.estado == 'pendiente'
        && request.resource.data.token is string
        && request.resource.data.clientId is string
        && request.resource.data.trainerKey is string
        && request.resource.data.fechaISO is string
        && request.resource.data.hora is string
        && request.resource.data.clave is string
        && request.resource.data.duracionMin == 45;

      allow read, update, delete: if isActiveUser();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```
