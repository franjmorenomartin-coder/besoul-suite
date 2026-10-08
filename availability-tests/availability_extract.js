const BS_APP_BUILD_TAG = 'agenda-persistencia-p0-2026-10-08';

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

function mensajeErrorGuardadoAgenda(err) {
            const code = err && err.code || '';
            if (code === 'conflict') {
                return (err && err.message) || 'Otra sesión ha guardado cambios de este entrenador que esta pantalla todavía no tenía. Recarga la página antes de reintentar para no perder ese cambio.';
            }
            if (code === 'permission-denied') {
                return 'Tu sesión no tiene permiso para guardar este cambio ahora mismo. Cierra sesión y vuelve a entrar; si sigue sin funcionar, contacta con administración.';
            }
            if (code === 'no-trainer-scope' || code === 'invalid-payload' || code === 'agenda-no-cargada') {
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

            const scope = trainerKeyScope || entrenadorVisto || '';
            const timers = estadoGuardadoAgenda().bsAgendaCloudTimers;

            // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: un temporizador POR trainerKey. Con el único
            // temporizador global de antes, si un admin editaba la agenda de un PT y en menos de
            // 350 ms editaba la de otro, el guardado del primero se cancelaba sin aviso. Además el
            // trainerKey queda marcado como "con cambios sin confirmar" desde este instante, para
            // que un snapshot que llegue durante la espera no borre el cambio de la memoria.
            const estado = estadoGuardadoPendienteScope(scope);
            estado.programado = true;
            clearTimeout(timers[scope]);

            timers[scope] = setTimeout(() => {
                delete timers[scope];
                // guardarEstadoNubeAgenda() incrementa enCola ANTES de que programado vuelva a
                // false, así que el trainerKey nunca queda "sin pendientes" entre medias.
                guardarEstadoNubeAgenda(scope);
                estado.programado = false;
            }, 350);

        }

function aplicarEstadoNubeAgenda(data, opcionesAplicar) {
            const opciones = opcionesAplicar || {};

            if (!data) return;

            // HOTFIX-V1-AGENDA-PERSISTENCIA-P0 (2026-10-08): antes este snapshot sustituía SIEMPRE
            // todo el estado local, incluido el de un trainerKey con un cambio todavía sin guardar
            // (debounce de 350 ms o transacción en curso). Bastaba con que OTRO entrenador guardase
            // algo en ese intervalo (mismo documento monolítico) para que el cambio desapareciera
            // de la memoria y el guardado posterior escribiera la copia del servidor sin él --
            // pérdida silenciosa. Ahora, para cada trainerKey con cambios sin confirmar, se
            // conserva su copia local y su base de concurrencia ANTERIOR (lo que había en el
            // servidor cuando se hizo el cambio). Así:
            //  - si el snapshot trae cambios de OTRO trainerKey, se aplican y el cambio local sigue;
            //  - si trae cambios de ESTE trainerKey hechos por otra sesión, la transacción del
            //    guardado los detecta contra esa base anterior (conflicto -> aviso), exactamente
            //    igual que antes: nunca se sobrescriben a ciegas.
            // Sin ningún snapshot previo (primera carga) no se conserva nada: lo local vendría de la
            // caché localStorage y nunca debe prevalecer sobre el servidor.
            // opciones.descartarPendientes: trainerKeys cuyo cambio local se descarta a propósito
            // (relectura tras un guardado fallido -- la pantalla debe volver a la verdad del servidor).
            const descartar = new Set(opciones.descartarPendientes || []);
            const basePrevia = window.bsUltimoServidorConocido || null;
            const CAMPOS_POR_TRAINER = ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes'];
            const pendientesLocales = {};
            if (basePrevia) {
                const localActual = { clientes: dbClientes, agenda: dbAgenda, pruebasCRM: dbPruebasCRM, disponibilidadReservas: dbDisponibilidadReservas, historicoClientes: dbHistoricoClientes };
                Object.keys(window.bsAgendaGuardadosPendientes || {}).forEach(scope => {
                    if (!scope || descartar.has(scope) || !scopeConCambiosSinConfirmar(scope)) return;
                    pendientesLocales[scope] = {};
                    CAMPOS_POR_TRAINER.forEach(campo => { pendientesLocales[scope][campo] = (localActual[campo] || {})[scope]; });
                });
            }
            const notasPendientes = {};
            if (basePrevia) {
                (window.bsAgendaNotasTocadas || new Set()).forEach(clave => { notasPendientes[clave] = (dbNotas || {})[clave]; });
            }

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
                // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: trainerKeys con cambios sin confirmar conservan
                // su base ANTERIOR (ver comentario al inicio de la función).
                Object.keys(pendientesLocales).forEach(scope => {
                    CAMPOS_POR_TRAINER.forEach(campo => {
                        const previo = (basePrevia[campo] || {})[scope];
                        if (previo === undefined) delete window.bsUltimoServidorConocido[campo][scope];
                        else window.bsUltimoServidorConocido[campo][scope] = JSON.parse(JSON.stringify(previo));
                    });
                });

                // Los entrenadores vienen de besoulUsers, no del documento de agenda.
                // Así evitamos perder el modo admin o el selector si el campo credenciales de agenda quedó antiguo.
                dbCredenciales = sanitizarCredenciales(dbCredenciales || CREDENCIALES_BASE);

                dbClientes = data.clientes || {};

                dbAgenda = data.agenda || {};
                dbPruebasCRM = data.pruebasCRM || {};
                dbDisponibilidadReservas = data.disponibilidadReservas || {};
                dbNotas = data.notas || {};
                dbHistoricoClientes = data.historicoClientes || {};

                // HOTFIX-V1-AGENDA-PERSISTENCIA-P0: se vuelven a poner encima los cambios locales
                // pendientes (por trainerKey y nota a nota), ANTES de inyectar las pruebas CRM.
                const nuevoEstado = { clientes: dbClientes, agenda: dbAgenda, pruebasCRM: dbPruebasCRM, disponibilidadReservas: dbDisponibilidadReservas, historicoClientes: dbHistoricoClientes };
                Object.keys(pendientesLocales).forEach(scope => {
                    CAMPOS_POR_TRAINER.forEach(campo => {
                        const valorLocal = pendientesLocales[scope][campo];
                        if (valorLocal !== undefined) nuevoEstado[campo][scope] = valorLocal;
                    });
                });
                Object.keys(notasPendientes).forEach(clave => {
                    if (typeof notasPendientes[clave] === 'string' && notasPendientes[clave]) dbNotas[clave] = notasPendientes[clave];
                    else delete dbNotas[clave];
                });
                if (Object.keys(pendientesLocales).length || Object.keys(notasPendientes).length) {
                    console.info(`[BESOUL Agenda] Snapshot aplicado conservando cambios locales sin confirmar · trainerKeys=${Object.keys(pendientesLocales).join(',') || '-'} · notas=${Object.keys(notasPendientes).length}`);
                }

                sincronizarPruebasCRMDentroDeAgenda();

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

            const resultado = await guardarEstadoNubeAgenda(entrenadorVisto, { avisoPropio: true });
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