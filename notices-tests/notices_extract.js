let usuarioLogeado = "";

let rolActivo = "";

let entrenadorVisto = "";

let dbClientes = JSON.parse(localStorage.getItem('bs_db_clientes_v6')) || {};

let dbAgenda = JSON.parse(localStorage.getItem('bs_db_agenda_v6')) || {};

let dbPruebasCRM = JSON.parse(localStorage.getItem('bs_db_pruebas_crm_v6')) || {};

let dbDisponibilidadReservas = JSON.parse(localStorage.getItem('bs_db_disponibilidad_reservas_v6')) || {};

let dbNotas = JSON.parse(localStorage.getItem('bs_db_notas_v6')) || {};

let dbHistoricoClientes = JSON.parse(localStorage.getItem('bs_db_historico_clientes_v6')) || {};

let dbCredenciales = sanitizarCredenciales(JSON.parse(localStorage.getItem('bs_db_credenciales_v6')) || CREDENCIALES_BASE);

let avisoMultipleEstados = new Map();

let avisoCanalWhatsAppActivo = true;

function valorInvalidoParaFirestore(valor, rutaActual = '', vistos = new Set()) {
            if (valor === undefined) return { ruta: rutaActual || '(raíz)', motivo: 'undefined' };
            if (typeof valor === 'number' && Number.isNaN(valor)) return { ruta: rutaActual || '(raíz)', motivo: 'NaN' };
            if (typeof valor === 'function') return { ruta: rutaActual || '(raíz)', motivo: 'función' };
            if (valor === null || typeof valor !== 'object') return null;
            if (valor instanceof Date) return null;
            // FieldValue.serverTimestamp()/increment()/arrayUnion() etc son objetos especiales del
            // SDK de Firestore, no datos de la app -- nunca hay que recorrerlos como si lo fueran.
            // instanceof cuando el SDK está cargado; _methodName como duck-type de respaldo (así
            // funciona igual en los tests, que no cargan el SDK real de Firebase).
            if (typeof firebase !== 'undefined' && firebase.firestore && valor instanceof firebase.firestore.FieldValue) return null;
            if (valor && valor._methodName) return null;
            if (vistos.has(valor)) return { ruta: rutaActual || '(raíz)', motivo: 'referencia circular' };
            vistos.add(valor);
            if (Array.isArray(valor)) {
                for (let i = 0; i < valor.length; i++) {
                    const problema = valorInvalidoParaFirestore(valor[i], `${rutaActual}[${i}]`, vistos);
                    if (problema) return problema;
                }
                return null;
            }
            for (const clave of Object.keys(valor)) {
                const problema = valorInvalidoParaFirestore(valor[clave], rutaActual ? `${rutaActual}.${clave}` : clave, vistos);
                if (problema) return problema;
            }
            return null;
        }

function estadoLocalAgendaParaNube(trainerKeyScope) {

            // Escritura dirigida: si se conoce el trainerKey afectado, solo se envían
            // sus propios sub-mapas (notación de punto) con merge:true, para que Firestore
            // fusione a nivel de campo y nunca pise los datos de otro entrenador que se
            // hayan guardado casi al mismo tiempo (evita "last write wins" sobre el documento
            // completo). "notas" sigue siendo un mapa plano (clave "trainerKey__clave", no
            // anidado) y por eso se envía entero como excepción documentada — riesgo residual
            // menor y aceptado, ver BESOUL_WORK_STATE.md.
            if (trainerKeyScope) {
                return {
                    [`clientes.${trainerKeyScope}`]: dbClientes[trainerKeyScope] || [],
                    [`agenda.${trainerKeyScope}`]: dbAgenda[trainerKeyScope] || {},
                    [`pruebasCRM.${trainerKeyScope}`]: dbPruebasCRM[trainerKeyScope] || {},
                    [`disponibilidadReservas.${trainerKeyScope}`]: dbDisponibilidadReservas[trainerKeyScope] || {},
                    [`historicoClientes.${trainerKeyScope}`]: dbHistoricoClientes[trainerKeyScope] || {},
                    notas: dbNotas || {},
                    ultimaActualizacionLocal: new Date().toISOString()
                };
            }

            // Fallback legacy (sin trainerKey conocido): documento completo, como antes.
            return {

                // En la versión con Firebase Authentication, los usuarios/roles se leen de besoulUsers.
                // No guardamos credenciales dentro del documento de agenda para evitar que una copia antigua
                // sobrescriba el selector de entrenadores o elimine perfiles por error.
                clientes: dbClientes || {},

                agenda: dbAgenda || {},
                pruebasCRM: dbPruebasCRM || {},
                disponibilidadReservas: dbDisponibilidadReservas || {},

                notas: dbNotas || {},
                historicoClientes: dbHistoricoClientes || {},

                ultimaActualizacionLocal: new Date().toISOString()

            };

        }

function guardarEstadoNubeAgenda(trainerKeyScope) {

            // Hallazgo real (hotfix edición de fichas, 2026-09-02): esta función SIEMPRE
            // resolvía en éxito, incluso cuando el guard de abajo omitía el guardado por
            // completo, o cuando .set() fallaba de verdad -- el .catch() se limitaba a
            // hacer console.error() sin relanzar, así que cualquier código que hiciera
            // "await guardarEstadoNubeAgenda(...)" nunca podía enterarse de un fallo real.
            // Se mantiene fire-and-forget para las llamadas existentes que ignoran el
            // resultado (siguen sin romperse: la promesa nunca se rechaza, solo cambia lo
            // que resuelve), pero ahora resuelve { ok:false, ... } en vez de éxito cuando
            // no se ha guardado nada, para que quien SÍ necesite saberlo (guardarCliente())
            // pueda distinguir un guardado real de uno omitido/fallido.
            if (!window.bsAgendaCloudDocRef || window.bsAgendaAplicandoNube) return Promise.resolve({ ok: false, omitido: true });

            try {

                const scope = trainerKeyScope || entrenadorVisto;

                const payload = estadoLocalAgendaParaNube(scope);

                // HOTFIX-CLIENT-SAVE-V2: valida ANTES de tocar Firestore -- si algo en el estado
                // local (cualquier campo, no solo clientes) es undefined/NaN/función/circular, se
                // bloquea aquí con la ruta exacta en consola, en vez de dejar que Firestore lo
                // rechace tras un round-trip con un error genérico para el usuario.
                const problemaPayload = valorInvalidoParaFirestore(payload);
                if (problemaPayload) {
                    console.error(`[BESOUL Agenda] guardarEstadoNubeAgenda: payload inválido, escritura BLOQUEADA antes de llegar a Firestore · trainerKey=${scope} · ruta=${problemaPayload.ruta} · motivo=${problemaPayload.motivo}`);
                    return Promise.resolve({ ok: false, err: { code: 'invalid-payload', message: `Valor no válido para Firestore en "${problemaPayload.ruta}" (${problemaPayload.motivo}).`, ruta: problemaPayload.ruta } });
                }

                payload.actualizadoEn = firebase.firestore.FieldValue.serverTimestamp();

                // Hallazgo real (auditoría actividades autorizadas, 2026-09-02), confirmado
                // contra el código fuente del SDK de Firestore: .set(payload, {merge:true})
                // SOLO interpreta como ruta anidada las claves con punto que vienen en la
                // opción mergeFields; las claves con punto DENTRO del propio objeto de datos
                // (p.ej. "clientes.veronica") se tratan como un nombre de campo LITERAL de
                // nivel superior -- es decir, esta escritura dirigida por trainerKey NUNCA
                // tocaba el campo real anidado clientes.<trainerKey>, sino un campo fantasma
                // separado llamado literalmente "clientes.<trainerKey>". Por eso el guardado
                // "funcionaba" (no fallaba, no lanzaba error) pero el valor real nunca
                // cambiaba. .update() SÍ interpreta las claves con punto del objeto como ruta
                // anidada real (fieldPathFromDotSeparatedString) -- es el método correcto
                // para este payload dirigido, sin cambiar su forma.
                // Devuelve la promesa (antes se descartaba) para que quien lo necesite
                // pueda esperar a que el guardado+publicación terminen de verdad, sin
                // cambiar el comportamiento de las llamadas existentes que la ignoran.
                return window.bsAgendaCloudDocRef.update(...payloadParaUpdateFirestore(payload))
                    .then(() => publicarReservasPublicas())
                    .then(() => ({ ok: true }))
                    .catch(err => { console.error('Error guardando agenda en Firebase:', err); return { ok: false, err }; });

            } catch (err) {

                console.error('Error preparando agenda para Firebase:', err);

                return Promise.resolve({ ok: false, err });

            }

        }

function payloadParaUpdateFirestore(payload) {
            const args = [];
            Object.keys(payload).forEach(key => {
                const partes = key.split('.');
                if (partes.length > 1) {
                    args.push(new firebase.firestore.FieldPath(partes[0], partes.slice(1).join('.')), payload[key]);
                } else {
                    args.push(key, payload[key]);
                }
            });
            return args;
        }

function programarGuardadoNubeAgenda(trainerKeyScope) {

            if (!window.bsAgendaCloudDocRef || window.bsAgendaAplicandoNube) return;

            const scope = trainerKeyScope || entrenadorVisto;

            clearTimeout(window.bsAgendaCloudTimer);

            window.bsAgendaCloudTimer = setTimeout(() => guardarEstadoNubeAgenda(scope), 350);

        }

function aplicarEstadoNubeAgenda(data) {

            if (!data) return;

            // FIX-PT-AVAILABILITY-PERSISTENCE: a partir de aquí, dbDisponibilidadReservas (y el
            // resto de dbXxx) refleja de verdad lo que hay en Firestore -- ya es seguro fabricar
            // un default para un trainerKey sin disponibilidad, porque significa que REALMENTE no
            // tiene ninguna, no que la respuesta de red aún no ha llegado.
            window.bsAgendaDisponibilidadCargada = true;

            window.bsAgendaAplicandoNube = true;

            try {

                // Los entrenadores vienen de besoulUsers, no del documento de agenda.
                // Así evitamos perder el modo admin o el selector si el campo credenciales de agenda quedó antiguo.
                dbCredenciales = sanitizarCredenciales(dbCredenciales || CREDENCIALES_BASE);

                dbClientes = data.clientes || {};

                dbAgenda = data.agenda || {};
                dbPruebasCRM = data.pruebasCRM || {};
                dbDisponibilidadReservas = data.disponibilidadReservas || {};
                sincronizarPruebasCRMDentroDeAgenda();

                dbNotas = data.notas || {};
                dbHistoricoClientes = data.historicoClientes || {};

                dbCatalogoActividades = data.catalogoActividades || {};
                dbTrainerActividades = data.trainerActividades || {};
                dbTarifasActividadVersiones = data.tarifasActividadVersiones || {};
                dbRepartoActividadVersiones = data.repartoActividadVersiones || {};



                localStorage.setItem('bs_db_credenciales_v6', JSON.stringify(dbCredenciales));

                localStorage.setItem('bs_db_clientes_v6', JSON.stringify(dbClientes));

                localStorage.setItem('bs_db_agenda_v6', JSON.stringify(dbAgenda));
                localStorage.setItem('bs_db_pruebas_crm_v6', JSON.stringify(dbPruebasCRM));
                localStorage.setItem('bs_db_disponibilidad_reservas_v6', JSON.stringify(dbDisponibilidadReservas));

                localStorage.setItem('bs_db_notas_v6', JSON.stringify(dbNotas));
                localStorage.setItem('bs_db_historico_clientes_v6', JSON.stringify(dbHistoricoClientes));

                normalizarCredenciales();

            } finally {

                window.bsAgendaAplicandoNube = false;

            }



            const appVisible = document.getElementById('app-content') && !document.getElementById('app-content').classList.contains('hidden');

            if (appVisible) {

                if (!dbCredenciales[entrenadorVisto]) entrenadorVisto = usuarioLogeado || Object.keys(dbCredenciales)[0] || '';

                if (rolActivo === 'admin') configurarSelectorAdmin();

                recalcularKPIs();

                renderClientes();

                renderAgenda();

                actualizarLabelsKPIMes();

            }

        }

function sincronizarPruebasCRMDentroDeAgenda() {
            // Las pruebas procedentes del CRM se guardan también en pruebasCRM como respaldo.
            // Para que la Agenda las pinte aunque el mapa principal no se haya fusionado bien,
            // las inyectamos en dbAgenda solo en memoria/local antes de renderizar.
            Object.keys(dbPruebasCRM || {}).forEach(trainerKey => {
                if (!dbAgenda[trainerKey]) dbAgenda[trainerKey] = {};
                Object.keys(dbPruebasCRM[trainerKey] || {}).forEach(clave => {
                    const prueba = dbPruebasCRM[trainerKey][clave];
                    if (prueba && esCitaPruebaCRM(prueba) && !dbAgenda[trainerKey][clave]) {
                        dbAgenda[trainerKey][clave] = prueba;
                    }
                });
            });
        }

function normalizarCredenciales() {

            dbCredenciales = sanitizarCredenciales(dbCredenciales || {});

            Object.keys(dbCredenciales).forEach(user => {

                if (!dbCredenciales[user].nombre) dbCredenciales[user].nombre = user.charAt(0).toUpperCase() + user.slice(1);

                if (!dbCredenciales[user].rol) dbCredenciales[user].rol = 'pt';

                if (dbCredenciales[user].pass) delete dbCredenciales[user].pass;

            });

            localStorage.setItem('bs_db_credenciales_v6', JSON.stringify(dbCredenciales));

            programarGuardadoNubeAgenda();

        }

function guardarCredenciales() {

            dbCredenciales = sanitizarCredenciales(dbCredenciales || {});

            localStorage.setItem('bs_db_credenciales_v6', JSON.stringify(dbCredenciales));

            programarGuardadoNubeAgenda();

        }

function sanitizarCredenciales(input) {
            const salida = {};
            Object.keys(input || {}).forEach(key => {
                const raw = input[key] || {};
                const trainerKey = String(raw.trainerKey || key || '').trim().toLowerCase().replace(/\s+/g, '');
                if (!trainerKey) return;
                salida[trainerKey] = {
                    nombre: raw.nombre || (trainerKey.charAt(0).toUpperCase() + trainerKey.slice(1)),
                    rol: raw.rol === 'admin' ? 'admin' : 'pt',
                    email: raw.email || '',
                    uid: raw.uid || '',
                    trainerKey,
                    activo: raw.activo !== false
                };
            });
            return salida;
        }

function buscarClientePorIdTrainer(trainerKey, id) {
            const lista = dbClientes[trainerKey] || [];
            return lista.find(c => c && c.id === id) || null;
        }

function nombreEntrenador(user) {

            return dbCredenciales[user]?.nombre || user;

        }

function publicarAvisoPortalCliente(id) {
            const ficha = buscarClientePorIdTrainer(entrenadorVisto, id);
            const mensaje = document.getElementById('aviso-multiple-mensaje')?.value.trim() || '';
            const estado = avisoMultipleEstados.get(id) || {};
            if (!ficha || !mensaje) { estado.portal = 'error'; avisoMultipleEstados.set(id, estado); renderListaEnvioAvisoMultiple(); return; }
            try {
                if (!Array.isArray(ficha.avisosPortal)) ficha.avisosPortal = [];
                ficha.avisosPortal.unshift({
                    id: `av_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
                    fecha: new Date().toISOString(),
                    contenido: mensaje,
                    remitente: nombreEntrenador(entrenadorVisto),
                    canales: { portal: true, whatsapp: avisoCanalWhatsAppActivo },
                    // A6 (addendum): 'manual' siempre hoy -- campo preparado para que un futuro
                    // generador automático (sesión mañana, bono a punto de agotarse/caducar,
                    // reserva confirmada...) pueda marcar sus propios avisos como 'sistema' sin
                    // cambiar el esquema. Ninguna automatización activa en esta fase.
                    tipo: 'manual'
                });
                ficha.avisosPortal = ficha.avisosPortal.slice(0, 20);
                localStorage.setItem('bs_db_clientes_v6', JSON.stringify(dbClientes));
                // PORTAL-NOTICES-FIX (2026-09-16): hallazgo real de auditoría -- este aviso nunca
                // se guardaba en besoulSuite/agenda (solo en localStorage + la proyección pública
                // besoulPublicClients vía publicarReservasPublicasDebounced()). En cuanto llegaba
                // CUALQUIER otro snapshot del documento (p.ej. tras guardar disponibilidad, un
                // cliente, o cualquier otro cambio de cualquier PT), aplicarEstadoNubeAgenda()
                // sustituye dbClientes por completo con la copia remota -- que nunca tuvo este
                // aviso -- y el contador/histórico "desaparecían" sin explicación, exactamente lo
                // reportado ("aparece un 1, luego 'sin avisos enviados'"). Ahora también se
                // persiste en el documento compartido, igual que el resto de la ficha -- sin
                // colección ni Rules nuevas (besoulSuite/agenda ya admite escritura de cualquier
                // usuario activo). Debounced (no directo) porque avisar a varios clientes ejecuta
                // esta función en bucle -- coalesce en un único guardado real.
                programarGuardadoNubeAgenda(entrenadorVisto);
                publicarReservasPublicasDebounced();
                estado.portal = 'ok';
            } catch (err) {
                console.error('[NOTICE-01] Error publicando aviso en Portal:', err);
                estado.portal = 'error';
            }
            avisoMultipleEstados.set(id, estado);
            renderListaEnvioAvisoMultiple();
        }