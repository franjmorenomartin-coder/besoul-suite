# Portal Slots P0 Tests — causa raíz de "Sin huecos disponibles" (PORTAL-SLOTS-P0)

Reproduce la cadena REAL completa -- disponibilidad guardada en Agenda -> `publicarReservasPublicas()`
(agenda.html, extraído verbatim) -> `besoulPublicSchedule`/`besoulPublicClients` (mock de
Firestore con `batch()/set()/commit()`) -> generador de slots real del Portal
(`generarSlotsReserva()`, portal-cliente.html, extraído verbatim). Nunca toca Firestore real, nunca
usa datos de Lourdes/Miguel Fenech reales -- reproduce la MECÁNICA con un fixture equivalente.

## Causa RAÍZ EXACTA confirmada en producción (lectura de solo lectura, sin escrituras)

Con Firebase CLI ya autenticado (`besoul-suite`), se leyó -- solo lectura, vía la REST API de
Firestore con un access token obtenido del propio login de `firebase-tools`, minimizando siempre
los campos leídos y sin exponer PII innecesaria -- lo estrictamente necesario para confirmar o
descartar cada hipótesis:

- `besoulUsers`: **un único** perfil cuyo nombre contiene "miguel"+"fenech", con `trainerKey=lillo`.
  **La identidad NO está duplicada.**
- Lourdes Frapolli vive, estructuralmente, en `dbClientes.lillo` (112 clientes en total bajo esa
  clave) -- el mismo trainerKey bajo el que Miguel Fenech guarda de verdad su disponibilidad.
- El trainerKey "miguel" existe y SÍ tiene disponibilidad publicada, pero pertenece a un entrenador
  real **distinto**, "Miguel Luna" (33 clientes propios, sin relación con Miguel Fenech) -- se
  descarta explícitamente como duplicidad de identidad.
- `disponibilidadReservas.lillo` (fuente real en `besoulSuite/agenda`) SÍ tiene 5 días activos,
  `actualizadoEn = 2026-08-27T12:18:37.684Z`.
- `besoulPublicSchedule/lillo` (lo que el Portal realmente lee) tenía **0 días activos
  publicados**, con `disponibilidad.actualizadoEn = 2026-09-08T09:16:46.517Z` y
  `updatedAt = 2026-09-08T09:16:46.734Z` -- **prácticamente el mismo instante**, y muy posterior al
  guardado real del 27 de agosto.

**Esa coincidencia exacta entre `disponibilidad.actualizadoEn` y `updatedAt` de la propia
publicación es la prueba determinante.** `disponibilidadReservasPorDefecto()` (agenda.html) sella
`actualizadoEn: new Date().toISOString()` en el instante en que se la invoca. Que el
`actualizadoEn` publicado coincida con el momento de publicar -- no con el guardado real -- solo
puede significar que se publicó el DEFAULT fabricado por esa función, no una copia vieja del dato
real.

**Clasificación: A -- publicarReservasPublicas() RECIBE una disponibilidad vacía/fabricada** (no la
transforma, ni una segunda operación la sobrescribe después). En `publicarReservasPublicas()`:

```js
const disp = dbDisponibilidadReservas[trainerKey] || disponibilidadReservasPorDefecto();
```

cae al default en cuanto esa clave **no existe todavía** en la copia local en memoria del
navegador que dispara la función -- no hace falta que sea una copia "vieja pero presente". Esto
puede pasar porque `publicarReservasPublicas()` se dispara automáticamente tras CUALQUIER guardado
de CUALQUIER PT/admin (`guardarEstadoNubeAgenda() -> publicarReservasPublicas()`), republicando de
golpe TODOS los trainerKeys con lo que hubiera en memoria en ESE instante -- y, a diferencia de la
UI de edición de disponibilidad (`disponibilidadListaParaEditar()`, que ya bloquea guardar hasta
que `window.bsAgendaDisponibilidadCargada` confirme que llegó al menos un snapshot real, fix de una
fase anterior -- ver el comentario "FIX-PT-AVAILABILITY-PERSISTENCE" en agenda.html),
`publicarReservasPublicas()` nunca comprobaba si el snapshot con el dato de OTRO trainerKey ya
había llegado a esa sesión concreta antes de publicar por él. El fallo, de producirse, tampoco es
visible para nadie: el `catch` de la función solo hace `console.warn`.

## Fix aplicado (agenda.html, `publicarReservasPublicas()`)

Antes de construir el batch de publicación, si existe `window.bsAgendaCloudDocRef` (la referencia
real al documento en producción), se hace `await bsAgendaCloudDocRef.get({ source: 'server' })` y
se reemplazan `dbClientes`/`dbAgenda`/`dbDisponibilidadReservas` por ese estado recién leído
**directamente del servidor** (nunca de caché local) antes de publicar. Aplica igual para
cualquier trainerKey -- no hay ninguna mención a Miguel/Lourdes/lillo en el código. Coste: una
lectura extra de Firestore por cada disparo de publicación: aceptable para un guardado de PT
(frecuencia baja) a cambio de cerrar una clase real de bug de datos obsoletos.

## Tests (25)

- **Escenario correcto**: cliente asignado al trainerKey real de su PT ve slots reales.
- **Capacidad general de la auditoría** (NO es una afirmación sobre el caso real de Lourdes/Miguel
  -- ver arriba, descartado por la lectura de producción): dos perfiles ("miguel_real" con
  disponibilidad, "miguel_otro" sin ella) compartiendo nombre; el cliente asignado a "miguel_otro"
  ve CERO huecos -- y la herramienta de auditoría señala exactamente ese caso, útil para CUALQUIER
  otro PT que en el futuro sí tenga una identidad duplicada real.
- **PUBLICACIÓN-P0 (causa raíz EXACTA, confirmada)**: la clave del trainer NO EXISTE en la copia
  local en memoria de quien dispara la publicación (no "obsoleta pero presente" -- ausente del
  todo), reproduciendo exactamente la caída al default de
  `disponibilidadReservasPorDefecto()` confirmada en producción (mismo patrón de `actualizadoEn`
  fabricado en el instante de publicar). Verifica que, con el fix, se publica la disponibilidad
  FRESCA del servidor y su `actualizadoEn` REAL (no uno fabricado), y que la cadena completa
  post-fix (source con 5 días activos -> publicación -> Portal -> `generarSlotsReserva()`) produce
  huecos futuros reales. Verificado manualmente que este bloque completo FALLA contra el código
  previo al fix (bloque `publicarReservasPublicas` revertido temporalmente, restaurado después) --
  incluyendo que el `actualizadoEn` publicado sin el fix es un timestamp fabricado "ahora mismo",
  reproduciendo el síntoma real byte a byte.
- **Negative controls** (bloque 8 del hotfix): mayúsculas/minúsculas, espacio, punto (conservado
  tal cual -- ya protegido en el writer real por `FieldPath`, ver `availability-tests/`), trainerKey
  ya normalizado, cliente de otro PT (nunca se mezcla), PT sin disponibilidad (0 huecos, no
  fabricados), disponibilidad solo en el pasado (0 huecos futuros), bloqueo (slot oculto
  correctamente), sesión existente (slot ocupado correctamente excluido).

## Cómo ejecutar

```bash
node portal-slots-p0-tests/extract.js && node portal-slots-p0-tests/run_tests.cjs
```
