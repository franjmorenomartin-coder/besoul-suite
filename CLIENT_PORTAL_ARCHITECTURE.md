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

**Limitación conocida, documentada, no resuelta en código -- pero ya NO oculta al usuario**: el procesamiento requiere que `agenda.html` esté abierta (con `onSnapshot` activo) en la sesión de algún PT/admin para ese `trainerKey`. Si el PT no tiene la pestaña abierta, la solicitud queda en `estado:'pendiente'` hasta que la abra. Decisión tomada explícitamente (CLIENT-05, 2026-09-04) tras la instrucción de no presentar esto como definitivo: en vez de deshabilitar el botón de cancelación (que quitaría una función real y ya funcional cuando el PT SÍ está conectado, que es la mayor parte del horario operativo), el texto de confirmación y el mensaje final en `portal-cliente.html` ahora dicen explícitamente "se aplicará en cuanto tu entrenador la reciba... no instantáneo garantizado" -- nunca se insinúa procesamiento inmediato. El mecanismo de solicitud (`besoulCancelacionesCliente` + `procesarCancelacionCliente()`) queda intacto y es el que usará el backend real cuando exista, sin cambios de contrato.

## 5bis. Contrato de Cloud Function para cancelación determinista (NO desplegada, NO implementada -- solo especificación)

Diseño listo para implementar cuando se autorice infraestructura de backend. Publicado aquí como contrato exacto, no como código parcialmente construido.

**Trigger**: Firestore `onCreate` sobre `besoulCancelacionesCliente/{id}` (Cloud Functions v2, `onDocumentCreated`). Se dispara en el momento exacto de la creación, sin depender de que ninguna pestaña de `agenda.html` esté abierta -- esto es lo que resuelve la limitación de raíz.

**Entrada** (ya es exactamente el payload que `portal-cliente.html` ya crea hoy -- CERO cambios en el cliente para esta parte):
```ts
{
  token: string;            // res_...
  clientId: string;
  clientName: string;
  trainerKey: string;
  clave: string;             // "YYYY-MM-DD_HH:MM"
  fechaISO: string;
  hora: string;
  cancelacionMinHoras: number;
  estado: 'pendiente';
  creadaEn: Timestamp;
}
```

**Pasos de la función** (idénticos, 1:1, a los que hoy ejecuta `procesarCancelacionCliente()` del lado del PT -- se migra la MISMA lógica, no se reinventa):

```
1. Validar token/clientId/trainerKey:
   leer besoulPublicClients/{token} -- si no existe, o clientId/trainerKey no
   coinciden -> marcar estado:'error', motivoError, salir. (mismo cross-check
   que ya usan las Rules de besoulReservas.create y la propuesta de
   besoulCancelacionesCliente.create de la sección 4)

2. Validar que la cita pertenece a ese cliente:
   leer besoulSuite/agenda, campo dbAgenda[trainerKey][clave] (vía Admin SDK,
   que SÍ puede leer el documento monolítico -- la función corre con
   privilegios de servidor, no con el token público del cliente) -- si no
   existe o su .id !== clientId -> estado:'error', salir.

3. Recalcular horas restantes EN EL SERVIDOR (Date.now() del propio backend,
   nunca un valor recibido del cliente):
   horas = (fechaHoraSesion - ahoraServidor) / 3600000
   dentroDePlazo = horas >= cancelacionMinHoras, releído del propio
   besoulPublicClients/{token} en este mismo paso, ignorando el campo
   cancelacionMinHoras que viaja en la solicitud (CLIENT-08, 2026-09-04:
   corrección de esta misma nota -- procesarCancelacionCliente() NO hacía
   esto todavía cuando se escribió esta sección por primera vez, confiaba
   directamente en data.cancelacionMinHoras del payload; se verificó el
   código real antes de asumirlo y se corrigió tanto ahí como en el
   contrato de la función de abajo, que ya nace con el re-read estricto).

4. Si dentroDePlazo:
   - Firestore transaction: delete dbAgenda[trainerKey][clave] dentro de
     besoulSuite/agenda, limpiar la nota asociada.
   - estado final: 'procesada', dentroDePlazoAplicado: true.

5. Si NO dentroDePlazo:
   - Firestore transaction: dbAgenda[trainerKey][clave].estadoCancelacion =
     'cancelada_fuera_plazo' (NUNCA delete -- sigue consumiendo sesión).
   - estado final: 'procesada', dentroDePlazoAplicado: false.

6. Evitar doble cancelación / races:
   - El id determinista (`trainerKey__clave__cancel`) YA lo impide a nivel de
     escritura de la solicitud (el cliente comprueba con un get() antes del
     create, y un segundo create() sobre el mismo id con Rules que NO
     permiten overwrite público falla). La función, además, debe comprobar
     al empezar que `estado === 'pendiente'` -- si el trigger se re-entrega
     (Cloud Functions garantiza "at least once", no "exactly once") y el
     documento ya tiene estado:'procesada' o 'error', la función debe
     salir inmediatamente sin repetir el efecto. Esto es lo que hace la
     función IDEMPOTENTE de verdad, no solo "improbable que falle dos
     veces".
   - La escritura sobre besoulSuite/agenda debe ir dentro de una
     Firestore transaction que primero relee dbAgenda[trainerKey][clave]
     y confirma que sigue siendo la MISMA cita (mismo clientId) antes de
     tocarla -- evita una condición de carrera si el PT movió/borró esa
     cita manualmente en el intervalo entre la creación de la solicitud
     y el procesamiento.

7. Idempotencia end-to-end:
   - Reintentar la función entera con el mismo id de solicitud (mismo
     evento de Cloud Functions, o un reintento manual) debe producir el
     mismo resultado final sin duplicar efectos -- garantizado por el
     paso 6 (early-exit si ya no está 'pendiente') combinado con la
     transaction del paso 4/5 (que vuelve a comprobar el estado real de
     la cita antes de aplicar el cambio, no solo "confía" en que sigue
     igual que cuando se leyó la solicitud).
```

**Qué NO cambia si se despliega esto en el futuro**: el cliente (`portal-cliente.html`) no necesita ningún cambio -- ya crea el documento con la forma correcta. `agenda.html` puede seguir teniendo su listener (`iniciarModuloCancelacionesCliente`) como mecanismo de refuerzo/fallback visual (para que el PT vea el cambio reflejado sin recargar), pero deja de ser el ÚNICO camino de procesamiento -- la Cloud Function se convierte en la vía primaria y determinista, y el listener del PT pasa a ser redundante-mas-no-crítico.

**Por qué no se implementa ahora**: requiere (a) un proyecto de Cloud Functions activo con facturación habilitada (Firestore triggers de 2ª generación requieren Cloud Run/Eventarc), (b) despliegue con credenciales de servicio que este entorno no tiene, (c) autorización explícita para tocar infraestructura de producción -- ninguna de las tres existe en esta sesión. El contrato queda listo para que, cuando exista, la implementación sea una traducción directa de `procesarCancelacionCliente()` a Cloud Function, no un diseño nuevo desde cero.

**CLIENT-08 (2026-09-04) — el contrato ya se tradujo a código real**: `functions/cancelacionCliente.js` (+ `functions/package.json`) implementa exactamente los 7 pasos de arriba, con `onDocumentCreated` de `firebase-functions/v2/firestore`. NO se ha ejecutado `firebase init functions`, no existe `firebase.json` en el repo, no se ha instalado ninguna dependencia, y no se ha desplegado nada -- las tres condiciones de más arriba siguen sin cumplirse. El archivo es código listo para revisar/desplegar el día que se autorice, no una especificación en prosa.

## 6. Reservar — cero lógica duplicada

El tab "Reservar" del portal **no reimplementa disponibilidad ni transacciones**. Es un enlace directo a `reservas.html?token=<mismo token>` -- la página ya existente, ya con: cálculo de huecos libres, bloqueos por cliente, ID determinista por franja (`trainerKey__clave` individual, `trainerKey__clave__clientId` para grupos abiertos) y `runTransaction()` para evitar condiciones de carrera entre dos clientes solicitando la misma franja. El campo `source: 'portalCliente'` ya existía en el payload de `reservas.html` antes de esta fase -- la página ya estaba preparada para ser embebida/enlazada desde un portal futuro.

## 7. Avisos (CLIENT-06, 2026-09-04) — modelo real, evaluado y conectado

**Se evaluó reutilizar `besoulNotifications` primero, como pedía el brief, y se descartó con motivo documentado**: esa colección exige `isActiveUser()` para leer y escribir (`firestore.rules`, sección `besoulNotifications`) -- es decir, requiere una sesión real de Firebase Auth. Un cliente del portal NO tiene sesión de Firebase Auth (accede por token, ver sección 1) -- por diseño, no por descuido. Añadir un tercer `audience:'client'` a esa colección habría exigido debilitar su regla de acceso (`isActiveUser()` → algo que también acepte un token público), tocando la seguridad de un buzón que hoy es exclusivamente de PT/admin. Se rechazó esa vía y se usó en su lugar la MISMA proyección aislada por cliente que ya existe (`besoulPublicClients/{token}`), consistente con la sección 2 de este documento.

**Modelo implementado**:
- Campo nuevo `avisos` (array, máx. 10 más recientes) dentro de `besoulPublicClients/{token}` -- `{ id, fecha, contenido }`. Escrito EXCLUSIVAMENTE por `agenda.html` (mismo batch-write trusted que ya escribe `sesionesContratadas`/etc. -- **cero Rules nuevas**, la regla ya valida por `trainerKey`, no por campo).
- Origen del contenido: se reutiliza el flujo YA EXISTENTE de `abrirModalAvisoMultiple()` (el PT selecciona clientes, escribe un mensaje, y por cada cliente pulsa "Abrir WhatsApp" para enviarlo) -- se añadió un efecto colateral en `abrirWhatsAppAvisoCliente(id)`: el mismo mensaje que se envía por WhatsApp se añade también a `ficha.avisosPortal` y se sincroniza. El PT no aprende ninguna interfaz nueva.
- `entrenador` = `trainerName` (ya presente en el documento). `contenido` y `fecha` = los del aviso. `leído/no leído` = **rastreado solo en `localStorage` del navegador del cliente** (`bs_portal_leidos_<token>`), nunca escrito a Firestore -- evita que un cliente sin cuenta necesite permiso de escritura en Firestore solo para marcar algo como leído; el coste es que "leído" no se sincroniza entre dispositivos del mismo cliente, aceptado como limitación menor y documentado.
- El cliente **solo puede leer las suyas** por construcción: es el mismo documento aislado por token de siempre (sección 2), no una colección nueva con su propia superficie de Rules que auditar.

**Qué sigue sin existir**: un editor de avisos independiente del flujo de WhatsApp (hoy el aviso del portal siempre acompaña a un envío de WhatsApp, no se puede crear uno "solo para el portal"). Aceptado como alcance suficiente para esta fase -- añadirlo es un cambio pequeño y aislado sobre la misma función si se pide después.

### 7bis. CLIENT-09 (2026-09-04) — leído sincronizado entre dispositivos (propuesta, NO conectada)

El brief de esta fase pedía, como preferencia ("preferible"), que el estado leído/no-leído se sincronizara entre dispositivos del mismo cliente -- hoy vive solo en `localStorage` (sección 7 arriba), por diseño, para no requerir ninguna Rule nueva. Esta fase añade la Rule que lo permitiría, sin conectar el cliente todavía:

```
// firestore.rules, dentro de match /besoulPublicClients/{token}, tercera rama de "update":
|| (request.auth == null
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['avisosLeidos'])
    && request.resource.data.avisosLeidos is list);
```

- **Por qué es seguro dejar escribir a un caller sin autenticar**: su "identidad" ya es el propio token -- es exactamente el mismo modelo que ya permite `allow get: if true` (quien tiene el enlace, puede leer *ese* documento; aquí, quien tiene el enlace, puede tocar *un solo campo* de *ese* documento). La whitelist de `affectedKeys()` es la que hace el resto: cualquier intento de tocar `sesionesContratadas`, `email`, `activo`, etc. en la misma escritura hace que la regla entera falle -- no hay forma de colar un cambio a otro campo aprovechando este hueco.
- **Campo nuevo, no reutiliza el array `avisos`**: `avisosLeidos` sería un array de ids de aviso (`string[]`), separado del array `avisos` (que solo escribe `agenda.html`, ownership de PT). Mantener dos campos distintos evita que la Rule de "el cliente puede tocar esto" y la Rule de "el PT puede tocar esto" compartan el mismo campo con distintas garantías.
- **Por qué NO se conecta `portal-cliente.html` todavía**: la Rule de arriba es una propuesta, no está desplegada. Conectar el cliente a escribir contra ella hoy produciría el mismo patrón que motivó CLIENT-07 (una función que aparenta funcionar pero siempre falla con `permission-denied` contra producción) -- se prefiere, otra vez, no presentar como funcional algo que depende de infraestructura no desplegada. Cuando se autorice desplegar esta Rule, conectar `marcarAvisoLeido()` (ya existente, hoy solo local) a escribir también en Firestore es un cambio pequeño y aislado, no un rediseño.

## 8. Qué NO se ha hecho en esta fase

- No se ha desplegado ninguna Rule nueva ni modificado ninguna existente.
- No se ha escrito ningún dato real de cliente.
- No existe todavía backend/Cloud Function para procesar cancelaciones sin que el PT tenga Agenda abierta.
- Avisos del portal no están conectados a una fuente de datos real todavía (sección 7).
- No se ha construido una vista de "detalle de sesión" ni edición de perfil por parte del cliente (fuera del alcance pedido: "sin chat en esta fase" ya excluía explícitamente parte de esto).
