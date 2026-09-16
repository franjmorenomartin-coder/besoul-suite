# Portal Calendar Tests — calendario mensual del Portal Cliente (PORTAL-MONTHLY-CALENDAR)

Pruebas deterministas de las dos únicas piezas con lógica real detrás del calendario mensual
añadido bajo "Sesiones recientes" en la pestaña Agenda del Portal: qué sesiones se publican
(`agenda.html`) y qué estado/color visual honesto le corresponde a cada día
(`portal-cliente.html`). El propio pintado (`pintarCalendarioMensual()`) es únicamente DOM/HTML,
igual que el resto de funciones `pintar*` de este proyecto -- no se prueba por separado, siguiendo
el mismo criterio ya aplicado al resto de la suite.

## Modelo de estados (auditado, no inventado)

- **VERDE (realizada)**: sesión con fecha pasada y sin `estadoCancelacion` -- misma asunción que ya
  usa `badgeEstadoSesion()` (ya en producción, "Sesiones recientes") y el resto de contadores del
  Portal/Agenda para "sesión realizada".
- **ROJO (cancelación tardía/penalizada)**: `estadoCancelacion === 'cancelada_fuera_plazo'` -- el
  único estado que `agenda.html` conserva sin ambigüedad (`procesarCancelacionCliente()`).
- **ÁMBAR (próxima)**: fecha de hoy en adelante, sesión todavía no realizada.
- **NEUTRO**: sin ninguna sesión ese día.
- **NO existe un estado "cancelada sin penalización"**: una cancelación DENTRO de plazo borra la
  sesión de `dbAgenda` sin dejar ningún rastro (`delete dbAgenda[trainerKey][clave]`), así que no
  hay ninguna fuente de datos que distinga honestamente ese caso de "nunca hubo sesión ese día".
  Inventar ese estado habría significado adivinar, no leer un dato real -- explícitamente
  descartado.

## Publicación (`calendarioSesionesClienteParaPortal()`, agenda.html)

Ventana de ±4 meses alrededor de hoy (suficiente para varios meses de navegación anterior/
siguiente sin otra consulta), independiente del límite 5/3 que ya usa
`sesionesClienteParaPortal()` para "Próximas"/"Recientes" -- así no hay que tocar ese límite
existente ni arriesgar una regresión en una vista que ya funciona. Se publica como campo nuevo
`calendarioSesiones` en `besoulPublicClients/{token}`, aditivo, sin colección ni Rules nuevas.

## Tests (15)

Cubren: filtrado correcto por cliente, inclusión de sesiones futuras/pasadas dentro de la
ventana, exclusión de una sesión fuera de la ventana (sin fabricar un límite distinto), orden por
fecha, y los 5 casos de `estadoDiaCalendarioMensual()` (incluida la prioridad ROJO sobre VERDE
cuando un mismo día tiene varias sesiones, y la confirmación explícita de que el estado "ámbar de
cancelación sin penalización" no existe en el código).

## Cómo ejecutar

```bash
node portal-calendar-tests/extract.js && node portal-calendar-tests/run_tests.cjs
```
