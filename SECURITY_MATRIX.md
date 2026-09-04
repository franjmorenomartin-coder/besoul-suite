# SEC-03 — Matriz de seguridad real (auditoría, 2026-09-04)

Leída directamente contra `firestore.rules` tal y como queda tras SEC-04/SEC-05/SEC-06/CLIENT-09 de esta fase (no de memoria, no de documentos anteriores sin re-verificar). Para cada colección se separan tres cosas que NO son lo mismo:

- **Restricción UI**: lo que la app impide hacer desde su propia interfaz (login guards, botones ocultos, etc.). No es seguridad real -- es evitable por cualquiera que hable con Firestore directamente (consola del navegador, `curl` al SDK, etc.).
- **Restricción real Firestore**: lo que `firestore.rules` impediría de verdad SI ESTUVIERA DESPLEGADO. IMPORTANTE: `firestore.rules` en este repo es una propuesta -- ver cabecera del propio archivo. Salvo que se indique lo contrario, asumir que la producción actual sigue las Rules documentadas en `SECURITY_RULES.md` como último estado desplegado conocido, no necesariamente este archivo completo.
- **Riesgo residual**: lo que queda expuesto incluso si TODO lo de este archivo estuviera desplegado.

No se llama "RLS completo" a nada de esto -- Firestore no tiene RLS a nivel de fila/celda dentro de un documento monolítico (ver sección Agenda, y `AGENDA_MONOLITHIC_RISK.md`), así que la comparación con RLS de una base de datos relacional sería engañosa.

## `besoulSuite/agenda` (documento único, TODOS los trainers dentro)

**SEC-07 (2026-09-04) — corrección importante**: la versión anterior de esta tabla analizaba la Rule tal como aparece en el fichero de PROPUESTA (`firestore.rules`: `isActiveUser() && docId=='agenda'`). Esa NO es la Rule desplegada en producción hoy. Según `SECURITY_RULES.md` (única fuente que documenta el estado real desplegado, fecha 2026-09-01), la Rule REAL en producción es:

```
allow read, write: if signedIn() && docId == 'agenda';
```

`signedIn()` (`request.auth != null && request.auth.token.email != null`) es una comprobación MÁS DÉBIL que `isActiveUser()`: no exige que exista un perfil en `besoulUsers`, ni que `activo==true` -- solo exige una sesión de Firebase Auth válida con email. La tabla de abajo distingue ambos estados explícitamente en cada fila -- no se afirma ninguna protección como real si solo vive en el fichero de propuesta.

| Actor | Restricción UI | Restricción real Firestore -- **PRODUCCIÓN HOY** (`signedIn()`) | Restricción real Firestore -- **SI SE DESPLEGARA LA PROPUESTA** (`isActiveUser()`) | Riesgo residual |
|---|---|---|---|---|
| ADMIN | Acceso total (Agenda, cualquier `entrenadorVisto`) | Total, sin distinción de rol | Total, sin distinción de rol (sin cambio para admin) | Ninguno adicional (el acceso total es intencional para admin) |
| PT | UI limita `entrenadorVisto` al propio `trainerKey`; `dbCredenciales` se carga ya acotado a `{ [propio]: perfil }` en el login no-admin (verificado en código, `ejecutarLogin()`) | **Cualquier cuenta de Firebase Auth con email** puede leer/escribir el documento COMPLETO -- ni siquiera hace falta tener perfil en `besoulUsers`, ni estar `activo:true`. Superficie de acceso MAYOR que la que describía la versión anterior de esta tabla | Se reduce la población a "usuario con perfil `activo:true` en `besoulUsers`", pero SIGUE sin distinguir trainerKey -- cualquier PT activo lee/escribe el documento COMPLETO de todos los trainers | **Alto en teoría, bajo en práctica** en ambos escenarios: un PT (o, hoy, cualquier cuenta Auth válida) con conocimientos técnicos podría leer o escribir agenda/clientes de OTRO PT vía llamada directa a Firestore, saltándose la UI por completo. Mitigación de escritura diseñada como "FASE 2" (ver `AGENDA_MONOLITHIC_RISK.md`), en curso de auditoría/tests en la rama `SEC-AGENDA-WRITE-ISOLATION`, todavía NO desplegada. El código de escritura real (`guardarEstadoNubeAgenda()`) SÍ usa `.update()` con rutas dirigidas por trainerKey -- la app nunca envía escrituras cruzadas por accidente -- pero eso es disciplina de la app, no una garantía de Firestore |
| CLIENTE/TOKEN | N/A -- ningún flujo de portal-cliente.html toca esta colección | Bloqueado: requiere `signedIn()`, un token no tiene sesión de Firebase Auth | Bloqueado: requiere `isActiveUser()` (más estricto todavía) | Ninguno |
| NO AUTH | N/A | Bloqueado (`signedIn()` exige `request.auth != null`) | Bloqueado (`isActiveUser()` exige `signedIn()` como base) | Ninguno |

## `besoulSuite/finanzas`

| Actor | Restricción UI | Restricción real Firestore | Riesgo residual |
|---|---|---|---|
| ADMIN | Acceso total (`finanzas.html`, `dashboard.html`) | `isAdmin() && docId=='finanzas'` | Ninguno |
| PT | Bloqueado en el login de `finanzas.html`/`dashboard.html` (guard ya existente, previo a esta fase) | Bloqueado -- `isAdmin()` exigido, ambas capas coinciden | Ninguno -- único caso donde UI y Rules ya coincidían exactamente antes de esta fase |
| CLIENTE/TOKEN, NO AUTH | N/A | Bloqueado | Ninguno |

## `besoulLeads` (tras SEC-04, esta fase)

| Actor | Restricción UI | Restricción real Firestore | Riesgo residual |
|---|---|---|---|
| ADMIN | Acceso total (`crm.html`) | CRUD completo vía `isAdmin()` | Ninguno |
| PT | Bloqueado por completo de `crm.html` (ROLE-01, ya en `main`) | **read**: propio `trainerKey` (necesario -- `agenda.html` lee esto para pintar "pruebas" en la Agenda del propio PT, flujo real y en uso). **create/update**: `isAdmin()` puro desde SEC-04 (antes permitía also al PT sobre sus propios leads) | Bajo: PT conserva únicamente lectura de sus propios leads, sin escritura. Antes de SEC-04 el riesgo era medio (podía crear/editar sus propios leads saltándose la UI); cerrado en esta fase |
| CLIENTE/TOKEN | N/A | N/A | N/A |
| NO AUTH | Formulario público (`valoracion.html`/`prueba.html`) | `create` solo vía `isPublicTrialLead()` -- whitelist estricta de campos y valores fijos (`estado=='Prueba solicitada'`, `trainerKey==''`, etc.) | Bajo -- un no-autenticado podría spamear creación de leads de prueba (no hay rate-limit a nivel de Rules), pero no puede leer/editar/borrar nada. Aceptado como diseño (captación pública) |

## `besoulPublicClients/{token}`

| Actor | Restricción UI | Restricción real Firestore | Riesgo residual |
|---|---|---|---|
| ADMIN | Gestiona vía `agenda.html` como cualquier PT, más puede desactivar/aprobar bajas | `get`: público (todos). `create`: exige `trainerKey==myTrainerKey()` -- **sin excepción para admin**. `update`/`delete`: `isAdmin()` sin restricción de trainerKey | **Hallazgo nuevo de esta auditoría (no corregido, fuera del alcance explícito de esta fase)**: si una sesión de ADMIN dispara `publicarReservasPublicas()` (p.ej. al aprobar una baja de cliente, `aprobarSolicitudEliminacion()`) y esa sesión tiene `dbCredenciales` con VARIOS trainers cargados (`cargarPerfilesUsuariosFirebase()`, solo pasa en sesión admin), el batch incluye un `.set(..., {merge:true})` por cada cliente individual de CADA trainer. Para un cliente que YA tiene documento público, esa operación es un `update` (bypass de `isAdmin()`, funciona). Pero para un cliente SIN documento público todavía (primera vez que se hace reservable), esa operación es un `create`, que exige `trainerKey==myTrainerKey()` -- el trainerKey del ADMIN, casi nunca igual al del cliente. Firestore evalúa un `batch.commit()` como atómico: si UNA sola operación del batch viola una Rule, el batch ENTERO se rechaza. Efecto observable: si existe al menos un cliente nuevo (de cualquier PT) sin publicar todavía en el momento en que un admin dispara este flujo, NINGÚN cliente de NINGÚN trainer se sincroniza ese ciclo -- fallo silencioso, capturado por `catch(err) => console.warn(...)`, sin alertar al admin. No confirmado contra Firestore real (sin acceso), pero se sigue directamente de leer las Rules + el código real de `publicarReservasPublicas()`. Se documenta como riesgo funcional/de fiabilidad, no como brecha de seguridad (las Rules están hopefully haciendo exactamente lo que deberían: impedir que el batch cree un documento con un trainerKey que no es el del autor) |
| PT | Gestiona solo sus propios clientes (botones "Link reservas"/"Regenerar enlace") | `create`/`update` (rama no-admin): exige `trainerKey==myTrainerKey()` en ambos lados -- coincide con la UI. `dbCredenciales` de una sesión PT no-admin se carga ya acotada a sí mismo (`ejecutarLogin()`), así que el batch real que un PT dispara nunca intenta tocar clientes de otro trainer -- el hallazgo de arriba es exclusivo de sesiones ADMIN | Ninguno adicional para PT |
| CLIENTE/TOKEN | Lee su propio documento (`portal-cliente.html`, `reservas.html`) vía el token en la URL | `get: if true` (documento exacto, no lista); `list: if false` -- sin el token exacto, no hay forma de enumerar ni adivinar otro documento (ver `SECURITY_AUDIT_PORTAL.md` para el análisis de entropía del token, mejorado en SEC-05 de esta fase). `update`: hoy bloqueado para un caller sin auth, salvo la rama CLIENT-09 (propuesta, NO desplegada) limitada a un único campo (`avisosLeidos`) | Bajo: el modelo es "quien tiene el enlace, entra" (capability URL) por diseño, no un fallo -- ver `CLIENT_PORTAL_ARCHITECTURE.md` sección 1-2 |
| NO AUTH (sin token) | N/A | Sin conocer un token exacto, `get` no sirve de nada (no hay `list`) | Ninguno más allá de fuerza bruta contra `get()` individuales, mitigado por la alta entropía del token tras SEC-05 y por el coste/cuota de cada intento contra Firestore |

## `besoulReservas/{reservaId}`

| Actor | Restricción UI | Restricción real Firestore | Riesgo residual |
|---|---|---|---|
| ADMIN | Ve/gestiona todas | `read`/`update`/`delete`: `isAdmin()` sin restricción | Ninguno |
| PT | Ve/gestiona solo las de su `trainerKey` | `read`/`update`/`delete`: propio `trainerKey` | Ninguno |
| CLIENTE/TOKEN | Reserva vía `reservas.html`/tab "Reservar" del portal | `create`: valida FORMA del payload + cross-check real contra `besoulPublicClients/{token}` (token/clientId/trainerKey deben coincidir de verdad -- auditoría 2026-09-02, ya en `main`) -- cierra la suplantación de "otro cliente del mismo entrenador" que existía antes de esa fecha | Ninguno nuevo encontrado en esta auditoría |
| NO AUTH (sin token) | N/A | `create` exige que el token exista y coincida -- sin un token real, no se puede crear nada | Ninguno |

## `besoulNotifications/{notifId}` (buzón PT/admin -- no el mismo sistema que los avisos del portal)

| Actor | Restricción UI | Restricción real Firestore | Riesgo residual |
|---|---|---|---|
| ADMIN | Ve todas | `read`: todas. `update`: whitelist a `read`/`readAt` | Ninguno |
| PT | Ve solo las suyas (`audience:'trainer' && trainerKey==propio`) | Igual que UI -- coincide | Ninguno |
| CLIENTE/TOKEN | N/A -- arquitectónicamente incompatible (exige `isActiveUser()`, un token no tiene sesión Auth) -- decisión de diseño documentada en `CLIENT_PORTAL_ARCHITECTURE.md` sección 7, no un descuido | Bloqueado | Ninguno -- por eso los avisos del cliente viven en `besoulPublicClients.avisos`, no aquí |
| NO AUTH | N/A | Bloqueado | Ninguno |

## `besoulCancelacionesCliente/{id}` (propuesta -- NO desplegada, catch-all deny-all hoy)

| Actor | Restricción UI | Restricción real Firestore (si se desplegara la propuesta de `CLIENT_PORTAL_ARCHITECTURE.md` sección 4) | Riesgo residual |
|---|---|---|---|
| ADMIN | Vería/gestionaría todas (mismo patrón que solicitudes de reserva) | `read`/`update`: sin restricción de trainerKey | Ninguno |
| PT | Procesa las de su propio `trainerKey` (`iniciarModuloCancelacionesCliente()`, ya en `main`, dormido -- sin escrituras posibles hoy porque la colección no tiene Rule) | `read`/`update`: propio `trainerKey` | Ninguno nuevo |
| CLIENTE/TOKEN | Botón deshabilitado hoy (`CANCELACION_PORTAL_HABILITADA=false`, CLIENT-07, ya en `main`) -- ningún intento de escritura posible desde la UI | `create`: cross-check real token/clientId/trainerKey contra `besoulPublicClients/{token}`, igual patrón que `besoulReservas.create` | Ninguno nuevo -- el diseño ya sigue el mismo patrón validado que `besoulReservas` |
| NO AUTH (sin token) | N/A | `create` exige token real y coincidente | Ninguno |
| **HOY, sin desplegar** | El botón está deshabilitado (CLIENT-07) precisamente porque, sin esta Rule, CUALQUIER intento de `create` cae en el catch-all `allow read, write: if false` -- `permission-denied` garantizado | -- | Ninguno de seguridad -- el riesgo hoy es de PRODUCTO (cancelación no funciona), no de seguridad |

## Conclusión

Ningún actor tiene hoy más acceso REAL (Firestore) del que la UI aparenta darle, **salvo un caso, y es más grave de lo que una lectura superficial del fichero de propuesta sugeriría**: en producción, `besoulSuite/agenda` usa hoy `signedIn()` (no `isActiveUser()`) -- cualquier cuenta de Firebase Auth con email, activa o no en `besoulUsers`, puede leer/escribir la Agenda completa de TODOS los trainers vía Firestore directo. Riesgo conocido desde antes de esta fase, con una mitigación de escritura ya diseñada ("FASE 2" en `firestore.rules`, más el propio swap `signedIn()`→`isActiveUser()`), auditada y en pruebas en la rama `SEC-AGENDA-WRITE-ISOLATION`, todavía sin desplegar. El riesgo de LECTURA cruzada entre PT queda fuera del alcance de esa mitigación -- Firestore no tiene lectura parcial de documento (ver `AGENDA_MONOLITHIC_RISK.md`) -- y sigue como deuda de seguridad documentada, no resuelta. El hallazgo nuevo de esta auditoría (posible fallo silencioso de `publicarReservasPublicas()` en sesión admin cuando hay clientes nuevos sin publicar de varios trainers a la vez) es de fiabilidad/producto, no de seguridad -- las Rules en ese caso están bloqueando correctamente una escritura mal dirigida, el problema es que el batch atómico no distingue "una escritura mal dirigida" de "el resto del batch, que sí era válido".
