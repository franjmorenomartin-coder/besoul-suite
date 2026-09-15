# B1/B3 — Inventario de capacidades reales de un PT en BESOUL Suite

Auditoría de `agenda.html` (única pantalla operativa completa para un PT desde ROLE-01 -- Dashboard/CRM/Finanzas están bloqueados en el login de sus propias pantallas para cualquier `rolActivo!=='admin'`). Cada entrada describe una capacidad REAL, verificada contra el código de esta sesión -- no se documenta ninguna función que no exista. Fuente estructurada consumible por el asistente: `CAPACIDADES_PT` en `agenda.html` (ver AI-02).

## Clientes

- **Alta de cliente** (`guardarCliente()`): modal de ficha nueva -- nombre, contacto, modalidad, tipo de compra (Plan/Bono), factor/sesiones, centro, entrenador (el propio). Un cliente nuevo puede generar automáticamente su enlace de reservas (`reservaToken`) si tiene email+teléfono.
- **Editar ficha** (`editarFicha(id)`): mismos campos que el alta, reabre la ficha existente.
- **Buscar/filtrar clientes**: buscador de texto + filtro "Activos"/otros estados en la pestaña Clientes.
- **Baja de cliente -- flujo seguro** (`abrirModalSolicitarEliminacion`/`confirmarSolicitudEliminacion`): el PT NO borra directamente -- solicita una baja, un admin revisa el impacto (citas futuras, histórico) y aprueba o rechaza. Deja la ficha en `estadoCliente:'baja'`, nunca borra el histórico.
- **Borrado físico** (`borrarFichaCliente`): existe pero está degradado a un enlace discreto solo-admin ("Borrar (legacy)"), uso de emergencia, irreversible -- el PT normal nunca lo ve como acción principal.
- **Plan/Bono**: cada ficha declara `tipoCompra` (Plan/Bono) y `modalidad`; el motor de sesiones (`calcularContadorClases`) deriva de ahí contratadas/usadas/pendientes -- un PT no "pone" un número de sesiones a mano, lo determina la modalidad + lo que ya está agendado.
- **Consultar sesiones de un cliente**: contador visible en cada card de la lista de clientes (contratadas/usadas/restantes del mes o del bono).
- **Token/enlace de reservas** (`copiarLinkReservaCliente`): genera/copia el enlace público del cliente. **Regenerar enlace** (SEC-05): revoca el antiguo y genera uno nuevo -- para cuando un enlace se compartió por error.

## Agenda

- **Agendar una sesión**: tocar un hueco libre en el calendario y elegir el cliente (flujo táctil, sin arrastrar, en móvil; con arrastrar en escritorio).
- **Mover/reprogramar una cita**: abrir la cita ya agendada y elegir un nuevo hueco -- BESOUL comprueba automáticamente conflictos y disponibilidad antes de guardar.
- **Cancelar/eliminar una cita**: quitar una sesión ya agendada, libera el hueco.
- **Duración fija de 45 min, huecos internos cada 15 min**: toda sesión ocupa 3 franjas de 15 minutos; los inicios posibles de una sesión son cualquier múltiplo de 15 dentro de la disponibilidad publicada.
- **Disponibilidad semanal + bloqueos puntuales**: el PT define qué días/horas está operativo (`dbDisponibilidadReservas`), y puede bloquear franjas concretas sin borrar la disponibilidad general.
- **Restricciones por cliente**: un cliente puede tener bloqueos propios (p.ej. "no lunes 18-20h") que se respetan tanto en Agenda como en Reservas/Portal.
- **Recuperaciones**: una sesión puede marcarse como recuperación (no facturable) -- `esRecuperacionNoFacturable()`, se distingue de una sesión normal a efectos de contador/facturación. Solo administración puede confirmar la marca; el PT la propone desde la propia cita.
- **Histórico de avisos por cliente**: botón "Avisos (N)" en la card del cliente -- fecha, mensaje, remitente y canal de cada aviso enviado (ver sección Avisos/Portal Cliente).

## Grupos

- **Grupo vinculado** (fichas con `vinculacion`, p.ej. "Grupo Reducido"): varias fichas comparten una sola cita/slot -- pensado para familias/grupos reducidos que entrenan juntos.
- **Grupo abierto** (`esGrupoAbierto`, `capacidadGrupoAbierto`, `asistentesGrupoAbierto`): una clase con capacidad (p.ej. 8 plazas) a la que distintos clientes se apuntan de forma independiente -- visible como "plazas libres" tanto en Agenda como en Reservas/Portal.
- **Editar un integrante de un grupo vinculado** (CLIENT-08, `editarFicha(idIntegrante)`): la ficha del integrante es una ficha individual real y editable -- botón "Editar" en su card la abre directamente (antes abría siempre la ficha del grupo entero, sin vía real para editar al integrante). Editable: nombre, teléfono, email, descuento individual. Solo lectura ahí (se cambian editando el grupo con "Ver grupo"): modalidad, frecuencia, tipo de compra, fecha de compra, color -- son compartidos por todo el grupo.
- **Descuento individual por integrante** (`descuentoPct` propio de la ficha del integrante, ya NO sincronizado desde el grupo en cada guardado): aplicar un descuento a un integrante cambia solo su propia aportación -- nunca la de otros integrantes ni la tarifa base del grupo.
- **Quitar un integrante del grupo**: se borra su fila en la ficha del grupo ("×") y se guarda -- deja de contarse en el grupo y en su facturación desde ese momento; su histórico de meses anteriores no se modifica.
- **Facturación real del grupo** (`calcularFacturacionGrupoTotal`/`importeEfectivoCliente`, FIN-GRUPO-02): el total económico del grupo es la SUMA de lo que paga cada integrante tras aplicar su propio descuento -- nunca tarifa × número de integrantes con un descuento único de grupo (fórmula anterior, corregida en esta fase). Mismo motor reutilizado en `agenda.html`, `finanzas.html` y `dashboard.html` (canon de centro, cierres y snapshots incluidos, ya que todos parten de este mismo cálculo por cliente).

## Pruebas (integración con CRM)

- **Prueba solicitada → agendada → realizada**: un lead de `besoulLeads` con sesión de valoración agendada aparece automáticamente en la Agenda del PT asignado (`consultaLeadsPermitidosAgenda`, solo lectura -- el PT no edita el lead, eso es admin-only desde ROLE-01).
- **Conversión a cliente**: la ejecuta un admin (`convertirLeadEnCliente`, en `crm.html`, ya no accesible para PT) -- el PT ve el resultado (la ficha nueva) pero no dispara la conversión él mismo.

## WhatsApp

- **Aviso a un cliente o a varios** (`abrirModalAvisoMultiple`): seleccionar clientes, escribir un mensaje una vez, y (NOTICE-01, esta fase) elegir canal: Portal Cliente, WhatsApp, o ambos. WhatsApp siempre requiere pulsar "Abrir WhatsApp" cliente por cliente -- nunca se envía nada automáticamente.
- **Aviso de "mañana"**: recordatorio dirigido a clientes con sesión al día siguiente.

## Avisos / Portal Cliente

- **Enviar aviso al Portal** (NOTICE-01/02): mismo modal que WhatsApp, canal independiente, publicación inmediata y confirmada (`Publicado`/`Error`, nunca "Entregado"/"Leído").
- **Histórico de avisos por cliente** (NOTICE-03): fecha, mensaje, remitente, canal, desde la propia ficha.
- **Copiar/enviar el enlace del Portal**: mismo enlace que reservas (`copiarLinkReservaCliente`) -- el cliente accede a Inicio/Agenda/Avisos/Perfil con ese mismo token.
- **Cancelación desde el Portal**: preparada en código, con backend real sin desplegar (`CANCELACION_PORTAL_HABILITADA=false`) -- el PT puede explicar esto a un cliente que pregunte, pero hoy la cancelación real la sigue haciendo el PT desde Agenda.

## Bonos / Planes (motor de sesiones)

- **Plan mensual**: `contratadas = factor × 4` (o reglas especiales por modalidad -- "Suelta"=1, actividades especiales según su plan de sesiones); se resetea cada mes calendario.
- **Bono 10**: `contratadas` fijo (10), vigencia de 3 meses desde `fechaCompra`, nunca se resetea por mes.
- **Bono 8** (PLAN-01, esta fase): mismo modelo que el Bono 10 -- 8 sesiones contratadas, misma vigencia de 3 meses, mismos descuentos, mismo histórico, mismo Portal -- disponible para Individual y Grupo Reducido. Su precio TOTAL es idéntico al del Bono 10 equivalente (nunca el mismo precio por sesión: al repartirse entre menos sesiones, cada sesión sale más cara). El precio se DERIVA de `TARIFAS_2026["Individual Bono"][10]` / `TARIFAS_2026["Grupo Reducido Bono"][10]` en el momento de cargar `agenda.html`/`finanzas.html`/`dashboard.html` -- nunca un número escrito a mano aparte, así no puede desincronizarse si el Bono 10 cambia de precio.
- **Actividades especiales** (clases/grupos con catálogo propio de precios y modalidades): un cliente puede estar en una actividad especial en vez de -- o además de -- el modelo estándar Plan/Bono.

## Lo que un PT explícitamente NO puede hacer (para que el asistente nunca lo sugiera)

- Acceder a Dashboard, CRM o Finanzas (bloqueado en el login de esas 3 pantallas, ROLE-01/guards previos).
- Crear/editar leads directamente en Firestore (SEC-04, Rules ya restringidas a admin-only).
- Aprobar/rechazar su propia solicitud de baja de cliente (siempre requiere un admin).
- Cambiar precio/tarifa/condiciones económicas de un cliente (eso vive en Finanzas, admin-only).
- Activar la cancelación real del Portal o desplegar cualquier Rule/Function (fuera del alcance de cualquier rol de la app -- es una operación de infraestructura).
