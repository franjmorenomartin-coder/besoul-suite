# Availability Tests — persistencia de disponibilidad PT (FIX-PT-AVAILABILITY-PERSISTENCE)

Pruebas deterministas del flujo real UI -> memoria -> payload -> Firestore -> carga posterior ->
render de la disponibilidad de los PT, extraído VERBATIM de `agenda.html` (mismo patrón de
brace-matching que el resto de la suite) y ejercitado contra un mock de Firestore que replica
fielmente la semántica real de `.update()` con rutas de punto (solo toca la ruta exacta, nunca
pisa hermanos) y el comportamiento asíncrono de `onSnapshot()` (incluido el "self-echo" de los
propios escritores).

## Causa raíz encontrada y corregida

`disponibilidadTrainerActual()`/`asegurarDisponibilidadTrainerEditable()` no son funciones de solo
lectura: si `dbDisponibilidadReservas[trainerKey]` todavía no existe EN MEMORIA, fabrican un
default vacío y lo **escriben** ahí mismo como efecto colateral de "leerlo". Justo después de
entrar o recargar la app, eso puede pasar simplemente porque la respuesta de red de
`onSnapshot()` (asíncrona) todavía no ha llegado -- no porque el PT realmente no tenga
disponibilidad guardada. Si en ese instante se abre "+ Disponibilidad" y se guarda, el formulario
"vacío" fabricado sustituye PERMANENTEMENTE la disponibilidad real que ni siquiera llegó a
mostrarse (confirmado contra el código de producción `f95a64d`: el mismo escenario borra el
bloque de un día completo).

**Fix** (`disponibilidadListaParaEditar()`, agenda.html): un guardián basado en
`window.bsAgendaDisponibilidadCargada` (true solo después de que `aplicarEstadoNubeAgenda()` haya
aplicado al menos un snapshot real en esta sesión) bloquea `abrirModalDisponibilidadReservas()`,
`habilitarSlotSobreLaMarcha()`, `ocultarSlotDisponibilidad()`, `limpiarBloqueosDisponibilidadSemana()`
y `guardarDisponibilidadReservas()` (defensa en profundidad) mientras el estado real todavía no se
conoce, avisando al usuario en vez de dejarle editar sobre datos fabricados.

## Qué contiene

- `extract.js` — extrae de `agenda.html`: `estadoLocalAgendaParaNube`, `guardarEstadoNubeAgenda`,
  `programarGuardadoNubeAgenda`, `aplicarEstadoNubeAgenda`, `normalizarCredenciales`,
  `sanitizarCredenciales`, `normalizarTrainerKey`, `disponibilidadReservasPorDefecto`,
  `disponibilidadTrainerActual`, `leerDisponibilidadFormulario`, `guardarDisponibilidadReservas`,
  `disponibilidadListaParaEditar`, `asegurarDisponibilidadTrainerEditable`, y funciones de lectura
  de huecos (`disponibilidadTrainerLectura`, `bloquesDisponibilidadFecha`, etc.).
- `run_tests.cjs` — 27 casos, incluyendo:
  - **CONTROL NEGATIVO** (el requerido explícitamente): reproduce la carrera exacta -- guardar
    disponibilidad antes de que llegue el primer snapshot ya no puede escribir nada ni fabricar un
    default persistente; una vez llega el snapshot real, los datos originales siguen intactos y un
    guardado posterior sí aplica con normalidad. Verificado manualmente (fuera de la suite
    permanente, evidencia en el informe de la sesión) que ESTE MISMO escenario corrompe datos
    reales contra `f95a64d` y ya no lo hace tras el fix.
  - PT sin disponibilidad -> primera disponibilidad; PT existente modifica -> persiste tras reload.
  - Dos PT mantienen disponibilidades independientes; guardar la de uno no afecta al otro, ni
    siquiera guardado justo después (mismo documento monolítico, escritura dirigida por trainerKey).
  - Guardar cliente / mover sesión después no borra la disponibilidad del mismo PT.
  - `normalizarTrainerKey()` normaliza mayúsculas/acentos/espacios correctamente (caso histórico
    "Lillo" -> "lillo").
  - Días vacíos permanecen vacíos, bloqueos parciales y múltiples franjas por día persisten tal cual.
  - Verificación (hipótesis investigada y descartada con una prueba real, no una suposición): el
    guardián `window.bsAgendaAplicandoNube` evita que `normalizarCredenciales()` dispare un bucle
    de escrituras automáticas en cada snapshot.

## Cómo ejecutar

```bash
node availability-tests/extract.js && node availability-tests/run_tests.cjs
```
