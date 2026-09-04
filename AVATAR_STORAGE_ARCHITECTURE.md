# B9 — Arquitectura de avatar de cliente vía Firebase Storage (propuesta, NO desplegada)

No se ha desplegado Storage. No se han abierto Storage Rules. No existe ningún bucket configurado en este entorno para probarlo contra Storage real. Este documento es arquitectura + Rules propuestas, listas para revisar, no código de subida sin probar presentado como funcional -- mismo criterio que ya rigió `functions/cancelacionCliente.js` (preparado, no ejecutado) y que evitó, en `portal-cliente.html`/`agenda.html`, escribir un botón "Cambiar foto" que pareciera activo sin estarlo.

## 1. Por qué NO base64 en Firestore

- Un avatar en JPEG/WebP, aunque comprimido, típicamente pesa 30-150 KB -- muy por encima de lo razonable para un campo de documento (Firestore soporta hasta 1 MiB por documento, pero `besoulPublicClients/{token}` y las fichas dentro de `besoulSuite/agenda` ya comparten espacio con mucho más contenido; incrustar imágenes ahí competiría directamente con el límite de tamaño ya identificado como riesgo en `AGENDA_MONOLITHIC_RISK.md`).
- Cada lectura del documento (incluida cada carga del Portal) descargaría la imagen completa codificada en base64 (~33% más pesada que el binario original) aunque no hiciera falta mostrarla de nuevo -- Storage permite cachear/servir el binario de forma nativa vía CDN, Firestore no.

## 2. Ruta de almacenamiento propuesta

```
avatares/{trainerKey}/{clientId}.{ext}
```

Un único archivo activo por cliente (se sobrescribe al reemplazar, no se acumulan versiones -- simplicidad deliberada; si se quisiera histórico de avatares, sería una carpeta `avatares/{trainerKey}/{clientId}/` con timestamp, pero no se ha pedido y añadiría complejidad de limpieza sin beneficio claro hoy).

`ext` restringido a `jpg`/`png`/`webp` (ver sección 4). El `trainerKey` en la ruta permite que las Storage Rules repliquen exactamente el mismo modelo de ownership que ya usa `besoulPublicClients` en Firestore, sin tener que consultar Firestore desde Storage Rules para cada archivo.

## 3. Storage Rules propuestas (NO desplegadas)

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatares/{trainerKey}/{fileName} {
      // Lectura pública, igual criterio que besoulPublicClients.get: una foto de perfil no es
      // más sensible que el nombre que YA se muestra sin autenticación en el Portal/reservas.html
      // (capability URL, mismo modelo ya auditado en SECURITY_AUDIT_PORTAL.md). Sin esto, el
      // Portal Cliente (sin sesión Firebase Auth) no podría ni mostrar su propia foto.
      allow read: if true;

      // Escritura: mismo ownership que Firestore, comprobado vía Storage Rules v2 (que SÍ puede
      // leer Firestore con firestore.get(), evitando duplicar la lógica de perfiles/roles).
      allow write: if request.auth != null
        && request.auth.token.email != null
        && firestore.get(/databases/(default)/documents/besoulUsers/$(request.auth.token.email)).data.activo == true
        && (
          firestore.get(/databases/(default)/documents/besoulUsers/$(request.auth.token.email)).data.rol == 'admin'
          || firestore.get(/databases/(default)/documents/besoulUsers/$(request.auth.token.email)).data.trainerKey == trainerKey
        )
        && request.resource.size < 3 * 1024 * 1024
        && request.resource.contentType.matches('image/(jpeg|png|webp)');

      allow delete: if request.auth != null
        && request.auth.token.email != null
        && (
          firestore.get(/databases/(default)/documents/besoulUsers/$(request.auth.token.email)).data.rol == 'admin'
          || firestore.get(/databases/(default)/documents/besoulUsers/$(request.auth.token.email)).data.trainerKey == trainerKey
        );
    }
    match /{allPaths=**} { allow read, write: if false; }
  }
}
```

Solo el PT dueño (o admin) puede subir/reemplazar/borrar el avatar de un cliente -- el cliente mismo (identidad = token, sin Firebase Auth) **no sube su propia foto directamente**; se la envía a su PT (WhatsApp, en persona) y el PT la sube desde `agenda.html`, exactamente igual que hoy se gestionan el resto de datos de la ficha. Evita abrir una superficie de escritura pública nueva sobre Storage.

## 4. Compresión, formato, tamaño

- **Formatos aceptados**: `image/jpeg`, `image/png`, `image/webp` -- rechazar cualquier otro `contentType` tanto en cliente (input `accept`) como en Rules (defensa en profundidad, nunca confiar solo en el cliente).
- **Tamaño máximo de subida**: 3 MB antes de comprimir (límite generoso para no frustrar a quien sube directo desde una cámara de móvil).
- **Compresión cliente, antes de subir** (Canvas API, sin dependencias): redimensionar al lado mayor a 512px (suficiente para un avatar, incluso en pantallas retina a 256px de render) y re-codificar como JPEG calidad ~0.82 -- objetivo realista final: 30-120 KB por archivo.
- **Recorte simple**: recorte centrado cuadrado (`object-fit: cover` conceptual, aplicado en el propio canvas antes de subir) -- no un editor de recorte interactivo completo (fuera de alcance, "crop simple si es viable" en el brief admite esta simplificación).

## 5. Reemplazo, eliminación, fallback

- **Reemplazar**: subir con el mismo `fileName` (`{clientId}.{ext}`) sobrescribe el archivo anterior -- no requiere borrar primero. Si el nuevo archivo cambia de extensión (p.ej. de `.jpg` a `.webp`), el archivo antiguo con la extensión vieja quedaría huérfano -- mitigación: fijar SIEMPRE la extensión de salida a `.jpg` en la compresión cliente (sección 4), independientemente del formato de entrada, así el nombre de archivo es siempre determinista y una subida nueva siempre sobrescribe la única existente.
- **Eliminar** (quitar foto, volver a iniciales): borra el archivo de Storage y limpia `avatarUrl`/`avatarPath` en la ficha del cliente (mismo mecanismo de guardado ya existente en `agenda.html`, sin Rules nuevas de Firestore -- esos dos campos ya viajan en el batch de `publicarReservasPublicas()`, PORTAL-02).
- **Fallback**: si `avatarUrl` está vacío, iniciales en círculo de degradado ámbar -- ya implementado en `portal-cliente.html` (`avatarHTML()`) y `agenda.html` (`avatarMiniHTML()`), funcionando hoy sin necesitar Storage.

## 6. Campos Firestore (ya preparados, PORTAL-02)

`avatarUrl` (URL de descarga pública de Storage) y `avatarPath` (ruta interna `avatares/{trainerKey}/{clientId}.jpg`, útil para poder borrar/reemplazar sin tener que derivar la ruta de la URL) ya se publican vacíos en `besoulPublicClients/{token}` desde PORTAL-02 -- el día que exista una subida real, rellenar estos dos campos en la ficha del cliente (`dbClientes`) es el único cambio de datos necesario; el batch de publicación ya los reenvía sin tocar código de publicación otra vez.

## 7. Qué falta para activar esto de verdad (ninguno ejecutado en esta fase)

1. Autorización explícita para habilitar Firebase Storage en el proyecto (puede que ya esté habilitado por `storageBucket` en `firebaseConfig` -- no confirmado, requiere acceso a Firebase Console que este entorno no tiene).
2. Desplegar las Storage Rules de la sección 3 (mismo proceso de aprobación que Firestore Rules: revisar contra emulador, backup, aprobación explícita).
3. Escribir el código de subida real en `agenda.html` (input file + compresión Canvas + `uploadBytes`/`getDownloadURL` del SDK de Storage) -- no escrito en esta fase para no presentar un flujo de subida sin poder probarlo contra Storage real, mismo criterio que evitó el problema original de "Cancelar" en el Portal.
4. Activar los botones "Cambiar foto" (hoy `disabled`, en `portal-cliente.html` -- perfil del cliente -- y pendiente de añadir el mismo patrón a la ficha de cliente en `agenda.html` si se decide permitir que el PT suba la foto desde ahí).
