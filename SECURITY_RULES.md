# SECURITY_RULES.md · BESOUL Suite

Estado: documentación de las reglas Firestore consideradas reales en producción.

Última actualización: 2026-08-26  
Ticket: BS-009  
Tipo de cambio: documentación  
Producción/Firebase: NO modificado  
Código app: NO modificado  

## Aviso importante

Este documento refleja las reglas Firestore actuales aportadas manualmente por el responsable del proyecto.

No despliega reglas.
No modifica Firebase.
No modifica Firestore.
No modifica datos.
No modifica lógica de negocio.

Para cambiar reglas reales, debe hacerse un ticket independiente con:
- backup previo,
- pruebas por rol,
- rollback,
- aprobación explícita.

## Reglas Firestore actuales

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

    function isPublicTrialLead() {
      return request.auth == null
        && request.resource.data.keys().hasOnly([
          'nombre', 'telefono', 'email',
          'centroId', 'centroNombre',
          'estado', 'fuente', 'medioCaptacion', 'captadorNombre',
          'trainerKey', 'trainerName',
          'objetivo', 'horarioPreferido',
          'tipoPrueba', 'duracionPrueba',
          'notas', 'notaEntrenadorPrueba',
          'createdAt', 'updatedAt',
          'createdByEmail', 'createdByName',
          'updatedByEmail', 'updatedByName',
          'convertido', 'origenPublico', 'origenQR',
          'sourceParam', 'campana',
          'valoracionUnica', 'leadId'
        ])
        && request.resource.data.nombre is string
        && request.resource.data.telefono is string
        && request.resource.data.email is string
        && request.resource.data.centroId is string
        && request.resource.data.centroNombre is string
        && request.resource.data.estado == 'Prueba solicitada'
        && request.resource.data.fuente == 'QR valoración'
        && request.resource.data.trainerKey == ''
        && request.resource.data.trainerName == ''
        && request.resource.data.tipoPrueba == 'Valoración inicial'
        && request.resource.data.duracionPrueba == '45 min'
        && request.resource.data.convertido == false
        && request.resource.data.origenPublico in ['valoracion.html', 'prueba.html']
        && request.resource.data.origenQR == true;
    }

    match /besoulUsers/{email} {
      // Cada usuario autenticado puede leer directamente SU propio perfil.
      // Esto evita depender de isActiveUser() para poder leer el documento
      // que precisamente necesitamos para calcular isActiveUser().
      allow get: if signedIn() && email == request.auth.token.email;

      // Administración puede leer/listar todos los perfiles.
      allow get, list: if isAdmin();

      allow create, update, delete: if isAdmin();
    }

 match /besoulSuite/{docId} {
  // Agenda compartida: cualquier usuario autenticado de BESOUL puede leer/escribir agenda.
  allow read, write: if signedIn() && docId == 'agenda';

  // Finanzas sigue reservado solo para administración.
  allow read, write: if isAdmin() && docId == 'finanzas';
}

    match /besoulLeads/{leadId} {
      allow read: if isAdmin()
        || (isActiveUser() && resource.data.trainerKey == myTrainerKey());

      allow create: if isPublicTrialLead()
        || isAdmin()
        || (isActiveUser() && request.resource.data.trainerKey == myTrainerKey());

      allow update: if isAdmin()
        || (
          isActiveUser()
          && resource.data.trainerKey == myTrainerKey()
          && request.resource.data.trainerKey == myTrainerKey()
        );

      allow delete: if isAdmin();
    }

    match /besoulPublicConfig/{docId} {
      allow get: if docId == 'centros';
      allow list: if false;
      allow create, update, delete: if isActiveUser();
    }


    match /besoulValoracionRegistry/{keyId} {
      allow get: if true;
      allow list: if false;

      allow create: if request.auth == null
        && request.resource.data.kind in ['email', 'phone']
        && request.resource.data.leadId is string
        && request.resource.data.nombre is string
        && request.resource.data.source == 'valoracion_publica';

      allow read, update, delete: if isActiveUser();
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

      // Admin ve todas. Un PT solo ve/gestiona reservas asignadas a su trainerKey.
      allow read: if isAdmin()
        || (isActiveUser() && resource.data.trainerKey == myTrainerKey());

      allow update, delete: if isAdmin()
        || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
