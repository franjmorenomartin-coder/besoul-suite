# Informe 5 — Hoja de ruta, pruebas y monitorización

## 1. Decisiones previas (bloqueantes)

| Id | Decisión | Recomendación |
|---|---|---|
| D1 | ¿La sesión congela el precio/condiciones del día en que se creó, o usa siempre la ficha? | Congelar un **snapshot económico mínimo** en la sesión (es lo que hoy hacen de facto los KPIs de Agenda) y que Finanzas use ese mismo dato → una sola fuente. Requiere validar con contabilidad. |
| D2 | ¿Se pueden editar sesiones de meses cerrados? | Solo admin, y con registro de auditoría. |
| D3 | Ventana de mantenimiento de la Etapa 2 | Domingo noche / fuera de horario, 60 min reservados. |
| D4 | Plan de Firebase (Spark/Blaze) | Confirmar: condiciona export administrado, PITR y Cloud Functions. |

## 2. Tareas priorizadas

| # | Tarea | Esfuerzo | Depende de | Criterio de aceptación |
|---|---|---|---|---|
| T0 | **Vigilancia de tamaño ya** (solo lectura): script admin que informa tamaño del monolito; ejecución semanal manual | 0,5 d | — | Informe semanal; alerta a 900 KB |
| T1 | Capa de acceso a datos `besoul-datos.js` leyendo del monolito (sin cambio funcional) | 2 d | — | Tests actuales en verde; sin diferencias visibles |
| T2 | Transformación + reconstrucción + reconciliación (scripts puros, Node, sobre respaldo) | 2 d | — | Ida-vuelta idéntica sobre el respaldo real |
| T3 | Reglas + índices nuevos en emulador + suite de reglas | 1,5 d | — | 100 % reglas P10–P12 |
| T4 | **Etapa 1**: lector unificado de rangos pasados (agenda/finanzas/dashboard) + archivado de meses cerrados | 3 d | T1–T3, D2 | Finanzas de jun–sep idéntica antes/después (importes por entrenador al céntimo); monolito −150 KB/mes |
| T5 | Operaciones transaccionales por día (crear/mover/cancelar/bloquear/aceptar reserva) + cola persistente con `opId` | 4 d | T1, D1 | P1–P9 verdes |
| T6 | Fichas, histórico, disponibilidad, actividades en nuevas colecciones | 2 d | T1 | P2, P13 |
| T7 | CRM (conversión/pruebas) y publicación del portal sobre la nueva estructura | 1,5 d | T5, T6 | Lead → cliente sin prueba fantasma; portal idéntico |
| T8 | Ensayo completo de migración en emulador con copia real protegida + crecimiento simulado | 1,5 d | T2–T7 | Criterios Informe 4 §14 |
| T9 | **Etapa 2**: ventana de corte en producción | 0,5 d | T8, D3, **tu autorización** | Criterios Informe 4 §14 |
| T10 | Monitorización, validador nocturno, backups programados, prueba de restauración | 1,5 d | T9 | Alertas probadas |

Total estimado: **~20 días de trabajo** (≈ 4 semanas). Camino crítico para quitar la urgencia: T0 → T1 → T2 → T3 → T4
(**~9 días**, antes de que el margen se agote a mediados de noviembre).

Riesgos del plan: la Etapa 1 exige tocar lectura en 3 módulos (mitigado por T1); memoria del equipo para emulador
(pruebas en lotes pequeños, secuenciales); decisión D1 tardía bloquea T5.

## 3. Estrategia de pruebas (Fase 5)

Entorno: emulador Firestore + reglas candidatas, datos de la copia aislada; navegadores reales para P13–P15.
**Una prueba local en verde no es validación de producción**: tras el corte se repite un subconjunto de humo
(P1, P3, P4, P8, P10) con cuentas de prueba y datos de prueba identificados, previa autorización.

| Id | Escenario | Resultado esperado | Criterio de aprobación |
|---|---|---|---|
| P1 | Dos PT guardan a la vez en sus agendas | Ambos confirmados | Ambos cambios presentes en el servidor; 0 conflictos |
| P2 | Admin y PT editan la misma ficha (campos distintos / mismo campo) | Distintos: ambos aplicados. Mismo: el segundo recibe conflicto explicado | Ningún valor confirmado desaparece; mensaje visible |
| P3 | Dos usuarios modifican sesiones diferentes del mismo día | Ambos aplicados (reintento de transacción) | `rev` +2; ambas sesiones correctas |
| P4 | Dos clientes/usuarios reservan el mismo hueco o huecos solapados (10:00/10:15) | Exactamente uno gana | Nunca dos sesiones solapadas en el día |
| P5 | Bloquear un día con sesiones | Rechazo o confirmación con lista de sesiones | Nunca sesiones "invisibles" en día bloqueado |
| P6 | Corte de red durante el guardado | Estado "No guardado — reintentando"; no hay éxito falso | Tras reconectar, cambio aplicado **una sola vez** (`opId`) |
| P7 | Reconexión con varios cambios pendientes | Aplicados en orden | Estado final idéntico a aplicar en línea |
| P8 | Recarga del navegador con cambio pendiente | La cola persistente lo reintenta | Cambio presente una vez; ninguno perdido |
| P9 | Sesión de autenticación caducada | Pide reautenticar; cambios conservados | Tras login, guardado confirmado |
| P10 | PT intenta leer/escribir datos de otro PT (SDK directo) | `permission-denied` | 100 % denegado; admin permitido |
| P11 | Escritura con `rev` obsoleto o desde versión antigua de la app | Denegada por reglas | 0 escrituras aceptadas al monolito congelado |
| P12 | Usuario inactivo / sin perfil / anónimo | Denegado | 100 % |
| P13 | iPhone Safari y Android Chrome: crear, mover, cancelar, reservar | Igual que escritorio | Checklist completa |
| P14 | Actualización del service worker con pestaña abierta | Aviso de recarga; sin escrituras de la versión vieja | Versión mínima respetada |
| P15 | Migración sobre copia real protegida | Reconciliación 0 diferencias | Ida-vuelta idéntica |
| P16 | Crecimiento simulado 10 años (E2 y E3) | Tamaño máx. doc día < 100 KB; tiempos de carga de semana estables | Medido en emulador (generación por lotes para no saturar el equipo) |
| P17 | Restauración desde respaldo (completa y selectiva por día/cliente) | Datos idénticos al respaldo | Hash de contenido coincide |

**Ningún guardado se da por bueno sin confirmación del servidor**: todas las pruebas verifican leyendo del servidor
(`get({source:'server'})`), nunca de la caché local.

## 4. Monitorización y prevención (Fase 6) — proporcional a Besoul

| Señal | Mecanismo | Umbral / alerta | Actuación |
|---|---|---|---|
| Guardados fallidos | Colección `besoulErroresCliente` (escritura mínima: tipo, código, módulo, versión, trainerKey, hora; sin datos de cliente), límite por usuario | > 5 fallos/hora o cualquier `invalid-argument` | Revisar registro; si es tamaño → Informe 1 §1 |
| Conflictos | Mismo registro (`conflict`) | > 10/día | Revisar granularidad de la operación |
| `permission-denied` | Mismo registro | Cualquiera en flujos normales | Revisar perfil/reglas el mismo día |
| Desconexión prolongada | Indicador en la app + registro al reconectar con duración | > 10 min con cambios pendientes | Aviso visible al usuario |
| Documentos grandes | Script admin semanal (hoy T0; después validador) | Monolito > 900 KB; doc día > 100 KB; ficha > 50 KB | Investigar antes de llegar al límite |
| Consultas ineficientes / costes | Consola Firebase → Uso; alerta de presupuesto en Google Cloud (si Blaze) | Lecturas/día > 2× media de 30 días | Revisar listeners |
| Incoherencias sesiones-fichas | Validador nocturno (o manual semanal): sesiones con `clientId` inexistente, solapes, días bloqueados con sesiones, reservas aceptadas sin sesión | > 0 | Informe y corrección manual |

**Copias de seguridad:** diaria automática (export administrado si Blaze; si no, `backup-firestore.js` programado en
el equipo del responsable) · retención 30 diarias + 12 mensuales · copia fuera del equipo · SHA-256 verificado ·
**prueba de restauración mensual** en emulador con informe (P17) · respaldo manual obligatorio antes de cada despliegue
que toque datos. Valorar PITR (7 días) si el plan lo permite.

## 5. Siguiente paso propuesto (requiere tu autorización)

1. Aprobar el enfoque (arquitectura D: entrenador-día) y las decisiones D1–D4.
2. Autorizar **T0–T4** (camino crítico de la Etapa 1) en esta rama, sin desplegar; te presentaré resultados de la
   reconciliación sobre el respaldo antes de pedir autorización para tocar producción.
