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

## V2 — causa raíz real del "aparece y desaparece" (FIX-PT-AVAILABILITY-PERSISTENCE-V2)

El fix V1 (arriba) no era el problema completo: en producción, tras V1, la disponibilidad seguía
apareciendo correctamente al guardar y desapareciendo sola segundos después, **sin recargar la
página**. Causa raíz real, demostrada (no asumida): `trainerKeyDesdeEmail()` preserva puntos
literales de un email (p.ej. `fran.jmorenomartin@gmail.com` -> trainerKey
`"fran.jmorenomartin"` cuando `besoulUsers` no tiene un `trainerKey` explícito para ese usuario).
`guardarEstadoNubeAgenda()` enviaba la clave `disponibilidadReservas.fran.jmorenomartin` como un
STRING con puntos dentro de un objeto de payload -- Firestore `.update({'a.b.c': valor})`
interpreta **cada punto** de esa cadena como un separador de ruta anidada real, así que el dato se
guardaba en 3 niveles (`disponibilidadReservas.fran.jmorenomartin`), nunca en el campo PLANO
`disponibilidadReservas["fran.jmorenomartin"]` que el resto del código lee. El guardado optimista
en memoria "aparecía" al instante; el self-echo de Firestore, con la estructura mal anidada, hacía
que `dbDisponibilidadReservas["fran.jmorenomartin"]` volviera a ser `undefined` en cuanto llegaba
-- "desaparece", sin ningún reload de por medio.

**Fix** (`payloadParaUpdateFirestore()`, agenda.html): convierte el payload de objeto único a la
forma varargs de `.update()`, usando `firebase.firestore.FieldPath(campo, trainerKeyCompleto)`
para cualquier clave con más de un punto -- `FieldPath` trata cada segmento como LITERAL, sin
volver a partirlo por puntos. Comportamiento idéntico para cualquier trainerKey sin puntos (la
inmensa mayoría hoy).

**Además** (bloque 6 del hotfix, confirmación real de guardado): `guardarDisponibilidadReservas()`
pasa a ser `async` y espera de verdad la confirmación de Firestore antes de cerrar el modal o
anunciar éxito. Si el guardado falla (red, cuota, error del servidor), se revierte la memoria al
valor anterior y se avisa explícitamente al PT -- antes, un fallo real de escritura no se
distinguía de un éxito: la UI decía "guardado" incondicionalmente y la disponibilidad podía
desaparecer sin explicación en el siguiente snapshot.

18 tests nuevos (45 en total):
- **CONTROL NEGATIVO V2** (el requerido explícitamente): reproduce el escenario exacto de un
  trainerKey con punto -- falla contra el código previo a este fix (demostrado manualmente,
  moviendo temporalmente `agenda.html` a la versión de `a0bc624`) y pasa contra el fix.
- Debounce programado antes del cambio de disponibilidad, disparado después: no revierte (relee
  el estado en vivo, nunca un payload capturado por adelantado).
- Fallo de escritura: rollback controlado al valor anterior + aviso claro, nunca una desaparición
  silenciosa; el documento remoto nunca queda a medias.
- Multi-tab (dos PT distintos): guardar/agendar/editar cliente en una pestaña nunca toca la
  disponibilidad de otro PT, en ambos sentidos.
- Multi-tab (mismo PT, dos pestañas): el resultado final es exactamente el del último guardado,
  sin mezclas ni datos vacíos a medio camino.

## Cómo ejecutar

```bash
node availability-tests/extract.js && node availability-tests/run_tests.cjs
```
