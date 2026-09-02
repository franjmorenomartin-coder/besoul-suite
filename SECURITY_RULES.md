# SECURITY_RULES.md · BESOUL Suite

Estado: documentación de las reglas Firestore consideradas reales en producción.

Última actualización: 2026-09-01  
Ticket: BS-009 (histórico) · SEC-010/SEC-011 (propuesta pendiente, ver abajo)  
Tipo de cambio: documentación  
Producción/Firebase: NO modificado  
Código app: modificado (ver `BESOUL_WORK_STATE.md` — escritura dirigida por trainerKey ya desplegada en código, las Rules de esta sección siguen siendo las REALES en producción hasta que se despliegue la propuesta)  

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

## Propuesta pendiente de despliegue (SEC-010 / SEC-011)

El archivo `firestore.rules` en la raíz del repo contiene una propuesta completa, lista para revisar y desplegar, que añade:

1. `match /besoulSolicitudesEliminacion/{solicitudId}` — hoy esa colección cae en el `catch-all` de abajo (deny-all total), lo que bloquea por completo el flujo de baja segura de clientes ya implementado en `agenda.html`.
2. `besoulPublicClients` con comprobación de propiedad por `trainerKey` en `create`/`update` (hoy cualquier usuario activo puede tocar el enlace público de cualquier otro entrenador).
3. `besoulReservas.create` con verificación cruzada de `token`/`clientId`/`trainerKey` contra `besoulPublicClients/{token}` (hoy solo se valida la forma del payload, no que los datos correspondan realmente entre sí).
4. `besoulSuite/agenda`: `signedIn()` → `isActiveUser()` — hoy un usuario autenticado pero marcado `activo:false` en `besoulUsers` conserva acceso de lectura/escritura al documento Agenda completo, porque `signedIn()` solo comprueba autenticación, no el perfil.
5. Un bloque opcional, comentado por defecto, de aislamiento de **escritura** por `trainerKey` dentro de `besoulSuite/agenda` — solo activar tras validar en producción que la escritura dirigida por `trainerKey` (`merge:true`, ya en el código) funciona sin errores durante unos días.

**Modelo de aislamiento real, resumido por colección** (para no afirmar un aislamiento que no existe):
- `besoulLeads`, `besoulPublicClients`, `besoulReservas`, `besoulSolicitudesEliminacion`: ownership real por `trainerKey` ya en las Rules propuestas (create/read/update comprueban `trainerKey==myTrainerKey()` según el caso); `besoulSolicitudesEliminacion` además exige `isAdmin()` para aprobar/rechazar, sin excepción para el propio solicitante.
- `besoulSuite/finanzas`: solo admin (`isAdmin()`), sin acceso de PT en absoluto.
- `besoulSuite/agenda`: **NO tiene aislamiento de lectura por PT, y su aislamiento de escritura por PT es opcional y sigue sin activar.** Todos los entrenadores comparten un único documento; cualquier usuario activo puede leer (y, mientras el bloque FASE 2 siga sin activar, también escribir) los datos de **todos** los demás PT. Esto es una limitación real de la arquitectura actual (documento monolítico), no un descuido menor — resolverlo del todo requeriría dividir el documento por `trainerKey`, fuera de alcance de esta ronda de Rules.

**No se ha desplegado.** Este entorno de trabajo no tiene Firebase CLI ni credenciales configuradas para desplegar reglas reales — el despliegue requiere que el responsable del proyecto lo haga manualmente (Firebase Console o `firebase deploy --only firestore:rules` desde un entorno con acceso), idealmente tras probar contra el emulador de Firestore con los 4 casos de rol (no-auth, PT propio, PT ajeno, admin), siguiendo el proceso que este mismo documento exige arriba. Detalle completo del análisis y de cada regla en `BESOUL_WORK_STATE.md`.

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
