# Informe 4 — Migración sin pérdida de datos

## Estrategia: dos etapas, sin doble escritura

**Etapa 1 — Meses cerrados (medida puente y primer paso real).** Copiar las sesiones de meses **cerrados** a
`besoulAgendaDias` (formato definitivo) y, solo tras verificación, retirarlas del monolito. Esos datos ya no se
editan en el día a día ([DECISIÓN D2] confirmar que los meses cerrados quedan de solo lectura), así que no existe
divergencia posible. Requiere que agenda/finanzas/dashboard lean "monolito + días archivados" para rangos pasados
(lector unificado). Libera ~150 KB por mes cerrado → elimina la urgencia de noviembre.

**Etapa 2 — Corte completo en ventana de mantenimiento.** Clientes, días futuros/actuales, disponibilidad, notas,
pruebas CRM, histórico y `trainerActividades` pasan a la nueva estructura en una ventana corta (fuera de horario,
estimado 30–60 min) con la app en modo mantenimiento.

**Por qué sin doble escritura:** escribir a la vez en dos estructuras exige reconciliar continuamente y, ante un fallo
parcial, no hay fuente de verdad clara. Con ventana: antes del corte, la verdad es el monolito; después, la nueva
estructura; el monolito queda **congelado por reglas** (solo lectura admin) como evidencia y origen de recuperación.

## Procedimiento (15 puntos)

1. **Inventario y respaldo íntegro.** `scripts/backup-firestore.js` (todas las colecciones) + export administrado
   (`gcloud firestore export` si el plan lo permite). Registro de `updateTime` del monolito.
2. **Verificación criptográfica.** `manifest.json` con SHA-256 por archivo, `--verificar`; copia fuera del equipo.
   Recuento por entrenador: fichas, sesiones, días bloqueados, excepciones, slots ocultos, notas, histórico.
3. **Copia aislada para pruebas.** Emulador de Firestore cargado con el respaldo (datos protegidos: no salen del
   equipo; para pruebas compartidas, versión **anonimizada** reproducible: nombres/teléfonos/emails sustituidos con
   hash estable).
4. **Transformación reproducible.** Script puro `transformar(monolito) → {dias[], clientes[], trainers[], historico[]}`
   sin efectos secundarios, determinista (mismo input → mismo output, `sesionId` derivado de
   `hash(trainerKey, claveOriginal, clientId)` para que repetir la migración genere los mismos ids). Se versiona en el repo.
5. **Reconciliación.** Para cada entrenador: nº sesiones, conjunto de (fecha, hora, clientId) idéntico; fichas por id;
   bloqueos/excepciones/slots por fecha; notas por clave; histórico por (cliente, mes). Se emite informe de diferencias;
   **cualquier diferencia no explicada detiene el proceso.**
6. **Validación campo por campo.** Función inversa `reconstruir(nuevo) → monolito`; se exige
   `canon(reconstruir(transformar(M))) == canon(M)` byte a byte (módulo campos explícitamente transformados, listados).
   Esta función es también el plan de recuperación de datos (punto 13).
7. **Control de escrituras concurrentes durante la migración.** (a) Aviso a usuarios; (b) bandera
   `besoulPublicConfig/mantenimiento` que la app comprueba y bloquea escritura; (c) **despliegue de reglas que
   deniegan escritura** en `besoulSuite/agenda` a no-admin (garantía real, no depende de la app); (d) relectura del
   `updateTime` antes y después: si cambió, se aborta.
8. **Transición entre versiones.** Nueva versión de la app publicada en la misma ventana; SW con nueva `CACHE` y
   comprobación de versión mínima (`besoulPublicConfig/version.minima`): una pestaña antigua muestra "Recarga para
   continuar" y no puede escribir (además las reglas la bloquean).
9. **Pruebas de permisos y concurrencia** en emulador con datos de la copia aislada (ver Informe 5, P1–P16).
10. **Validación funcional ordenador y móvil** antes de abrir: checklist de `AGENTS.md` (18 puntos) en Chrome
    escritorio, iPhone Safari y Android Chrome, con cuenta admin y una cuenta PT de prueba.
11. **Ventana controlada.** Etapa 1 sin ventana (datos inmutables). Etapa 2 con ventana fuera de horario; opcional
    piloto previo con un entrenador voluntario en entorno de emulador/proyecto de pruebas, nunca en producción parcial.
12. **Rollback del código.** Rama/tag de la versión anterior preparados. **Volver al código anterior NO revierte
    Firestore**: el código antiguo solo funciona si el monolito vuelve a ser la fuente de verdad, lo que exige el punto 13.
13. **Recuperación de datos (independiente).** Si hay que volver atrás tras haber escrito en la nueva estructura:
    `reconstruir(nuevo)` genera un monolito que incluye los cambios hechos después del corte; se verifica tamaño
    < 900 KB, se reabren las reglas antiguas y se escribe. Si el fallo es de datos de la nueva estructura, restauración
    selectiva por documento (día/cliente) desde el respaldo, sin afectar al resto.
14. **Criterios de aceptación.** 0 diferencias en reconciliación; ida-vuelta idéntica; 100 % de P1–P16 en verde en
    emulador; checklist manual completa en 3 dispositivos; tras abrir, 48 h sin `permission-denied` ni conflictos no
    explicados en el registro de errores; validador nocturno sin huérfanos.
15. **Condiciones de parada.** Cualquier diferencia en reconciliación; `updateTime` del monolito cambiado durante la
    ventana; fallo de una prueba P*; tamaño inesperado de un documento > 100 KB; `permission-denied` en flujos normales
    tras abrir; un usuario reporta un dato ausente → se vuelve a modo mantenimiento y se ejecuta el punto 13 si procede.

## Mapa de transformación

| Origen (monolito) | Destino |
|---|---|
| `agenda.<tk>.<fecha_HH:MM>` | `besoulAgendaDias/{tk}_{fecha}.sesiones.{sesionId}` con `hora`, `clientId` = `id`, resto según D1 |
| `pruebasCRM.<tk>.<clave>` + copia en `agenda` | una sola sesión `tipoCita:'pruebaCRM'` (se reconcilian ambas copias; discrepancias → informe) |
| `disponibilidadReservas.<tk>.semanal` + config | `besoulTrainers/{tk}` |
| `disponibilidadReservas.<tk>.excepciones[fecha]` / `bloqueos[fecha]` | `besoulAgendaDias/{tk}_{fecha}.excepcionHorario/bloqueoDia/slotsOcultos` |
| `notas.<tk>__<clave>` | `besoulAgendaDias/{tk}_{fecha}.notas` (clave → sesionId si existe; si no, por hora) |
| `clientes.<tk>[]` | `besoulClientes/{id}` con `trainerKey` |
| `historicoClientes.<tk>.<cid>.<mes>` | `besoulHistoricoClientes/{tk}_{cid}_{mes}` |
| `trainerActividades.<tk>` | `besoulTrainers/{tk}.actividades` |

Casos especiales a resolver antes: `trainerKey` con punto (IDs válidos; rutas con `FieldPath`), fichas duplicadas por
id entre entrenadores (detectar y listar), sesiones cuyo `id` no corresponde a ninguna ficha (huérfanas: conservar
y listar), claves de sesión mal formadas (conservar en `sesionesNoNormalizadas` y listar).

## Módulos afectados por el corte

`agenda.html` (capa de datos completa), `crm.html` (conversión/pruebas), `finanzas.html` y `dashboard.html`
(lectura por rangos), publicación del portal (lee de la nueva estructura), `functions/cancelacionCliente.js`
(si se despliega), `firestore.rules`, `firestore.indexes.json`, `sw.js` (versión), tests.
Estrategia de código: una **capa de acceso a datos** compartida (`besoul-datos.js`) para que los módulos no
conozcan la forma de Firestore; se introduce primero leyendo del monolito (sin cambio funcional) y luego se cambia
la implementación en el corte.
