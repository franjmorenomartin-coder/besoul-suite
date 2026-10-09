const BS_APP_BUILD_TAG = 'agenda-sync-p0-2026-10-09';

const BS_AGENDA_GUARDADO_TIMEOUT_MS = 20000;

const BS_CAMPOS_AGENDA_POR_TRAINER = ['clientes', 'agenda', 'pruebasCRM', 'disponibilidadReservas', 'historicoClientes'];

const BS_DISP_SUBMAPAS = ['semanal', 'excepciones', 'bloqueos'];

const BS_DISP_METADATOS = ['actualizadoEn', 'actualizadoPor'];

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

function actualizarIndicadorGuardadoAgenda() {
            const el = elementoIndicadorGuardadoAgenda();
            if (!el) return;
            const app = document.getElementById('app-content');
            if (!app || app.classList.contains('hidden')) { el.style.display = 'none'; return; }
            const estados = Object.values(window.bsAgendaGuardadosPendientes || {});
            const sinGuardar = estados.some(e => e && e.reintentar);
            const guardando = estados.some(e => e && (e.programado || e.enCola > 0));
            const sinConexion = window.bsAgendaSincronizacion === 'error' || window.bsAgendaSincronizacion === 'cache';
            let texto, colores, boton = '';
            if (sinGuardar) {
                texto = guardando ? 'Reintentando guardar... Hay cambios SIN GUARDAR en el servidor' : 'Cambios SIN GUARDAR en el servidor (sin conexión). No cierres la página.';
                colores = ['#450a0a', '#fca5a5', '#ef4444'];
                if (!guardando) boton = '<button type="button" onclick="reintentarGuardadosAgenda()" style="background:#ef4444;color:#fff;border:0;border-radius:999px;padding:2px 8px;font:inherit;cursor:pointer">Reintentar</button>';
            } else if (guardando) {
                texto = 'Guardando en el servidor...';
                colores = ['#422006', '#fcd34d', '#f59e0b'];
            } else if (sinConexion) {
                texto = window.bsAgendaSincronizacion === 'error' ? 'Sin conexión con el servidor: reconectando. La agenda puede no estar al día.' : 'Sin conexión con el servidor: la agenda puede no estar al día.';
                colores = ['#450a0a', '#fca5a5', '#ef4444'];
            } else if (window.bsAgendaUltimoGuardadoOk) {
                const h = new Date(window.bsAgendaUltimoGuardadoOk);
                texto = `Guardado en el servidor · ${String(h.getHours()).padStart(2, '0')}:${String(h.getMinutes()).padStart(2, '0')}:${String(h.getSeconds()).padStart(2, '0')}`;
                colores = ['#052e16', '#86efac', '#22c55e'];
            } else {
                el.style.display = 'none';
                return;
            }
            el.style.display = 'flex';
            el.style.background = colores[0]; el.style.color = colores[1]; el.style.borderColor = colores[2];
            el.title = `Versión ${typeof BS_APP_BUILD_TAG !== 'undefined' ? BS_APP_BUILD_TAG : ''}`;
            el.innerHTML = `<span>${escapeHTML(texto)}</span>${boton}`;
        }

function elementoIndicadorGuardadoAgenda() {
            if (typeof document === 'undefined' || !document.body) return null;
            let el = document.getElementById('bs-estado-guardado');
            if (el) return el;
            el = document.createElement('div');
            el.id = 'bs-estado-guardado';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:40;max-width:calc(100vw - 24px);font:600 11px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:999px;border:1px solid;display:none;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,.35)';
            document.body.appendChild(el);
            return el;
        }

function reintentarGuardadosAgenda() {
            Object.keys(window.bsAgendaGuardadosPendientes || {}).forEach(scope => {
                const estado = window.bsAgendaGuardadosPendientes[scope];
                if (estado && estado.reintentar && !estado.programado && !(estado.enCola > 0)) guardarEstadoNubeAgenda(scope);
            });
            actualizarIndicadorGuardadoAgenda();
        }

function errorGuardadoAgendaReintentable(err) {
            const code = (err && err.code) || '';
            return ['unavailable', 'deadline-exceeded', 'aborted', 'resource-exhausted'].includes(code)
                || /client is offline|network|Failed to fetch/i.test((err && err.message) || '');
        }

function referenciaMemoriaCampoAgenda(campo) {
            return { clientes: dbClientes, agenda: dbAgenda, pruebasCRM: dbPruebasCRM, disponibilidadReservas: dbDisponibilidadReservas, historicoClientes: dbHistoricoClientes }[campo];
        }

function guardarMemoriaAgendaEnLocalStorage() {
            try {
                localStorage.setItem('bs_db_clientes_v6', JSON.stringify(dbClientes));
                localStorage.setItem('bs_db_agenda_v6', JSON.stringify(dbAgenda));
                localStorage.setItem('bs_db_pruebas_crm_v6', JSON.stringify(dbPruebasCRM));
                localStorage.setItem('bs_db_disponibilidad_reservas_v6', JSON.stringify(dbDisponibilidadReservas));
                localStorage.setItem('bs_db_historico_clientes_v6', JSON.stringify(dbHistoricoClientes));
            } catch (e) { console.warn('[BESOUL Agenda] No se pudo actualizar la copia local:', e); }
        }

function repintarAgendaSiVisible(scope) {
            if (typeof document === 'undefined') return;
            const app = document.getElementById('app-content');
            if (!app || app.classList.contains('hidden') || (scope && scope !== entrenadorVisto)) return;
            recalcularKPIs(); renderClientes(); renderAgenda();
        }

function rebasarMemoriaScopeAgenda(scope, payloadEnviado, escritoPorCampo) {
            let cambioVisible = false;
            BS_CAMPOS_AGENDA_POR_TRAINER.forEach(campo => {
                const mapa = referenciaMemoriaCampoAgenda(campo);
                if (!mapa) return;
                const memoria = mapa[scope];
                const confirmado = escritoPorCampo[campo];
                if (igualdadCanonica(memoria === undefined ? null : memoria, confirmado === undefined ? null : confirmado)) return;
                const r = fusionarCampoTresVias(campo, payloadEnviado[`${campo}.${scope}`], memoria, confirmado);
                if (igualdadCanonica(r.valor, memoria === undefined ? null : memoria)) return;
                mapa[scope] = JSON.parse(JSON.stringify(r.valor));
                cambioVisible = true;
            });
            if (cambioVisible) {
                if (typeof sincronizarPruebasCRMDentroDeAgenda === 'function') sincronizarPruebasCRMDentroDeAgenda();
                guardarMemoriaAgendaEnLocalStorage();
                repintarAgendaSiVisible(scope);
            }
        }

function descartarCambiosLocalesScopeAgenda(scope) {
            const base = window.bsUltimoServidorConocido;
            if (!base) return;
            BS_CAMPOS_AGENDA_POR_TRAINER.forEach(campo => {
                const mapa = referenciaMemoriaCampoAgenda(campo);
                if (!mapa) return;
                const valor = (base[campo] || {})[scope];
                if (valor === undefined) delete mapa[scope];
                else mapa[scope] = JSON.parse(JSON.stringify(valor));
            });
            if (typeof sincronizarPruebasCRMDentroDeAgenda === 'function') sincronizarPruebasCRMDentroDeAgenda();
            guardarMemoriaAgendaEnLocalStorage();
            repintarAgendaSiVisible(scope);
        }

function avisarCambioAgendaSinConfirmar(scope) {
            const entrenador = scope ? ` en la agenda de ${nombreEntrenador(scope)}` : '';
            alert(`ATENCIÓN: no hay conexión con el servidor y tus últimos cambios${entrenador} TODAVÍA NO ESTÁN GUARDADOS.\n\nSe conservan en esta pantalla y se guardarán al recuperar la conexión (o pulsa «Reintentar» en el aviso rojo de abajo). No cierres ni recargues la página hasta que veas «Guardado en el servidor».`);
        }

function esObjetoPlanoAgenda(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function elementosCampoAgenda(campo, valor) {
            const salida = new Map();
            if (valor === undefined || valor === null) return salida;
            if (campo === 'clientes') {
                if (!Array.isArray(valor)) return null;
                for (const ficha of valor) {
                    const id = ficha && ficha.id;
                    if (!id || salida.has(`id:${id}`)) return null;
                    salida.set(`id:${id}`, ficha);
                }
                return salida;
            }
            if (!esObjetoPlanoAgenda(valor)) return null;
            if (campo === 'disponibilidadReservas') {
                for (const k of Object.keys(valor)) {
                    if (BS_DISP_SUBMAPAS.includes(k) && esObjetoPlanoAgenda(valor[k])) {
                        salida.set(`sub:${k}`, true);
                        Object.keys(valor[k]).forEach(sk => salida.set(`${k}:${sk}`, valor[k][sk]));
                    } else {
                        salida.set(`top:${k}`, valor[k]);
                    }
                }
                return salida;
            }
            Object.keys(valor).forEach(k => salida.set(`k:${k}`, valor[k]));
            return salida;
        }

function recomponerCampoAgenda(campo, entradas) {
            if (campo === 'clientes') return entradas.map(([, v]) => v);
            const out = {};
            if (campo === 'disponibilidadReservas') {
                entradas.forEach(([clave, v]) => {
                    const sep = clave.indexOf(':');
                    const tipo = clave.slice(0, sep), resto = clave.slice(sep + 1);
                    if (tipo === 'top') out[resto] = v;
                    else if (tipo === 'sub') { if (!out[resto]) out[resto] = {}; }
                    else { if (!out[tipo]) out[tipo] = {}; out[tipo][resto] = v; }
                });
                return out;
            }
            entradas.forEach(([clave, v]) => { out[clave.slice(2)] = v; });
            return out;
        }

function valorVacioCampoAgenda(campo) { return campo === 'clientes' ? [] : {}; }

function fusionarCampoTresVias(campo, base, local, servidor) {
            const b = base === undefined ? null : base;
            const l = local === undefined ? null : local;
            const s = servidor === undefined ? null : servidor;
            // Atajos (el caso normal): nadie más ha tocado este entrenador, o esta pestaña no ha tocado nada.
            if (igualdadCanonica(b, s)) return { valor: l === null ? valorVacioCampoAgenda(campo) : l, baseNueva: s, conflictos: [], cambiado: !igualdadCanonica(l, s) };
            if (igualdadCanonica(l, b) || igualdadCanonica(l, s)) return { valor: s === null ? valorVacioCampoAgenda(campo) : s, baseNueva: s, conflictos: [], cambiado: false };

            const eb = elementosCampoAgenda(campo, b), el = elementosCampoAgenda(campo, l), es = elementosCampoAgenda(campo, s);
            if (!eb || !el || !es) {
                // Forma no descomponible y cambios de ambos lados: conflicto de campo completo.
                return { valor: l, baseNueva: b, conflictos: [`campo:${campo}`], cambiado: true };
            }
            // Orden: el del servidor, y después lo nuevo de esta pestaña en su orden local.
            const orden = [...es.keys()];
            el.forEach((_, k) => { if (!es.has(k)) orden.push(k); });
            eb.forEach((_, k) => { if (!es.has(k) && !el.has(k)) orden.push(k); });
            // Mover una sesión = quitarla de su hueco y crearla en otro. Si las dos sesiones la quitan
            // del MISMO hueco y la llevan a destinos distintos (o una la mueve y la otra la borra),
            // fusionar por hueco dejaría dos copias (o resucitaría una borrada): es el mismo
            // elemento cambiado por ambos -> conflicto real (reproducido: sync.cjs S13).
            const movidasEnConflicto = new Set();
            if (campo === 'agenda' || campo === 'pruebasCRM') {
                const idDe = v => (v && typeof v === 'object' ? String(v.id || v.leadId || '') : '');
                const nuevasL = [...el.keys()].filter(c => !eb.has(c));
                const nuevasS = [...es.keys()].filter(c => !eb.has(c));
                eb.forEach((vb, clave) => {
                    if (el.has(clave) || es.has(clave)) return;
                    const id = idDe(vb);
                    if (!id) return;
                    const destinosL = nuevasL.filter(c => idDe(el.get(c)) === id).sort();
                    const destinosS = nuevasS.filter(c => idDe(es.get(c)) === id).sort();
                    if ((destinosL.length || destinosS.length) && JSON.stringify(destinosL) !== JSON.stringify(destinosS)) movidasEnConflicto.add(clave);
                });
            }
            // Una sesión dura 45 min (3 tramos): dos sesiones NUEVAS en huecos distintos pero
            // solapados (una de cada sesión de usuario) serían una doble reserva -> conflicto.
            if (campo === 'agenda') {
                const esHueco = c => /^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(c);
                const tramos = (c, v) => new Set(clavesBloqueSesion(c, (v && v.duracionMin) || 45));
                const nuevasL = [...el.keys()].filter(c => !eb.has(c) && !es.has(c) && esHueco(c.slice(2)));
                const nuevasS = [...es.keys()].filter(c => !eb.has(c) && !el.has(c) && esHueco(c.slice(2)));
                nuevasL.forEach(cl => {
                    const tl = tramos(cl.slice(2), el.get(cl));
                    if (nuevasS.some(cs => [...tramos(cs.slice(2), es.get(cs))].some(t => tl.has(t)))) movidasEnConflicto.add(cl);
                });
            }
            const resultado = [], baseResultado = [], conflictos = [];
            orden.forEach(clave => {
                const vb = eb.has(clave) ? eb.get(clave) : undefined;
                const vl = el.has(clave) ? el.get(clave) : undefined;
                const vs = es.has(clave) ? es.get(clave) : undefined;
                let r = vs, rb = vs;
                if (movidasEnConflicto.has(clave)) { r = vl; rb = vb; conflictos.push(clave); }
                else if (igualdadCanonica(vl, vb)) { r = vs; }
                else if (igualdadCanonica(vs, vb) || igualdadCanonica(vl, vs)) { r = vl; }
                else if (campo === 'disponibilidadReservas' && BS_DISP_METADATOS.includes(clave.slice(4))) { r = vl; }
                else { r = vl; rb = vb; conflictos.push(clave); }
                if (r !== undefined) resultado.push([clave, r]);
                if (rb !== undefined) baseResultado.push([clave, rb]);
            });
            // Con un conflicto real no se fusiona NADA de ese campo: se conserva lo local y la base
            // anterior completas, de modo que el guardado vuelve a ver exactamente el mismo conflicto
            // (si se absorbiera en la base lo ajeno, p.ej. una sesión solapada, dejaría de detectarse).
            if (conflictos.length) return { valor: l, baseNueva: b, conflictos, cambiado: true };
            const valor = recomponerCampoAgenda(campo, resultado);
            return { valor, baseNueva: recomponerCampoAgenda(campo, baseResultado), conflictos, cambiado: !igualdadCanonica(valor, s) };
        }

function describirElementoAgenda(campo, clave, trainerKey) {
            const sep = clave.indexOf(':');
            const tipo = clave.slice(0, sep), resto = clave.slice(sep + 1);
            const fechaHora = txt => { const p = String(txt).split('_'); return p.length > 1 ? `${p[0]} ${p[1]}` : txt; };
            if (tipo === 'campo') return `todos los datos de "${resto}"`;
            if (campo === 'agenda') return `la sesión del ${fechaHora(resto)}`;
            if (campo === 'pruebasCRM') return `la prueba CRM del ${fechaHora(resto)}`;
            if (campo === 'historicoClientes') return `el histórico ${resto}`;
            if (campo === 'clientes') {
                const ficha = (dbClientes[trainerKey] || []).find(c => c && c.id === resto);
                return `la ficha de ${ficha && ficha.nombre ? ficha.nombre : resto}`;
            }
            if (campo === 'disponibilidadReservas') {
                if (tipo === 'semanal') return `la disponibilidad semanal del ${['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][Number(resto)] || resto}`;
                if (tipo === 'excepciones') return `la disponibilidad del día ${resto}`;
                if (tipo === 'bloqueos') return `los slots ocultos del día ${resto}`;
                return 'la configuración de disponibilidad';
            }
            return `${campo} ${resto}`;
        }

function clavesBloqueSesion(clave, duracionMin = 45) {
            const partes = String(clave || '').split('_');
            if (partes.length < 2) return [];
            const fechaISO = partes[0];
            const inicio = minutosDesdeHorario(partes[1]);
            if (Number.isNaN(inicio)) return [];
            const paso = 15;
            const finAgenda = 22 * 60;
            const duracion = parseInt(duracionMin, 10) || 45;
            if (inicio + duracion > finAgenda) return [];
            const claves = [];
            for (let m = inicio; m < inicio + duracion; m += paso) {
                claves.push(claveDesdeFechaYMinutos(fechaISO, m));
            }
            return claves;
        }

function claveDesdeFechaYMinutos(fechaISO, minutos) {
            return `${fechaISO}_${formatoMinutosHorario(minutos)}`;
        }

function minutosDesdeHorario(hora) {
            const partes = String(hora || '').split(':');
            if (partes.length !== 2) return NaN;
            const h = parseInt(partes[0], 10);
            const m = parseInt(partes[1], 10);
            if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
            return h * 60 + m;
        }

function formatoMinutosHorario(totalMinutos) {

            const horas = Math.floor(totalMinutos / 60);

            const minutos = totalMinutos % 60;

            return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;

        }

function publicarReservasPublicasDebounced() {
            clearTimeout(window.bsReservasPublishTimer);
            window.bsReservasPublishTimer = setTimeout(publicarReservasPublicas, 800);
        }

function guardarEstadoNubeAgenda(trainerKeyScope, opcionesGuardado) {
            const opciones = opcionesGuardado || {};
            if (!window.bsAgendaCloudDocRef || window.bsAgendaAplicandoNube) return Promise.resolve({ ok: false, omitido: true });
            const scope = trainerKeyScope || entrenadorVisto || '';
            const estado = estadoGuardadoPendienteScope(scope);
            const cola = estadoGuardadoAgenda().bsAgendaColaGuardado;
            estado.enCola++;
            actualizarIndicadorGuardadoAgenda();
            const anterior = cola[scope] || Promise.resolve();
            const actual = anterior
                .catch(() => {})
                .then(() => ejecutarGuardadoEstadoNubeAgenda(scope))
                .catch(err => ({ ok: false, err }))
                .then(async resultado => {
                    if (resultado && resultado.ok === true) {
                        // HOTFIX-V1-AGENDA-SYNC-P0: confirmado por el servidor -- solo ahora se
                        // muestra "Guardado" y se olvida un posible reintento pendiente.
                        estado.reintentar = false;
                        estado.ultimoOk = true;
                        window.bsAgendaUltimoGuardadoOk = Date.now();
                    } else {
                        estado.ultimoOk = false;
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
                    actualizarIndicadorGuardadoAgenda();
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
                // HOTFIX-V1-AGENDA-SYNC-P0 (2026-10-09): la transacción ya no cancela el guardado por
                // CUALQUIER cambio ajeno en este entrenador; FUSIONA por elemento (ver
                // fusionarCampoTresVias) y solo cancela si otra sesión cambió el MISMO elemento
                // (conflicto real, explicado al usuario con el nombre del elemento). Lo que se escribe
                // es siempre "servidor actual + cambios de esta pestaña", calculado dentro de la
                // transacción: un cambio ajeno ya confirmado nunca se sobrescribe.
                const baseConocida = window.bsUltimoServidorConocido;
                const docRef = window.bsAgendaCloudDocRef;
                let escritoPorCampo = null;

                const transaccion = docRef.firestore.runTransaction(async tx => {
                    const snap = await tx.get(docRef);
                    const actual = snap.exists ? (snap.data() || {}) : {};
                    const escritura = {};
                    const conflictos = [];
                    const escrito = {};
                    BS_CAMPOS_AGENDA_POR_TRAINER.forEach(campo => {
                        const ruta = `${campo}.${scope}`;
                        const servidorCampo = (actual[campo] || {})[scope];
                        const r = fusionarCampoTresVias(campo, (baseConocida[campo] || {})[scope], payload[ruta], servidorCampo);
                        r.conflictos.forEach(clave => conflictos.push({ campo, clave }));
                        escrito[campo] = r.valor;
                        if (r.cambiado) escritura[ruta] = r.valor;
                    });
                    if (conflictos.length) {
                        const errConflicto = new Error('Conflicto de concurrencia detectado para trainerKey=' + scope);
                        errConflicto.code = 'conflict';
                        errConflicto.conflictos = conflictos;
                        throw errConflicto;
                    }
                    Object.keys(payload).forEach(k => { if (k.startsWith('notas.')) escritura[k] = payload[k]; });
                    if (Object.keys(escritura).length) {
                        escritura.ultimaActualizacionLocal = payload.ultimaActualizacionLocal;
                        escritura.actualizadoEn = payload.actualizadoEn;
                        tx.update(docRef, ...payloadParaUpdateFirestore(escritura));
                    }
                    escritoPorCampo = escrito;
                });

                // Nunca un "Guardando..." indefinido: si el servidor no confirma en este plazo, el
                // guardado se da por NO confirmado (los cambios se conservan; ver
                // gestionarGuardadoAgendaFallido). Si la transacción llegara a confirmarse después, el
                // reintento lo detecta (fusión: el elemento ya está igual en el servidor).
                let temporizador = null;
                const limite = new Promise((_, rechazar) => {
                    temporizador = setTimeout(() => {
                        const errTiempo = new Error('El servidor no ha confirmado el guardado a tiempo.');
                        errTiempo.code = 'deadline-exceeded';
                        rechazar(errTiempo);
                    }, BS_AGENDA_GUARDADO_TIMEOUT_MS);
                });

                return Promise.race([transaccion, limite])
                    .finally(() => clearTimeout(temporizador))
                    .then(() => {
                        // Nueva base de concurrencia de este entrenador = lo que se acaba de confirmar.
                        const previo = window.bsUltimoServidorConocido || {};
                        const actualizado = {};
                        BS_CAMPOS_AGENDA_POR_TRAINER.forEach(campo => {
                            actualizado[campo] = { ...(previo[campo] || {}) };
                            actualizado[campo][scope] = escritoPorCampo[campo];
                        });
                        window.bsUltimoServidorConocido = JSON.parse(JSON.stringify(actualizado));
                        // La memoria pasa a ser lo confirmado (que ya incluye los cambios ajenos
                        // fusionados) + lo que el usuario haya cambiado DESPUÉS de construir este
                        // guardado (eso lo enviará el siguiente guardado de la cola).
                        rebasarMemoriaScopeAgenda(scope, payload, escritoPorCampo);
                        Object.keys(notasEnviadas).forEach(clave => {
                            const actualLocal = (dbNotas && typeof dbNotas[clave] === 'string' && dbNotas[clave]) ? dbNotas[clave] : null;
                            if (actualLocal === notasEnviadas[clave]) estadoGuardadoAgenda().bsAgendaNotasTocadas.delete(clave);
                        });
                        // El portal público se publica aparte (con espera), fuera de la cola de
                        // guardado: antes cada guardado esperaba a releer el documento entero y a
                        // publicar los datos de TODOS los entrenadores antes de confirmarse, y los
                        // guardados siguientes esperaban detrás (lentitud reportada).
                        publicarReservasPublicasDebounced();
                        return { ok: true };
                    })
                    .catch(err => {
                        if (err && err.code === 'conflict') {
                            const elementos = (err.conflictos || []).map(c => describirElementoAgenda(c.campo, c.clave, scope));
                            const unicos = Array.from(new Set(elementos));
                            console.error(`[BESOUL Agenda] guardarEstadoNubeAgenda: CONFLICTO real para trainerKey=${scope} -- otra sesión cambió los mismos elementos: ${(err.conflictos || []).map(c => `${c.campo}/${c.clave}`).join(', ')}`);
                            const lista = unicos.slice(0, 5).join(', ') + (unicos.length > 5 ? ` y ${unicos.length - 5} más` : '');
                            return { ok: false, err: { code: 'conflict', conflictos: err.conflictos || [], message: `Otra persona (otra sesión, otro dispositivo o administración) ha modificado a la vez ${lista || 'los mismos datos'}. Para no borrar su cambio, el tuyo NO se ha guardado. La agenda muestra ya lo que hay guardado en el servidor: revísalo y, si hace falta, repite tu cambio.` } };
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
            const estado = estadoGuardadoPendienteScope(scope);
            console.error(`[BESOUL Agenda] Cambio NO guardado · trainerKey=${scope} · code=${err.code || '(sin código)'} · message=${err.message || ''}`);

            // HOTFIX-V1-AGENDA-SYNC-P0: sin respuesta del servidor (sin conexión, tiempo agotado,
            // contención) el cambio sigue siendo válido: se CONSERVA en esta pantalla, marcado como
            // "sin guardar", y se reintenta al volver la conexión o con el botón "Reintentar". El
            // reintento es seguro: fusiona contra lo que haya entonces en el servidor y nunca pisa
            // lo que otros hayan guardado mientras tanto. Solo en guardados con su propio formulario
            // abierto (avisoPropio) se descarta, porque el formulario sigue abierto para repetirlo.
            if (!opciones.avisoPropio && errorGuardadoAgendaReintentable(err) && window.bsUltimoServidorConocido) {
                const yaAvisado = estado.reintentar === true;
                estado.reintentar = true;
                actualizarIndicadorGuardadoAgenda();
                if (!yaAvisado) avisarCambioAgendaSinConfirmar(scope);
                return;
            }
            estado.reintentar = false;

            // Las notas tocadas formaban parte del cambio que no se ha guardado: se descartan
            // junto con él, para que la pantalla vuelva a coincidir con el servidor.
            estadoGuardadoAgenda().bsAgendaNotasTocadas.clear();
            let releido = false;
            try {
                if (window.bsAgendaCloudDocRef && typeof window.bsAgendaCloudDocRef.get === 'function') {
                    let temporizador = null;
                    const snap = await Promise.race([
                        window.bsAgendaCloudDocRef.get({ source: 'server' }),
                        new Promise((_, rechazar) => { temporizador = setTimeout(() => rechazar(new Error('relectura sin respuesta')), 8000); }),
                    ]).finally(() => clearTimeout(temporizador));
                    if (snap.exists) { aplicarEstadoNubeAgenda(snap.data(), { descartarPendientes: [scope] }); releido = true; }
                }
            } catch (errRelectura) {
                console.error('[BESOUL Agenda] No se pudo releer la agenda del servidor tras un guardado fallido:', errRelectura);
            }
            // Sin relectura posible, se vuelve a lo último confirmado por el servidor (nunca a una
            // copia anterior guardada por la función que hizo el cambio).
            if (!releido) descartarCambiosLocalesScopeAgenda(scope);
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
            if (!w.bsAgendaGuardadosPendientes[scope]) w.bsAgendaGuardadosPendientes[scope] = { programado: false, enCola: 0, reintentar: false };
            return w.bsAgendaGuardadosPendientes[scope];
        }

function scopeConCambiosSinConfirmar(scope) {
            const estado = (window.bsAgendaGuardadosPendientes || {})[scope];
            return !!estado && (estado.programado || estado.enCola > 0 || estado.reintentar === true);
        }

function avisarCambioAgendaNoGuardado(err, scope) {
            const ahora = Date.now();
            if (window.bsAgendaUltimoAvisoNoGuardado && ahora - window.bsAgendaUltimoAvisoNoGuardado < 4000) return;
            window.bsAgendaUltimoAvisoNoGuardado = ahora;
            const entrenador = scope ? ` (agenda de ${nombreEntrenador(scope)})` : '';
            const esConflicto = !!err && err.code === 'conflict';
            const motivo = esConflicto && Array.isArray(err.conflictos)
                ? err.message
                : esConflicto
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
            actualizarIndicadorGuardadoAgenda();

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
                // HOTFIX-V1-AGENDA-SYNC-P0 (2026-10-09): un trainerKey con cambios sin confirmar ya no
                // IGNORA los cambios ajenos que trae el snapshot (antes conservaba su copia local
                // entera hasta el siguiente snapshot: el admin podía no ver un bloqueo del PT hasta
                // que alguien volviera a guardar). Se fusionan por elemento: los cambios ajenos se
                // ven al instante y los propios pendientes se mantienen. Solo un elemento tocado por
                // ambos conserva su base anterior, para que el guardado lo detecte como conflicto.
                const rebasados = {};
                Object.keys(pendientesLocales).forEach(scope => {
                    rebasados[scope] = {};
                    CAMPOS_POR_TRAINER.forEach(campo => {
                        const servidorCampo = (window.bsUltimoServidorConocido[campo] || {})[scope];
                        const r = fusionarCampoTresVias(campo, (basePrevia[campo] || {})[scope], pendientesLocales[scope][campo], servidorCampo);
                        rebasados[scope][campo] = r.valor === null || r.valor === undefined ? undefined : JSON.parse(JSON.stringify(r.valor));
                        if (r.baseNueva === null || r.baseNueva === undefined) delete window.bsUltimoServidorConocido[campo][scope];
                        else window.bsUltimoServidorConocido[campo][scope] = JSON.parse(JSON.stringify(r.baseNueva));
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
                Object.keys(rebasados).forEach(scope => {
                    CAMPOS_POR_TRAINER.forEach(campo => {
                        const valorFusionado = rebasados[scope][campo];
                        if (valorFusionado !== undefined) nuevoEstado[campo][scope] = valorFusionado;
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
            const baseFormulario = window.bsDispFormularioBase;
            if (baseFormulario && (baseFormulario.trainer !== entrenadorVisto || baseFormulario.lunes !== formatoFechaLocal(lunesActual)
                || !igualdadCanonica(baseFormulario.porcion, porcionFormularioDisponibilidad(dbDisponibilidadReservas[entrenadorVisto])))) {
                document.getElementById('disp-trainer-label').innerText = nombreEntrenador(entrenadorVisto);
                renderDisponibilidadReservasForm();
                capturarBaseFormularioDisponibilidad();
                alert(`La disponibilidad de ${nombreEntrenador(entrenadorVisto)} ha cambiado desde que abriste este formulario (la ha modificado otra persona u otra pestaña, o has cambiado de semana o de entrenador). Para no borrar ese cambio, NO se ha guardado. El formulario muestra ahora la disponibilidad actual: revísala y vuelve a guardar.`);
                return;
            }
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
                // HOTFIX-V1-AGENDA-SYNC-P0 (2026-10-09) -- CAUSA RAÍZ de "los bloqueos desaparecen sin
                // avisar" (reproducida: sync.cjs S10a). Aquí se volvía a poner "anterior", la copia
                // tomada al pulsar Guardar, DESPUÉS de que el guardado fallido hubiera releído el
                // servidor. Si el fallo era un conflicto (otra persona acababa de bloquear un día),
                // la pantalla volvía a la copia SIN ese bloqueo, la base de concurrencia ya era la
                // del servidor, y la siguiente operación normal (crear/mover una sesión) escribía
                // esa disponibilidad vieja encima: el bloqueo desaparecía sin que nadie lo viera.
                // Ahora la memoria ya es la del servidor (la deja así guardarEstadoNubeAgenda()).
                renderAgenda();
                renderDisponibilidadReservasForm();
                capturarBaseFormularioDisponibilidad();
                if (btn) { btn.disabled = false; btn.textContent = 'Guardar disponibilidad'; }
                const motivo = resultado?.err ? mensajeErrorGuardadoAgenda(resultado.err) : 'la app está sincronizando otro cambio en este instante -- vuelve a intentarlo en unos segundos.';
                alert(`No se ha podido guardar la disponibilidad en el servidor: tu cambio NO se ha guardado. El formulario muestra ahora la disponibilidad guardada en el servidor. ${motivo}`);
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