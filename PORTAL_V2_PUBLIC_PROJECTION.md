# B12/B13 — Proyección pública: esquema final + sincronización

## B12 — Esquema (ya existía, ahora completo)

`besoulPublicClients/{token}` sigue siendo la única proyección pública por cliente -- confirmado en `SECURITY_AUDIT_PORTAL.md`/`FIREBASE_SCHEMA.md` (fase anterior) que ya cumplía "mínimo y seguro" (sin canon/reparto/rentabilidad/notas internas/otros clientes). Esta fase (PORTAL-02) añade 5 campos aditivos, todos ya auditados como no sensibles:

| Campo nuevo | Contenido | ¿Sensible? |
|---|---|---|
| `tipoPlan` | `'mensual'` \| `'bono'` -- de `calcularContadorClases()` | No |
| `caducidadPlan` | Fecha de fin de vigencia de un bono | No |
| `modalidad` | Texto libre de la ficha (p.ej. "Individual 3x/semana") | No |
| `avatarUrl` | URL pública de Storage (vacío hasta que exista subida real) | No -- ver `AVATAR_STORAGE_ARCHITECTURE.md` |
| `avatarPath` | Ruta interna de Storage, para poder borrar/reemplazar | No |

El Portal **nunca** lee `besoulSuite/agenda` -- confirmado sin cambios, mismo modelo de aislamiento documentado en `CLIENT_PORTAL_ARCHITECTURE.md` sección 2.

## B13 — Sincronización: auditoría de disparadores + diseño

**No existían 8 sitios con lógica duplicada.** `publicarReservasPublicas()` (agenda.html) ya era, desde antes de esta fase, la ÚNICA función que calcula y escribe la proyección pública -- confirmado por búsqueda exhaustiva: **13 puntos de la app la disparan** (directa o vía `publicarReservasPublicasDebounced()`, que solo aplica un debounce de 800ms sobre la misma función), pero **ninguno de los 13 reimplementa el cálculo** -- todos delegan en la misma función. La preocupación de "no duplicar en 8 sitios" ya estaba resuelta arquitectónicamente; se documenta aquí para confirmarlo con evidencia, no dejarlo como una suposición.

**Disparadores reales, agrupados por tipo de cambio**:

| Cambio en Agenda | Disparador |
|---|---|
| Cualquier guardado genérico de Agenda (cliente, cita, disponibilidad...) | `guardarEstadoNubeAgenda()` → `.then(() => publicarReservasPublicas())` -- el disparador más general, cubre la mayoría de ediciones |
| Alta/edición de ficha de cliente | `publicarReservasPublicasDebounced()` tras guardar la ficha |
| Reprogramar/mover cita | `publicarReservasPublicasDebounced()` tras mover |
| Aviso enviado por WhatsApp (añade a `avisosPortal`) | `publicarReservasPublicasDebounced()` |
| Aprobar baja de cliente (`aprobarSolicitudEliminacion`) | `publicarReservasPublicas()` directo (además marca `activo:false` en el token, revocándolo) |
| Regenerar token (`regenerarTokenReservaCliente`, SEC-05) | `await publicarReservasPublicas()` directo (crea el nuevo doc, revoca el antiguo por separado) |
| Copiar link de reservas por primera vez | `await publicarReservasPublicas()` directo (garantiza que el doc existe antes de compartir el enlace) |
| Cancelación procesada (`procesarCancelacionCliente`) | vía `guardarEstadoNubeAgenda()` en la misma función |
| Sincronización de disponibilidad/bloqueos | `publicarReservasPublicasDebounced()` |

**Auto-sanación, ya presente por diseño**: al ejecutarse en CADA uno de estos disparadores (no solo al crear el cliente), un cliente cuyo documento quedó "congelado" en un mal estado (ver `PORTAL_V2_ROOT_CAUSE_ANALYSIS.md`, causa candidata 1: cliente que dejó de cumplir las condiciones de publicación) se corrige solo la próxima vez que cualquiera de estos 13 disparadores se ejecute para su `trainerKey` -- no hace falta un job de reconciliación aparte. La única laguna real es un cliente que NUNCA vuelve a disparar ninguno de los 13 eventos (ficha completamente inactiva) -- ese caso ya está cubierto por el filtro de publicación (deja de intentar publicarlo, no dejarlo huérfano con datos viejos sería el único cambio de comportamiento posible, y solo tiene sentido si además se borra o marca el token, decisión de producto fuera de esta fase).

## Conclusión

No se ha creado ninguna función nueva de publicación ni se ha tocado la lógica de `publicarReservasPublicas()` más allá del fix de mes real (PORTAL-01) y los 5 campos aditivos (PORTAL-02) -- la arquitectura de sincronización ya era la correcta antes de esta fase; el trabajo de B12/B13 fue auditarla y documentarla con evidencia, no rediseñarla.
