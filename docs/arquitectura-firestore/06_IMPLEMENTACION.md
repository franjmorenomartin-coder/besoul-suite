# Informe 6 — Implementación, pruebas, consumo y procedimiento de corte

Rama: `ARQ-V1-MIGRACION-IMPL` (derivada de `ARQ-V1-FIRESTORE-ESCALABLE`, incluye los hotfix `89b31e1`
—publicado— y `4e91256` —sin publicar—). Nada de esto está desplegado. Fecha: 2026-10-13.

## 1. Qué se ha implementado

| Pieza | Archivo | Qué hace |
|---|---|---|
| Capa de datos | `besoul-datos.js` | Transformación exacta documento único ⇄ documentos; sincronización incremental; guardado transaccional por documento; transacción sobre documentos concretos (CRM); configuración global (Finanzas); contadores de consumo |
| Agenda | `agenda.html` | Lee por colecciones (PT: solo lo suyo; admin: todo) con copia local de datos **confirmados**; guarda con la misma fusión a tres vías de siempre, por documento, con comprobación anti-solapes en el servidor; publicación del portal sin relecturas y solo lo cambiado; listeners auxiliares acotados |
| CRM | `crm.html` | Pruebas CRM y conversión de leads leyendo solo las semanas/fichas implicadas (`leadsPrueba`, `leadId`); la prueba se borra de verdad al convertir |
| Finanzas | `finanzas.html` | Agenda incremental; actividades → `besoulTrainers/{tk}.actividades`; catálogo → `besoulAgendaConfig/global`; sin lecturas duplicadas |
| Dashboard | `dashboard.html` | Agenda incremental; elimina la lectura doble (get + listener) |
| Función cancelación | `functions/cancelacionCliente.js` | Adaptada a semanas/notas (sigue SIN desplegar) |
| Reglas | `firestore.rules` | Aislamiento real de lectura y escritura por entrenador; documento antiguo congelado; lápidas; hora del servidor obligatoria; `besoulPublicSchedule` solo del propio entrenador |
| Índices | `firestore.indexes.json` | 10 compuestos (todos con consulta real) + exenciones de mapas grandes |
| Migrador | `scripts/migrar-agenda-documentos.js` | Simulación, ejecución idempotente, verificación desde el servidor, reconstrucción inversa |
| Daños | `scripts/informe-sesiones-danadas.cjs` | Clasifica sesiones dañadas comparando dos respaldos |

Decisiones respecto a los informes 3–4 (justificadas por el código real):
- **Documento por entrenador y SEMANA** (no por día): mismas garantías (tamaño acotado por huecos físicos:
  ≤ 7 × 96 huecos; mayor real medido 29 KB) y ~5× menos documentos en la primera carga.
- **Se conserva la forma en memoria de la app** (`dbClientes`, `dbAgenda`…): cero cambios en la lógica de
  negocio, económica o de interfaz; solo cambia la persistencia. Las claves de sesión siguen siendo
  `fecha_hora` (identidad estable dentro de la semana); mover entre semanas es atómico (2 documentos, 1 transacción).
- **Sin borrados**: fichas e históricos eliminados quedan como lápidas (`eliminado: true`).
- **`rev` no se compara con el valor guardado en las reglas**: el emulador demostró que, con dos guardados
  simultáneos, esa regla convertía el reintento de la transacción en un falso `permission-denied`
  (exactamente el síntoma reportado). La protección contra pisar cambios es la transacción.

## 2. Pruebas superadas (todas en local; ninguna sobre producción)

| Batería | Resultado | Qué valida |
|---|---|---|
| Ida y vuelta con respaldos reales 9-oct y 13-oct | 8/8 + 8/8 | Transformación exacta, determinista, sin datos no transformables; huellas SHA-256 por entrenador y campo |
| Emulador, SDK real, reglas reales (`rules-tests/run_arquitectura_documentos.cjs`) | **73/73** | Migración real verificada desde el servidor; 34 reglas; 18 escenarios de guardado/concurrencia con la fusión real; sincronización y consumo |
| Páginas reales en navegador + emulador (`.review-local/agenda-persistencia/arq_e2e.cjs`) | **23/23** | PT aislado; crear/mover; admin+PT simultáneos; doble reserva; ficha; recarga con copia local; sin conexión y reconexión; bloqueo de día; reserva del portal aceptada; viewport iPhone (motor Chromium); Dashboard; CRM; sin errores de permisos ni JS |
| Migrador real en navegador (`arq_migrador_e2e.cjs`) | **6/6** | Simulación, ejecución, verificación IDÉNTICO, original intacto, idempotencia, reconstrucción |
| Baterías existentes adaptadas a documentos | concurrencia 57/57, disponibilidad 52/52, avisos 7/7, huecos portal 42/42, CRM 111/111, rutas con punto 14/14, índices 30/30 | Los mismos escenarios históricos, ahora contra el guardado nuevo |
| Baterías existentes sin cambios | guardado 28/28, fichas 13/13, publicación 9/9, PWA 15/15, logout 23/23, finanzas 95/95, grupos 19/19, calendario 15/15, asistente 174/174 | Sin regresiones |

**Pendiente (no automatizable aquí):** Safari real en iPhone y Chrome real en Android (solo viewport
emulado en Chromium); Finanzas y Portal no cargan el modo emulador, se validaron por sus baterías Node;
prueba real en producción con usuarios autorizados durante el corte. Fallo preexistente ajeno:
`portal-tests` 19/20 (fecha de prueba ya pasada, también falla en `main`).

## 3. Consumo de Firestore: ANTES / DESPUÉS

ANTES = código en producción (`89b31e1`), calculado del código y de los volúmenes reales (doc. 1.032 KB,
103 leads, 22 usuarios, 217 fichas públicas). DESPUÉS = **medido** (emulador, contadores instrumentados).
Lecturas de reglas: +1 por consulta o escritura (perfil del usuario).

| Operación | Antes: lecturas / escrituras / datos | Después (medido): lecturas / escrituras |
|---|---|---|
| Abrir Agenda — PT | ~20 / **~13** (republica) / ~2 MB | primera vez en el dispositivo: 7 (ficticio) – 53 (PT real); siguientes: **6** + reglas / 0 |
| Abrir Agenda — admin | ~270 / **~238** / ~2 MB | primera vez: 904 (datos reales, una vez por dispositivo); siguientes: **15** / 0 |
| Cambiar de semana | 0 / 0 | 0 / 0 |
| Crear sesión | admin 2 / **239**; PT 2 / 14 + ~200 rechazos de reglas; ~2 MB | **2 / 1** (+ 0–2 de portal si cambia lo publicado) |
| Mover a otra semana | igual que crear | 3 / 2 |
| Recurrencia 12 semanas | igual que crear | 13 / 12 |
| Modificar ficha | 2 guardados: admin 4 / **~478** | **4 / 1** (+ semanas futuras de ese cliente si cambian) |
| Recibir el cambio de otro (por dispositivo) | 1 / 0 / **~1 MB** | **1 / 0 / 5–30 KB** |
| Abrir Dashboard | ~254 (todo dos veces) / 0 / ~2 MB | 7 + usuarios + leads (con copia local) |
| Abrir Finanzas | ~48 / 0 / ~2 MB | ~10 + usuarios (estimado: misma sincronización que Dashboard; Finanzas no se abre en el emulador) |
| Reserva desde el portal | 4 en portal + republicación total en cada dispositivo abierto (~238 escrituras) | 4 en portal + 1–2 escrituras (solo ese entrenador, solo lo cambiado) |

### Proyección diaria (hipótesis explícitas)
Uso actual supuesto: 18 PT × 6 aperturas y 15 guardados/día; admin 10 aperturas de Agenda, 5 de
Dashboard, 5 de Finanzas, 5 de CRM y 60 guardados/día; 3 dispositivos escuchando cada agenda.

| | Antes | Después | Límite Spark |
|---|---|---|---|
| Lecturas/día | ~8.400 | **~5.500** | 50.000 |
| Escrituras/día | **~21.900** (≈ lo observado: 21.000 el 9-oct) | **~700** | 20.000 |
| Datos descargados/día | **~1,6 GB** (≈ 48 GB/mes) | ~20 MB | 10 GiB/mes |

Escenarios de crecimiento (actividad proporcional a clientes activos, ver informe 3): ×4 (≈1.700 activos)
→ ~20.000 lecturas y ~2.800 escrituras/día: **cabe en Spark**. ×15 (≈6.400 activos) → ~60–80.000
lecturas/día: **superaría Spark**. Conclusión: **Spark es viable ahora y a medio plazo**; Blaze solo sería
necesario si la actividad diaria se multiplica por más de ~5–6 (o si se quiere eliminar el riesgo de
corte por cuota), con un coste estimado de céntimos a pocos euros al mes. Nota: la descarga de ~48 GB/mes
del modelo actual supera con creces los 10 GiB/mes del plan Spark; es una causa probable (no confirmada
con el desglose de la consola) del aviso "Se alcanzó el límite de recursos".

Detección de regresiones de consumo: las baterías `run_arquitectura_documentos.cjs` y `arq_e2e.cjs`
fallan si crear una sesión escribe más de 1 documento, si reabrir lee más de 8, o si sincronizar un
cambio cuesta más de 1 lectura.

## 4. Integridad de la migración (respaldo real 13-oct)
1.078 sesiones, 427 fichas, 269 meses de histórico, 1 nota, 21 entrenadores, disponibilidad con
excepciones y slots ocultos → 876 documentos (156 semanas, 427 fichas, 269 históricos, 21 entrenadores,
1 nota, config, legado). Reconstrucción **idéntica** al original (comparación campo a campo y SHA-256 por
entrenador/campo), en memoria y **releyendo desde el servidor** con las reglas reales. Ningún dato
ambiguo. Campos de uso desconocido: conservados verbatim (`besoulAgendaLegado/raiz`: campos raíz sueltos
como `trainerActividades.ruben`). Nota antigua sin entrenador (1): solo visible para admin → revisión manual.

## 5. Sesiones dañadas (comparando respaldos 9-oct y 13-oct; detalle fuera del repo)
`Downloads/besoul-informe-danos-2026-10-13/` (contiene datos de clientes).
- **15 recuperables con certeza**: perdieron `duracionMin` (15) y/o la serie recurrente (4).
- **120 a revisión manual**: sesiones anteriores al 9-oct cuyo `integrantesObj` (111) o datos del plan (9)
  cambiaron (posible reescritura con la ficha actual; puede afectar a la economía de grupos históricos).
- Daños anteriores al 9-oct: no determinables (no hay respaldo previo).
La recuperación (`propuesta-recuperacion.json`) se aplicaría tras el corte, con autorización expresa.

## 6. Procedimiento exacto de corte (requiere autorización final)

Preparación (T-24 h): avisar a los entrenadores (ventana, "recargad la app al terminar", revisar agenda
después); confirmar quién despliega reglas (consola de Firebase o CLI con una cuenta con permisos);
fusionar `ARQ-V1-MIGRACION-IMPL` en una rama de publicación SIN subirla.

| Paso | Acción | Tiempo | Criterio para continuar |
|---|---|---|---|
| 1 | Desplegar reglas e índices: `firebase deploy --only firestore:rules,firestore:indexes --project besoul-suite` | 2 min + creación de índices (2–10 min) | Índices "Habilitado" en la consola. **Desde aquí nadie puede escribir en el documento antiguo** (mantenimiento efectivo) |
| 2 | Respaldo final del estado congelado (exportación desde la consola admin, como el 13-oct) + SHA-256 | 2 min | Hash verificado; copia fuera del equipo |
| 3 | Migración: en la consola de la app (admin) pegar `besoul-datos.js` y `scripts/migrar-agenda-documentos.js`; `await migrarAgendaBesoul()` → revisar; `await migrarAgendaBesoul({ ejecutar: true })` | 2–3 min | `verificacionServidor: 'IDÉNTICO'`, `originalIntacto: true`, recuentos iguales |
| 4 | Publicar la app (push de la rama de publicación a `main`); comprobar build `agenda-arq-documentos-2026-10-13` y SW v13 | 2–3 min | La web sirve la versión nueva |
| 5 | Pruebas reales: admin y un PT autorizado abren Agenda, Dashboard, Finanzas y CRM; un guardado de prueba controlado en una agenda/cliente de prueba acordado; móvil iPhone/Android | 10–15 min | Sin errores de permisos; guardado confirmado; datos completos |
| 6 | Abrir: avisar a los entrenadores para recargar | — | — |

**Tiempo de mantenimiento estimado: 25–35 min** (reservar 60 min).

**Condiciones de parada**: cualquier diferencia en la verificación; `originalIntacto: false`; índices no
habilitados; cualquier `permission-denied` en flujos normales; un dato ausente en las pruebas reales.

## 7. Recuperación si falla
- **Fallo antes del paso 4** (sin escrituras nuevas): volver a desplegar las reglas anteriores
  (`git show 89b31e1:firestore.rules`). El documento antiguo está intacto y la app antigua sigue
  funcionando. Las colecciones nuevas quedan inertes (no se borran).
- **Fallo después del paso 4**: preferible corregir hacia delante. Si hay que volver atrás:
  1) volver a desplegar las reglas anteriores; 2) `reconstruirAgendaBesoul()` (simulación) — incluye todo lo
  guardado después del corte; 3) si no cabe en 1 MiB (probable: el original ya ocupa ~1.032 KB), solo con
  autorización, `reconstruirAgendaBesoul({ ejecutar: true, quitarCincoCamposRedundantes: true })`;
  4) publicar el commit anterior de la app (`89b31e1` o `4e91256`). **Volver al código anterior no revierte
  Firestore**: sin el paso 2–3, se perderían los cambios posteriores al corte.
- **Restauración selectiva**: un documento (semana, ficha, histórico) desde el respaldo, sin tocar el resto.

## 8. Riesgos y pendientes
- Hotfix `4e91256` (cuota de escrituras) sigue **sin publicar**: hasta el corte, la producción puede
  volver a agotar la cuota diaria con actividad normal del admin.
- Pruebas en Safari iOS y Android reales: pendientes del corte.
- Despliegue de reglas/índices: confirmar cuenta con permisos (la CLI de este equipo usa otra cuenta).
- Primera apertura del admin en cada dispositivo: ~900 lecturas (una vez; cerrar sesión borra la copia local).
- `integrantesObj` y datos del plan en 120 sesiones históricas: decisión de negocio sobre su recuperación.
