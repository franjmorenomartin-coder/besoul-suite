# B18 — Auditoría de seguridad, Portal Cliente V2

Auditoría exhaustiva de acceso a datos, no una afirmación genérica. Método: listado completo de TODAS las llamadas a Firestore en `portal-cliente.html` (grep de `db.collection(`, 4 resultados, ninguno omitido).

## Inventario completo de acceso a Firestore

| # | Colección | Operación | Alcance |
|---|---|---|---|
| 1 | `besoulPublicClients/{token}` | `get()` | Un único documento, el del propio token de la URL. Sin `list()` en ningún punto del archivo -- imposible enumerar otros clientes desde este código |
| 2 | `besoulPublicSchedule/{trainerKey}` | `get()` | Un único documento, el del PT del propio cliente (`clientData.trainerKey`, ya resuelto del punto 1, nunca un valor libre) |
| 3 | `besoulCancelacionesCliente/{id}` | `get()` + `set()` (create) | Solo un `id` determinista propio (`trainerKey__clave__cancel`); inalcanzable en la práctica hoy -- `CANCELACION_PORTAL_HABILITADA=false` elimina el `onclick` que llamaría a esta función, ver sección "Cancelación" abajo |
| 4 | `besoulReservas/{id}` | `runTransaction` (get + create) | Solo un `id` determinista propio de la franja elegida; nunca lee otras reservas |

**Ninguna otra colección se toca desde este archivo**: no `besoulSuite/agenda` (el documento monolítico con TODOS los clientes de TODOS los PT -- nunca se lee, confirmado por ausencia total en el grep), no `besoulLeads`, no `besoulUsers`, no `besoulSuite/finanzas`. Esto no ha cambiado respecto a V1 -- el modelo de aislamiento (`CLIENT_PORTAL_ARCHITECTURE.md` sección 2) sigue intacto en V2.

## Verificación campo por campo: qué puede ver un cliente a través de Portal V2

| Categoría a proteger | ¿Expuesta? | Por qué |
|---|---|---|
| Otros clientes (mismo PT o de otro) | No | `besoulPublicClients` es 1:1 por token; sin `list()`; `besoulPublicSchedule` publica `ocupados`/`gruposAbiertos` agregados (franjas horarias, no identidades) y `asistentesIds` de grupos abiertos (ver nota) |
| Notas internas del PT | No | `notas` (mapa de `besoulSuite/agenda`) nunca se publica ni se lee desde Portal |
| Rentabilidad / canon / participación / reparto 50-35-15 | No | Viven exclusivamente en `besoulSuite/finanzas`, con Rules `isAdmin()`-only ya antes de esta fase; Portal no tiene ningún código que apunte a esa colección |
| Costes / histórico administrativo | No | Mismo motivo que arriba |
| Datos privados de otro PT | No | Portal nunca lee `besoulUsers` ni ningún perfil de PT; `trainerName`/`centroNombre` son los únicos datos del PT propio, ya públicos por diseño (igual que en V1 y en `reservas.html`) |
| Firestore Agenda completa (`besoulSuite/agenda`) | No | Cero referencias en todo el archivo (grep exhaustivo, tabla de arriba) |

**Nota sobre `asistentesIds` en grupos abiertos**: `besoulPublicSchedule/{trainerKey}.gruposAbiertos[].asistentesIds` contiene los `clientId` (no nombres) de quienes ya están apuntados a un grupo abierto -- se usa únicamente para que `gruposAbiertosDisponiblesReserva()` excluya de la lista de "grupos disponibles" un grupo al que el propio cliente YA pertenece (`asistentesIds.includes(clientData?.clientId)`). Es un id interno, no un nombre ni un dato de contacto, y ya era así en `reservas.html` antes de esta fase (mismo campo, mismo uso) -- no es una regresión introducida por Portal V2.

## Cancelación -- por qué "preparado pero no explotable" es verificable, no solo una promesa

`CANCELACION_PORTAL_HABILITADA = false` (sin cambios respecto a CLIENT-07). El botón que llamaría a `solicitarCancelacion()` se renderiza `disabled`, sin `onclick` -- **la función existe en el código pero no hay ningún camino de UI que la invoque**. Aunque alguien intentara llamarla manualmente desde la consola del navegador, escribiría en `besoulCancelacionesCliente`, colección que **no tiene ninguna Rule desplegada** (cae en el catch-all deny-all de producción) -- doble barrera: ni la UI la ofrece, ni Firestore la aceptaría aunque se forzara.

## DEMO mode -- por qué no es una superficie de riesgo

`DEMO_MODE` exige `qs.get('demo')==='1'` **Y** `['localhost','127.0.0.1'].includes(location.hostname)` -- ambas condiciones, comprobadas en el propio código, no solo documentadas. Un dominio de producción real (`app.besoulfitness.com` o equivalente) nunca puede satisfacer la segunda condición, así que `?demo=1` en un enlace real de producción no tiene ningún efecto -- no es un flag que dependa de que nadie lo descubra, es estructuralmente inactivable fuera de un entorno de desarrollo local.

## Conclusión

Portal V2 no amplía la superficie de exposición de datos respecto a V1 -- añade 5 campos ya auditados como no sensibles (`PORTAL_V2_PUBLIC_PROJECTION.md`) al mismo documento aislado de siempre, y ningún código nuevo introduce una lectura/escritura a una colección distinta de las 4 ya auditadas. El único mecanismo nuevo con capacidad de escritura real (reserva integrada) reutiliza exactamente las mismas Rules y el mismo patrón de cross-check ya validado en `reservas.html`, sin duplicar ni relajar ninguna comprobación.
