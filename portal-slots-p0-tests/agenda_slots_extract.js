const BS_PUBLIC_CLIENTS_COLLECTION = 'besoulPublicClients';

const BS_PUBLIC_SCHEDULE_COLLECTION = 'besoulPublicSchedule';

const CANCELACION_MIN_HORAS_DEFAULT = 6;

function formatoFechaLocal(fecha) {

            const y = fecha.getFullYear();

            const m = String(fecha.getMonth() + 1).padStart(2, '0');

            const d = String(fecha.getDate()).padStart(2, '0');

            return `${y}-${m}-${d}`;

        }

function normalizarEstadoCliente(valor) { return ['activo', 'inactivo', 'baja'].includes(valor) ? valor : 'activo'; }

function estadoClienteFicha(ficha) { return normalizarEstadoCliente(ficha?.estadoCliente || 'activo'); }

function clienteActivoParaAgenda(ficha) { return estadoClienteFicha(ficha) === 'activo'; }

function esGrupoAbierto(ficha) { return !!(ficha && (ficha.grupoAbierto === true || ficha.tipoCita === 'grupo_abierto')); }

function capacidadGrupoAbierto(ficha) { return Math.max(1, parseInt(ficha?.capacidadGrupoAbierto || ficha?.capacidad || 1, 10) || 1); }

function asistentesGrupoAbierto(ficha) { return Array.isArray(ficha?.asistentesGrupoAbierto) ? ficha.asistentesGrupoAbierto : []; }

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

function minutosDesdeHorario(hora) {
            const partes = String(hora || '').split(':');
            if (partes.length !== 2) return NaN;
            const h = parseInt(partes[0], 10);
            const m = parseInt(partes[1], 10);
            if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
            return h * 60 + m;
        }

function claveDesdeFechaYMinutos(fechaISO, minutos) {
            return `${fechaISO}_${formatoMinutosHorario(minutos)}`;
        }

function formatoMinutosHorario(totalMinutos) {

            const horas = Math.floor(totalMinutos / 60);

            const minutos = totalMinutos % 60;

            return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;

        }

function sesionesClienteParaPortal(trainerKey, clientId) {
            const hoyISO = formatoFechaLocal(new Date());
            const ahoraHM = new Date().toTimeString().slice(0, 5);
            const futuras = [], pasadas = [];
            Object.keys(dbAgenda[trainerKey] || {}).forEach(clave => {
                const obj = dbAgenda[trainerKey][clave];
                if (!obj || obj.id !== clientId) return;
                const [fechaISO, hora] = clave.split('_');
                const item = { clave, fechaISO, hora, estadoCancelacion: obj.estadoCancelacion || '' };
                if (fechaISO > hoyISO || (fechaISO === hoyISO && hora >= ahoraHM)) futuras.push(item);
                else pasadas.push(item);
            });
            futuras.sort((a, b) => a.clave.localeCompare(b.clave));
            pasadas.sort((a, b) => b.clave.localeCompare(a.clave));
            return { proximas: futuras.slice(0, 5), recientes: pasadas.slice(0, 3) };
        }

function calendarioSesionesClienteParaPortal(trainerKey, clientId) {
            const hoy = new Date();
            const desdeISO = formatoFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() - 4, 1));
            const hastaISO = formatoFechaLocal(new Date(hoy.getFullYear(), hoy.getMonth() + 4, 1));
            const items = [];
            Object.keys(dbAgenda[trainerKey] || {}).forEach(clave => {
                const obj = dbAgenda[trainerKey][clave];
                if (!obj || obj.id !== clientId) return;
                const [fechaISO, hora] = clave.split('_');
                if (fechaISO < desdeISO || fechaISO > hastaISO) return;
                items.push({ fechaISO, hora, estadoCancelacion: obj.estadoCancelacion || '', modalidad: obj.modalidad || '' });
            });
            items.sort((a, b) => a.fechaISO.localeCompare(b.fechaISO) || a.hora.localeCompare(b.hora));
            return items;
        }

function nombreEntrenador(user) {

            return dbCredenciales[user]?.nombre || user;

        }

async function publicarReservasPublicasParaTrainer(trainerKey, { fs, claveMesReal }) {
            if (!dbClientes[trainerKey]) return;
            const disp = dbDisponibilidadReservas[trainerKey] || disponibilidadReservasPorDefecto();
            const batch = fs.batch();
            const ocupados = {};
            const gruposAbiertos = [];
            Object.keys(dbAgenda[trainerKey] || {}).forEach(clave => {
                const objAgenda = dbAgenda[trainerKey][clave];
                clavesBloqueSesion(clave, 45).forEach(k => ocupados[k] = true);
                if (esGrupoAbierto(objAgenda)) {
                    const [fechaISO, hora] = clave.split('_');
                    const capacidad = capacidadGrupoAbierto(objAgenda);
                    const asistentes = asistentesGrupoAbierto(objAgenda);
                    gruposAbiertos.push({
                        clave,
                        fechaISO,
                        hora,
                        grupoId: objAgenda.id || '',
                        grupoNombre: objAgenda.nombre || 'Grupo abierto',
                        duracionMin: 45,
                        capacidad,
                        asistentes: asistentes.length,
                        asistentesIds: asistentes.map(a => a.id || a.clientId).filter(Boolean),
                        plazasLibres: Math.max(0, capacidad - asistentes.length),
                        trainerKey,
                        trainerName: nombreEntrenador(trainerKey)
                    });
                }
            });
            Object.values(dbSolicitudesReservas || {}).forEach(r => {
                if (r.trainerKey === trainerKey && estadoReservaActivo(r)) {
                    clavesBloqueSesion(r.clave || `${r.fechaISO}_${r.hora}`, 45).forEach(k => ocupados[k] = true);
                }
            });
            gruposAbiertos.forEach(g => {
                const pendientes = Object.values(dbSolicitudesReservas || {}).filter(r => String(r.estado || 'pendiente').toLowerCase() === 'pendiente' && r.trainerKey === trainerKey && (r.clave || `${r.fechaISO}_${r.hora}`) === g.clave && r.tipoReserva === 'grupo_abierto').length;
                g.solicitudesPendientes = pendientes;
                g.plazasLibres = Math.max(0, (g.capacidad || 0) - (g.asistentes || 0) - pendientes);
            });
            const scheduleRef = fs.collection(BS_PUBLIC_SCHEDULE_COLLECTION).doc(trainerKey);
            batch.set(scheduleRef, {
                trainerKey,
                trainerName: nombreEntrenador(trainerKey),
                centroId: dbCredenciales[trainerKey]?.centroId || '',
                centroNombre: dbCredenciales[trainerKey]?.centroNombre || '',
                disponibilidad: disp,
                ocupados,
                gruposAbiertos: gruposAbiertos.filter(g => g.plazasLibres > 0),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            (dbClientes[trainerKey] || []).forEach(c => {
                if (!c || c.tipo !== 'individual' || c.vinculacion || !clienteActivoParaAgenda(c)) return;
                if (!c.email || !c.telefono) return;
                if (!c.reservaToken) c.reservaToken = generarTokenReservaCliente();
                const ref = fs.collection(BS_PUBLIC_CLIENTS_COLLECTION).doc(c.reservaToken);
                // CLIENT-01/02 (2026-09-04): campos añadidos para portal-cliente.html --
                // MISMO documento por token que ya usaba reservas.html (eliminado en
                // REMOVE-RESERVAS-LEGACY; besoulPublicClients ya era, de facto, la proyección
                // aislada por cliente que pedía el brief;
                // no se crea una colección paralela). contador/proximaSesion se calculan
                // aquí, en el lado PT ya autenticado, con las MISMAS funciones que usa el
                // resto de Agenda (calcularContadorClases, dbAgenda) -- el cliente nunca
                // lee el documento monolítico de agenda, solo este resumen ya calculado.
                const contador = calcularContadorClases(c, claveMesReal, trainerKey);
                const sesionesPortal = sesionesClienteParaPortal(trainerKey, c.id);
                batch.set(ref, {
                    token: c.reservaToken,
                    clientId: c.id,
                    clientName: c.nombre,
                    trainerKey,
                    trainerName: nombreEntrenador(trainerKey),
                    centroId: dbCredenciales[trainerKey]?.centroId || '',
                    centroNombre: dbCredenciales[trainerKey]?.centroNombre || '',
                    email: c.email || '',
                    telefono: c.telefono || '',
                    activo: c.reservasOnlineActivas !== false,
                    reservasOnlineActivas: c.reservasOnlineActivas !== false,
                    restriccionesReservas: c.restriccionesReservas || { modo:'bloquear', bloquesTexto: c.reservasBloqueadasTexto || '' },
                    reservasBloqueadasTexto: c.reservasBloqueadasTexto || c.restriccionesReservas?.bloquesTexto || '',
                    sesionesContratadas: contador.contratadas || 0,
                    sesionesUsadas: contador.usadas || 0,
                    sesionesPendientes: contador.restantes || 0,
                    periodoSesiones: contador.periodo || '',
                    // PORTAL-02 (2026-09-05): campos nuevos, aditivos -- necesarios para que el
                    // Portal V2 pueda mostrar tipo de plan/vigencia real en vez de inventar una
                    // etiqueta genérica. tipoPlan viene de calcularContadorClases() (misma fuente
                    // que el resto de contadores); modalidad y avatar vienen directos de la ficha,
                    // sin transformar. avatarUrl/avatarPath quedan vacíos hasta que exista una
                    // subida real (ver AVATAR_STORAGE_ARCHITECTURE.md) -- se publican ya para no
                    // tener que tocar este batch otra vez cuando se active.
                    tipoPlan: contador.tipo || '',
                    caducidadPlan: contador.caducidad || '',
                    modalidad: c.modalidad || '',
                    avatarUrl: c.avatarUrl || '',
                    avatarPath: c.avatarPath || '',
                    proximaSesion: sesionesPortal.proximas[0] || null,
                    proximasSesiones: sesionesPortal.proximas,
                    sesionesRecientes: sesionesPortal.recientes,
                    // PORTAL-MONTHLY-CALENDAR: ventana propia de ±4 meses (ver función),
                    // separada de proximas/recientes para no tocar ese límite existente.
                    calendarioSesiones: calendarioSesionesClienteParaPortal(trainerKey, c.id),
                    cancelacionMinHoras: parseInt(c.cancelacionMinHoras, 10) || CANCELACION_MIN_HORAS_DEFAULT,
                    avisos: Array.isArray(c.avisosPortal) ? c.avisosPortal.slice(0, 10).map(a => ({ id: a.id, fecha: a.fecha, contenido: a.contenido })) : [],
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });
            await batch.commit();
        }

async function publicarReservasPublicas() {
            try {
                if (!window.firebase || !firebase.apps.length || !usuarioFirebaseActual) return;
                const fs = firebase.firestore();
                // PORTAL-SLOTS-P0 (2026-09-16): causa raíz EXACTA, confirmada leyendo producción de
                // solo lectura (comparando disponibilidadReservas.<trainerKey> real contra el
                // besoulPublicSchedule/<trainerKey> publicado, campo a campo). La línea
                // `dbDisponibilidadReservas[trainerKey] || disponibilidadReservasPorDefecto()` cae al
                // default (todos los días inactivos) en cuanto esa clave no existe TODAVÍA en la
                // copia LOCAL en memoria del navegador que dispara esta función -- y
                // disponibilidadReservasPorDefecto() sella su propio `actualizadoEn` con
                // `new Date().toISOString()` en ese instante, coincidencia confirmada exactamente
                // así en producción. Fix: releer el documento real directamente del servidor (nunca
                // de caché local) inmediatamente antes de publicar.
                if (window.bsAgendaCloudDocRef) {
                    const snapshotFresco = await window.bsAgendaCloudDocRef.get({ source: 'server' });
                    const datosFrescos = snapshotFresco.data() || {};
                    dbClientes = datosFrescos.clientes || {};
                    dbAgenda = datosFrescos.agenda || {};
                    dbDisponibilidadReservas = datosFrescos.disponibilidadReservas || {};
                }
                const hoy = new Date(); hoy.setHours(0,0,0,0);
                // PORTAL-02 (2026-09-05): hallazgo real -- calcularContadorClases(ficha) usa por
                // defecto claveMesVisible(), que es el MES QUE EL PT TIENE ABIERTO EN LA UI de
                // Agenda (lunesActual), no el mes real de hoy -- causa raíz confirmada del "0/0/0"
                // reportado. claveMesReal fija siempre el mes de calendario real, no el navegado.
                const claveMesReal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
                // PORTAL-SLOTS-P0 GLOBAL (2026-09-16): hallazgo real adicional, confirmado con
                // auditoría de producción de TODOS los trainerKeys (no solo uno) -- iterar
                // `Object.keys(dbCredenciales)` es sistémicamente frágil por dos motivos
                // independientes, ambos reales: (1) para una sesión de PT normal (no admin),
                // dbCredenciales solo contiene SU PROPIA clave -- cualquier publicación disparada
                // desde esa sesión NUNCA puede tocar el resto de trainerKeys, aunque
                // dbDisponibilidadReservas/dbClientes (ya releídos frescos del servidor arriba) SÍ
                // los contengan todos, porque esta app usa un único documento monolítico compartido
                // que cualquier sesión autenticada ya puede leer completo. (2) el batch ÚNICO
                // compartido entre TODOS los trainerKeys hacía que un solo registro inválido de
                // CUALQUIER cliente/PT abortara silenciosamente la publicación de TODOS los demás a
                // la vez (Promise.allSettled + un batch POR trainerKey aísla el fallo: un PT con un
                // dato corrupto ya no puede bloquear la publicación de los demás). La lista de
                // trainerKeys a publicar se deriva de la propia fuente fresca ya releída
                // (disponibilidadReservas ∪ clientes), nunca de dbCredenciales -- ninguna sesión
                // parcial puede limitar a quién se publica. Sin trainerKeys hardcodeados.
                const trainerKeysAPublicar = Array.from(new Set([
                    ...Object.keys(dbDisponibilidadReservas || {}),
                    ...Object.keys(dbClientes || {})
                ]));
                const resultados = await Promise.allSettled(
                    trainerKeysAPublicar.map(trainerKey => publicarReservasPublicasParaTrainer(trainerKey, { fs, claveMesReal }))
                );
                resultados.forEach((r, i) => {
                    if (r.status === 'rejected') {
                        console.warn('No se pudo publicar reservas para un trainerKey concreto (el resto de PT SÍ se publicaron):', trainerKeysAPublicar[i], r.reason);
                    }
                });
                localStorage.setItem('bs_db_clientes_v6', JSON.stringify(dbClientes));
            } catch(err) {
                console.warn('No se pudieron publicar datos públicos de reservas:', err);
            }
        }

function normalizarTrainerKey(valor) {
            return String(valor || '')
                .trim()
                .toLowerCase()
                .normalize('NFD').replace(/\p{Diacritic}/gu, '')
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9._-]/g, '');
        }

function diasDisponibilidadActivaTrainer(trainerKey) {
            const disp = dbDisponibilidadReservas[trainerKey];
            if (!disp || !disp.semanal) return 0;
            return Object.values(disp.semanal).filter(d => d && d.activo === true && Array.isArray(d.bloques) && d.bloques.length > 0).length;
        }

function construirAuditoriaTrainerKey() {
            const filas = Object.keys(dbCredenciales || {}).sort().map(key => {
                const cred = dbCredenciales[key] || {};
                const clientes = (dbClientes[key] || []).length;
                const sesiones = Object.keys(dbAgenda[key] || {}).length;
                const diasActivos = diasDisponibilidadActivaTrainer(key);
                let estado = 'OK';
                if (clientes > 0 && diasActivos === 0) estado = 'Tiene clientes pero SIN disponibilidad activa publicada';
                else if (clientes === 0 && diasActivos === 0) estado = 'Sin clientes ni disponibilidad';
                return { key, nombre: cred.nombre || key, clientes, sesiones, diasActivos, estado };
            });

            // Heurística de posible duplicado: mismo nombre normalizado (minúsculas, sin acentos,
            // sin espacios) bajo DOS O MÁS trainerKey distintos -- exactamente el patrón del
            // incidente real ya documentado (Miguel Fenech con más de una clave a la vez). No
            // asume nada sobre NINGÚN nombre concreto -- es una comparación genérica aplicable a
            // cualquier PT.
            const porNombreNormalizado = {};
            filas.forEach(f => {
                const norm = normalizarTrainerKey(f.nombre);
                (porNombreNormalizado[norm] = porNombreNormalizado[norm] || []).push(f.key);
            });
            const duplicados = Object.entries(porNombreNormalizado).filter(([, keys]) => keys.length > 1);

            return { filas, duplicados };
        }

function disponibilidadReservasPorDefecto() {
            // Nueva filosofía: sin disponibilidad publicada no hay slots agendables.
            // El PT/admin debe definir franjas antes de agendar clientes.
            const semanal = {};
            for (let d=1; d<=7; d++) semanal[d] = { activo: false, bloques: [] };
            return { semanal, excepciones: {}, bloqueos: {}, recurrenteSemanal: true, actualizadoEn: new Date().toISOString() };
        }

function calcularContadorClases(ficha, claveMes = claveMesVisible(), trainerKey = entrenadorVisto) {

            const fichaBase = fichaBaseParaContador(ficha);

            if (!fichaBase) return { tipo: 'sin_datos', contratadas: 0, usadas: 0, restantes: 0, periodo: 'Sin datos' };



            const contratadas = sesionesContratadasFicha(fichaBase);

            const esBono = (fichaBase.tipoCompra === 'Bono') || (fichaBase.modalidad && fichaBase.modalidad.includes('Bono'));



            if (esBono) {

                // Los bonos tienen ventana de vigencia propia (p.ej. 3 meses desde la compra),
                // no un ciclo mensual — nunca se resetean por mes, no usan claveMes.
                const inicio = fichaBase.fechaCompra ? new Date(`${fichaBase.fechaCompra}T00:00:00`) : new Date(lunesActual.getFullYear(), lunesActual.getMonth(), 1);

                const fin = sumarMeses(inicio, 3);

                const usadas = contarSesionesAgendadas(fichaBase, formatoFechaLocal(inicio), formatoFechaLocal(fin), trainerKey);

                return {

                    tipo: 'bono',

                    contratadas,

                    usadas,

                    restantes: Math.max(0, contratadas - usadas),

                    exceso: Math.max(0, usadas - contratadas),

                    periodo: `${formatoFechaCorta(inicio)} - ${formatoFechaCorta(fin)}`,

                    caducidad: formatoFechaCorta(fin)

                };

            }

            // Plan mensual no acumulable: el mes (claveMes, formato YYYY-MM) es parte
            // de la identidad del saldo. Si ese mes ya quedó cerrado/respaldado en el
            // histórico (guardarResumenClienteMes), se usa el snapshot congelado en vez
            // de recalcular en vivo — evita que un cambio posterior de tarifa/modalidad
            // altere retroactivamente un mes ya cerrado.
            const snapshotMes = dbHistoricoClientes[trainerKey]?.[fichaBase.id]?.[claveMes];
            if (snapshotMes) {
                const contratadasHist = snapshotMes.sesionesContratadas ?? contratadas;
                const usadasHist = snapshotMes.sesionesAgendadas ?? 0;
                return {
                    tipo: 'mensual',
                    contratadas: contratadasHist,
                    usadas: usadasHist,
                    restantes: Math.max(0, contratadasHist - usadasHist),
                    exceso: Math.max(0, usadasHist - contratadasHist),
                    periodo: snapshotMes.etiquetaMes || etiquetaMesDesdeClave(claveMes),
                    historico: true
                };
            }

            const [anioMesVista, mesMesVista] = claveMes.split('-').map(x => parseInt(x, 10));
            const inicioMes = new Date(anioMesVista, mesMesVista - 1, 1);

            const finMes = new Date(anioMesVista, mesMesVista, 1);

            const usadas = contarSesionesAgendadas(fichaBase, formatoFechaLocal(inicioMes), formatoFechaLocal(finMes), trainerKey);

            return {

                tipo: 'mensual',

                contratadas,

                usadas,

                restantes: Math.max(0, contratadas - usadas),

                exceso: Math.max(0, usadas - contratadas),

                periodo: inicioMes.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),

                historico: false

            };

        }

function contarSesionesAgendadas(ficha, desdeISO, hastaISO, trainerKey = entrenadorVisto) {

            // PORTAL-SLOTS-P0 GLOBAL (2026-09-16): hallazgo real -- este parámetro `trainerKey`
            // (con default = entrenadorVisto, el mismo comportamiento de siempre para el resto de
            // llamadores) es NUEVO. Antes, esta función SIEMPRE leía dbAgenda[entrenadorVisto] --
            // "coincidía por casualidad" mientras el único llamador real (calcularContadorClases,
            // vía renderContadorHTML) siempre se invocaba para la ficha del PT que el usuario tenía
            // abierto en la UI. Al hacer que publicarReservasPublicas() publique TODOS los
            // trainerKeys reales desde cualquier sesión (fix de esta misma fecha), este contador se
            // calcularía para clientes de OTROS trainerKeys usando la agenda del trainerKey que el
            // usuario tenga abierto -- no la del cliente real -- publicando sesionesUsadas/
            // Pendientes incorrectos en besoulPublicClients. Se pasa explícitamente desde el bucle
            // de publicación para que use la agenda REAL de cada trainerKey.
            if (!ficha || !dbAgenda[trainerKey]) return 0;

            const idsValidos = new Set([ficha.id]);

            return Object.keys(dbAgenda[trainerKey]).reduce((total, clave) => {

                const fechaClave = clave.split('_')[0];

                const obj = dbAgenda[trainerKey][clave];

                if (esCitaPruebaCRM(obj)) return total;
                if (fechaClave >= desdeISO && fechaClave < hastaISO && obj && idsValidos.has(obj.id)) return total + 1;
                if (fechaClave >= desdeISO && fechaClave < hastaISO && obj && esGrupoAbierto(obj) && asistentesGrupoAbierto(obj).some(a => (a.id || a.clientId) === ficha.id)) return total + 1;

                return total;

            }, 0);

        }

function sesionesContratadasFicha(ficha) {

            if (!ficha) return 0;

            if (ficha.actividadEspecialId) return parseInt(ficha.planSesiones) || 0;

            // PLAN-01: Bono 8 comprobado antes que el genérico "Bono" (mismo motivo que en
            // actualizarOpcionesFrecuencia -- "Bono 8" también contiene la subcadena "Bono").
            if (ficha.modalidad && ficha.modalidad.includes('Bono 8')) return 8;

            if ((ficha.tipoCompra === 'Bono') || (ficha.modalidad && ficha.modalidad.includes('Bono'))) return 10;

            if (ficha.modalidad && ficha.modalidad.includes('Suelta')) return 1;

            return (parseInt(ficha.factor) || 1) * 4;

        }

function sumarMeses(fecha, meses) {

            const copia = new Date(fecha.getTime());

            copia.setMonth(copia.getMonth() + meses);

            return copia;

        }

function fichaBaseParaContador(ficha) {

            if (!ficha) return null;

            if (ficha.vinculacion) return buscarFichaPorId(ficha.vinculacion) || ficha;

            return ficha;

        }

function buscarFichaPorId(id) {

            if (!dbClientes[entrenadorVisto]) return null;

            return dbClientes[entrenadorVisto].find(c => c.id === id) || null;

        }

function formatoFechaCorta(fecha) {

            return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

        }

function etiquetaMesDesdeClave(claveMes) {
            const [y, m] = String(claveMes || '').split('-').map(x => parseInt(x, 10));
            if (!y || !m) return claveMes || '---';
            return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        }

function esCitaPruebaCRM(obj) {
            return !!(obj && (obj.esPruebaCRM === true || obj.tipoCita === 'pruebaCRM' || obj.noSumaFacturacion === true || obj.modalidad === 'Prueba CRM'));
        }