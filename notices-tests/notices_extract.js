const BS_APP_BUILD_TAG = 'conflict-diag-v1-2026-09-17';

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
            // HARDENING (QA 2026-09-17): "vistos" debe representar los ANCESTROS del nodo actual
            // en ESTA rama de la recursión, no "todo objeto visto en cualquier parte del árbol" --
            // lo segundo daba un falso positivo de "referencia circular" cuando el MISMO objeto
            // aparece dos veces por caminos distintos sin anidarse entre sí (p.ej.
            // sincronizarPruebasCRMDentroDeAgenda() enlaza, POR REFERENCIA (nunca clonada), la
            // misma prueba CRM dentro de dbAgenda además de dbPruebasCRM -- ambos acaban en el
            // mismo payload de guardarEstadoNubeAgenda(), sin que exista ningún ciclo real).
            // Se elimina el nodo de "vistos" al terminar de recorrer sus hijos (backtrack), así
            // solo detecta un objeto que se contiene a sí mismo, directa o indirectamente.
            if (vistos.has(valor)) return { ruta: rutaActual || '(raíz)', motivo: 'referencia circular' };
            vistos.add(valor);
            let problema = null;
            if (Array.isArray(valor)) {
                for (let i = 0; i < valor.length && !problema; i++) {
                    problema = valorInvalidoParaFirestore(valor[i], `${rutaActual}[${i}]`, vistos);
                }
            } else {
                for (const clave of Object.keys(valor)) {
                    problema = valorInvalidoParaFirestore(valor[clave], rutaActual ? `${rutaActual}.${clave}` : clave, vistos);
                    if (problema) break;
                }
            }
            vistos.delete(valor);
            return problema;
        }

function canonicalizarValorDiagnostico(v) {
            if (Array.isArray(v)) return v.map(canonicalizarValorDiagnostico);
            if (v && typeof v === 'object') {
                if (v instanceof Date) return v.toISOString();
                if (v._methodName) return `<FieldValue:${v._methodName}>`;
                const claves = Object.keys(v).sort();
                const out = {};
                claves.forEach(k => { out[k] = canonicalizarValorDiagnostico(v[k]); });
                return out;
            }
            return v === undefined ? '<undefined>' : v;
        }

function hashEstableDiagnostico(valor) {
            const str = JSON.stringify(canonicalizarValorDiagnostico(valor));
            let h = 0x811c9dc5;
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
            }
            return (h >>> 0).toString(16).padStart(8, '0');
        }

function contarElementosDiagnostico(v) {
            if (Array.isArray(v)) return v.length;
            if (v && typeof v === 'object') return Object.keys(v).length;
            return v == null ? 0 : 1;
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

                    // QA 2026-09-17: la DECISIÓN real (qué compara, cómo) es exactamente la misma
                    // de antes -- JSON.stringify(a) !== JSON.stringify(b) por campo -- sin cambios
                    // en esta pasada, a propósito, porque todavía no hay evidencia de otra causa.
                    // Solo se añade diagnóstico: por cada campo comparable, hash/recuento estables
                    // (nunca el contenido) más una comparación CANÓNICA en paralelo, puramente
                    // informativa, para poder confirmar o descartar sensibilidad al orden de claves
                    // la próxima vez que esto ocurra en un navegador real.
                    let huboConflicto = false;
                    if (conocidoPrevio) {
                        const camposDiagnostico = {};
                        const conflictFields = [];
                        CAMPOS_CONCURRENCIA_COMPARABLES.forEach(campo => {
                            const valorPrevio = (conocidoPrevio[campo] || {})[scope] ?? null;
                            const valorFresco = (actual[campo] || {})[scope] ?? null;
                            const sameRaw = JSON.stringify(valorPrevio) === JSON.stringify(valorFresco);
                            camposDiagnostico[campo] = {
                                same: sameRaw,
                                sameCanonical: hashEstableDiagnostico(valorPrevio) === hashEstableDiagnostico(valorFresco),
                                baselineHash: hashEstableDiagnostico(valorPrevio),
                                serverHash: hashEstableDiagnostico(valorFresco),
                                baselineCount: contarElementosDiagnostico(valorPrevio),
                                serverCount: contarElementosDiagnostico(valorFresco),
                            };
                            if (!sameRaw) conflictFields.push(campo);
                        });
                        huboConflicto = conflictFields.length > 0;
                        if (huboConflicto) {
                            // Nunca contenido real: solo booleans, hashes cortos y recuentos.
                            console.warn('[BESOUL CONFLICT DIAG]', {
                                appBuild: BS_APP_BUILD_TAG,
                                trainerKeyScope: scope,
                                entrenadorVisto,
                                rolActivo,
                                baselineExiste: true,
                                serverExiste: snap.exists,
                                campos: camposDiagnostico,
                                conflictFields,
                            });
                        }
                    }

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

                // HARDENING-PRE-BASELINE-v3.2.1: instantánea de "lo último que esta pestaña sabe
                // con certeza que hay en el servidor", por trainerKey -- usada únicamente por
                // guardarEstadoNubeAgenda() para detectar (nunca para fusionar) si otra sesión ha
                // guardado cambios de ESTE MISMO entrenador entre medias. Ver esa función.
                // IMPORTANTE (2): debe ser una copia profunda, NUNCA las mismas referencias que
                // dbClientes/dbDisponibilidadReservas/etc. -- esos objetos se MUTAN en el sitio en
                // más de un punto del código (p.ej. guardarDisponibilidadReservas():
                // "dbDisponibilidadReservas[entrenadorVisto] = nuevoValor" antes de guardar). Si
                // esta instantánea compartiera referencia, esa mutación optimista contaminaría el
                // propio "estado conocido" usado como base de comparación, dando un falso conflicto
                // en TODOS los guardados, incluso sin ninguna otra sesión de por medio.
                // IMPORTANTE (3, QA 2026-09-17 -- P0 real, SEGUNDA vuelta): tiene que capturarse
                // AQUÍ, ANTES de "dbAgenda = data.agenda" (más abajo) -- ese "=" es una asignación
                // de REFERENCIA, no una copia: dbAgenda y data.agenda pasan a ser el MISMO objeto
                // en memoria. sincronizarPruebasCRMDentroDeAgenda() muta dbAgenda EN EL SITIO para
                // pintar en Agenda las pruebas CRM que todavía no están fusionadas de verdad en el
                // campo "agenda" del servidor (su propio comentario lo dice: "solo en
                // memoria/local antes de renderizar") -- y como dbAgenda === data.agenda, esa
                // mutación ensucia igualmente data.agenda. Un primer intento de arreglo que leía
                // "data.agenda" DESPUÉS de esa mutación (en vez de dbAgenda) parecía correcto pero
                // seguía viendo el mismo objeto ya mutado -- confirmado con un negative control que
                // reprodujo el conflicto incluso así. La única captura realmente segura es ANTES
                // de que exista cualquier alias hacia data.agenda/data.pruebasCRM/etc., con
                // JSON.parse(JSON.stringify(...)) rompiendo el enlace de una vez. Causa raíz real
                // del P0 reportado en QA tras activar FASE 2 (visible al "ver como" un PT con una
                // valoración/prueba CRM agendada -- conflicto falso, determinista, en cada
                // guardado de ese entrenador, sin que nadie más escribiera nada).
                window.bsUltimoServidorConocido = JSON.parse(JSON.stringify({
                    clientes: data.clientes || {}, agenda: data.agenda || {}, pruebasCRM: data.pruebasCRM || {},
                    disponibilidadReservas: data.disponibilidadReservas || {}, historicoClientes: data.historicoClientes || {},
                }));

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