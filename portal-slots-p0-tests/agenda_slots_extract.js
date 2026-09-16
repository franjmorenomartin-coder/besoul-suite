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

async function publicarReservasPublicas() {
            try {
                if (!window.firebase || !firebase.apps.length || !usuarioFirebaseActual) return;
                const fs = firebase.firestore();
                // PORTAL-SLOTS-P0 (2026-09-16): hallazgo real confirmado contra producción. Esta
                // función se dispara tras CUALQUIER guardado en Firestore (guardarEstadoNubeAgenda),
                // republicando de golpe TODOS los trainerKeys, pero leía disponibilidad/clientes/
                // agenda de las variables globales dbDisponibilidadReservas/dbClientes/dbAgenda tal
                // como estuvieran en memoria del navegador que disparó esa acción -- si ese navegador
                // llevaba tiempo abierto y su listener en tiempo real aún no había recibido el último
                // cambio guardado por OTRO trainer en OTRA sesión, esta función republicaba de todos
                // modos para ese trainer con datos obsoletos, sobrescribiendo en silencio una
                // publicación correcta y reciente con una vacía/desactualizada. Confirmado en
                // producción vía lectura de solo lectura: un PT con disponibilidad real guardada y
                // persistente en besoulSuite/agenda tenía su besoulPublicSchedule publicado con 0
                // días activos y un updatedAt POSTERIOR al último guardado real de esa disponibilidad
                // -- solo se explica por una publicación disparada con una copia local obsoleta. Fix:
                // releer el documento real directamente del servidor (nunca de caché local)
                // inmediatamente antes de construir el batch, para que la publicación siempre parta
                // del estado confirmado en Firestore, nunca de una copia en memoria potencialmente
                // desincronizada. Aplica igual para cualquier trainerKey, sin excepciones.
                if (window.bsAgendaCloudDocRef) {
                    const snapshotFresco = await window.bsAgendaCloudDocRef.get({ source: 'server' });
                    const datosFrescos = snapshotFresco.data() || {};
                    dbClientes = datosFrescos.clientes || {};
                    dbAgenda = datosFrescos.agenda || {};
                    dbDisponibilidadReservas = datosFrescos.disponibilidadReservas || {};
                }
                const batch = fs.batch();
                const hoy = new Date(); hoy.setHours(0,0,0,0);
                const diasPublicar = 60;
                // PORTAL-02 (2026-09-05): hallazgo real -- calcularContadorClases(ficha) usa por
                // defecto claveMesVisible(), que es el MES QUE EL PT TIENE ABIERTO EN LA UI de
                // Agenda (lunesActual), no el mes real de hoy. publicarReservasPublicas() se
                // dispara automáticamente ante cualquier cambio (guardarEstadoNubeAgenda ->
                // publicarReservasPublicas), así que si el PT (o un admin, cuyo dbCredenciales
                // cubre a TODOS los trainers) había navegado a otro mes en el momento en que se
                // disparó la publicación, el contador de sesiones publicado al Portal Cliente
                // quedaba calculado para ESE mes, no el actual -- causa raíz confirmada del "0/0/0"
                // reportado: un cliente con plan mensual normal, publicado mientras la Agenda
                // estaba parada en un mes sin sesiones suyas, muestra sesionesUsadas/Pendientes
                // incorrectos (0) hasta la siguiente publicación que SÍ coincida con el mes real.
                const claveMesReal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
                Object.keys(dbCredenciales || {}).forEach(trainerKey => {
                    if (!dbClientes[trainerKey]) return;
                    const disp = dbDisponibilidadReservas[trainerKey] || disponibilidadReservasPorDefecto();
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
                        const contador = calcularContadorClases(c, claveMesReal);
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
                });
                await batch.commit();
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