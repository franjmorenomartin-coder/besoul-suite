# NOTICE-01/02/03 — Avisos multicanal (Portal Cliente + WhatsApp)

## Antes de esta fase

`abrirWhatsAppAvisoCliente(id)` hacía DOS cosas siempre juntas, sin que el PT pudiera elegir: abría WhatsApp Y escribía el aviso en `ficha.avisosPortal` (Portal) como efecto colateral incondicional. No había forma de mandar un aviso SOLO por Portal, ni SOLO por WhatsApp -- ambos canales estaban acoplados.

## Ahora

**Un mensaje, elegido una vez, dos canales independientes** (checkboxes "Portal Cliente" / "WhatsApp" en el modal de aviso múltiple, `agenda.html`). Un cliente sin teléfono ya no queda excluido de la lista entera -- solo su botón de WhatsApp aparece deshabilitado ("Sin teléfono"), Portal sigue disponible para él.

- **`publicarAvisoPortalCliente(id)`**: escritura real e inmediata en `ficha.avisosPortal` (mismo campo, mismas Rules, mismo batch de publicación de siempre -- PORTAL-02/CLIENT-06, sin cambios de esquema salvo 2 campos nuevos por entrada: `remitente`, `canales`, `tipo`). Se dispara automáticamente al entrar en el paso de envío para todos los clientes con el canal Portal activo -- no requiere una pulsación por cliente, a diferencia de WhatsApp.
- **`abrirWhatsAppAvisoCliente(id)`**: sin cambios de comportamiento, sigue abriendo `wa.me` con el texto precargado -- sigue exigiendo una pulsación manual por cliente (no se puede automatizar: el navegador bloquearía N pestañas abiertas sin interacción directa del usuario como pop-ups no solicitados).

**Estados honestos, verificados en el código, no solo en la documentación**:

| Canal | Estados posibles | Lo que NUNCA se afirma |
|---|---|---|
| Portal | `Publicado` (escritura confirmada) / `⚠ Error · reintentar` (con botón de reintento real) | "Entregado", "Leído" -- el Portal no tiene forma de saber si el cliente ya abrió su enlace |
| WhatsApp | `Preparado` (wa.me abierto con el texto cargado) | "Enviado", "Entregado" -- `wa.me` no devuelve ninguna confirmación de que el PT pulsó enviar dentro de WhatsApp, ni de que el mensaje llegó |

## A3/A4 — Histórico

Nuevo botón "Avisos (N)" en la ficha de cada cliente (`abrirModalHistoricoAvisos()`) -- lista `ficha.avisosPortal` con fecha/hora, mensaje, remitente y badges de canal (`Portal ✓` / `WhatsApp ↗`, el símbolo ↗ deliberado para no sugerir confirmación de entrega). Avisos guardados ANTES de esta fase (sin campo `canales`) muestran "Canal no registrado" en vez de inventar un canal que no se registró en su momento.

Portal Cliente V2 (`portal-cliente.html`) muestra ahora un badge numérico ("Avisos • N") en el nav inferior cuando hay avisos no leídos -- corregido además un bug real preexistente en `pintarAvisos()`: cuando la lista de avisos estaba vacía, la función retornaba antes de llegar al código que actualiza cualquier indicador, así que un badge nunca se habría limpiado correctamente en ese caso; ahora el cálculo de no-leídos y la actualización del badge ocurren siempre, antes del `return` anticipado.

## A5 — Multicliente, aislamiento

Reutiliza el modal de selección múltiple ya existente -- sin cambios en el modelo de selección. Cada cliente sigue recibiendo únicamente SU aviso, escrito en SU propia ficha (`ficha.avisosPortal`), publicado a SU propio documento `besoulPublicClients/{token}` -- nunca un recurso compartido. Nada nuevo que auditar aquí: el aislamiento ya lo garantizaba el modelo de datos existente (un documento por cliente, sin `list()`), documentado en `PORTAL_V2_SECURITY_AUDIT.md`.

## A6 — Preparado para avisos de sistema, no activado

Cada entrada nueva de `avisosPortal` incluye `tipo: 'manual'`. Ningún generador automático existe todavía (sesión mañana, bono a punto de agotarse/caducar, reserva confirmada, cambio de sesión, cancelación) -- el campo solo deja el esquema listo para que, el día que se decida construirlos, puedan marcarse `tipo:'sistema'` sin migrar datos ni tocar Rules.

## A7 — Seguridad

- **PT**: solo puede generar avisos para clientes de su propio `entrenadorVisto` (ya limitado por el resto de la app -- `buscarClientePorIdTrainer(entrenadorVisto, id)`).
- **Cliente**: sigue sin ninguna vía de escritura sobre `avisosPortal`/`avisos` -- confirmado en `PORTAL_V2_SECURITY_AUDIT.md`, sin cambios este bloque.
- **Leído/no-leído**: la única modificación que un cliente podría llegar a hacer (propuesta `avisosLeidos`, CLIENT-09, ya documentada y con Rule preparada mas NO desplegada) -- sigue exactamente igual que antes de este addendum, no se ha tocado ni conectado.

Nada de esto se ha desplegado ni escrito contra Firestore real -- verificado con `?demo=1` (capturas en `rules-tests`/QA de esta fase) y `node --check` sobre ambos archivos tras el cambio.
