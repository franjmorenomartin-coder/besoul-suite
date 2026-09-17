const BS_APP_BUILD_TAG = 'conflict-diag-v1-2026-09-17';

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