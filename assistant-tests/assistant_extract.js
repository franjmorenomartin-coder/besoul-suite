const TARIFAS_2026 = {

            "Individual Plan": { 1: 120, 2: 210, 3: 300, 4: 380, 5: 450 },

            "Individual Suelta": { 1: 30 }, "Individual Bono": { 10: 270 },

            "Pareja": { 1: 90, 2: 160, 3: 210, 4: 270, 5: 300 }, // PRECIO POR PERSONA

            "Trío": { 1: 70, 2: 120, 3: 150, 4: 170, 5: 200 }, // PRECIO POR PERSONA

            "Grupo Reducido Plan": { 1: 45, 2: 80, 3: 110, 4: 130, 5: 150 }, // PRECIO POR PERSONA

            "Grupo Reducido Suelta": { 1: 12 }, "Grupo Reducido Bono": { 10: 105 },

            "Grupo Aire Libre": { 1: 30, 2: 40, 3: 50, 4: 60, 5: 70 }, // PRECIO POR PERSONA

            "Miembro Subordinado": { 1: 0 } // Para los autogenerados

        };
TARIFAS_2026["Individual Bono 8"] = { 8: TARIFAS_2026["Individual Bono"][10] };
TARIFAS_2026["Grupo Reducido Bono 8"] = { 8: TARIFAS_2026["Grupo Reducido Bono"][10] };

const CAPACIDADES_PT = [
            { id: 'crear_cliente', nombre: 'Dar de alta un cliente', aliases: ['crear cliente', 'nuevo cliente', 'alta cliente', 'dar de alta', 'meter cliente', 'meto un cliente', 'meto cliente', 'añadir cliente', 'agregar cliente', 'creo un cliente', 'como creo cliente'], roles: ['pt', 'admin'],
              pasos: ['Abre la pestaña Clientes.', 'Pulsa "+ Alta".', 'Rellena nombre, contacto, modalidad y tipo de compra (Plan o Bono).', 'Guarda -- si tiene email y teléfono, se genera su enlace de reservas automáticamente.'],
              restricciones: ['El precio/tarifa lo determina la modalidad elegida, no se escribe a mano.'], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'editar_cliente', nombre: 'Editar la ficha de un cliente', aliases: ['editar cliente', 'modificar cliente', 'cambiar datos cliente', 'cambiar teléfono', 'cambiar telefono', 'cambio telefono', 'cambio el telefono', 'actualizar ficha'], roles: ['pt', 'admin'],
              pasos: ['Abre la pestaña Clientes.', 'Toca la ficha del cliente.', 'Pulsa "Editar".', 'Cambia el campo que necesites y guarda.'], restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'baja_cliente', nombre: 'Solicitar la baja de un cliente', aliases: ['eliminar cliente', 'borrar cliente', 'dar de baja', 'quitar cliente', 'solicitar eliminación', 'solicitar eliminacion'], roles: ['pt', 'admin'],
              pasos: ['Abre la ficha del cliente en Clientes.', 'Pulsa "Solicitar eliminación".', 'Indica el motivo.', 'Un administrador revisará el impacto (citas futuras, histórico) y aprobará o rechazará la baja.'],
              restricciones: ['No puedes aprobar tu propia solicitud -- siempre la revisa un admin.', 'El histórico del cliente nunca se borra, aunque se apruebe la baja.'], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'agendar_sesion', nombre: 'Agendar una sesión', aliases: ['agendar', 'crear cita', 'nueva sesión', 'nueva sesion', 'programar sesión', 'poner una clase', 'reservar hueco interno'], roles: ['pt', 'admin'],
              pasos: ['Ve a la pestaña Agenda.', 'Toca un hueco libre en el calendario.', 'Elige el cliente de la lista.', 'Confirma -- la sesión queda de 45 minutos.'],
              restricciones: ['Las sesiones solo pueden empezar en múltiplos de 15 minutos.', 'No se puede agendar sobre un hueco ya ocupado o fuera de tu disponibilidad publicada.'], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'reprogramar_sesion', nombre: 'Mover / reprogramar una sesión', aliases: ['reprogramar', 'mover cita', 'cambiar hora sesión', 'cambiar hora sesion', 'cambiar día sesión', 'mover sesión', 'mover sesion'], roles: ['pt', 'admin'],
              pasos: ['Abre la cita ya agendada.', 'Pulsa "Reprogramar".', 'Elige el nuevo hueco entre los disponibles.', 'BESOUL comprueba automáticamente conflictos antes de guardar.'], restricciones: [], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'eliminar_sesion', nombre: 'Eliminar / cancelar una sesión', aliases: ['eliminar sesión', 'eliminar sesion', 'elimino sesion', 'borrar sesión', 'borrar sesion', 'cancelar sesión', 'cancelar sesion', 'quitar cita', 'quitar entrenamiento'], roles: ['pt', 'admin'],
              pasos: ['Abre la cita en Agenda.', 'Pulsa "Eliminar"/"Cancelar".', 'Confirma -- el hueco queda libre de nuevo.'], restricciones: [], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'disponibilidad', nombre: 'Añadir o cambiar tu disponibilidad', aliases: ['añadir disponibilidad', 'anadir disponibilidad', 'añado disponibilidad', 'anado disponibilidad', 'cambiar disponibilidad', 'poner horario', 'bloquear hora', 'bloquear franja'], roles: ['pt', 'admin'],
              pasos: ['Pulsa "+ Disponibilidad" en la cabecera de Agenda.', 'Define tus franjas semanales habituales.', 'Para un bloqueo puntual (una franja concreta un día concreto), añade una excepción sin tocar tu disponibilidad general.'], restricciones: [], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'crear_grupo', nombre: 'Crear un grupo abierto', aliases: ['crear grupo', 'creo grupo', 'nuevo grupo', 'grupo abierto', 'clase grupal', 'crear clase grupo'], roles: ['pt', 'admin'],
              pasos: ['Agenda una cita como "grupo abierto" en vez de individual.', 'Define la capacidad (número de plazas).', 'Los clientes se apuntan de forma independiente hasta completar el aforo.'], restricciones: [], ubicacion: 'grupos', tab: 'grupos' },
            { id: 'añadir_cliente_grupo', nombre: 'Añadir un cliente a un grupo', aliases: ['añadir cliente a grupo', 'anadir cliente a grupo', 'añado cliente grupo', 'anado cliente grupo', 'meter cliente en grupo', 'apuntar a grupo'], roles: ['pt', 'admin'],
              pasos: ['Abre el grupo abierto en Agenda o en la pestaña Grupos.', 'Selecciona el cliente y confírmalo como asistente.', 'Se descuenta una plaza libre automáticamente.'], restricciones: ['No se puede añadir a un cliente si el grupo ya está completo.'], ubicacion: 'grupos', tab: 'grupos' },
            { id: 'marcar_prueba', nombre: 'Gestionar una prueba de valoración', aliases: ['marcar prueba', 'marco prueba', 'prueba realizada', 'prueba agendada', 'valoración cliente nuevo', 'valoracion cliente nuevo'], roles: ['pt', 'admin'],
              pasos: ['Una prueba solicitada desde el QR de valoración aparece automáticamente en tu Agenda si tiene fecha asignada.', 'Se ve como cualquier cita, marcada como prueba.', 'La conversión del lead a cliente real la completa un administrador.'],
              restricciones: ['No puedes editar el lead directamente -- eso es solo de administración.'], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'enviar_whatsapp', nombre: 'Enviar un WhatsApp a uno o varios clientes', aliases: ['mandar whatsapp', 'mando whatsapp', 'enviar whatsapp', 'envio whatsapp', 'avisar por whatsapp', 'whatsapp a varios', 'avisar a todos'], roles: ['pt', 'admin'],
              pasos: ['Pulsa "Enviar aviso" en Agenda.', 'Selecciona uno o varios clientes.', 'Escribe el mensaje una vez.', 'Marca el canal WhatsApp.', 'Pulsa "Abrir WhatsApp" para cada cliente -- tú confirmas el envío dentro de WhatsApp.'],
              restricciones: ['BESOUL nunca envía el WhatsApp por ti -- solo prepara el mensaje y abre la conversación.'], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'enviar_aviso_portal', nombre: 'Enviar un aviso al Portal del cliente', aliases: ['enviar aviso', 'envio aviso', 'aviso portal', 'notificar cliente portal', 'mandar aviso portal'], roles: ['pt', 'admin'],
              pasos: ['Pulsa "Enviar aviso" en Agenda.', 'Selecciona el/los cliente(s).', 'Escribe el mensaje.', 'Marca el canal Portal Cliente (puedes marcar también WhatsApp a la vez).', 'El aviso se publica al instante -- verás "Publicado" o "Error" para cada cliente.'],
              restricciones: [], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'ver_sesiones_cliente', nombre: 'Consultar las sesiones que le quedan a un cliente', aliases: ['sesiones restantes', 'cuántas sesiones le quedan', 'cuantas sesiones le quedan', 'consulto sesiones', 'consulto las sesiones', 'ver bono', 'veo bono', 'veo el bono', 'consultar bono', 'sesiones pendientes cliente'], roles: ['pt', 'admin'],
              pasos: ['Abre la pestaña Clientes.', 'El contador (contratadas/usadas/restantes) aparece directamente en la card de cada cliente.'], restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'link_reservas', nombre: 'Copiar o regenerar el enlace de reservas/Portal', aliases: ['link reservas', 'enlace reservas', 'copiar link', 'regenerar enlace', 'enlace portal'], roles: ['pt', 'admin'],
              pasos: ['Abre la ficha del cliente.', 'Pulsa "Link reservas" para copiarlo.', 'Si necesitas invalidar el anterior (se compartió por error), pulsa "Regenerar enlace" -- el antiguo deja de funcionar al instante.'], restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'hacer_reserva', nombre: 'Hacer una reserva desde el enlace del cliente', aliases: ['cómo hago una reserva', 'como hago una reserva', 'reservar por el cliente', 'reserva desde el link'], roles: ['pt', 'admin'],
              pasos: ['El cliente usa su propio enlace (reservas.html o el Portal) para elegir un hueco libre.', 'La solicitud queda "pendiente" hasta que tú la aceptes o rechaces.'], restricciones: [], ubicacion: 'agenda', tab: 'agenda' },
            // CLIENT-08/D5 -- capacidades reales que ya existían en el código pero no estaban
            // documentadas ni eran entendidas por el asistente (gap encontrado en la auditoría).
            { id: 'quitar_cliente_grupo', nombre: 'Quitar un cliente de un grupo', aliases: ['quitar cliente del grupo', 'quitar cliente grupo', 'quito a alguien del grupo', 'quito alguien del grupo', 'sacar cliente del grupo', 'eliminar integrante grupo', 'eliminar integrante del grupo', 'quitar integrante grupo'], roles: ['pt', 'admin'],
              pasos: ['Abre la ficha del grupo ("Ver grupo" desde la card de cualquier integrante, o la pestaña Grupo).', 'Borra la fila de ese integrante (botón "×") en la lista de integrantes.', 'Guarda -- desde ese momento deja de contarse en el grupo y en su facturación.'],
              restricciones: ['El histórico de meses anteriores de ese integrante no se modifica.'], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'recuperacion_no_facturable', nombre: 'Marcar una sesión como recuperación no facturable', aliases: ['marcar recuperacion', 'marco una recuperacion', 'recuperacion no facturable', 'sesion de recuperacion', 'clase de recuperacion', 'como marco una recuperacion'], roles: ['pt', 'admin'],
              pasos: ['Abre la cita en Agenda.', 'Marca la casilla "Recuperación no facturable".', 'La sesión sigue ocupando la agenda, pero no cuenta para el bono/sesiones sueltas de ese cliente.'],
              restricciones: ['Solo un administrador puede confirmar esta marca -- un PT puede proponerla pero no confirmarla por su cuenta.'], ubicacion: 'agenda', tab: 'agenda' },
            { id: 'historico_avisos', nombre: 'Consultar el histórico de avisos de un cliente', aliases: ['historico de avisos', 'historico avisos', 'ver historico avisos', 'consultar avisos enviados', 'avisos enviados cliente', 'como veo el historico de avisos'], roles: ['pt', 'admin'],
              pasos: ['Abre la ficha del cliente en Clientes.', 'Pulsa el botón "Avisos (N)".', 'Verás fecha, mensaje, remitente y canal (Portal/WhatsApp) de cada aviso enviado.'], restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            // CLIENT-08/J -- capacidad NUEVA de esta fase: antes la respuesta honesta habría sido
            // "no, un cliente de grupo no es editable" (cierto hasta este bloque). Ahora sí lo es.
            { id: 'editar_cliente_grupo', nombre: 'Editar un cliente que pertenece a un grupo', aliases: ['editar cliente de grupo', 'puedo editar un cliente de un grupo', 'editar integrante grupo', 'modificar integrante grupo', 'editar integrante de un grupo'], roles: ['pt', 'admin'],
              pasos: ['Sí: abre la ficha del integrante como cualquier cliente (botón "Editar" en su card).', 'Puedes cambiar su nombre, teléfono, email y descuento individual.', 'Modalidad, frecuencia, tipo de compra y color son compartidos por todo el grupo -- se cambian editando el grupo entero ("Ver grupo"), nunca desde un solo integrante.'],
              restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'descuento_individual_grupo', nombre: 'Aplicar un descuento a un solo integrante de un grupo', aliases: ['descuento a un cliente de grupo', 'descuento individual grupo', 'hacer descuento a un integrante', 'descuento solo a un integrante', 'puedo hacer descuento a un cliente de grupo'], roles: ['pt', 'admin'],
              pasos: ['Sí: abre la ficha de ese integrante y cambia su campo "Descuento".', 'Afecta solo a su propia aportación -- no cambia lo que pagan el resto de integrantes ni la tarifa base del grupo.'],
              restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'facturacion_grupo_explicacion', nombre: 'Cómo se calcula lo que factura un grupo', aliases: ['como se calcula lo que factura un grupo', 'como factura un grupo', 'que pasa si descuento a un miembro del grupo', 'facturacion de un grupo', 'como se calcula la facturacion del grupo', 'cuanto factura un grupo'], roles: ['pt', 'admin'],
              pasos: ['El grupo factura la SUMA de lo que paga cada integrante tras aplicar sus condiciones individuales vigentes (su propio descuento).', 'Si aplicas un descuento a un integrante, solo cambia su aportación -- el total se recalcula como esa nueva suma, nunca como tarifa × número de integrantes.'],
              restricciones: [], ubicacion: 'clientes', tab: 'clientes' },
            { id: 'bono8_info', nombre: 'Cómo funciona el Bono 8', aliases: ['como funciona bono 8', 'que es el bono 8', 'bono 8 sesiones', 'diferencia bono 8 y bono 10', 'diferencia entre bono 8 y bono 10', 'cuanto cuesta el bono 8', 'cuanto cuesta bono 8'], roles: ['pt', 'admin'],
              // J: nunca hardcodear el precio -- se deriva de TARIFAS_2026 en el momento de responder
              // (ver respuestaDinamica más abajo), así nunca puede desincronizarse del catálogo real.
              pasos: [], restricciones: [], ubicacion: 'clientes', tab: 'clientes',
              respuestaDinamica: () => {
                  const precioInd = TARIFAS_2026['Individual Bono 8']?.[8] ?? 0;
                  const precioGrupo = TARIFAS_2026['Grupo Reducido Bono 8']?.[8] ?? 0;
                  return `Bono 8: 8 sesiones contratadas, mismo precio TOTAL que el Bono 10 equivalente (nunca el mismo precio por sesión -- al repartirse entre menos sesiones, cada sesión sale más cara).\n\nIndividual: ${precioInd.toFixed(2)}€ el bono completo (igual que el Bono 10 Individual).\nGrupo Reducido: ${precioGrupo.toFixed(2)}€ por persona (igual que el Bono 10 Grupo Reducido).\n\nLa única diferencia entre Bono 8 y Bono 10 es el número de sesiones -- vigencia, descuentos e histórico funcionan igual que cualquier bono.`;
              } },
        ];

function normalizarTextoAsistente(v) {
            return String(v || '')
                .toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                // ":" se conserva a propósito -- respuestaDiagnosticoHueco necesita el formato
                // "18:15" intacto para extraer la hora (aunque en la app real el diagnóstico usa
                // `q`, no este `qNorm`, mantenerlo aquí evita sorpresas si algo más lo reutiliza).
                .replace(/[¿?¡!.,;"'()]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

const LEMAS_VERBOS_ASISTENTE = {
            creo: 'crear', crea: 'crear', crean: 'crear',
            agendo: 'agendar', agenda: 'agendar', agendan: 'agendar',
            reprogramo: 'reprogramar', reprograma: 'reprogramar', reprograman: 'reprogramar',
            muevo: 'mover', mueve: 'mover', mueven: 'mover',
            cambio: 'cambiar', cambia: 'cambiar', cambian: 'cambiar',
            elimino: 'eliminar', elimina: 'eliminar', eliminan: 'eliminar',
            borro: 'borrar', borra: 'borrar', borran: 'borrar',
            quito: 'quitar', quita: 'quitar', quitan: 'quitar',
            cancelo: 'cancelar', cancela: 'cancelar', cancelan: 'cancelar',
            añado: 'añadir', añade: 'añadir', añaden: 'añadir',
            anado: 'anadir', anade: 'anadir', anaden: 'anadir',
            envio: 'enviar', envia: 'enviar', envian: 'enviar',
            mando: 'mandar', manda: 'mandar', mandan: 'mandar',
            marco: 'marcar', marca: 'marcar', marcan: 'marcar',
            consulto: 'consultar', consulta: 'consultar',
            meto: 'meter', mete: 'meter',
            apunto: 'apuntar', apunta: 'apuntar'
        };

function lematizarPalabra(p) { return LEMAS_VERBOS_ASISTENTE[p] || p; }

function distanciaEdicionAcotada(a, b) {
            if (Math.abs(a.length - b.length) > 1) return 99;
            const filas = a.length + 1, cols = b.length + 1;
            const dp = Array.from({ length: filas }, () => new Array(cols).fill(0));
            for (let i = 0; i < filas; i++) dp[i][0] = i;
            for (let j = 0; j < cols; j++) dp[0][j] = j;
            for (let i = 1; i < filas; i++) {
                for (let j = 1; j < cols; j++) {
                    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
            }
            return dp[a.length][b.length];
        }

function palabraCoincideFuzzy(palabraAlias, palabrasQueryArr) {
            if (palabraAlias.length < 5) return false;
            return palabrasQueryArr.some(pq => pq.length >= 5 && distanciaEdicionAcotada(palabraAlias, pq) <= 1);
        }

function buscarCapacidadPT(textoNormalizado, rolActual) {
            const palabrasQuery = new Set(textoNormalizado.split(/\s+/).filter(Boolean).map(lematizarPalabra));
            const palabrasQueryArr = [...palabrasQuery];

            function intentar(permitirFuzzy) {
                let mejorPuntos = 0, empatados = [];
                CAPACIDADES_PT.forEach(cap => {
                    if (!cap.roles.includes(rolActual)) return;
                    cap.aliases.forEach(alias => {
                        const palabrasAlias = normalizarTextoAsistente(alias).split(/\s+/).filter(Boolean).map(lematizarPalabra);
                        const todasPresentes = palabrasAlias.every(p => palabrasQuery.has(p) || (permitirFuzzy && palabraCoincideFuzzy(p, palabrasQueryArr)));
                        if (!todasPresentes) return;
                        if (palabrasAlias.length > mejorPuntos) { mejorPuntos = palabrasAlias.length; empatados = [cap]; }
                        else if (palabrasAlias.length === mejorPuntos && !empatados.includes(cap)) { empatados.push(cap); }
                    });
                });
                return { mejorPuntos, empatados };
            }

            let { mejorPuntos, empatados } = intentar(false);
            if (!empatados.length) ({ mejorPuntos, empatados } = intentar(true));
            if (!empatados.length) return null;

            const idsUnicos = [...new Set(empatados.map(c => c.id))];
            if (idsUnicos.length > 1 && mejorPuntos >= 2) {
                return { ambiguo: true, opciones: idsUnicos.map(id => empatados.find(c => c.id === id)) };
            }
            return empatados[0];
        }

function respuestaCapacidadPT(cap) {
            if (cap.respuestaDinamica) return { texto: cap.respuestaDinamica(), accionTab: cap.tab, accionLabel: `Ir a ${cap.tab === 'agenda' ? 'Agenda' : cap.tab === 'grupos' ? 'Grupos' : 'Clientes'}` };
            const pasos = cap.pasos.map((p, i) => `${i + 1}. ${p}`).join('\n');
            const restricciones = cap.restricciones.length ? `\n\nImportante: ${cap.restricciones.join(' ')}` : '';
            return { texto: `${cap.nombre}:\n${pasos}${restricciones}`, accionTab: cap.tab, accionLabel: `Ir a ${cap.nombre.match(/agenda|cliente|grupo/i) ? (cap.tab === 'agenda' ? 'Agenda' : cap.tab === 'grupos' ? 'Grupos' : 'Clientes') : cap.nombre}` };
        }

function respuestaAmbiguaPT(opciones) {
            const nombres = opciones.map(c => c.nombre.toLowerCase());
            const lista = nombres.length === 2
                ? `${nombres[0]} o ${nombres[1]}`
                : `${nombres.slice(0, -1).join(', ')} o ${nombres[nombres.length - 1]}`;
            return { texto: `¿Quieres ${lista}? Dímelo con esas palabras y te explico los pasos.` };
        }

function respuestaCalculoAsistente(q) {
            const numeros = (q.match(/\d+([.,]\d+)?/g) || []).map(n => parseFloat(n.replace(',', '.')));
            // "X% de Y" / "Y - X%" / "aplico X% a Y" -> precio final
            let m = q.match(/(\d+(?:[.,]\d+)?)\s*%.*?(?:de|a)\s*(\d+(?:[.,]\d+)?)/) || q.match(/(\d+(?:[.,]\d+)?)\s*€.*?(\d+(?:[.,]\d+)?)\s*%/);
            // H (hallazgo de auditoria): "aplico" solo cubre 1a persona -- "aplicar 15% a 120"
            // (infinitivo, tal cual pide el enunciado H de la auditoria) no coincidía.
            if (/%/.test(q) && /descuento|resta|aplic|hago|quito/.test(q) && numeros.length >= 2) {
                const pct = numeros.find(n => q.includes(String(n).replace('.', ',') + '%') || q.includes(String(n) + '%')) ?? numeros[0];
                const base = numeros.find(n => n !== pct) ?? numeros[1];
                const final = base * (1 - pct / 100);
                return `${base}€ − ${pct}% = ${final.toFixed(2)}€ (descuento de ${(base - final).toFixed(2)}€).`;
            }
            if (/%\s*de/.test(q) && numeros.length >= 2) {
                const [pct, base] = numeros;
                return `${pct}% de ${base} = ${(base * pct / 100).toFixed(2)}.`;
            }
            // "qué descuento para pasar de A a B" / "de A a B qué descuento es"
            m = q.match(/de\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros)?\s*a\s*(\d+(?:[.,]\d+)?)/);
            if (m && /descuento|rebaja|porcentaje/.test(q)) {
                const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.'));
                if (a > 0) return `Para pasar de ${a}€ a ${b}€ hace falta un descuento del ${(100 - (b / a) * 100).toFixed(2)}%.`;
            }
            // "N de M sesiones, qué % ha consumido" -- AMBIGUO sin contexto: "lleva 5 de 10
            // sesiones" = 5 usadas, pero "le quedan 3 de 8 sesiones" = 3 RESTANTES (usadas=8-3=5).
            // Hallazgo real de los tests (assistant_test_harness.cjs, caso exacto del enunciado
            // "le quedan 3 de 8 sesiones" -> 62.5%): la primera versión trataba SIEMPRE el primer
            // número como "usadas", dando 37.5% para ese caso -- resultado incorrecto. Se detecta
            // "queda/quedan/restan" antes del número para invertir la interpretación.
            m = q.match(/(\d+)\s*de\s*(\d+)\s*(?:sesion|clase)/);
            if (m) {
                const n = parseInt(m[1], 10), total = parseInt(m[2], 10);
                const esRestantes = /queda|quedan|restan|restantes/.test(q.slice(0, q.indexOf(m[0])));
                const usadas = esRestantes ? total - n : n;
                if (total > 0) return `${usadas} de ${total} sesiones = ${(usadas / total * 100).toFixed(1)}% consumido (quedan ${total - usadas}).`;
            }
            return null;
        }

function respuestaDiagnosticoHueco(q) {
            // D4: sin valor mágico -- "agendar"/"hueco" ya cubren cualquier hora concreta, no
            // hacía falta la hora del ejemplo (18:15) codificada aquí como si fuera una keyword.
            if (!/por qu[eé]|porque/.test(q) || !/hueco|agendar|reservar|disponib|slot/.test(q)) return null;
            const horaMatch = q.match(/(\d{1,2})[:h](\d{2})/);
            if (!horaMatch) return 'Para diagnosticar un hueco concreto dime la hora exacta, por ejemplo: "¿por qué no puedo agendar a las 18:15?".';
            const hora = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2]}`;
            const hoyISO = formatoFechaLocal(new Date());
            const clave = `${hoyISO}_${hora}`;
            const ocupado = dbAgenda[entrenadorVisto]?.[clave];
            if (ocupado) return `A las ${hora} de hoy ya tienes una sesión ocupando ese hueco (${ocupado.nombre || 'cliente'}). Por eso no puedes agendar ahí -- elige otra franja o reprograma esa cita primero.`;
            const disp = dbDisponibilidadReservas[entrenadorVisto];
            if (!disp) return `No tienes disponibilidad publicada todavía, así que ningún hueco aparece como agendable. Añádela desde "+ Disponibilidad" en Agenda.`;
            return `A las ${hora} de hoy el hueco no está ocupado por ninguna cita tuya que yo pueda ver -- si sigue sin dejarte agendar, puede estar fuera de tu disponibilidad publicada para ese día, o bloqueado como excepción puntual. Revisa "+ Disponibilidad".`;
        }

function respuestaAyudaAsistente(rolActual) {
            const categorias = {};
            CAPACIDADES_PT.forEach(cap => {
                if (!cap.roles.includes(rolActual)) return;
                const cat = ({ crear_cliente:'Clientes', editar_cliente:'Clientes', baja_cliente:'Clientes', ver_sesiones_cliente:'Clientes', link_reservas:'Clientes',
                    agendar_sesion:'Agenda', reprogramar_sesion:'Agenda', eliminar_sesion:'Agenda', disponibilidad:'Agenda', marcar_prueba:'Agenda', hacer_reserva:'Agenda',
                    recuperacion_no_facturable:'Agenda',
                    crear_grupo:'Grupos', añadir_cliente_grupo:'Grupos', quitar_cliente_grupo:'Grupos', editar_cliente_grupo:'Grupos', descuento_individual_grupo:'Grupos', facturacion_grupo_explicacion:'Grupos',
                    enviar_whatsapp:'WhatsApp', enviar_aviso_portal:'Avisos y Portal', historico_avisos:'Avisos y Portal',
                    bono8_info:'Bonos y Planes' })[cap.id] || 'Otros';
                (categorias[cat] = categorias[cat] || []).push(cap.nombre);
            });
            const texto = Object.keys(categorias).map(cat => `${cat}:\n${categorias[cat].map(n => `· ${n}`).join('\n')}`).join('\n\n');
            return { texto: `Esto es lo que puedo ayudarte a hacer:\n\n${texto}\n\nPregúntame "cómo..." sobre cualquiera de estas, o pídeme un cálculo (p.ej. "15% de 120").` };
        }