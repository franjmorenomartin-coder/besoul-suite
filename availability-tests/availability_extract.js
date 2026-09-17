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
            //
            // HARDENING-PRE-BASELINE-v3.2.1 (2026-09-17): el fallback legacy que existía aquí
            // ("sin trainerKey conocido, escribe el documento COMPLETO de todos los entrenadores")
            // se retira. Auditoría de TODOS los llamadores de guardarEstadoNubeAgenda()/
            // programarGuardadoNubeAgenda() confirmó que ninguno depende hoy de recibir ese
            // fallback: o pasan un trainerKey explícito, o dependen de `entrenadorVisto`, que se
            // fija una única vez en el login (línea ~3409) y nunca se vacía después salvo el borde
            // `if (!dbCredenciales[entrenadorVisto]) entrenadorVisto = usuarioLogeado || ... || ''`
            // (línea ~1854) -- un caso raro pero posible si la primera carga de dbCredenciales
            // llega vacía. Sin un fallback legítimo real, se devuelve null en vez de un payload de
            // documento completo: ver guardarEstadoNubeAgenda(), que ahora trata null como fallo
            // explícito en vez de escribir a ciegas.
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

            return null;

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

                // HARDENING-PRE-BASELINE-v3.2.1: sin trainerKey conocido no hay guardado seguro
                // posible -- estadoLocalAgendaParaNube() devuelve null a propósito en vez del
                // antiguo fallback de documento completo. Fallar aquí, explícito y detectable,
                // en vez de sobrescribir en silencio los datos de TODOS los entrenadores.
                if (!scope) {
                    console.error('[BESOUL Agenda] guardarEstadoNubeAgenda: sin trainerKey de scope (entrenadorVisto vacío) -- guardado BLOQUEADO para evitar sobrescribir el documento completo.');
                    return Promise.resolve({ ok: false, err: { code: 'no-trainer-scope', message: 'No se pudo determinar el entrenador afectado; guardado cancelado por seguridad.' } });
                }

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

                // HARDENING-PRE-BASELINE-v3.2.1: guardarEstadoNubeAgenda() construye su payload a
                // partir del estado LOCAL en memoria (dbClientes[scope], etc.), no de una lectura
                // fresca -- así que ni una relectura del servidor justo antes de escribir basta por
                // sí sola (get(source:'server') + update() SIGUE pudiendo pisar en silencio un
                // cambio de la MISMA scope guardado por otra pestaña/sesión que esta pestaña
                // todavía no ha aplicado vía su propio onSnapshot). En vez de fusionar a ciegas
                // (arriesgado sin conocer con certeza qué cambió en cada caso -- ver auditoría),
                // se usa una transacción real para DETECTAR el conflicto y abortar el guardado en
                // vez de sobrescribirlo en silencio: si lo que el servidor tiene AHORA MISMO para
                // este trainerKey ya no coincide con lo último que esta pestaña sincronizó
                // (bsUltimoServidorConocido, actualizado en cada aplicarEstadoNubeAgenda()),
                // significa que otra sesión guardó algo de este mismo entrenador entre medias.
                // Comportamiento en el caso común (sin conflicto): idéntico a antes. En el caso de
                // conflicto real: el guardado se cancela con un error claro en vez de perder el
                // cambio ajeno silenciosamente -- objetivo explícito de esta fase.
                const CAMPOS_CONCURRENCIA_COMPARABLES = ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes'];
                const conocidoPrevio = window.bsUltimoServidorConocido;
                const docRef = window.bsAgendaCloudDocRef;

                return docRef.firestore.runTransaction(async tx => {
                    const snap = await tx.get(docRef);
                    const actual = snap.exists ? (snap.data() || {}) : {};
                    const huboConflicto = conocidoPrevio ? CAMPOS_CONCURRENCIA_COMPARABLES.some(campo => {
                        const previo = JSON.stringify((conocidoPrevio[campo] || {})[scope] ?? null);
                        const fresco = JSON.stringify((actual[campo] || {})[scope] ?? null);
                        return previo !== fresco;
                    }) : false;
                    if (huboConflicto) {
                        const errConflicto = new Error('Conflicto de concurrencia detectado para trainerKey=' + scope);
                        errConflicto.code = 'conflict';
                        throw errConflicto;
                    }
                    tx.update(docRef, ...payloadParaUpdateFirestore(payload));
                })
                    .then(() => publicarReservasPublicas())
                    .then(() => ({ ok: true }))
                    .catch(err => {
                        if (err && err.code === 'conflict') {
                            console.error(`[BESOUL Agenda] guardarEstadoNubeAgenda: CONFLICTO de concurrencia para trainerKey=${scope} -- otra sesión guardó cambios de este entrenador que esta pestaña aún no había recibido. Guardado cancelado para no sobrescribirlos.`);
                            return { ok: false, err: { code: 'conflict', message: 'Se han detectado cambios más recientes de este entrenador guardados desde otra sesión/pestaña. Recarga la página antes de volver a guardar para no perder esos cambios.' } };
                        }
                        console.error('Error guardando agenda en Firebase:', err);
                        return { ok: false, err };
                    });

            } catch (err) {

                console.error('Error preparando agenda para Firebase:', err);

                return Promise.resolve({ ok: false, err });

            }

        }

function mensajeErrorGuardadoAgenda(err) {
            const code = err && err.code || '';
            if (code === 'conflict') {
                return (err && err.message) || 'Otra sesión ha guardado cambios de este entrenador que esta pantalla todavía no tenía. Recarga la página antes de reintentar para no perder ese cambio.';
            }
            if (code === 'permission-denied') {
                return 'Tu sesión no tiene permiso para guardar este cambio ahora mismo. Cierra sesión y vuelve a entrar; si sigue sin funcionar, contacta con administración.';
            }
            if (code === 'no-trainer-scope' || code === 'invalid-payload') {
                return (err && err.message) || 'No se pudo preparar el guardado. Recarga la página e inténtalo de nuevo.';
            }
            if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'cancelled') {
                return 'No hay conexión con el servidor ahora mismo. Revisa tu conexión e inténtalo de nuevo.';
            }
            return 'Ha ocurrido un error inesperado al guardar. Inténtalo de nuevo; si se repite, contacta con administración.';
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

                // HARDENING-PRE-BASELINE-v3.2.1: instantánea de "lo último que esta pestaña sabe
                // con certeza que hay en el servidor", por trainerKey -- usada únicamente por
                // guardarEstadoNubeAgenda() para detectar (nunca para fusionar) si otra sesión ha
                // guardado cambios de ESTE MISMO entrenador entre medias. Ver esa función.
                // IMPORTANTE: debe ser una copia profunda, NUNCA las mismas referencias que
                // dbClientes/dbDisponibilidadReservas/etc. -- esos objetos se MUTAN en el sitio en
                // más de un punto del código (p.ej. guardarDisponibilidadReservas():
                // "dbDisponibilidadReservas[entrenadorVisto] = nuevoValor" antes de guardar). Si
                // esta instantánea compartiera referencia, esa mutación optimista contaminaría el
                // propio "estado conocido" usado como base de comparación, dando un falso conflicto
                // en TODOS los guardados, incluso sin ninguna otra sesión de por medio.
                window.bsUltimoServidorConocido = JSON.parse(JSON.stringify({
                    clientes: dbClientes, agenda: dbAgenda, pruebasCRM: dbPruebasCRM,
                    disponibilidadReservas: dbDisponibilidadReservas, historicoClientes: dbHistoricoClientes,
                }));

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
                const motivo = resultado?.err ? mensajeErrorGuardadoAgenda(resultado.err) : 'la app está sincronizando otro cambio en este instante -- vuelve a intentarlo en unos segundos.';
                alert(`No se ha podido guardar la disponibilidad en el servidor. Se ha restaurado la disponibilidad anterior en pantalla. ${motivo}`);
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