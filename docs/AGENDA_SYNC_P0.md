# HOTFIX-V1-AGENDA-SYNC-P0: sincronización multiusuario de la Agenda

Rama `HOTFIX-V1-AGENDA-SYNC-P0`, creada desde `887bd46`, que es la versión publicada hoy
(`agenda-persistencia-p0-2026-10-08`). No incluye el importador Excel. No hay migración, el
esquema no cambia y las reglas de Firestore tampoco.

## Síntomas reportados (2026-10-08, con entrenadores reales)

1. Bloqueos de días con sesiones que desaparecen sin aviso.
2. Guardados que tardan mucho.
3. Unas modificaciones se guardan y otras no, sin error visible.
4. Dos ordenadores ven la misma agenda distinta.
5. El admin no ve los cambios que acaba de guardar el PT.

## Causas demostradas

Todas están reproducidas con el código de producción en dos navegadores con sesiones Auth distintas
(PT y admin) contra Firebase Emulator. El estado final se lee siempre directamente de Firestore.
Script: `.review-local/agenda-persistencia/sync.cjs`.

| # | Causa | Dónde | Escenario |
|---|---|---|---|
| 1 | Tras un guardado de disponibilidad rechazado, la pantalla volvía a poner la copia tomada **antes** del guardado, y lo hacía **después** de releer el servidor. La siguiente operación normal (crear o mover una sesión) escribía esa disponibilidad vieja encima: el bloqueo del otro usuario desaparecía sin aviso para nadie. El mismo patrón estaba en `guardarCliente` y en el grupo abierto. | `guardarDisponibilidadReservas`, `guardarCliente`, `actualizarCitaGrupoAbiertoActual` | S10a: pérdida silenciosa, 2/2 |
| 2 | El formulario de disponibilidad (y la ficha de cliente) se rellena al abrirlo y, al guardar, escribe la semana entera (o la ficha entera) tal como estaba en pantalla. Un bloqueo hecho por el PT mientras el admin tenía el formulario abierto se deshacía al guardar el admin, sin conflicto y sin aviso. | `guardarDisponibilidadReservas`, `guardarCliente` | S10b, S12: pérdida silenciosa |
| 3 | La unidad de conflicto era el **entrenador entero**. Si admin y PT tocaban cosas distintas de la misma agenda casi a la vez, el segundo guardado se cancelaba entero y se descartaba todo lo pendiente ("unos se guardan y otros no"). | `ejecutarGuardadoEstadoNubeAgenda` | S2, S3, S4, S5, S9, S10c: rechazos |
| 4 | Sin conexión, el guardado se quedaba esperando sin límite y sin ningún indicador: el cambio se veía igual que uno guardado. Al volver la red, se descartaba por conflicto. | ídem | S8 |
| 5 | Cada guardado esperaba, dentro de la cola, a releer el documento entero y a publicar el portal de todos los entrenadores antes de confirmarse. Los guardados siguientes esperaban detrás (lentitud). | ídem, `publicarReservasPublicas` | S15 |
| 6 | El service worker interceptaba y guardaba en caché también las peticiones a Firestore y Auth: en el emulador, 17 respuestas del canal en tiempo real en segundos. Sin red, respondía a esas peticiones con `index.html`. | `sw.js` | `pwa-tests`: control negativo |
| 7 | Un error de la suscripción en tiempo real la dejaba muerta (un `alert` y nada más). Esa pantalla dejaba de recibir cambios hasta recargar. | `iniciarSincronizacionNubeAgenda` | revisión de código |
| 8 | Avisos de "hecho" antes de que el servidor confirmara nada, incluso sin conexión: "✓ Sesión reprogramada / Cita agendada / Sesión cancelada · Enviar WhatsApp", "Recurrencia creada", "Sesiones futuras borradas", "Slots restaurados", "Ficha borrada" y "Baja aprobada". En la baja, además, la solicitud se marcaba como aprobada en el servidor antes de guardar la ficha, y ese guardado no se comprobaba. | `soltarFichaEnCelda`, `borrarSesionAgenda`, `crearRecurrenciaSemanalSesion`, `borrarFuturasRecurrentesSesion`, `limpiarBloqueosDisponibilidadSemana`, `borrarFichaCliente`, `aprobarSolicitudEliminacion` | captura de pantalla sin conexión; S17 |
| 9 | El enlace del portal regenerado no se guardaba en la agenda: solo vivía en memoria. | `regenerarTokenReservaCliente` | revisión de código |

## Corrección

- **Fusión a tres vías por elemento** (`fusionarCampoTresVias`), dentro de la misma transacción
  de siempre.
  - Elementos: sesión por hueco, ficha por `id`, `semanal.<día>`, `excepciones.<fecha>`,
    `bloqueos.<fecha>` y clave de histórico.
  - Lo compatible se combina.
  - Conflicto real: el mismo elemento cambiado por ambos, la misma sesión movida o borrada de
    formas distintas, o dos sesiones nuevas solapadas.
  - Ante un conflicto no se escribe nada y el aviso nombra el elemento ("la sesión del 2026-10-09
    10:00", "la disponibilidad del día…").
- **Los snapshots ya no se ignoran** con cambios pendientes: se fusionan, y el usuario ve al
  instante lo de los demás.
- **Sin restauraciones de copias viejas.** Tras un fallo, la memoria vuelve a lo que hay en el
  servidor: se relee o, si no hay red, se usa la última base confirmada.
- **Formularios abiertos.**
  - Disponibilidad: si cambió desde que se abrió, no se guarda, se avisa y se recarga el
    formulario.
  - Ficha: se fusiona campo a campo. Si el otro cambió el mismo campo, no se guarda y se avisa.
- **Estado de guardado visible y honesto.** Un indicador permanente muestra uno de estos estados:
  - "Guardando en el servidor…";
  - "Guardado en el servidor · hh:mm:ss", solo tras la confirmación de Firestore;
  - "Cambios SIN GUARDAR · Reintentar";
  - "Sin conexión con el servidor".
- **Sin esperas indefinidas.** Si el servidor no confirma en 20 s:
  - el cambio se conserva, se marca "sin guardar" y se avisa;
  - se guarda al volver la conexión o con "Reintentar"; el reintento fusiona, así que es seguro;
  - el navegador pide confirmación antes de cerrar la página mientras queden cambios así.
- **Publicación del portal fuera de la cola de guardado**, con un retardo de 800 ms.
  `asegurarTokenYPublicarPortalCliente` publica de forma explícita, y `regenerarTokenReservaCliente`
  ahora guarda el token nuevo, que antes solo vivía en memoria.
- **Suscripción con reconexión** (espera creciente) y estado visible; un aviso explícito si se
  pierde el permiso.
- **`sw.js`.** Las peticiones de datos de otros dominios (Firestore y Auth) ya no se interceptan.
  Siguen en caché las librerías, los estilos, las fuentes y las imágenes. Caché `v10`.
- **Avisos de éxito solo tras la confirmación del servidor** (`esperarConfirmacionAgenda`,
  `ofrecerWhatsAppTrasConfirmar`). La oferta de WhatsApp solo aparece si lo confirmado ya contiene
  el cambio. La baja de un cliente guarda primero la ficha y solo después aprueba la solicitud.
- Marca de versión `agenda-sync-p0-2026-10-09`, visible en el indicador al pasar el ratón.

## Pruebas

- `.review-local/agenda-persistencia/sync.cjs`: navegador real, PT y admin, emulador, S1–S16.
  Con el código de producción fallan 10 de 13; con la corrección pasan todos (ver el informe).
- `concurrency-tests` (51), `availability-tests` (52), `save-tests` (28), `notices-tests` (7),
  `pwa-tests` (15, con control negativo contra el `sw.js` anterior) y el resto de suites V1.
- `rules-tests`, con emulador y las reglas reales: 60/60. FASE 2, igualdad canónica, concurrencia
  real y regresión de guardado, todas en verde.

## Riesgos residuales

- Sigue siendo **un único documento** (`besoulSuite/agenda`, límite de 1 MiB, contención
  compartida). Ver `AGENDA_MONOLITHIC_RISK.md`. La fusión hace que la contención deje de perder
  cambios, pero no la elimina.
- **Pestañas abiertas con la versión anterior** siguen teniendo los defectos 1 a 4 hasta que se
  recarguen. Es imprescindible que todos recarguen tras el despliegue (ver el plan).
- Una sesión nueva que se solape con otra ya existente que el usuario no veía (pantalla
  desactualizada) solo se detecta si la otra también es nueva. La agenda ya impide solapes con lo
  que se ve en pantalla.
- "Habilitar solo este día" al crear una sesión en un día bloqueado reabre ese hueco de 45 min. Es
  comportamiento previo, no cambiado.
