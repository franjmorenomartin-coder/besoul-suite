# Portal Slots P0 Tests — causa raíz de "Sin huecos disponibles" (PORTAL-SLOTS-P0)

Reproduce la cadena REAL completa -- disponibilidad guardada en Agenda -> `publicarReservasPublicas()`
(agenda.html, extraído verbatim) -> `besoulPublicSchedule`/`besoulPublicClients` (mock de
Firestore con `batch()/set()/commit()`) -> generador de slots real del Portal
(`generarSlotsReserva()`, portal-cliente.html, extraído verbatim). Nunca toca Firestore real, nunca
usa datos de Lourdes/Miguel Fenech reales -- reproduce la MECÁNICA con un fixture equivalente.

## Causa REAL confirmada en producción (lectura de solo lectura, sin escrituras)

Con Firebase CLI ya autenticado (`besoul-suite`), se leyó -- solo lectura, vía la REST API de
Firestore con un access token obtenido del propio login de `firebase-tools`, minimizando siempre
los campos leídos y sin exponer PII innecesaria -- lo estrictamente necesario para confirmar o
descartar la hipótesis de identidad duplicada:

- `besoulUsers`: **un único** perfil cuyo nombre contiene "miguel"+"fenech", con `trainerKey=lillo`.
- Lourdes Frapolli vive, estructuralmente, en `dbClientes.lillo` (112 clientes en total bajo esa
  clave).
- `disponibilidadReservas.lillo` (fuente real en `besoulSuite/agenda`) SÍ tiene 5 días activos,
  `actualizadoEn = 2026-08-27T12:18:37Z`.
- `besoulPublicSchedule/lillo` (lo que el Portal realmente lee) tenía **0 días activos
  publicados**, con `updatedAt = 2026-09-08T09:16:46Z` -- **posterior** al último guardado real de
  la disponibilidad.
- (Se descartó explícitamente la hipótesis de identidad duplicada tipo "lillo"/"miguel": el
  trainerKey "miguel" existe y SÍ tiene disponibilidad publicada, pero pertenece a un entrenador
  real distinto, "Miguel Luna" -- 33 clientes propios, sin relación con Miguel Fenech.)

**Clasificación: B. PUBLICACIÓN.** Un `updatedAt` de publicación posterior al último guardado real,
pero con disponibilidad vacía, solo se explica por una publicación disparada con datos obsoletos:
`publicarReservasPublicas()` se dispara automáticamente tras CUALQUIER guardado en Firestore de
CUALQUIER PT o admin (`guardarEstadoNubeAgenda() -> publicarReservasPublicas()`), y republica de
golpe TODOS los trainerKeys usando lo que hubiera en las variables globales
`dbDisponibilidadReservas`/`dbClientes`/`dbAgenda` **en memoria del navegador que disparó esa
acción concreta** -- nunca releía el estado real del servidor antes de publicar. Si ese navegador
llevaba tiempo abierto y su listener en tiempo real no había recibido todavía el guardado de OTRO
PT en OTRA sesión, la republicación disparada por esa acción no relacionada sobrescribía en
silencio la publicación correcta y reciente de ese otro PT con una copia obsoleta -- sin ningún
error visible para nadie (el fallo, de haberlo, ya se traga en un `catch` que solo hace
`console.warn`).

## Fix aplicado (agenda.html, `publicarReservasPublicas()`)

Antes de construir el batch de publicación, si existe `window.bsAgendaCloudDocRef` (la referencia
real al documento en producción), se hace `await bsAgendaCloudDocRef.get({ source: 'server' })` y
se reemplazan `dbClientes`/`dbAgenda`/`dbDisponibilidadReservas` por ese estado recién leído
**directamente del servidor** (nunca de caché local) antes de publicar. Aplica igual para
cualquier trainerKey -- no hay ninguna mención a Miguel/Lourdes/lillo en el código. Coste: una
lectura extra de Firestore por cada disparo de publicación: aceptable para un guardado de PT
(frecuencia baja) a cambio de cerrar una clase real de bug de datos obsoletos.

## Tests (22)

- **Escenario correcto**: cliente asignado al trainerKey real de su PT ve slots reales.
- **Mecanismo de identidad duplicada** (documentado y probado como POSIBLE causa, pero DESCARTADO
  como causa real de Lourdes/Miguel por la lectura de producción de arriba): dos perfiles
  ("miguel_real" con disponibilidad, "miguel_otro" sin ella) para el mismo nombre; el cliente
  asignado a "miguel_otro" ve CERO huecos -- y la herramienta de auditoría señala exactamente ese
  caso, útil para CUALQUIER otro PT que sí tenga este problema en el futuro.
- **PUBLICACIÓN-P0 (causa real confirmada)**: una sesión con una copia local obsoleta (sin
  disponibilidad) dispara la publicación; el fix relee el servidor (`source: 'server'`) y publica
  la disponibilidad FRESCA, no la obsoleta. Verificado manualmente que este test FALLA contra el
  código previo al fix (bloque `publicarReservasPublicas` revertido temporalmente) y pasa con el
  fix aplicado.
- **Negative controls** (bloque 8 del hotfix): mayúsculas/minúsculas, espacio, punto (conservado
  tal cual -- ya protegido en el writer real por `FieldPath`, ver `availability-tests/`), trainerKey
  ya normalizado, cliente de otro PT (nunca se mezcla), PT sin disponibilidad (0 huecos, no
  fabricados), disponibilidad solo en el pasado (0 huecos futuros), bloqueo (slot oculto
  correctamente), sesión existente (slot ocupado correctamente excluido).

## Cómo ejecutar

```bash
node portal-slots-p0-tests/extract.js && node portal-slots-p0-tests/run_tests.cjs
```
