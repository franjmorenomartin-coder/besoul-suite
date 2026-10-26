# Finanzas: guardado seguro, protección contra vaciado y restauración selectiva

FIX-FINANZAS-GUARDADO-SEGURO (2026-10-23). Estado: **implementado y probado en local / emulador.
Nada desplegado, nada escrito en producción, nada restaurado.**

## 1. Incidente del 10-10-2026 (resumen)

- Entre las 08:31 y las 08:36 UTC, una sesión de Finanzas (cuenta que figura en `actualizadoPor`)
  añadió dos gastos de octubre. Tras esas escrituras, `besoulSuite/finanzas` quedó con
  `trainerSettings`, `trainerSettingsVersiones`, `centrosVersiones`, `otrosIngresos` e `historico`
  vacíos, y `centros` sustituido por los valores por defecto del código.
- **Causa técnica (reproducida en el emulador, idéntica campo a campo al estado real):**
  1. `finanzas.html` mostraba la pantalla antes de recibir el documento; `dbFinanzas` empezaba con
     mapas vacíos y el listener no tenía manejo de error.
  2. `guardarConfigFinanzas()` enviaba `set({...dbFinanzas}, {merge:true})`. El SDK de Firestore trata
     un **mapa vacío** como "sustituir el campo entero" (`parseObject` añade la ruta a la máscara).
  3. La pestaña recibió después el documento ya vaciado, `normalizarFinanzas()` rellenó `centros` con
     `DEFAULT_CENTROS`, y el guardado siguiente escribió esos valores por defecto.
- La acción del usuario (añadir un gasto) era normal; el defecto era del código.

## 2. Protecciones implementadas

| Capa | Dónde | Qué hace |
|---|---|---|
| Carga | `finanzas.html` → `suscribirFinanzas()` | Estado `cargando` / `listo` / `error` / `sin_documento`. Solo un snapshot **del servidor** (no de caché) y existente pone `listo` y sustituye `dbFinanzas`. Un error o un documento inexistente **nunca** sustituye los datos por vacíos o por defecto. Aviso visible (`#finanzas-estado-carga`) y contenido con atributo `inert` (no solo CSS) mientras no hay datos. "Actualizar" vuelve a suscribirse si la carga falló. |
| Guardado | `finanzas.html` → `guardarConfigFinanzas()` | Rechaza cualquier escritura si el estado no es `listo`. Ya no envía el documento completo. |
| Escritura dirigida | `besoul-finanzas-guardado.js` → `guardarCambios()` | Compara el estado de la pestaña con lo último recibido del servidor (normalizado igual) y escribe solo las rutas cambiadas (`gastos.2026-10`, `trainerSettings.igor`, `centros.inacua`…) con `tx.update()` + `FieldPath`. La normalización (centros por defecto) nunca se escribe. |
| Concurrencia | ídem, en transacción | Comparación a tres bandas por ruta: si otra sesión cambió esa misma ruta desde que esta pestaña la leyó → `conflicto-concurrencia`, no se escribe nada. Rutas distintas se conservan las dos. |
| Vaciado / borrado masivo (cliente) | ídem | `vaciado-bloqueado` si un mapa crítico con contenido quedaría vacío; `borrado-masivo-bloqueado` si se borrarían >1 entradas de `trainerSettings`, `trainerSettingsVersiones`, `centros` o `centrosVersiones`. Vaciar `historico` solo si el cierre se mueve a `historicoBorrado` en la misma escritura. |
| Concurrencia en la propia pestaña (revisión 2) | ídem + `suscribirFinanzas()` | Las operaciones se calculan sobre una copia tomada al empezar el guardado (lo editado durante la transacción va en el guardado siguiente). La base avanza solo con lo que la pestaña ha escrito (un cambio ajeno aún no recibido sigue contando como conflicto). Al llegar un snapshot, las ediciones pendientes se conservan (`rebasar`); si otra sesión cambió esa misma ruta, gana el servidor y se avisa. Un guardado rechazado devuelve esas rutas al valor del servidor (no se reintenta). |
| Marca de versión (revisión 2) | `firestore.rules` → `finanzasEscrituraSegura()` | Toda escritura (create/update) debe llevar `guardadoSeguroEn == request.time` (serverTimestamp). Solo la versión nueva y la herramienta de restauración la envían: **una versión antigua en caché no puede escribir nada**, ni con datos vacíos ni con datos completos. |
| Reglas (servidor) | `firestore.rules` → `finanzasSinVaciado()` | Misma defensa en el servidor: `update` denegado si deja vacío un mapa crítico que tenía entradas, o quita >1 entrada de configuración; `delete` del documento denegado. Lectura: solo admin, como antes. Regenerado también `scripts/corte/firestore.contingencia.rules`. |
| Centros públicos (revisión 2) | `sincronizarCentrosPublicosSiCambian()` | `besoulPublicConfig/centros` solo se escribe si cambia la lista publicada (id, nombre, activo, orden, visibilidad); un cambio de canon no la escribe. |
| PWA | `sw.js` | `besoul-finanzas-guardado.js` en la caché; `CACHE_NAME` v16 para descartar copias antiguas. |

Comportamiento que cambia (intencionado):
- Mientras Finanzas carga, no se puede editar. Si falla la carga, aviso rojo con el código de error.
- `besoulPublicConfig/centros` solo se sincroniza cuando cambia la lista publicada (antes, en cada guardado).
- Un admin ya no puede borrar el documento `besoulSuite/finanzas` (antes podía).
- Con las reglas nuevas, una pestaña de Finanzas con la versión antigua recibe "Error guardando
  Finanzas" en cualquier guardado: hay que recargar la página.
- Si otra sesión cambia los mismos datos mientras se edita, se muestran sus datos y se avisa de que el
  cambio propio no se ha guardado (antes: recargar).
- Coste Spark: cada guardado es 1 lectura + 1 escritura (transacción); antes 1 escritura. Guardados
  sin cambios: 0 escrituras.

## 3. Pruebas

| Batería | Resultado | Qué demuestra |
|---|---|---|
| `finance-save-tests/run_guardado_seguro.cjs` (emulador, reglas del repo, `finanzas.html` real) | 92/92 | Incidente reproducido → rechazado sin escribir; carga/errores/documento inexistente; gastos añadir/modificar/eliminar/mes vacío/copiar fijos; otros ingresos; concurrencia entre pestañas y dentro de la pestaña (§9: edición durante la transacción, snapshot ajeno con edición en cola, cambio ajeno no visto); vaciado y borrado masivo (cliente y reglas); versión antigua (vacía o sana) y escrituras sin marca → denegadas; operaciones legítimas por la interfaz real (§10: último gasto/ingreso del único mes, condiciones de entrenador con y sin vigencia, alta de entrenador, centros crear/editar/desactivar/eliminar, cerrar/reabrir/recalcular/papelera/restaurar cierre, centros públicos solo cuando cambian). Los casos de §9 FALLAN con la versión anterior a la revisión (comprobado). |
| `finance-save-tests/run_restauracion_selectiva.cjs` (reglas nuevas y anteriores) | 50/50 | Restauración: simulación sin escrituras, confirmación, solo rutas aprobadas, conflictos; funciona con las reglas nuevas sobre el documento vaciado; reversión sin vaciar nada (solo rutas sobrescritas). |
| Regresión con datos reales del 09-10 (local, fuera del repo) | 6/6 | La secuencia real del 10-10 ya no vacía nada, ni con la versión nueva ni con la antigua en caché (reglas). |
| Baterías existentes (`finance-tests`, `fieldpath-tests`, `save-tests`, `pwa-tests`, `logout-cache-tests`, `crm-incident-tests`, `firestore-index-config-tests`, `rules-tests/run_arquitectura_documentos`, `verificar-v2-intacto`) | iguales que `origin/main` | Sin regresiones. |

Ejecutar:

```bash
firebase emulators:exec --only firestore --project demo-besoul-finanzas "node finance-save-tests/run_guardado_seguro.cjs"
firebase emulators:exec --only firestore --project demo-besoul-restauracion "node finance-save-tests/run_restauracion_selectiva.cjs"
```

## 4. Despliegue (PENDIENTE DE AUTORIZACIÓN)

**Reglas PRIMERO, código después, restauración al final.** Publicar el código antes que las reglas
dejaba una ventana en la que una pestaña antigua (estado vacío o datos anteriores a la restauración)
podía seguir enviando el documento completo y volver a vaciar o pisar lo restaurado. Con la marca de
versión, desplegar las reglas primero cierra esa ventana: desde ese momento ninguna versión antigua
puede escribir, y el peor caso es que Finanzas quede **solo lectura** unos minutos hasta que se publica
el código nuevo. La restauración funciona con las reglas nuevas (probado), y su reversión no necesita
vaciar nada.

| Paso | Acción | Comprobación | Si falla |
|---|---|---|---|
| 0 | Revisión y fusión de la rama (sin desplegar). Lectura (solo consulta) de `besoulPublicConfig/centros`. | Pruebas en verde; V2 intacto. | No se sigue. |
| 1 | **Ventana de mantenimiento de Finanzas** (15–30 min): avisar a los admins; cerrar todas las pestañas de Finanzas. Agenda, CRM y Portal siguen operativos. | Nadie usa Finanzas. | Aplazar. |
| 2 | Respaldo del día (`respaldoBesoul()`), SHA-256 anotado. | Archivo y huella guardados fuera del equipo. | No se sigue. |
| 3 | **Reglas**: `node scripts/corte/verificar-v2-intacto.cjs` y `firebase deploy --only firestore:rules`. | Agenda guarda una sesión; CRM crea un lead; el Portal abre. Finanzas abre y lee (escritura denegada: esperado). | Volver a desplegar las reglas anteriores (`git show origin/main:firestore.rules`): los datos no cambian. |
| 4 | **Código**: publicar `finanzas.html`, `besoul-finanzas-guardado.js`, `sw.js` (GitHub Pages). | Abrir Finanzas con recarga forzada; en consola `typeof BesoulFinanzasGuardado.rebasar === 'function'`; aviso "Cargando…" que desaparece; añadir y borrar un gasto de prueba en un mes abierto; el documento tiene `guardadoSeguroEn` y solo cambia `gastos.<mes>` (comparar con el respaldo del paso 2). | Ver "Reversión". |
| 5 | **Restauración selectiva** (autorización aparte, sección 5) con el respaldo del paso 2 como "actualizado". Si cambia `centros`, ejecutar después `sincronizarCentrosPublicos()` en la consola de Finanzas (1 escritura). | `planificar()` repetido: todo `ya_restaurado`; cifras revisadas con administración; archivo de reversión guardado. | `revertir()` (solo rutas sobrescritas) o corrección puntual desde Finanzas. |
| 6 | Fin de la ventana; supervisión 7 días (`actualizadoPor`, `guardadoSeguroEn`, errores en consola). | — | — |

### Reversión del despliegue (sin volver a vaciar configuraciones)

- **Código** con problemas tras el paso 4: corregir hacia delante. Revertir el código con las reglas
  nuevas deja Finanzas en solo lectura (la versión antigua no puede escribir): es seguro, pero bloquea.
  Volver a la versión antigua con las reglas antiguas reabre el riesgo del incidente: solo con todas
  las pestañas cerradas, respaldo nuevo y autorización expresa.
- **Reglas** con problemas (una operación legítima denegada): volver a desplegar las anteriores. El
  código nuevo funciona también con ellas (probado) y los datos no cambian.
- **Restauración** incorrecta: `revertir()` devuelve su valor anterior solo a lo que la restauración
  sobrescribió; lo que estaba perdido se mantiene y se corrige ruta a ruta desde la interfaz (o con
  otra restauración planificada). Nunca se vuelve al estado vaciado y nunca se toca `gastos`, así que
  los movimientos legítimos posteriores (p.ej. los gastos de octubre) se conservan siempre.
- Los datos que añade el código nuevo (`guardadoSeguroEn`, `auditoriaRestauraciones`,
  `historicoLegadoRestaurado`) no los lee el motor: revertir no pierde ni altera cifras.

## 5. Restauración selectiva (PREPARADA, NO EJECUTADA)

Herramienta: `scripts/restaurar-finanzas-selectivo.js` (consola del navegador, admin, sin claves).

1. **Respaldo actualizado** del día (`respaldoBesoul()`), con su SHA-256.
2. Pegar el script en la consola de `finanzas.html`. `cargarRespaldoFinanzas()` dos veces: el del
   09-10 (origen) y el del día (actualizado); se muestra el SHA-256 de cada uno para cotejarlo.
3. **Simulación**: `restauracionFinanzas.planificar({ origen, actualizado, rutasAprobadas })`. No escribe.
   Clasifica cada ruta del origen:
   - `restaurable`: ausente en el servidor (perdida) → se escribe si está aprobada;
   - `ya_restaurado`: el servidor ya tiene ese valor;
   - `requiere_decision`: el servidor tiene otro valor (p.ej. `centros.*` con valores por defecto) →
     solo con `sobrescribir: [...]` explícito;
   - `cambiado_tras_respaldo`: cambió en el servidor desde el respaldo actualizado → bloquea;
   - `fecha_serializada`: el valor contiene fechas serializadas del respaldo → bloquea.
   Informa además de qué campos del documento han cambiado desde el respaldo actualizado.
4. **Validación de negocio**: la lista `rutasAprobadas` la decide administración (pendientes: condiciones
   de varios entrenadores, los 11 de Inacua, cánones de centros). `gastos` nunca es candidato.
5. **Ejecución** (solo con autorización): `ejecutar({ plan, confirmacion: 'RESTAURAR FINANZAS', motivo })`.
   Transacción: si el documento cambió desde la simulación, o el plan ya no coincide, no escribe nada.
   Escribe solo las rutas aprobadas + `auditoriaRestauraciones.<id>`; descarga `besoul-reversion-<id>.json`.
6. **Verificación**: repetir `planificar()` (todo `ya_restaurado`), nuevo respaldo y comparar; abrir
   Finanzas y revisar cifras con administración.
7. **Reversión**: `revertir({ reversion, confirmacion: 'REVERTIR RESTAURACION', motivo })`. Devuelve su
   valor anterior SOLO a las rutas que la restauración sobrescribió (p.ej. `centros.alfa_prime`), y
   solo si no se han editado después. Las rutas que estaban ausentes se mantienen y se listan
   (`seMantienen`): se corrigen desde Finanzas. No vacía nada, funciona igual con las reglas nuevas.

Nota sobre `historico`: en el respaldo del 09-10 es una **lista** de formato antiguo («JUNIO 2026»), no
un mapa de cierres por mes. Devolverla a `historico` rompería el cierre de meses del código actual; la
herramienta la ofrece como `historicoLegadoRestaurado` (solo conservación, sin efecto en los cálculos).
