# Portal Cliente — arquitectura, seguridad y Rules propuestas

Documento de arquitectura + propuesta. Las Rules descritas en la sección 4 **no se han desplegado** — siguen sin autorización explícita, como el resto de esta fase.

## 1. Decisión de identidad: reutilizar el token existente, no inventar login

`agenda.html` ya genera un `reservaToken` (`res_...`) por cada cliente activo con email+teléfono y lo publica en `besoulPublicClients/{token}` (colección ya desplegada, ya con Rules reales — ver sección 3). `reservas.html` ya usa ese mismo token como identidad de acceso ("capability URL": quien posee el enlace, entra) sin pedir usuario/contraseña.

El portal cliente (`portal-cliente.html`) reutiliza **exactamente el mismo token y el mismo documento**, en vez de construir un sistema de login nuevo (Firebase Auth por email/contraseña para clientes, verificación, recuperación de contraseña...). Motivo: introducir una segunda identidad de cliente sería una superficie de seguridad nueva y una carga operativa nueva (altas, bajas, "olvidé mi contraseña") para un caso de uso donde el enlace privado ya es el modelo que BESOUL usa hoy con reservas, y donde el propio dato (`besoulPublicClients/{token}`) ya está diseñado, auditado y con Rules reales para no exponer nada de otros clientes.

## 2. Aislamiento de datos — por qué un cliente no puede leer a otro

- `portal-cliente.html` hace **una sola lectura**: `db.collection('besoulPublicClients').doc(token).get()`. Nunca lee `besoulSuite/agenda` (el documento monolítico por entrenador, con TODOS sus clientes) ni ninguna colección que agregue varios clientes.
- La Rule ya desplegada (`allow get: if true; allow list: if false;`) permite leer **un documento por su ID exacto**, nunca listar/consultar la colección. Sin conocer el token exacto (aleatorio, `res_<8 chars>_<8 chars>` en base36 -- ver `generarTokenReservaCliente()`), no hay forma de enumerar ni adivinar el documento de otro cliente.
- El documento en sí (`besoulPublicClients/{token}`) contiene **únicamente los campos de ese cliente** -- nombre, contador de sesiones, próximas/recientes sesiones, disponibilidad de su entrenador. Nunca contiene datos de otros clientes del mismo entrenador. Esto ya era así (era el diseño de `reservas.html`); esta fase solo añade más campos al mismo documento aislado, no cambia el modelo de aislamiento.
- El cálculo de esos campos (`sesionesContratadas`, `proximasSesiones`, etc.) ocurre **en `agenda.html`, del lado del PT ya autenticado**, con las mismas funciones que ya usa el resto de Agenda (`calcularContadorClases`, lectura de `dbAgenda[trainerKey]`). El cliente nunca ejecuta ese cálculo ni tiene acceso al dato crudo del que sale.

## 3. Qué ya estaba desplegado (sin cambios en esta fase)

```
match /besoulPublicClients/{token} {
  allow get: if true;
  allow list: if false;
  allow create: if isActiveUser() && request.resource.data.trainerKey == myTrainerKey();
  allow update: if isAdmin() || (isActiveUser() && resource.data.trainerKey == myTrainerKey() && request.resource.data.trainerKey == resource.data.trainerKey);
  allow delete: if isAdmin();
}
```

Los campos nuevos que `agenda.html` ahora escribe en este documento (`sesionesContratadas`, `sesionesUsadas`, `sesionesPendientes`, `periodoSesiones`, `proximaSesion`, `proximasSesiones`, `sesionesRecientes`, `cancelacionMinHoras`) **no requieren ningún cambio de Rules** -- la regla de `create`/`update` ya valida por `trainerKey`, no por campo, así que el mismo camino de escritura que ya funcionaba para `disponibilidad`/`ocupados` cubre los campos nuevos sin tocar nada desplegado.

## 4. Colección NUEVA propuesta — `besoulCancelacionesCliente` (NO desplegada)

El cliente necesita poder cancelar su propia sesión. La app **no puede** dejar que el token público escriba directamente en `besoulSuite/agenda` (documento monolítico por entrenador, sin permisos a nivel de celda -- dejar eso abierto sería un agujero real: un solo `update` mal acotado podría tocar la agenda entera de un PT). En vez de eso, se sigue el mismo patrón ya usado para `besoulReservas` (solicitud pública validada, procesada por la sesión ya autenticada del PT):

```
match /besoulCancelacionesCliente/{id} {
  // El cliente público solo puede CREAR, y solo si el token/clientId/trainerKey del payload
  // coinciden REALMENTE con un besoulPublicClients/{token} existente -- mismo patrón de
  // comprobación cruzada que ya protege besoulReservas.create hoy.
  allow create: if request.resource.data.estado == 'pendiente'
    && request.resource.data.token is string
    && request.resource.data.clientId is string
    && request.resource.data.trainerKey is string
    && request.resource.data.clave is string
    && exists(/databases/$(database)/documents/besoulPublicClients/$(request.resource.data.token))
    && get(/databases/$(database)/documents/besoulPublicClients/$(request.resource.data.token)).data.clientId == request.resource.data.clientId
    && get(/databases/$(database)/documents/besoulPublicClients/$(request.resource.data.token)).data.trainerKey == request.resource.data.trainerKey;

  // Solo el PT dueño (o admin) puede leer/procesar/actualizar el estado de la solicitud.
  allow read, update: if isAdmin() || (isActiveUser() && resource.data.trainerKey == myTrainerKey());

  allow delete: if isAdmin();
}
```

**ID determinista** (`${trainerKey}__${clave}__cancel`, igual que el patrón ya usado en `besoulReservas`): evita que el mismo cliente pueda spamear cancelaciones duplicadas de la misma sesión -- la segunda petición de `create` para la misma sesión choca contra un documento que ya existe (el cliente ya comprueba esto con un `get()` antes de intentar el `create`, pero la protección real está en que reintentar `create` sobre un ID ya usado con Rules que no incluyan `update` público simplemente sobrescribiría con las mismas Rules de creación, no puede degradar el estado ya procesado por el PT).

## 5. Flujo de cancelación, extremo a extremo

```
portal-cliente.html                    besoulCancelacionesCliente        agenda.html (PT autenticado)
  │ cliente pulsa "Cancelar"                                                   │
  │ calcula horas hasta la sesión                                             │
  │ si < cancelacionMinHoras: aviso                                           │
  │ explícito + confirmación                                                  │
  │─────────── create(id determinista) ─────────────►│                        │
  │                                                    │◄── onSnapshot ────────│
  │                                                    │   (iniciarModuloCancelacionesCliente,
  │                                                    │    where trainerKey==propio)
  │                                                    │   procesarCancelacionCliente():
  │                                                    │   - valida sesión existe y coincide clientId
  │                                                    │   - recalcula holgura horaria EN SERVIDOR-SIDE
  │                                                    │     (no confía en el "dentroDePlazo" que
  │                                                    │      pudiera mandar el cliente, si se
  │                                                    │      añadiera -- hoy ni se manda, se
  │                                                    │      recalcula siempre del lado del PT)
  │                                                    │   - >= plazo: delete dbAgenda[...][clave]
  │                                                    │   - < plazo: dbAgenda[...][clave].estadoCancelacion
  │                                                    │     = 'cancelada_fuera_plazo' (NUNCA se borra,
  │                                                    │     sigue consumiendo la sesión)
  │                                                    │   - guardarEstadoNubeAgenda()
  │                                                    │◄── set(estado:'procesada') ────────────────────│
```

Importante: `procesarCancelacionCliente()` **recalcula las horas hasta la sesión con su propio reloj**, no confía en un campo `dentroDePlazo` enviado por el cliente -- el cliente podría, en teoría, manipular ese valor antes de enviarlo, así que la decisión real (que la sesión se libere o se marque como fuera de plazo) siempre se toma del lado ya autenticado del PT.

**Limitación conocida, documentada, no resuelta**: el procesamiento requiere que `agenda.html` esté abierta (con `onSnapshot` activo) en la sesión de algún PT/admin para ese `trainerKey`. Si el PT no tiene la pestaña abierta, la solicitud queda en `estado:'pendiente'` hasta que la abra. Para procesamiento inmediato de verdad, haría falta una Cloud Function -- misma categoría de trabajo de backend que la integración de IA real (ver `AI_ASSISTANT_ARCHITECTURE.md`), no implementada en esta fase.

## 6. Reservar — cero lógica duplicada

El tab "Reservar" del portal **no reimplementa disponibilidad ni transacciones**. Es un enlace directo a `reservas.html?token=<mismo token>` -- la página ya existente, ya con: cálculo de huecos libres, bloqueos por cliente, ID determinista por franja (`trainerKey__clave` individual, `trainerKey__clave__clientId` para grupos abiertos) y `runTransaction()` para evitar condiciones de carrera entre dos clientes solicitando la misma franja. El campo `source: 'portalCliente'` ya existía en el payload de `reservas.html` antes de esta fase -- la página ya estaba preparada para ser embebida/enlazada desde un portal futuro.

## 7. Avisos — estado actual (parcial, documentado)

La pestaña "Avisos" existe en la UI pero **no tiene todavía una fuente de datos real conectada**: no hay hoy ningún campo en la ficha de cliente ni en `besoulPublicClients` que represente "avisos enviados por el entrenador a este cliente en concreto". Se deja como estado vacío honesto ("No tienes avisos nuevos") en vez de inventar datos falsos. Para conectarlo de verdad haría falta: (a) decidir si los avisos son un array dentro de `besoulPublicClients/{token}` (simple, coherente con el resto) o una sub-colección (mejor si crecen mucho), y (b) una UI en Agenda para que el PT redacte avisos por cliente (hoy `abrirModalAvisoMultiple()` envía avisos por WhatsApp, no los guarda como dato leíble desde el portal). Ninguna de las dos cosas se ha construido en esta fase -- identificado como el hueco más claro de "Portal Cliente" para una siguiente iteración.

## 8. Qué NO se ha hecho en esta fase

- No se ha desplegado ninguna Rule nueva ni modificado ninguna existente.
- No se ha escrito ningún dato real de cliente.
- No existe todavía backend/Cloud Function para procesar cancelaciones sin que el PT tenga Agenda abierta.
- Avisos del portal no están conectados a una fuente de datos real todavía (sección 7).
- No se ha construido una vista de "detalle de sesión" ni edición de perfil por parte del cliente (fuera del alcance pedido: "sin chat en esta fase" ya excluía explícitamente parte de esto).
