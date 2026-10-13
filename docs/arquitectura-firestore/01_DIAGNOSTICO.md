# Informe 1 — Diagnóstico

Fuentes: código de `origin/main` @ `f3720f4`; lecturas de solo lectura de producción (2026-10-13, sesión admin);
respaldo verificado `besoul-respaldo-2026-10-09T12-24-15-113Z.json` (SHA-256 `fba80c94…0c9d`).

## 0. Estado real del hotfix `agenda-sync-p0-2026-10-09`

| Aspecto | Estado |
|---|---|
| Fusión a tres vías por elemento dentro de transacción (`fusionarCampoTresVias`) | [HOTFIX] Un cambio ajeno confirmado ya no se pisa; conflicto real solo si se toca el mismo elemento o sesiones nuevas se solapan. |
| Confirmación de servidor antes de avisos de éxito / WhatsApp | [HOTFIX] `esperarConfirmacionAgenda`, `ofrecerWhatsAppTrasConfirmar`. |
| Timeout 20 s + reintentos + indicador de estado | [HOTFIX] Nunca un "Guardando…" indefinido. |
| SW no cachea tráfico de datos (v10) | [HOTFIX] |
| Sesiones dejan de copiar 5 campos de portal/contrato | [HOTFIX] + compactación ejecutada (1.031.061 → 801.607 B). |
| Causa del `permission-denied` de Lucía | [HIPÓTESIS] No reproducida; su perfil es correcto (`trainerKey: lucia`, `activo: true`, `pt`). |
| Batería E1–E17 en emulador tras el hotfix | Pendiente de re-ejecución completa por falta de memoria del equipo (S1–S18 y 56 tests de concurrencia sí pasaron). |

## 1. Límite de tamaño del documento — CAUSA ESTRUCTURAL PRINCIPAL

- [HECHO] `besoulSuite/agenda` = **801.607 B** tras compactar (78 % de 1 MiB). Reparto: `agenda` 421.695 B
  (879 sesiones, 18 entrenadores), `clientes` 268.013 B (410 fichas), `historicoClientes` 101.524 B,
  `disponibilidadReservas` 8.783 B, `pruebasCRM` 2.745 B.
- [HECHO] Las sesiones **nunca se eliminan** al pasar el tiempo; el documento crece con toda la historia.
- [HECHO] Crecimiento medido ≈ **230 KB/mes** (sesiones ~320/mes × 480 B; fichas ~50/mes × 653 B; histórico
  ~96 entradas/mes × ~450 B).
- [RIESGO — INMINENTE] Margen restante ~247 KB → **saturación hacia mediados de noviembre de 2026**. Efecto:
  `invalid-argument` en **todos** los guardados de **todos** los entrenadores (ya ocurrió antes del 9-oct).
- [HECHO] La compactación no es repetible: ya no quedan copias redundantes de ese tipo eliminables sin cambiar código
  (ver Informe 2: los demás campos copiados en sesiones **sí se leen**).

## 2. Contención por escrituras concurrentes

- [HECHO] Todas las escrituras de agenda, CRM (conversión, pruebas), cancelaciones del portal (función) y
  catálogo de actividades (finanzas) van al **mismo documento**.
- [RIESGO] Límite práctico de Firestore ≈ 1 escritura sostenida/s por documento; las transacciones que leen
  ~800 KB y reintentan bajo contención amplían la ventana de conflicto. Con 18 entrenadores no es hoy el cuello
  de botella dominante, pero crece con usuarios y tamaño.
- [HIPÓTESIS] Parte de los "guardados bloqueados" previos al hotfix pudieron deberse a reintentos de
  transacción sobre un documento grande en redes móviles lentas (no verificado con trazas de producción).

## 3. Actualizaciones completas frente a parciales

- [HECHO] Agenda escribe por **entrenador completo** (`clientes.<tk>` es un array: cambiar 1 ficha reescribe
  el array entero del entrenador; `agenda.<tk>` reescribe el mapa del entrenador si cambió). Mitigado por la
  fusión del hotfix, pero el coste de cada escritura es proporcional al tamaño del entrenador, no del cambio.
- [HECHO] **CRM `convertirLead`** (`crm.html` ~L1713–1745): `tx.set(agendaRef, { clientes, agenda, … }, { merge:true })`
  reescribe los mapas `clientes` y `agenda` de **todos** los entrenadores. Está dentro de transacción (no pisa a
  ciegas), pero:
  - [RIESGO — BUG PROBABLE] borra la prueba CRM con `delete` de JS y luego hace `set(..., {merge:true})`.
    Con `merge:true` Firestore **no elimina** las claves ausentes: la sesión de prueba **seguiría en la agenda**
    tras convertir. Además no limpia `pruebasCRM`. El propio `crm.html` (L1287) documenta este efecto en otra
    función y allí usa `FieldValue.delete()`. Verificable en emulador; no ejecutado (restricción de recursos).
  - [RIESGO] Si una sola transacción reescribe ~690 KB y el documento se acerca al límite, la conversión de un lead
    falla aunque el cambio real sea de 1 ficha.
- [HECHO] `actualizarFichaAgendaDesdeLead` (`crm.html` ~L1394–1432) igual patrón para `clientes`.

## 4. Pérdida de actualizaciones (lost updates)

- [HOTFIX] Agenda: corregido mediante transacción + fusión por elemento.
- [HECHO] La clave de sesión es `YYYY-MM-DD_HH:MM`: **mover** una sesión = borrar una clave y crear otra. El hotfix
  detecta "misma sesión movida de forma distinta" por heurística (id del cliente). [RIESGO] Con dos sesiones del
  mismo cliente el mismo día, la heurística puede emparejar mal; un ID estable de sesión lo eliminaría.
- [RIESGO] Cambios pendientes no confirmados viven **en memoria** (y una copia en `localStorage bs_db_agenda_v6`).
  [HIPÓTESIS] Al recargar la página con un guardado pendiente, el cambio puede perderse o reaplicarse sobre una
  base distinta; no hay cola persistente con identificador de operación. Pendiente de prueba dirigida.

## 5. Conflictos administrador–entrenador

- [HOTFIX] Se fusionan si tocan elementos distintos; si tocan el mismo, el segundo recibe un conflicto explicado.
- [HECHO] La granularidad de conflicto en fichas es la **ficha completa** (no el campo): admin cambia el teléfono y
  el PT cambia la nota de la misma ficha a la vez → conflicto (no pérdida). Aceptable, pero mejorable.

## 6. Sincronización entre dispositivos

- [HECHO] Cada dispositivo escucha el documento completo (`agenda.html`, `finanzas.html`, `dashboard.html`).
  Cualquier guardado de cualquier entrenador provoca la **descarga del documento entero (~800 KB)** en todos
  los dispositivos con la app abierta.
- [RIESGO] En móvil con red débil, el snapshot tarda; durante ese tiempo la base local queda atrasada y aumentan los
  conflictos y el uso de datos. Coste de ancho de banda proporcional a (usuarios conectados × guardados × 800 KB).

## 7. Comportamiento sin conexión

- [HECHO] Las transacciones de Firestore **requieren conexión**: sin red, el guardado falla tras el timeout y queda
  pendiente (correcto: no se declara éxito). [HOTFIX]
- [RIESGO] No hay cola persistente e idempotente de operaciones (ver §4).

## 8. Confirmación de guardados

- [HOTFIX] Agenda. [HECHO] CRM y aceptación de reservas usan `await` sobre la escritura/transacción → confirmación de
  servidor. [RIESGO] `aceptarSolicitudReserva` hace dos escrituras **no atómicas** (sesión en agenda y luego
  `estado:'aceptada'` en `besoulReservas`); el código maneja el fallo intermedio con un aviso, pero el estado puede
  quedar "sesión creada / solicitud pendiente" hasta reintento manual.

## 9. Permisos y autenticación

- [HECHO] Lectura de `besoulSuite/agenda`: **cualquier usuario activo lee los datos de todos los entrenadores**
  (incluidos teléfonos, emails y notas de clientes ajenos). Ya documentado (`AGENDA_MONOLITHIC_RISK.md`); no es
  corregible con reglas mientras exista un único documento. Implicación RGPD (minimización de acceso).
- [HECHO] `notas` es un mapa plano: un PT puede escribir notas de otro PT llamando al SDK directamente (riesgo
  residual documentado en `firestore.rules`).
- [HECHO — NUEVO] `besoulPublicSchedule/{trainerKey}` y `besoulPublicConfig/{docId}`: `create, update, delete: if
  isActiveUser()`. **Cualquier PT activo puede sobrescribir o borrar el horario público de otro entrenador** o la
  configuración pública de centros. Integridad, no confidencialidad. Severidad media (requiere usuario interno
  malintencionado o bug). No es pérdida de datos irrecuperable (se regenera desde la agenda), por eso no se detuvo la
  auditoría; se corrige en la arquitectura nueva.
- [HECHO] `functions/cancelacionCliente.js` construye rutas con cadena `agenda.${trainerKey}.${clave}`; un
  `trainerKey` con punto (existe `fran.jmorenomartin`) partiría la ruta. [HECHO] La propia función declara no estar
  desplegada. Debe corregirse antes de desplegarla.
- [HIPÓTESIS] El `permission-denied` de Lucía pudo venir de una escritura de pre-hotfix que tocaba claves de otro
  entrenador (p. ej. restauraciones de formularios obsoletos ya eliminadas por el hotfix). Sin trazas, no confirmado.

## 10. Listeners, caché y service worker

- [HOTFIX] SW v10 no intercepta tráfico de datos de Firestore.
- [HECHO] Listeners sobre documento completo en tres módulos + `besoulLeads` y `besoulUsers` completos en
  dashboard. Sin `limit()` en algunas consultas de colecciones crecientes (`besoulNotifications`, `besoulLeads`).
  [RIESGO] Coste y memoria lineales con la historia.

## 11. Integridad de reservas y dobles reservas

- [HECHO] El portal crea `besoulReservas/{trainerKey}__{clave}` en transacción: impide **dos solicitudes al mismo
  hueco exacto**, pero no solapes desplazados (10:00 y 10:15). La aceptación comprueba solapes en la agenda local
  y [HOTFIX] la fusión rechaza sesiones nuevas solapadas en el servidor.
- [RIESGO] La comprobación de solape depende de la lógica del cliente; no existe una invariante en servidor/reglas.
  Con el modelo por día, la transacción sobre el documento del día la hace atómica y simple.
- [HECHO] Las pruebas CRM se guardan **dos veces** (`agenda.<tk>` y `pruebasCRM.<tk>`), con riesgo de divergencia.

## 12. Recuperación después de fallos

- [HECHO] Existe respaldo manual verificable (`scripts/backup-firestore.js` + SHA-256) y el de 9-oct.
- [HECHO] No hay respaldo automático programado ni prueba periódica de restauración. [HIPÓTESIS] PITR (point-in-time
  recovery) de Firestore no consta activado (requiere plan de pago; el plan actual no está confirmado).
- [RIESGO] Restaurar hoy = sobrescribir el documento monolítico completo → se perderían todos los cambios de todos
  los entrenadores posteriores al respaldo. No existe restauración selectiva por entrenador/día/cliente.

## Otros hallazgos

- [HECHO] **Sesiones = copia de la ficha en el momento de crearse** (`{...cliente, duracionMin}`), y editar la ficha
  **no** actualiza sus sesiones. Finanzas factura con la **ficha actual**; los KPI de Agenda y Dashboard usan la
  **copia de la sesión**. → Dos fuentes de verdad para el importe de una misma sesión (inconsistencia
  demostrada en código; magnitud real no medida). Requiere decisión de negocio (precio congelado o no).
- [RIESGO — MEDIO PLAZO] `besoulSuite/finanzas` ≈ 86 KB, crece por meses (`historico`, `auditoriaCierres`,
  `trainerSettingsVersiones`). [HIPÓTESIS] A ~20 KB/mes alcanzaría 1 MiB en ~4 años. Medir antes de decidir.

## Conclusión

La causa estructural de los incidentes es el **documento monolítico**: concentra tamaño, contención, coste de
sincronización, superficie de conflicto y exposición de datos. El hotfix resolvió la **pérdida silenciosa** y la
**falsa confirmación**; no puede resolver el **tamaño**, el **aislamiento de lectura** ni el **coste por cambio**.
No todos los fallos son de tamaño: el bug de `merge:true` en conversión de leads, la escritura doble de pruebas CRM,
las reglas laxas de `besoulPublicSchedule` y la doble fuente de precio son causas independientes.
