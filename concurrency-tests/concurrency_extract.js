const BS_APP_BUILD_TAG = 'import-excel-clientes-agenda-2026-10-08-r2';

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
            // anidado); desde HOTFIX-V1-AGENDA-PERSISTENCIA-P0 ya no se envía entero, solo las
            // claves que esta pestaña ha cambiado (ver más abajo).
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
                const payload = {
                    [`clientes.${trainerKeyScope}`]: dbClientes[trainerKeyScope] || [],
                    [`agenda.${trainerKeyScope}`]: dbAgenda[trainerKeyScope] || {},
                    [`pruebasCRM.${trainerKeyScope}`]: dbPruebasCRM[trainerKeyScope] || {},
                    [`disponibilidadReservas.${trainerKeyScope}`]: dbDisponibilidadReservas[trainerKeyScope] || {},
                    [`historicoClientes.${trainerKeyScope}`]: dbHistoricoClientes[trainerKeyScope] || {},
                    ultimaActualizacionLocal: new Date().toISOString()
                };
                // HOTFIX-V1-AGENDA-PERSISTENCIA-P0 (2026-10-08): "notas" ya NO se envía entero. Antes,
                // cada guardado de CUALQUIER entrenador reescribía el mapa completo con su copia
                // local, borrando la nota que otro entrenador acabase de guardar y que esta pestaña
                // todavía no había recibido (reproducido en el emulador). Ahora solo viajan las claves
                // que ESTA pestaña ha cambiado (bsAgendaNotasTocadas), una a una ("notas.<clave>"):
                // valor = texto de la nota, null = borrarla (guardarEstadoNubeAgenda() lo convierte en
                // FieldValue.delete()). Sin notas tocadas, el campo "notas" no se toca en absoluto.
                const notasTocadas = (typeof window !== 'undefined' && window.bsAgendaNotasTocadas) || new Set();
                notasTocadas.forEach(clave => {
                    payload[`notas.${clave}`] = (dbNotas && typeof dbNotas[clave] === 'string' && dbNotas[clave]) ? dbNotas[clave] : null;
                });
                return payload;
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

function guardarEstadoNubeAgenda(trainerKeyScope, opcionesGuardado) {
            const opciones = opcionesGuardado || {};
            if (!window.bsAgendaCloudDocRef || window.bsAgendaAplicandoNube) return Promise.resolve({ ok: false, omitido: true });
            const scope = trainerKeyScope || entrenadorVisto || '';
            const estado = estadoGuardadoPendienteScope(scope);
            const cola = estadoGuardadoAgenda().bsAgendaColaGuardado;
            estado.enCola++;
            const anterior = cola[scope] || Promise.resolve();
            const actual = anterior
                .catch(() => {})
                .then(() => ejecutarGuardadoEstadoNubeAgenda(scope))
                .catch(err => ({ ok: false, err }))
                .then(async resultado => {
                    if (!resultado || resultado.ok !== true) {
                        // La gestión del fallo nunca puede romper el contrato de esta función
                        // (la promesa no se rechaza nunca).
                        try { await gestionarGuardadoAgendaFallido(scope, resultado, opciones); }
                        catch (errGestion) { console.error('[BESOUL Agenda] Error gestionando un guardado fallido:', errGestion); }
                    }
                    return resultado;
                })
                .finally(() => {
                    estado.enCola = Math.max(0, estado.enCola - 1);
                    if (cola[scope] === actual) delete cola[scope];
                });
            cola[scope] = actual;
            return actual;
        }

function ejecutarGuardadoEstadoNubeAgenda(trainerKeyScope) {

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
                // P0 2026-09-21: identificador único por INTENTO de guardado (no por sesión), para
                // poder correlacionar un conflicto concreto con el resto de la actividad de esta
                // pestaña en consola sin exponer nada sensible -- es solo un contador+azar, nunca
                // deriva de datos de cliente.
                const saveAttemptId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

                // HARDENING-PRE-BASELINE-v3.2.1: sin trainerKey conocido no hay guardado seguro
                // posible -- estadoLocalAgendaParaNube() devuelve null a propósito en vez del
                // antiguo fallback de documento completo. Fallar aquí, explícito y detectable,
                // en vez de sobrescribir en silencio los datos de TODOS los entrenadores.
                if (!scope) {
                    console.error('[BESOUL Agenda] guardarEstadoNubeAgenda: sin trainerKey de scope (entrenadorVisto vacío) -- guardado BLOQUEADO para evitar sobrescribir el documento completo.');
                    return Promise.resolve({ ok: false, err: { code: 'no-trainer-scope', message: 'No se pudo determinar el entrenador afectado; guardado cancelado por seguridad.' } });
                }

                // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: sin ningún snapshot real aplicado todavía, el
                // estado local viene de la caché localStorage de este dispositivo (posiblemente de
                // días atrás) y no hay base con la que detectar conflictos -- escribirlo podría
                // pisar cambios más recientes hechos desde otro dispositivo. Se bloquea con un
                // aviso explícito en vez de escribir datos potencialmente antiguos.
                if (!window.bsUltimoServidorConocido) {
                    console.error(`[BESOUL Agenda] guardarEstadoNubeAgenda: la agenda aún no se ha cargado del servidor -- guardado BLOQUEADO · trainerKey=${scope}`);
                    return Promise.resolve({ ok: false, err: { code: 'agenda-no-cargada', message: 'La agenda todavía se está cargando desde el servidor. Espera unos segundos y repite el cambio.' } });
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

                // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: lo que se escribe (y lo que después se toma como
                // base de concurrencia) es una copia fija de este instante, nunca los objetos vivos.
                Object.keys(payload).forEach(k => { payload[k] = clonarDatosParaGuardado(payload[k]); });

                // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: notas enviadas clave a clave; null = borrar.
                const notasEnviadas = {};
                Object.keys(payload).forEach(k => {
                    if (!k.startsWith('notas.')) return;
                    notasEnviadas[k.slice('notas.'.length)] = payload[k];
                    if (payload[k] === null) payload[k] = firebase.firestore.FieldValue.delete();
                });

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

                    // P0 2026-09-21 (CUARTA ronda -- FIX real, causa raíz confirmada con evidencia
                    // de producción): la DECISIÓN de conflicto ahora usa igualdadCanonica() --
                    // claves de objeto ordenadas recursivamente, orden de ARRAY preservado -- en vez
                    // de JSON.stringify(a) !== JSON.stringify(b) crudo. El diagnóstico capturado en
                    // producción (trainerScope='fran') mostró rawEqual:false + canonicalEqual:true +
                    // structuralDiff:[] en 4 de los 5 campos simultáneamente: la comparación cruda
                    // estaba bloqueando guardados legítimos por una diferencia de ORDEN DE CLAVES,
                    // nunca de contenido real -- confirmado, no hipótesis. La protección de
                    // concurrencia SIGUE intacta: un cambio de contenido REAL (cualquier valor,
                    // cualquier ruta, dentro del campo/scope comparado) sigue produciendo
                    // canonicalEqual:false y sigue bloqueando el guardado exactamente igual que
                    // antes -- lo único que deja de contar como conflicto es una reordenación de
                    // claves sin ningún cambio de valor. El orden de los ARRAYS sigue siendo
                    // significativo (canonicalizarValorDiagnostico() nunca reordena un array), así
                    // que una reordenación real de elementos (p.ej. citas reordenadas) sigue
                    // detectándose como conflicto.
                    let huboConflicto = false;
                    if (conocidoPrevio) {
                        // P0 2026-09-21 (tercera ronda): UNA sola estructura de diagnóstico,
                        // reutilizada tanto para el console.warn(objeto) como para la línea de
                        // texto plano copiable -- nunca dos sistemas de diagnóstico distintos.
                        // Para CADA campo comparable (coincida o no) se calcula: tipo local/remoto,
                        // igualdad RAW (la que decide el conflicto de verdad), igualdad CANÓNICA
                        // (insensible al orden de claves, puramente informativa), hashes cortos, y
                        // el diff estructural PATH POR PATH (vacío si no hay diferencia). Nunca un
                        // valor real -- solo rutas, tipos, presencia y hashes de 8 hex.
                        const campos = CAMPOS_CONCURRENCIA_COMPARABLES.map(campo => {
                            const valorPrevio = (conocidoPrevio[campo] || {})[scope] ?? null;
                            const valorFresco = (actual[campo] || {})[scope] ?? null;
                            const rawEqual = JSON.stringify(valorPrevio) === JSON.stringify(valorFresco);
                            const canonicalEqual = igualdadCanonica(valorPrevio, valorFresco);
                            return {
                                field: campo,
                                localType: valorPrevio === null ? 'null' : Array.isArray(valorPrevio) ? 'array' : typeof valorPrevio,
                                remoteType: valorFresco === null ? 'null' : Array.isArray(valorFresco) ? 'array' : typeof valorFresco,
                                rawEqual,
                                canonicalEqual,
                                localHash: hashEstableDiagnostico(valorPrevio),
                                remoteHash: hashEstableDiagnostico(valorFresco),
                                localCount: contarElementosDiagnostico(valorPrevio),
                                remoteCount: contarElementosDiagnostico(valorFresco),
                                // Rutas exactas donde difieren DE VERDAD (p.ej.
                                // "clientes.fran[3].notas") -- vacío cuando canonicalEqual es true
                                // (rawEqual:false + canonicalEqual:true ya no implica ninguna
                                // diferencia real que mostrar). Calculado siempre (no solo para los
                                // campos en conflicto) porque el coste es insignificante frente al
                                // tamaño real de un solo trainerKey.
                                structuralDiff: canonicalEqual ? [] : diffEstructuralDiagnostico(valorPrevio, valorFresco, `${campo}.${scope}`),
                            };
                        });
                        // differingFields: diferencia CRUDA (informativa -- ya NO decide el
                        // conflicto). canonicalDifferingFields: diferencia REAL -- esto es lo que
                        // ahora decide si el guardado se bloquea.
                        const differingFields = campos.filter(c => !c.rawEqual).map(c => c.field);
                        const canonicalDifferingFields = campos.filter(c => !c.canonicalEqual).map(c => c.field);
                        // Si un campo es rawEqual:false pero canonicalEqual:true, es sensibilidad al
                        // orden de claves -- con este fix, YA NO bloquea el guardado (se sigue
                        // reportando aquí porque sigue siendo información útil: confirma que el fix
                        // se activó para este intento concreto).
                        const possibleKeyOrderOnlyDifference = campos.some(c => !c.rawEqual && c.canonicalEqual);
                        huboConflicto = canonicalDifferingFields.length > 0;
                        if (differingFields.length > 0 || huboConflicto) {
                            const safeDiagnosticObject = {
                                buildId: BS_APP_BUILD_TAG,
                                saveAttemptId,
                                documentPath: docRef.path,
                                trainerScope: scope,
                                authUid: (firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.uid) || null,
                                entrenadorVisto,
                                rolActivo,
                                baselineExiste: true,
                                serverExiste: snap.exists,
                                timestamps: {
                                    ahoraISO: new Date().toISOString(),
                                    baselineUltimaActualizacionLocal: conocidoPrevio.ultimaActualizacionLocal || null,
                                    serverUltimaActualizacionLocal: actual.ultimaActualizacionLocal || null,
                                    serverActualizadoEn: actual.actualizadoEn ? String(actual.actualizadoEn) : null,
                                },
                                campos,
                                differingFields,
                                canonicalDifferingFields,
                                possibleKeyOrderOnlyDifference,
                                // P0 2026-09-21 (cuarta ronda): el diagnóstico ahora puede emitirse
                                // SIN bloquear el guardado (diferencia cruda pero no canónica, el
                                // fix la deja pasar) -- este campo dice explícitamente si ESTE
                                // intento concreto se bloqueó o se dejó pasar, para poder validar el
                                // fix en producción sin ambigüedad.
                                conflictoBloqueado: huboConflicto,
                            };
                            // Forma expandible (DevTools -- útil si quien mira SÍ puede navegar el
                            // objeto) y forma de texto plano de una sola línea, pensada para poder
                            // seleccionar/copiar directamente sin depender de "Copy object" ni de
                            // ninguna interacción de DevTools más allá de seleccionar texto.
                            console.warn('[BESOUL_SAVE_CONFLICT]', safeDiagnosticObject);
                            console.error('[BESOUL_SAVE_CONFLICT_JSON] ' + JSON.stringify(safeDiagnosticObject));
                        }
                    }

                    if (huboConflicto) {
                        const errConflicto = new Error('Conflicto de concurrencia detectado para trainerKey=' + scope);
                        errConflicto.code = 'conflict';
                        throw errConflicto;
                    }
                    tx.update(docRef, ...payloadParaUpdateFirestore(payload));
                })
                    .then(() => {
                        // ROOT CAUSE real del P0 "conflicto de otra sesión" reportado en QA
                        // 2026-09-21 (tercera vez, tras Ctrl+F5 y sin ninguna otra pestaña/usuario
                        // real de por medio): esta pestaña acaba de escribir con éxito, así que YA
                        // CONOCE el nuevo estado real del servidor para trainerKey=scope -- pero
                        // bsUltimoServidorConocido solo se refrescaba en aplicarEstadoNubeAgenda()
                        // (el listener onSnapshot), que depende de un round-trip de red y NO es
                        // instantáneo. Un segundo guardado normal e inmediatamente consecutivo, de
                        // la MISMA sesión (dos ediciones seguidas, cada una disparando su propio
                        // guardarEstadoNubeAgenda() vía el debounce de programarGuardadoNubeAgenda),
                        // podía ejecutar su transacción ANTES de que el listener hubiera vuelto a
                        // disparar -- comparando entonces contra el baseline de ANTES del primer
                        // guardado, no contra lo que ese primer guardado acababa de escribir.
                        // Reproducido de forma determinista con las funciones reales extraídas
                        // contra el Emulator Suite, sin ninguna Rule ni índice involucrados (ver
                        // rules-tests/run_double_save_race_repro.cjs) -- dos guardados legítimos y
                        // consecutivos desde una única pestaña, el segundo fallaba con
                        // code:'conflict' porque comparaba contra un baseline obsoleto, no porque
                        // hubiera ningún conflicto real. Este bloque cierra esa ventana: actualiza
                        // SOLO la porción [campo][scope] que esta pestaña acaba de escribir,
                        // preservando lo que ya se sabía de cualquier OTRO trainerKey. Un conflicto
                        // REAL de otra sesión sigue detectándose igual que antes: si otra pestaña
                        // escribe de verdad entre medias, el próximo tx.get() de ESTA pestaña verá
                        // un valor de servidor que YA NO coincide con lo que ella misma cree haber
                        // escrito la última vez.
                        const previo = window.bsUltimoServidorConocido || {};
                        const actualizado = {};
                        CAMPOS_CONCURRENCIA_COMPARABLES.forEach(campo => {
                            actualizado[campo] = { ...(previo[campo] || {}) };
                            actualizado[campo][scope] = payload[`${campo}.${scope}`];
                        });
                        // Copia profunda obligatoria (mismo motivo que la captura inicial en
                        // aplicarEstadoNubeAgenda(): nunca compartir referencia con dbClientes/
                        // dbAgenda/etc., que se siguen mutando en el sitio en cuanto el usuario
                        // edite algo más -- ver el comentario "IMPORTANTE (2)" de esa función).
                        window.bsUltimoServidorConocido = JSON.parse(JSON.stringify(actualizado));
                        // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: notas ya confirmadas -- dejan de estar
                        // pendientes salvo que se hayan vuelto a cambiar mientras se guardaban.
                        Object.keys(notasEnviadas).forEach(clave => {
                            const actualLocal = (dbNotas && typeof dbNotas[clave] === 'string' && dbNotas[clave]) ? dbNotas[clave] : null;
                            if (actualLocal === notasEnviadas[clave]) estadoGuardadoAgenda().bsAgendaNotasTocadas.delete(clave);
                        });
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

async function gestionarGuardadoAgendaFallido(scope, resultado, opcionesFallo) {
            const opciones = opcionesFallo || {};
            const err = (resultado && resultado.err) || { code: resultado && resultado.omitido ? 'omitido' : 'desconocido', message: 'El guardado no se ha completado.' };
            console.error(`[BESOUL Agenda] Cambio NO guardado · trainerKey=${scope} · code=${err.code || '(sin código)'} · message=${err.message || ''}`);
            // Las notas tocadas formaban parte del cambio que no se ha guardado: se descartan
            // junto con él, para que la pantalla vuelva a coincidir con el servidor.
            estadoGuardadoAgenda().bsAgendaNotasTocadas.clear();
            try {
                if (window.bsAgendaCloudDocRef && typeof window.bsAgendaCloudDocRef.get === 'function') {
                    const snap = await window.bsAgendaCloudDocRef.get({ source: 'server' });
                    if (snap.exists) aplicarEstadoNubeAgenda(snap.data(), { descartarPendientes: [scope] });
                }
            } catch (errRelectura) {
                console.error('[BESOUL Agenda] No se pudo releer la agenda del servidor tras un guardado fallido:', errRelectura);
            }
            if (!opciones.avisoPropio) avisarCambioAgendaNoGuardado(err, scope);
        }

function estadoGuardadoAgenda() {
            if (!window.bsAgendaGuardadosPendientes) window.bsAgendaGuardadosPendientes = {};
            if (!window.bsAgendaColaGuardado) window.bsAgendaColaGuardado = {};
            if (!window.bsAgendaCloudTimers) window.bsAgendaCloudTimers = {};
            if (!window.bsAgendaNotasTocadas) window.bsAgendaNotasTocadas = new Set();
            return window;
        }

function estadoGuardadoPendienteScope(scope) {
            const w = estadoGuardadoAgenda();
            if (!w.bsAgendaGuardadosPendientes[scope]) w.bsAgendaGuardadosPendientes[scope] = { programado: false, enCola: 0 };
            return w.bsAgendaGuardadosPendientes[scope];
        }

function scopeConCambiosSinConfirmar(scope) {
            const estado = (window.bsAgendaGuardadosPendientes || {})[scope];
            return !!estado && (estado.programado || estado.enCola > 0);
        }

function avisarCambioAgendaNoGuardado(err, scope) {
            const ahora = Date.now();
            if (window.bsAgendaUltimoAvisoNoGuardado && ahora - window.bsAgendaUltimoAvisoNoGuardado < 4000) return;
            window.bsAgendaUltimoAvisoNoGuardado = ahora;
            const entrenador = scope ? ` (agenda de ${nombreEntrenador(scope)})` : '';
            const esConflicto = !!err && err.code === 'conflict';
            const motivo = esConflicto
                ? 'Otra sesión (otra pestaña, otro dispositivo o administración) ha guardado cambios en esta misma agenda a la vez y, para no borrarlos, tu cambio se ha cancelado. La agenda se ha actualizado con lo que hay guardado ahora mismo: revísala y, si hace falta, repite el cambio.'
                : mensajeErrorGuardadoAgenda(err);
            alert(`ATENCIÓN: tu último cambio${entrenador} NO se ha guardado. ${motivo}`);
        }

function clonarDatosParaGuardado(valor) {
            if (Array.isArray(valor)) return valor.map(clonarDatosParaGuardado);
            if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
                const copia = {};
                Object.keys(valor).forEach(k => { copia[k] = clonarDatosParaGuardado(valor[k]); });
                return copia;
            }
            return valor;
        }

function canonicalizarValorDiagnostico(v) {
            if (Array.isArray(v)) return v.map(canonicalizarValorDiagnostico);
            if (v && typeof v === 'object') {
                if (v instanceof Date) return v.toISOString();
                if (v._methodName) return `<FieldValue:${v._methodName}>`;
                // Firestore Timestamp (compat SDK): no es instanceof Date ni una FieldValue sin
                // resolver -- expone toDate() y seconds/nanoseconds (o _seconds/_nanoseconds según
                // versión). Ninguno de los 5 campos comparables almacena hoy un Timestamp real (este
                // proyecto usa siempre ISO strings para fechas de negocio -- confirmado en el código
                // fuente), pero se normaliza de todos modos por robustez, con el mismo criterio que
                // Date: a ISO string, nunca comparado por identidad de instancia.
                if (typeof v.toDate === 'function' && (typeof v.seconds === 'number' || typeof v._seconds === 'number')) {
                    return v.toDate().toISOString();
                }
                const claves = Object.keys(v).sort();
                const out = {};
                claves.forEach(k => { out[k] = canonicalizarValorDiagnostico(v[k]); });
                return out;
            }
            return v === undefined ? '<undefined>' : v;
        }

function igualdadCanonica(a, b) {
            return JSON.stringify(canonicalizarValorDiagnostico(a)) === JSON.stringify(canonicalizarValorDiagnostico(b));
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

function diffEstructuralDiagnostico(local, remoto, ruta = '', salida = [], limite = 25) {
            if (salida.length >= limite) return salida;
            const tipoLocal = local === undefined ? 'undefined' : (local === null ? 'null' : Array.isArray(local) ? 'array' : typeof local);
            const tipoRemoto = remoto === undefined ? 'undefined' : (remoto === null ? 'null' : Array.isArray(remoto) ? 'array' : typeof remoto);

            if (tipoLocal !== tipoRemoto) {
                salida.push({ ruta: ruta || '(raíz)', motivo: 'tipo-distinto', tipoLocal, tipoRemoto, hashLocal: hashEstableDiagnostico(local), hashRemoto: hashEstableDiagnostico(remoto) });
                return salida;
            }
            if (tipoLocal === 'array') {
                if (local.length !== remoto.length) {
                    salida.push({ ruta: ruta || '(raíz)', motivo: 'longitud-array-distinta', longitudLocal: local.length, longitudRemoto: remoto.length });
                }
                const max = Math.min(local.length, remoto.length);
                for (let i = 0; i < max && salida.length < limite; i++) {
                    diffEstructuralDiagnostico(local[i], remoto[i], `${ruta}[${i}]`, salida, limite);
                }
                return salida;
            }
            if (tipoLocal === 'object') {
                const claves = new Set([...Object.keys(local), ...Object.keys(remoto)]);
                for (const k of claves) {
                    if (salida.length >= limite) break;
                    const subruta = ruta ? `${ruta}.${k}` : k;
                    if (!(k in local)) { salida.push({ ruta: subruta, motivo: 'solo-en-remoto' }); continue; }
                    if (!(k in remoto)) { salida.push({ ruta: subruta, motivo: 'solo-en-local' }); continue; }
                    diffEstructuralDiagnostico(local[k], remoto[k], subruta, salida, limite);
                }
                return salida;
            }
            // Hoja (string/number/boolean/null/undefined): mismo primitivo igualdadCanonica() que
            // la decisión real -- nunca un segundo criterio de igualdad, ni siquiera para hojas.
            if (!igualdadCanonica(local, remoto)) {
                salida.push({ ruta: ruta || '(raíz)', motivo: 'valor-distinto', tipoLocal, tipoRemoto, hashLocal: hashEstableDiagnostico(local), hashRemoto: hashEstableDiagnostico(remoto) });
            }
            return salida;
        }