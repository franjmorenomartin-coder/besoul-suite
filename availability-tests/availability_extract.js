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

let lunesActual = new Date();

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

function normalizarTrainerKey(valor) {
            return String(valor || '')
                .trim()
                .toLowerCase()
                .normalize('NFD').replace(/\p{Diacritic}/gu, '')
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9._-]/g, '');
        }

function disponibilidadReservasPorDefecto() {
            // Nueva filosofía: sin disponibilidad publicada no hay slots agendables.
            // El PT/admin debe definir franjas antes de agendar clientes.
            const semanal = {};
            for (let d=1; d<=7; d++) semanal[d] = { activo: false, bloques: [] };
            return { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true, actualizadoEn: new Date().toISOString() };
        }

function disponibilidadTrainerActual() {
            if (!dbDisponibilidadReservas[entrenadorVisto]) dbDisponibilidadReservas[entrenadorVisto] = disponibilidadReservasPorDefecto();
            return dbDisponibilidadReservas[entrenadorVisto];
        }

function leerDisponibilidadFormulario() {
            const semanal = {};
            for (let d=1; d<=7; d++) {
                const activo = !!document.getElementById(`disp-active-${d}`)?.checked;
                const b1s = document.getElementById(`disp-${d}-b1-start`)?.value || '';
                const b1e = document.getElementById(`disp-${d}-b1-end`)?.value || '';
                const b2s = document.getElementById(`disp-${d}-b2-start`)?.value || '';
                const b2e = document.getElementById(`disp-${d}-b2-end`)?.value || '';
                const bloques = [];
                if (activo && b1s && b1e && b1s < b1e) bloques.push({inicio:b1s, fin:b1e});
                if (activo && b2s && b2e && b2s < b2e) bloques.push({inicio:b2s, fin:b2e});
                semanal[d] = { activo, bloques };
            }
            return semanal;
        }

async function guardarDisponibilidadReservas() {
            // FIX-PT-AVAILABILITY-PERSISTENCE: defensa en profundidad -- si por cualquier vía se
            // llega aquí sin que el snapshot real se haya aplicado todavía, "anterior" de abajo
            // sería un default fabricado, no los datos reales del PT; guardar sobre eso los
            // sustituiría permanentemente. abrirModalDisponibilidadReservas() ya bloquea el camino
            // normal (el botón "+ Disponibilidad"); este guardián cubre cualquier otro disparador.
            if (!disponibilidadListaParaEditar()) return;
            const semanalFormulario = leerDisponibilidadFormulario();
            const anterior = dbDisponibilidadReservas[entrenadorVisto] || disponibilidadReservasPorDefecto();
            const recurrente = !!document.getElementById('disp-recurrente-semanal')?.checked;
            const bloqueos = anterior.bloqueos || {};
            const excepciones = anterior.excepciones || {};
            let nuevoValor;

            if (recurrente) {
                nuevoValor = {
                    ...anterior,
                    semanal: semanalFormulario,
                    excepciones,
                    bloqueos,
                    recurrenteSemanal: true,
                    actualizadoEn: new Date().toISOString(),
                    actualizadoPor: usuarioLogeado
                };
            } else {
                const nuevasExcepciones = { ...excepciones };
                for (let d=1; d<=7; d++) {
                    const fecha = new Date(lunesActual);
                    fecha.setDate(fecha.getDate() + (d - 1));
                    const fechaISO = formatoFechaLocal(fecha);
                    nuevasExcepciones[fechaISO] = { ...semanalFormulario[d], override: true };
                }
                nuevoValor = {
                    ...anterior,
                    semanal: anterior.semanal || disponibilidadReservasPorDefecto().semanal,
                    excepciones: nuevasExcepciones,
                    bloqueos,
                    recurrenteSemanal: false,
                    actualizadoEn: new Date().toISOString(),
                    actualizadoPor: usuarioLogeado
                };
            }

            // FIX-PT-AVAILABILITY-PERSISTENCE-V2: confirmación real de guardado (bloque 6 del
            // hotfix). Antes: el estado local se sustituía y se anunciaba "guardado" de forma
            // incondicional, sin esperar a que el write a Firestore realmente terminara -- si
            // fallaba (red, cuota, error del servidor), el PT veía "Disponibilidad guardada" para
            // segundos después ver cómo la franja recién puesta desaparecía sin ninguna
            // explicación, en cuanto llegaba el próximo snapshot con el estado remoto real (el
            // guardado nunca llegó a aplicarse). Ahora: se aplica en memoria de forma optimista
            // (para que el PT vea el cambio al instante), pero se ESPERA la confirmación real
            // antes de cerrar el modal/anunciar éxito -- y si falla, se revierte la memoria al
            // valor anterior y se avisa explícitamente, dejando el modal abierto para reintentar.
            const btn = document.getElementById('btn-guardar-disponibilidad');
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
            dbDisponibilidadReservas[entrenadorVisto] = nuevoValor;
            localStorage.setItem('bs_db_disponibilidad_reservas_v6', JSON.stringify(dbDisponibilidadReservas));
            renderAgenda();

            const resultado = await guardarEstadoNubeAgenda();
            if (!resultado || !resultado.ok) {
                dbDisponibilidadReservas[entrenadorVisto] = anterior;
                localStorage.setItem('bs_db_disponibilidad_reservas_v6', JSON.stringify(dbDisponibilidadReservas));
                renderAgenda();
                if (btn) { btn.disabled = false; btn.textContent = 'Guardar disponibilidad'; }
                const motivo = resultado?.err ? (resultado.err.message || resultado.err.code || 'error desconocido') : 'la app está sincronizando otro cambio en este instante';
                alert(`No se ha podido guardar la disponibilidad en el servidor (${motivo}). Se ha restaurado la disponibilidad anterior en pantalla. Vuelve a intentarlo.`);
                return;
            }

            publicarReservasPublicas();
            if (btn) { btn.disabled = false; btn.textContent = 'Guardar disponibilidad'; }
            cerrarModalDisponibilidadReservas();
            alert(recurrente ? 'Disponibilidad recurrente guardada. Se generarán slots de 45 min todas las semanas.' : 'Disponibilidad guardada solo para la semana visible.');
        }

function disponibilidadListaParaEditar() {
            if (window.bsAgendaCloudDocRef && !window.bsAgendaDisponibilidadCargada) {
                alert('Todavía se está cargando la disponibilidad desde el servidor. Espera un momento y vuelve a intentarlo.');
                return false;
            }
            return true;
        }

function asegurarDisponibilidadTrainerEditable(trainerKey = entrenadorVisto) {
            if (!dbDisponibilidadReservas[trainerKey]) dbDisponibilidadReservas[trainerKey] = disponibilidadReservasPorDefecto();
            if (!dbDisponibilidadReservas[trainerKey].semanal) dbDisponibilidadReservas[trainerKey].semanal = disponibilidadReservasPorDefecto().semanal;
            if (!dbDisponibilidadReservas[trainerKey].excepciones) dbDisponibilidadReservas[trainerKey].excepciones = {};
            if (!dbDisponibilidadReservas[trainerKey].bloqueos) dbDisponibilidadReservas[trainerKey].bloqueos = {};
            return dbDisponibilidadReservas[trainerKey];
        }

function disponibilidadTrainerLectura(trainerKey = entrenadorVisto) {
            return dbDisponibilidadReservas[trainerKey] || null;
        }

function bloquesDisponibilidadFecha(trainerKey, fechaISO) {
            const disp = disponibilidadTrainerLectura(trainerKey);
            if (!disp) return [];
            const fecha = new Date(`${fechaISO}T00:00:00`);
            const dia = diaSemanaBesoul(fecha);
            const semanal = disp.semanal?.[dia];
            const excepcion = disp.excepciones?.[fechaISO];

            // Si hay excepción semanal/día con override, manda sobre la recurrente.
            if (excepcion) {
                if (excepcion.activo === false) return [];
                if (excepcion.override === true) {
                    return excepcion.activo ? normalizarBloquesDisponibilidad(excepcion.bloques) : [];
                }
            }

            let bloques = [];
            if (semanal?.activo) bloques = bloques.concat(normalizarBloquesDisponibilidad(semanal.bloques));
            if (excepcion?.activo !== false) bloques = bloques.concat(normalizarBloquesDisponibilidad(excepcion?.bloques));
            return fusionarBloquesDisponibilidad(bloques);
        }

function normalizarBloquesDisponibilidad(bloques) {
            return (Array.isArray(bloques) ? bloques : [])
                .map(b => ({ inicio: String(b.inicio || '').slice(0,5), fin: String(b.fin || '').slice(0,5) }))
                .filter(b => b.inicio && b.fin && b.inicio < b.fin)
                .sort((a,b) => a.inicio.localeCompare(b.inicio));
        }

function fusionarBloquesDisponibilidad(bloques) {
            const lista = normalizarBloquesDisponibilidad(bloques);
            if (!lista.length) return [];
            const salida = [lista[0]];
            for (let i=1; i<lista.length; i++) {
                const ultimo = salida[salida.length - 1];
                const actual = lista[i];
                if (actual.inicio <= ultimo.fin) {
                    if (actual.fin > ultimo.fin) ultimo.fin = actual.fin;
                } else salida.push(actual);
            }
            return salida;
        }

function formatoFechaLocal(fecha) {

            const y = fecha.getFullYear();

            const m = String(fecha.getMonth() + 1).padStart(2, '0');

            const d = String(fecha.getDate()).padStart(2, '0');

            return `${y}-${m}-${d}`;

        }

function emailDocId(email) {
            return String(email || '').trim().toLowerCase();
        }

function trainerKeyDesdeEmail(email) {
            return String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
        }

function perfilFirestoreAcredencial(perfil, emailFallback='') {
            const email = emailDocId(perfil?.email || emailFallback);
            const trainerKey = String(perfil?.trainerKey || trainerKeyDesdeEmail(email)).trim().toLowerCase().replace(/\s+/g, '');
            return {
                nombre: perfil?.nombre || trainerKey.charAt(0).toUpperCase() + trainerKey.slice(1),
                rol: perfil?.rol === 'admin' ? 'admin' : 'pt',
                email,
                uid: perfil?.uid || '',
                trainerKey,
                activo: perfil?.activo !== false
            };
        }