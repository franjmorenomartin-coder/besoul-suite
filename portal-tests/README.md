# Portal Tests — motor de reservas dentro de portal-cliente.html (PORTAL-RESERVATIONS-INTEGRATION)

Pruebas deterministas del motor de reservas real que vive dentro de `portal-cliente.html`
(portado de `reservas.html` en una fase anterior del proyecto, PORTAL-03..09; `reservas.html`
fue eliminado en REMOVE-RESERVAS-LEGACY una vez confirmada esta paridad). Extraído VERBATIM con
`extract.js` (mismo patrón de brace-matching que el resto de la suite) -- nunca una
reimplementación paralela del motor.

## Qué contiene

- `extract.js` — extrae de `portal-cliente.html`: `dateISO/timeToMin/minToTime`,
  `bloquesDisponibilidadFechaCliente`, `slotOcupado/bloqueLibre/intervalosOcupadosDentroBloque`,
  `huecosLibresFecha/iniciosEficientesHueco/generarSlotsReserva`,
  `gruposAbiertosDisponiblesReserva`, `bloqueadoPorCliente` (restricciones de cliente) y
  `enviarSolicitudReserva` (la transacción de Firestore con ID determinista).
- `run_tests.cjs` — 20 casos:
  - **Sesiones de 45 min**: un bloque de disponibilidad de 4h produce exactamente los inicios
    espaciados 45 min que caben.
  - **No double-booking**: un slot ocupado bloquea también los slots que empezarían 15/30 min
    antes (solaparían con la sesión de 45 min ya ocupada), pero no uno que empieza 45 min antes.
  - **Restricciones de cliente**: bloqueos por texto (día + franja) se respetan y no afectan a
    otros días/horas.
  - **Grupos abiertos**: solo se ofrecen los que tienen plazas libres; un cliente ya apuntado no
    vuelve a verse la misma clase.
  - **IDs deterministas + transacción**: `trainerKey__clave` para individual,
    `trainerKey__clave__clientId` para grupo abierto; un ID que ya existe en Firestore (aunque sea
    de una solicitud previa rechazada) bloquea una segunda escritura -- la transacción real de
    `db.runTransaction()` se ejercita con un `db` simulado en memoria, sin tocar Firestore.
    `duracionMin` queda fijado en 45 y el estado inicial siempre es `'pendiente'`.

## Por qué no se prueba aquí la disponibilidad publicada por el PT (agenda.html)

`gruposAbiertos`/`besoulPublicSchedule` los construye y publica `agenda.html`
(`publicarReservasPublicas()`), no `portal-cliente.html` -- ese lado ya lo cubre indirectamente
`save-tests/` (validación de payload antes de publicar). Aquí se prueba el lado que SÍ es nuevo/
migrado: cómo el Portal consume esa disponibilidad para generar slots y proteger la reserva.

## Cómo ejecutar

```bash
node portal-tests/extract.js && node portal-tests/run_tests.cjs
```
