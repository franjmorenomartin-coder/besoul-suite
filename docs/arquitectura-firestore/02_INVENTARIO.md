# Informe 2 — Inventario y matriz de trazabilidad

Clases: **A** imprescindible · **B** duplicado demostrado · **C** derivado/recalculable · **D** posiblemente obsoleto
(pendiente de verificación) · **E** uso desconocido (conservar). Ningún campo se propone para borrado en esta fase.
Método: lectura del código (`agenda`, `crm`, `finanzas`, `dashboard`, `portal-cliente`, `valoracion`,
`functions/cancelacionCliente.js`) + script de trazas (lecturas/escrituras por módulo) + medición en producción.

## 1. Colecciones y documentos

| Colección / doc | Docs | Tamaño | Escritores | Lectores | Notas |
|---|---|---|---|---|---|
| `besoulSuite/agenda` | 1 | 801.607 B | agenda (tx), crm (tx), finanzas (`trainerActividades`), función cancelación (no desplegada) | agenda, crm, finanzas, dashboard (listeners) | Monolito. Objeto de esta reingeniería. |
| `besoulSuite/finanzas` | 1 | ~86 KB | finanzas (admin) | finanzas, dashboard, crm (get) | Crece por meses. Vigilar. |
| `besoulUsers/{email}` | 22 | pequeño | admin (agenda) | todos los módulos | Perfil/rol/`trainerKey`. |
| `besoulLeads/{id}` | 103 | ~119 KB | crm, valoracion (público) | crm, agenda (query), dashboard (listener completo) | Bien particionado. |
| `besoulPublicClients/{token}` | n/d (no listable) | — | agenda (publicación debounced) | portal-cliente (get) | Proyección pública. |
| `besoulPublicSchedule/{tk}` | n/d | — | agenda | portal-cliente | Regla de escritura laxa (Informe 1 §9). |
| `besoulReservas/{tk__clave[__cid]}` | 5 | pequeño | portal (create tx), agenda (aceptar/rechazar) | agenda (listener) | |
| `besoulSolicitudesEliminacion` | 16 | pequeño | agenda | agenda | |
| `besoulNotifications` | 10 | pequeño | agenda | agenda (listener) | Crece sin límite; añadir `limit`. |
| `besoulValoracionRegistry` | 4 | pequeño | valoracion (tx) | valoracion | Anti-duplicados. |
| `besoulPublicConfig/centros` | 1 | pequeño | finanzas | valoracion | Regla de escritura laxa. |

## 2. Contenido de `besoulSuite/agenda` — matriz campo → lector → escritor → funcionalidad → riesgo → tamaño

| Campo | Forma | Tamaño | Escritor | Lector | Funcionalidad | Riesgo | Clase |
|---|---|---|---|---|---|---|---|
| `agenda.<tk>.<fecha_HH:MM>` | mapa sesión | 421.695 B (52,6 %) | agenda (tx fusión), crm conversión (set merge), función cancelación | agenda, finanzas, dashboard, crm, publicación portal | Calendario, KPIs, facturación, portal | Crecimiento ilimitado; clave = hora (mover = borrar+crear) | A |
| `clientes.<tk>[]` | array fichas | 268.013 B | agenda (tx), crm (tx set merge) | agenda, finanzas, dashboard, crm, publicación portal | Fichas, tarifas, contacto | Array: 1 cambio reescribe el entrenador entero | A |
| `historicoClientes.<tk>.<cid>.<YYYY-MM>` | snapshot mensual | 101.524 B | agenda (`guardarResumenClienteMes`) | agenda (saldo de mes cerrado), finanzas | **Congela** el saldo de meses cerrados frente a cambios de tarifa | No recalculable fielmente una vez cambian tarifas | A |
| `disponibilidadReservas.<tk>` (`semanal`, `excepciones`, `bloqueos`, config) | mapa | 8.783 B | agenda | agenda, publicación portal | Horario operativo, días bloqueados, slots ocultos | Bajo | A |
| `pruebasCRM.<tk>.<clave>` | mapa | 2.745 B | crm | agenda (`sincronizarPruebasCRMDentroDeAgenda`) | Pruebas de lead en agenda | **Duplica** las pruebas guardadas también en `agenda.<tk>` | B (copia de `agenda` con `esPruebaCRM`) — conservar hasta migrar |
| `notas.<tk>__<clave>` | mapa plano | pequeño | agenda, función cancelación | agenda | Nota por hueco | Sin aislamiento por reglas | A |
| `trainerActividades.<tk>` | mapa | pequeño | finanzas (admin) | agenda, finanzas | Actividades autorizadas por PT | Bajo | A |
| `ultimaActualizacionLocal`, `actualizadoEn` | meta | mínimo | todos | agenda (diagnóstico) | Trazabilidad | — | C |

## 3. Campos dentro de cada SESIÓN (copia de la ficha + campos propios)

Tamaño medio de sesión: **480 B**. Mayores contribuyentes medidos: `integrantesObj` 90,5 KB total,
`capacidadGrupoAbierto` 24 KB, `modalidad` 22,7 KB.

| Grupo de campos | Ejemplos | Lector desde la SESIÓN | Clase | Comentario |
|---|---|---|---|---|
| Identidad de cita | `id` (= id ficha), `tipoCita`, `esPruebaCRM`, `duracionMin`, `leadId` | agenda, finanzas, dashboard, crm, función | A | `id` hoy es el id del **cliente**, no de la sesión. |
| Facturación usada por Finanzas | `noSumaFacturacion`, `recuperacionNoFacturable`, `noFacturable`, `tipoFacturacion`, `modalidad` | finanzas (`sesionesAgendadasFacturablesFichaMes`) | A | Precio sale de la ficha, no de la sesión. |
| Copia económica usada por KPIs | `descuentoPct`, `factor`, `tipoCompra`, `planSesiones`, `vinculacion`, `actividadEspecialId` | agenda (`calcularRentabilidadFicha(cita)`), dashboard | A **hoy** / B **conceptual** | Duplicado de la ficha **pero se lee** → no eliminable sin refactor + decisión de precio congelado. |
| Grupo | `integrantesObj`, `asistentesGrupoAbierto`, `capacidadGrupoAbierto`, `grupoAbierto*` | agenda, finanzas, dashboard, portal | A | `integrantesObj` copia nombres/contacto de miembros (B parcial). |
| Contacto copiado | `nombre`, `telefono`, `email` | agenda (pintar, WhatsApp) | A hoy / B conceptual | Renombrar la ficha **no** actualiza sesiones existentes. |
| Estado | `estadoCancelacion`, `canceladaEn`, `origenReservaCliente`, `solicitudReservaId`, `avisosPortal` | agenda, portal (vía publicación) | A | |
| Recurrencia | `recurrencia*` | solo agenda | A | |
| Ficha no-sesión (ya eliminados 9-oct) | `contratoCliente`, `restriccionesReservas`, `reservaToken`, `reservasBloqueadasTexto`, `reservasOnlineActivas` | ninguno desde sesión (verificado) | B — **ya compactado** | La ficha los conserva. |
| Resto de campos de ficha copiados (`notaFacturacion`, `facturacionEstadistica`, `fechaAlta`, `estado`, datos CRM `fuenteCaptacion`… ) | — | sin lectura demostrada **desde sesión** en la traza | D | No borrar: la traza por regex no prueba ausencia de acceso dinámico (`cita[campo]`). Requiere revisión manual por campo. |
| Otros no clasificados | — | — | E | Conservar. |

## 4. Fichas (`clientes.<tk>[]`)

410 fichas, media **653 B**. Estado: activo 363, baja 13, inactivo 7, vacío 27. Tipo: individual 221, grupo 57,
miembro 132. Campos A: identidad/contacto, tarifa (`modalidad`, `planSesiones`, `tipoCompra`, `descuentoPct`…),
`vinculacion` (miembro→grupo), `reservaToken` + `restriccionesReservas` (portal), `contratoCliente` (273 fichas),
`leadId`/datos CRM. `facturacionEstadistica`, `notaFacturacion`: A (finanzas). Fichas con `estado` vacío (27): E —
conservar, revisar con negocio.

## 5. Datos derivados (C)

`besoulPublicClients` y `besoulPublicSchedule` (proyecciones regenerables desde agenda), `ultimaActualizacionLocal`,
KPIs. `historicoClientes` **no** es C: es una congelación con valor contable.

## 6. Escrituras que sustituyen estructuras completas

| Operación | Alcance real escrito | Protegida por transacción |
|---|---|---|
| Agenda `guardarEstadoNubeAgenda(tk)` | campos completos del entrenador `tk` que cambiaron | Sí + fusión [HOTFIX] |
| CRM `convertirLead` | `clientes` y `agenda` de **todos** los entrenadores (merge) | Sí; bug probable de `merge` (no borra prueba) |
| CRM `actualizarFichaAgendaDesdeLead` | `clientes` de todos (merge) | Sí |
| Finanzas catálogo actividades | `trainerActividades.<tk>` (FieldPath) | No (campo pequeño, admin) |
| Portal publicación | `besoulPublicClients/*`, `besoulPublicSchedule/*` en batch | No (proyección regenerable) |

## 7. Dependencias

Reservas ↔ agenda (clave de hueco, `trainerKey`); portal ↔ `reservaToken` de ficha + proyecciones; contratos ↔
ficha; disponibilidad ↔ publicación del horario; histórico ↔ fichas + sesiones del mes; CRM ↔ `leadId` en ficha y
pruebas en agenda; finanzas ↔ fichas + sesiones del mes + `trainerSettings` (finanzas doc); dashboard ↔ todo (lectura).

## 8. Oportunidades de ahorro (NO ejecutar)

| Oportunidad | Ahorro estimado | Condición |
|---|---|---|
| Sesión con referencia a ficha + snapshot económico mínimo en lugar de copia completa | ~40–60 % del tamaño de cada sesión | Decisión de precio congelado + refactor de KPIs. Se hace en la nueva arquitectura. |
| `integrantesObj` como lista de ids | hasta ~90 KB hoy | Refactor de grupos. |
| Eliminar duplicado `pruebasCRM` | 2,7 KB | Unificar en el día. |

Conclusión del inventario: el monolito **no tiene grasa recortable relevante** sin cambiar código. El ahorro posible
(~30 %) solo retrasa meses el límite; **no sustituye** el reparto de los datos.
