# B1/B17 — Auditoría de fuente real de datos + causa raíz de "0/0/0" y "Centro: ---"

Auditado: `agenda.html` (única fuente real y única escritora de la proyección pública), `reservas.html`/`portal-cliente.html` (consumidores, solo lectura), `besoulPublicClients`, `besoulPublicSchedule`, `besoulReservas`.

## Fuente real, campo por campo

| Campo mostrado en Portal | Fuente real | Función/línea (`agenda.html`) |
|---|---|---|
| Plan / Bono (tipo) | `c.tipoCompra`, `c.modalidad` (ficha del cliente, dentro de `dbClientes[trainerKey]`) | `calcularContadorClases()` → `esBono` |
| Sesiones contratadas | Derivado de `c.factor`/`c.modalidad`/`c.actividadEspecialId`/`c.planSesiones`, NUNCA un campo fijo | `sesionesContratadasFicha()` |
| Sesiones realizadas (usadas) | Recuento real de citas en `dbAgenda[trainerKey]` dentro de la ventana del plan (mes calendario para planes normales, 3 meses desde `fechaCompra` para bonos) | `contarSesionesAgendadas()` dentro de `calcularContadorClases()` |
| Sesiones pendientes | `contratadas - usadas` | `calcularContadorClases()` |
| Próxima sesión / futuras / recientes | Recuento real de `dbAgenda[trainerKey]` filtrado por `id===clientId`, separado por fecha/hora vs. ahora | `sesionesClienteParaPortal()` |
| Disponibilidad | `dbDisponibilidadReservas[trainerKey]` + huecos ocupados calculados de `dbAgenda[trainerKey]` | `publicarReservasPublicas()`, colección separada `besoulPublicSchedule/{trainerKey}` |
| Entrenador (nombre) | `dbCredenciales[trainerKey].nombre` / `nombreEntrenador(trainerKey)` -- perfil del PT, NO de la ficha del cliente | `publicarReservasPublicas()` |
| **Centro** | `dbCredenciales[trainerKey].centroId` / `.centroNombre` -- **perfil del PT asignado al cliente, NO un campo de la ficha del cliente** | `publicarReservasPublicas()`, línea del `batch.set(ref, {..., centroId: dbCredenciales[trainerKey]?.centroId || '', centroNombre: dbCredenciales[trainerKey]?.centroNombre || '', ...})` |

Todo se calcula **una sola vez, del lado del PT ya autenticado**, en `publicarReservasPublicas()`, y se escribe en `besoulPublicClients/{token}` -- el Portal nunca lee el documento monolítico `besoulSuite/agenda`, solo este resumen ya calculado (modelo de aislamiento confirmado, sin cambios en esta fase). No existe un segundo motor de contadores: el Portal consume directamente los campos ya calculados por `calcularContadorClases()`/`sesionesClienteParaPortal()`, las MISMAS funciones que usa el resto de Agenda.

## Causa raíz de "0/0/0" -- CONFIRMADA Y CORREGIDA (PORTAL-01)

`calcularContadorClases(ficha, claveMes = claveMesVisible())` toma por defecto **el mes que el PT tiene abierto en la UI de Agenda** (`claveMesVisible()` lee `lunesActual`, una variable global ligada a la navegación del calendario), **no el mes calendario real de hoy**. `publicarReservasPublicas()` llamaba a `calcularContadorClases(c)` **sin pasar un mes explícito** -- así que el contador publicado al Portal dependía de qué mes tenía el PT (o un admin, cuyo `dbCredenciales` cubre a TODOS los trainers a la vez) abierto en pantalla en el instante exacto en que se disparó la publicación automática (`guardarEstadoNubeAgenda()` → `publicarReservasPublicas()`, en cada cambio de Agenda).

Efecto real: un cliente con un plan mensual normal, publicado mientras la Agenda estaba parada en un mes SIN sesiones suyas (p. ej. el PT revisando el mes anterior o siguiente por cualquier motivo), recibía `sesionesUsadas: 0` y `sesionesPendientes` igual a `contratadas` -- y si la siguiente publicación automática tardaba en llegar (o el PT no volvía a tocar Agenda ese cliente), el Portal se quedaba mostrando ese estado incorrecto indefinidamente.

**Corregido** (`agenda.html`, `publicarReservasPublicas()`): se calcula `claveMesReal` a partir de `hoy` (la fecha real del sistema, ya usada en la misma función para la ventana de reservas) y se pasa explícitamente a `calcularContadorClases(c, claveMesReal)`. Ya no depende de la navegación del PT. Es un fix real de una línea, sin tocar la fórmula de `calcularContadorClases()` en sí (nunca se cambian fórmulas de negocio sin más).

**No confirmado, y no se puede confirmar sin acceso a Firestore real**: si el cliente concreto que motivó el reporte original de "0/0/0" fue víctima exactamente de este bug, o de otro de los candidatos de abajo. Se documenta como la causa MÁS PROBABLE, evidenciada por lectura directa del código, no como un hecho verificado contra datos reales.

## Otras causas posibles de "0/0/0" (candidatas, no confirmadas, no corregidas aún)

1. **Filtro de publicación**: un cliente solo recibe/actualiza su documento `besoulPublicClients/{token}` si `tipo==='individual' && !vinculacion && clienteActivoParaAgenda(c) && c.email && c.telefono`. Si CUALQUIERA de estas condiciones deja de cumplirse después de que el cliente ya tuviera un token/documento publicado antes, el documento **deja de actualizarse pero no se borra** -- queda congelado con los últimos valores calculados, potencialmente `0/0/0` si se congeló en un mal momento. Esto es un diseño deliberado (no publicar a quien no puede recibir el enlace), pero tiene un efecto secundario de "documento fantasma desactualizado" que el B12/B13 de este mismo informe rediseña (única función de publicación, auto-sanadora en cada ejecución mientras las condiciones se sigan cumpliendo).
2. **Cliente nunca tuvo el batch ejecutado para su trainer**: `publicarReservasPublicas()` se salta trainers enteros si `!dbClientes[trainerKey]` -- normalmente no debería pasar en producción, pero si un PT nunca ha disparado ningún cambio en Agenda desde que existe la funcionalidad de Portal, su cartera entera podría no tener documentos públicos actualizados con los campos nuevos (`sesionesContratadas` etc. se añadieron en `CLIENT-01`, después de que el mecanismo de publicación básico ya existiera para reservas).

## Causa raíz de "Centro: ---" -- CONFIRMADA, NO ES UN DATO DE CLIENTE

**No es (C) del enunciado** ("clave/formato no coincide") **ni (D)** ("bug Portal") **ni, estrictamente, (A) tal como se planteaba** ("dato realmente falta en cliente") -- el campo `centroNombre`/`centroId` publicado a `besoulPublicClients/{token}` **nunca se lee de la ficha del cliente**. Se lee siempre de `dbCredenciales[trainerKey].centroId`/`.centroNombre` -- el perfil del ENTRENADOR asignado a ese cliente. Si el perfil de ese PT concreto (en `besoulUsers`, cargado a `dbCredenciales`) tiene `centroId`/`centroNombre` vacíos, **todos** sus clientes publicados mostrarán "Centro: ---", sin excepción, sin relación con los datos de cada cliente individual.

**Para el caso real reportado (cliente "Alba")**: la causa más probable es que el perfil de su PT asignado en `besoulUsers` tenga el campo `centroId`/`centroNombre` vacío. **No se ha modificado el dato de Alba ni de ningún PT** -- instrucción explícita de la fase anterior, que se mantiene. Se documenta la causa exacta para que el usuario pueda corregir el perfil del PT correspondiente (fuera de esta sesión -- es una decisión sobre datos reales de producción).
