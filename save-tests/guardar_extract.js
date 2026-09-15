const TARIFAS_2026 = {

            "Individual Plan": { 1: 120, 2: 210, 3: 300, 4: 380, 5: 450 },

            "Individual Suelta": { 1: 30 }, "Individual Bono": { 10: 270 },

            "Pareja": { 1: 90, 2: 160, 3: 210, 4: 270, 5: 300 }, // PRECIO POR PERSONA

            "Trío": { 1: 70, 2: 120, 3: 150, 4: 170, 5: 200 }, // PRECIO POR PERSONA

            "Grupo Reducido Plan": { 1: 45, 2: 80, 3: 110, 4: 130, 5: 150 }, // PRECIO POR PERSONA

            "Grupo Reducido Suelta": { 1: 12 }, "Grupo Reducido Bono": { 10: 105 },

            "Grupo Aire Libre": { 1: 30, 2: 40, 3: 50, 4: 60, 5: 70 }, // PRECIO POR PERSONA

            "Miembro Subordinado": { 1: 0 } // Para los autogenerados

        };
TARIFAS_2026["Individual Bono 8"] = { 8: TARIFAS_2026["Individual Bono"][10] };
TARIFAS_2026["Grupo Reducido Bono 8"] = { 8: TARIFAS_2026["Grupo Reducido Bono"][10] };

const DEFAULT_CATALOGO_ACTIVIDADES = {
            ciclo_indoor: {
                id: 'ciclo_indoor', nombre: 'Ciclo Indoor / Spinning', centroId: 'alfa_prime', activo: true,
                unidadCiclo: 'semanas', duracionCiclo: 4,
                reparto: { partes: [{ destino: 'entrenador', pct: 50 }, { destino: 'centro', pct: 35 }, { destino: 'besoul', pct: 15 }] },
                modalidades: {
                    plan: { nombre: 'Plan por ciclo (4 semanas)', tipo: 'ciclo_no_acumulable', segmentos: {
                        general: { nombre: 'General', porPersona: true, planes: [{ sesiones: 4, precio: 55 }, { sesiones: 8, precio: 75 }, { sesiones: 12, precio: 95 }] },
                        empresa: { nombre: 'Empresa', porPersona: true, planes: [{ sesiones: 4, precio: 45 }, { sesiones: 8, precio: 65 }, { sesiones: 12, precio: 85 }] },
                        jubilados: { nombre: 'Jubilados', porPersona: true, planes: [{ sesiones: 4, precio: 45 }, { sesiones: 8, precio: 65 }, { sesiones: 12, precio: 85 }] }
                    }}
                }
            },
            pilates_maquina: {
                id: 'pilates_maquina', nombre: 'Pilates Máquina', centroId: 'alfa_prime', activo: true,
                unidadCiclo: 'meses', duracionCiclo: 1,
                reparto: { partes: [{ destino: 'entrenador', pct: 50 }, { destino: 'centro', pct: 35 }, { destino: 'besoul', pct: 15 }] },
                modalidades: {
                    plan: { nombre: 'Plan mensual', tipo: 'ciclo_no_acumulable', segmentos: {
                        general: { nombre: 'General', porPersona: true, planes: [{ sesiones: 4, precio: 65 }, { sesiones: 8, precio: 95 }, { sesiones: 12, precio: 120 }] },
                        empresa: { nombre: 'Empresa', porPersona: true, planes: [{ sesiones: 4, precio: 55 }, { sesiones: 8, precio: 85 }, { sesiones: 12, precio: 110 }] },
                        jubilados: { nombre: 'Jubilados', porPersona: true, planes: [{ sesiones: 4, precio: 55 }, { sesiones: 8, precio: 85 }, { sesiones: 12, precio: 110 }] }
                    }},
                    bono10: { nombre: 'Bono 10 clases', tipo: 'bono_vigencia', segmentos: {
                        individual: { nombre: 'Individual', porPersona: false, planes: [{ sesiones: 10, precio: 450 }] },
                        pareja: { nombre: 'Pareja', porPersona: false, planes: [{ sesiones: 10, precio: 600 }] },
                        trio: { nombre: 'Trío', porPersona: false, planes: [{ sesiones: 10, precio: 800 }] }
                    }},
                    vip: { nombre: 'Sala VIP / Personalizado', tipo: 'ciclo_no_acumulable', segmentos: {
                        individual: { nombre: 'Individual', porPersona: true, planes: [{ sesiones: 4, precio: 180 }, { sesiones: 8, precio: 320 }, { sesiones: 12, precio: 420 }] },
                        pareja: { nombre: 'Pareja', porPersona: true, planes: [{ sesiones: 4, precio: 120 }, { sesiones: 8, precio: 210 }, { sesiones: 12, precio: 285 }] },
                        trio: { nombre: 'Trío', porPersona: true, planes: [{ sesiones: 4, precio: 100 }, { sesiones: 8, precio: 170 }, { sesiones: 12, precio: 225 }] }
                    }}
                }
            }
        };

function buscarFichaPorId(id) {

            if (!dbClientes[entrenadorVisto]) return null;

            return dbClientes[entrenadorVisto].find(c => c.id === id) || null;

        }

function tarifaBaseFicha(ficha) {

            if (!ficha || !TARIFAS_2026[ficha.modalidad]) return 0;

            const factor = parseInt(ficha.factor) || 1;

            return TARIFAS_2026[ficha.modalidad][factor] || TARIFAS_2026[ficha.modalidad][1] || 0;

        }

function multiplicadorFacturacionFicha(ficha) {

            if (!ficha) return 1;

            let multi = 1;

            if (ficha.modalidad && ficha.modalidad.includes('Pareja')) multi = 2;

            if (ficha.modalidad && ficha.modalidad.includes('Trío')) multi = 3;

            if (ficha.tipo === 'grupo' && !esGrupoAbierto(ficha)) multi = ficha.integrantesObj ? ficha.integrantesObj.length : 1;
            if (esGrupoAbierto(ficha)) multi = 0;

            return Math.max(1, multi);

        }

function normalizarPorcentajeDescuento(valor) {
            const normalizado = String(valor ?? '').replace(',', '.');
            const num = parseFloat(normalizado);
            if (Number.isNaN(num)) return 0;
            return Math.min(100, Math.max(0, num));
        }

function formatoPorcentajeDescuento(valor) {
            return normalizarPorcentajeDescuento(valor).toLocaleString('es-ES', { maximumFractionDigits: 2 });
        }

function obtenerDescuentoFicha(ficha) {
            if (!ficha) return 0;
            return normalizarPorcentajeDescuento(ficha.descuentoPct || 0);
        }

function aplicarDescuentoImporte(importe, descuentoPct) {
            const descuento = normalizarPorcentajeDescuento(descuentoPct);
            return Math.max(0, importe * (1 - (descuento / 100)));
        }

function fechaHoyISO() { return formatoFechaLocal(new Date()); }

function normalizarEstadoCliente(valor) { return ['activo', 'inactivo', 'baja'].includes(valor) ? valor : 'activo'; }

function estadoClienteFicha(ficha) { return normalizarEstadoCliente(ficha?.estadoCliente || 'activo'); }

function esGrupoAbierto(ficha) { return !!(ficha && (ficha.grupoAbierto === true || ficha.tipoCita === 'grupo_abierto')); }

function esFichaMiembroGrupo(ficha) { return !!(ficha && ficha.modalidad === 'Miembro Subordinado' && ficha.vinculacion); }

function importeEfectivoCliente(ficha) {
            if (!ficha) return 0;
            if (ficha.modalidad === 'Miembro Subordinado' && ficha.vinculacion) {
                const fichaGrupo = buscarFichaPorId(ficha.vinculacion);
                if (!fichaGrupo) return 0;
                return aplicarDescuentoImporte(tarifaBaseFicha(fichaGrupo), obtenerDescuentoFicha(ficha));
            }
            const base = tarifaBaseFicha(ficha) * multiplicadorFacturacionFicha(ficha);
            return aplicarDescuentoImporte(base, obtenerDescuentoFicha(ficha));
        }

function fichasMiembrosGrupo(fichaGrupo) {
            if (!fichaGrupo || !Array.isArray(fichaGrupo.integrantesObj)) return [];
            const lista = dbClientes[entrenadorVisto] || [];
            return fichaGrupo.integrantesObj
                .map(m => lista.find(c => c.tipo === 'individual' && c.vinculacion === fichaGrupo.id && c.memberId === m.id))
                .filter(Boolean);
        }

function calcularFacturacionGrupoTotal(fichaGrupo) {

            if (!fichaGrupo) return 0;
            if (esGrupoAbierto(fichaGrupo)) return 0;

            const miembros = fichasMiembrosGrupo(fichaGrupo);

            if (!miembros.length) {
                // Todavía sin fichas de integrante sincronizadas (p.ej. justo al crear el grupo,
                // antes del primer guardado) -- aproximación con la tarifa base del propio grupo.
                // En cuanto existan integrantesObj con ficha, se usa siempre la suma real de abajo.
                const numPersonas = Math.max(1, fichaGrupo.integrantesObj?.length || 1);
                return aplicarDescuentoImporte(tarifaBaseFicha(fichaGrupo) * numPersonas, obtenerDescuentoFicha(fichaGrupo));
            }

            return miembros.reduce((total, miembro) => total + importeEfectivoCliente(miembro), 0);

        }

function calcularFacturacionEstadisticaMiembro(fichaGrupo, fichaMiembro) {

            if (!fichaGrupo) return 0;

            if (fichaMiembro) return importeEfectivoCliente(fichaMiembro);

            const miembros = fichaGrupo.integrantesObj && fichaGrupo.integrantesObj.length ? fichaGrupo.integrantesObj.length : 1;

            return calcularFacturacionGrupoTotal(fichaGrupo) / miembros;

        }

function contratoVacio() {
            return { firmado: false, nombreArchivo: '', tipoMime: 'application/pdf', contenidoBase64: '', storagePath: '', downloadURL: '', externalURL: '', enlaceContrato: '', subidaEn: '' };
        }

function normalizarReservasBloqueadasTexto(texto) {
            return String(texto || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 20).join('\n');
        }

function sincronizarIntegrantesGrupo(fichaGrupo) {

            if (!fichaGrupo || fichaGrupo.tipo !== 'grupo' || esGrupoAbierto(fichaGrupo)) return;

            if (!dbClientes[entrenadorVisto]) dbClientes[entrenadorVisto] = [];



            const lista = dbClientes[entrenadorVisto];

            const miembrosActuales = fichaGrupo.integrantesObj || [];

            const idsActuales = new Set(miembrosActuales.map(m => m.id));



            for (let i = lista.length - 1; i >= 0; i--) {

                const ficha = lista[i];

                if (ficha.tipo === 'individual' && ficha.vinculacion === fichaGrupo.id && !idsActuales.has(ficha.memberId)) {

                    lista.splice(i, 1);

                }

            }



            miembrosActuales.forEach(miembro => {

                let fichaMiembro = lista.find(c => c.tipo === 'individual' && c.vinculacion === fichaGrupo.id && c.memberId === miembro.id);

                const esNuevo = !fichaMiembro;

                if (esNuevo) {

                    fichaMiembro = {

                        id: `cli_member_${fichaGrupo.id}_${miembro.id}`,

                        tipo: 'individual',

                        // A4/CLIENT-08: el descuento individual solo se HEREDA del grupo al crear
                        // el integrante (punto de partida razonable). A partir de aquí es un campo
                        // propio del integrante -- editable desde su propia ficha (editarFicha) --
                        // y el Object.assign de abajo, a propósito, YA NO lo vuelve a escribir en
                        // cada guardado del grupo (antes sí lo hacía, y pisaba cualquier descuento
                        // individual que se hubiera puesto, aunque la ficha del PT jamás ofrecía
                        // una vía real para ponerlo -- ver CLIENT-08 en el informe).
                        descuentoPct: fichaGrupo.descuentoPct || 0

                    };

                    lista.push(fichaMiembro);

                }



                Object.assign(fichaMiembro, {

                    tipo: 'individual',

                    nombre: miembro.nombre,

                    telefono: miembro.telefono || '',

                    email: miembro.email || '',

                    modalidad: 'Miembro Subordinado',

                    factor: fichaGrupo.factor,

                    tipoCompra: fichaGrupo.tipoCompra,

                    fechaCompra: fichaGrupo.fechaCompra || '',

                    color: fichaGrupo.color,
                    estadoCliente: estadoClienteFicha(fichaGrupo),
                    fechaAlta: fichaGrupo.fechaAlta || '',
                    fechaEstado: fichaGrupo.fechaEstado || '',
                    observacionesEstado: fichaGrupo.observacionesEstado || '',

                    vinculacion: fichaGrupo.id,

                    memberId: miembro.id,

                    grupoNombre: fichaGrupo.nombre,

                    facturacionEstadistica: calcularFacturacionEstadisticaMiembro(fichaGrupo, fichaMiembro),

                    notaFacturacion: 'Dato estadístico: lo que aporta este integrante al total del grupo según su propio descuento. El grupo cuenta una sola vez en cartera (esta ficha nunca suma aparte).'

                });

            });

        }

function generarTokenReservaCliente() {
            // SEC-05 (2026-09-04): Math.random() no es un CSPRNG -- con suficientes muestras del
            // mismo generador (p.ej. observando varios tokens emitidos seguidos) su estado interno
            // es, en teoría, reconstruible, lo que reduce la entropía real del token por debajo de
            // lo que aparenta (documentado en SECURITY_AUDIT_PORTAL.md). crypto.getRandomValues()
            // es un CSPRNG real, nativo en todo navegador evergreen, sin dependencias nuevas.
            // Mismo formato de salida (prefijo res_, resto en minúsculas/dígitos/guion bajo) --
            // sigue encajando en /^res_[a-z0-9_]{3,60}$/, el mismo validador que ya usan
            // reservas.html y portal-cliente.html. Los tokens YA EMITIDOS con Math.random() NO se
            // invalidan por este cambio: el formato nunca cambió, solo la fuente de aleatoriedad de
            // los tokens NUEVOS a partir de ahora. Migración de los ya emitidos: progresiva, bajo
            // demanda, vía regenerarTokenReservaCliente() (revoca el antiguo, emite uno nuevo con
            // este generador), nunca forzada en bloque.
            let hex;
            if (window.crypto && typeof crypto.getRandomValues === 'function') {
                const bytes = new Uint8Array(16); // 128 bits de entropía real
                crypto.getRandomValues(bytes);
                hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
            } else {
                // Fallback defensivo solo para un navegador sin Web Crypto (no debería ocurrir en
                // ningún entorno moderno) -- mismo comportamiento que había antes, no una regresión.
                hex = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
            }
            const b = Date.now().toString(36);
            return `res_${hex}_${b}`;
        }

function catalogoActividadesVivo() { return { ...DEFAULT_CATALOGO_ACTIVIDADES, ...dbCatalogoActividades }; }

async function guardarCliente() {

            const name = document.getElementById('cust-name').value.trim();

            const phone = document.getElementById('cust-phone').value.trim();
            const emailCliente = (document.getElementById('cust-email')?.value || '').trim().toLowerCase();

            const mod = document.getElementById('cust-mod').value;

            const factor = parseInt(document.getElementById('cust-factor').value) || 1;

            const pType = document.getElementById('cust-purchase-type').value;

            const pDate = document.getElementById('cust-bono-date').value;

            const color = document.getElementById('cust-color').value;
            const descuentoPct = normalizarPorcentajeDescuento(document.getElementById('cust-discount')?.value || 0);
            const contratoCliente = { ...(contratoTemporalFicha || contratoVacio()), firmado: !!document.getElementById('cust-contract-signed')?.checked };
            const estadoCliente = normalizarEstadoCliente(document.getElementById('cust-status')?.value || 'activo');
            const fechaAlta = document.getElementById('cust-start-date')?.value || '';
            const fechaEstado = estadoCliente === 'activo' ? '' : (document.getElementById('cust-status-date')?.value || '');
            const observacionesEstado = estadoCliente === 'activo' ? '' : (document.getElementById('cust-status-reason')?.value.trim() || '');
            const reservasOnlineActivas = !!document.getElementById('cust-reservas-online')?.checked;
            const reservasBloqueadasTexto = normalizarReservasBloqueadasTexto(document.getElementById('cust-reservas-bloqueadas')?.value || '');
            const grupoAbierto = tabFichaActiva === 'grupo' ? !!document.getElementById('cust-open-group')?.checked : false;
            const capacidadGrupoAbiertoVal = grupoAbierto ? Math.max(1, Math.min(20, parseInt(document.getElementById('cust-open-group-capacity')?.value || '6', 10) || 6)) : 0;

            const esActividadEspecial = tabFichaActiva !== 'grupo' && !!document.getElementById('cust-es-actividad')?.checked;
            let actividadEspecialId = '', modalidadIdActividad = '', segmentoIdActividad = '', planSesionesActividad = 0, numPersonasActividad = 1, fechaCompraActividad = '';
            if (esActividadEspecial) {
                actividadEspecialId = document.getElementById('cust-actividad-id')?.value || '';
                modalidadIdActividad = document.getElementById('cust-actividad-modalidad')?.value || '';
                segmentoIdActividad = document.getElementById('cust-actividad-segmento')?.value || '';
                planSesionesActividad = Number(document.getElementById('cust-actividad-plan')?.value) || 0;
                numPersonasActividad = Math.max(1, parseInt(document.getElementById('cust-actividad-personas')?.value) || 1);
                const actCat = catalogoActividadesVivo()[actividadEspecialId];
                const esBonoActividad = actCat?.modalidades?.[modalidadIdActividad]?.tipo === 'bono_vigencia';
                fechaCompraActividad = esBonoActividad ? (document.getElementById('cust-actividad-bono-date')?.value || '') : '';
                if (!actividadEspecialId || !modalidadIdActividad || !segmentoIdActividad || !planSesionesActividad) {
                    alert('Selecciona actividad, modalidad, segmento y plan de sesiones.');
                    return;
                }
                if (esBonoActividad && !fechaCompraActividad) {
                    alert('Este plan es un bono con vigencia: indica la fecha de compra.');
                    return;
                }
            }



            if(!name) {
                alert('El nombre es obligatorio. En móvil está en el primer campo de la ficha.');
                const nameInput = document.getElementById('cust-name');
                if (nameInput) { nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => nameInput.focus(), 50); }
                return;
            }

            if (tabFichaActiva !== 'grupo' && (!phone || !emailCliente)) {
                alert('Para activar reservas, el teléfono y el email del cliente son obligatorios.');
                const contactInput = !phone ? document.getElementById('cust-phone') : document.getElementById('cust-email');
                if (contactInput) { contactInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => contactInput.focus(), 50); }
                return;
            }

            if (tabFichaActiva !== 'grupo' && emailCliente && !/^\S+@\S+\.\S+$/.test(emailCliente)) {
                alert('Introduce un email válido para el cliente.');
                const emailInput = document.getElementById('cust-email');
                if (emailInput) { emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => emailInput.focus(), 50); }
                return;
            }

            if(!dbClientes[entrenadorVisto]) dbClientes[entrenadorVisto] = [];



            const fichaAnterior = idFichaEditando ? dbClientes[entrenadorVisto].find(c => c.id === idFichaEditando) : null;

            const tipoReal = fichaAnterior ? fichaAnterior.tipo : tabFichaActiva;



            let integrantesArr = [];

            if(tipoReal === 'grupo' && !grupoAbierto) {

                const filasMiembros = Array.from(document.querySelectorAll('.member-row'));

                for (const row of filasMiembros) {

                    let n = row.querySelector('.mem-name')?.value.trim() || '';

                    let t = row.querySelector('.mem-phone')?.value.trim() || '';

                    let e = (row.querySelector('.mem-email')?.value || '').trim().toLowerCase();

                    let memberId = row.dataset.memberId || ('mem_' + Date.now() + Math.random().toString(36).substr(2, 5));

                    if(n || t || e) {
                        if(!n || !t || !e) {
                            alert('En grupos cerrados, cada integrante debe tener nombre, teléfono y email para mantener la base de datos completa.');
                            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }
                        if(!/^\S+@\S+\.\S+$/.test(e)) {
                            alert('El email de un integrante del grupo no es válido.');
                            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }
                        integrantesArr.push({id: memberId, nombre: n, telefono: t, email: e});
                    }

                }

            }



            let ficha = {

                ...(fichaAnterior || {}),

                id: idFichaEditando || ("cli_" + Date.now()),

                tipo: tipoReal,

                nombre: name,

                telefono: tipoReal === 'grupo' ? '' : phone,
                email: tipoReal === 'grupo' ? '' : emailCliente,
                reservaToken: tipoReal === 'grupo' ? '' : (fichaAnterior?.reservaToken || generarTokenReservaCliente()),
                reservasOnlineActivas: tipoReal === 'grupo' ? false : reservasOnlineActivas,
                reservasBloqueadasTexto: tipoReal === 'grupo' ? '' : reservasBloqueadasTexto,
                restriccionesReservas: tipoReal === 'grupo' ? { modo:'bloquear', bloquesTexto:'' } : { modo:'bloquear', bloquesTexto: reservasBloqueadasTexto },
                grupoAbierto: tipoReal === 'grupo' ? grupoAbierto : false,
                capacidadGrupoAbierto: tipoReal === 'grupo' ? capacidadGrupoAbiertoVal : 0,

                modalidad: esActividadEspecial ? `Actividad: ${nombreModalidadActividadParaFicha(actividadEspecialId, modalidadIdActividad, segmentoIdActividad)}` : mod,

                factor: esActividadEspecial ? 1 : factor,

                tipoCompra: esActividadEspecial ? (catalogoActividadesVivo()[actividadEspecialId]?.modalidades?.[modalidadIdActividad]?.tipo === 'bono_vigencia' ? 'Bono' : 'Mensualidad') : pType,

                fechaCompra: esActividadEspecial ? fechaCompraActividad : pDate,

                actividadEspecialId: esActividadEspecial ? actividadEspecialId : '',
                modalidadId: esActividadEspecial ? modalidadIdActividad : '',
                segmentoId: esActividadEspecial ? segmentoIdActividad : '',
                planSesiones: esActividadEspecial ? planSesionesActividad : 0,
                numPersonas: esActividadEspecial ? numPersonasActividad : 0,

                color: color,
                descuentoPct: descuentoPct,
                contratoCliente: contratoCliente,
                estadoCliente: estadoCliente,
                fechaAlta: fechaAlta || fichaAnterior?.fechaAlta || fechaHoyISO(),
                fechaEstado: fechaEstado,
                observacionesEstado: observacionesEstado,

                integrantesObj: (tipoReal === 'grupo' && !grupoAbierto) ? integrantesArr : []

            };

            // CLIENT-08: guardar la ficha de UN integrante de grupo directamente (ver
            // esFichaMiembroGrupo/editarFicha) actualiza solo nombre/teléfono/email/descuento --
            // todo lo compartido por el grupo (modalidad/factor/tipoCompra/fechaCompra/color/
            // vinculacion/memberId/grupoNombre/estado) se restaura tal cual estaba, y nunca se le
            // genera un enlace de reservas propio (A3: un integrante no reserva por su cuenta,
            // reserva el grupo). facturacionEstadistica se recalcula con SU descuento nuevo.
            if (esFichaMiembroGrupo(fichaAnterior)) {
                // HOTFIX-CLIENT-SAVE-V2 (2026-09-15): esFichaMiembroGrupo() solo garantiza
                // modalidad==='Miembro Subordinado' y vinculacion truthy -- los otros 8 campos de
                // abajo NO tienen esa garantía. Una ficha de integrante real que carezca de
                // cualquiera de ellos (dato de producción: nunca antes existía una vía para abrir
                // y guardar la ficha de un integrante por separado, así que este camino no se
                // había ejercitado nunca contra datos reales) dejaba esa clave como `undefined`
                // explícito -- Firestore .update() rechaza la escritura ENTERA si cualquier valor
                // del documento es undefined, con el mismo mensaje genérico para cualquier
                // cliente de ese entrenador. Causa raíz real, reproducida en
                // hotfix-diagnostics/run.cjs escenario H. Fallback seguro, mismo valor por
                // defecto que ya usa sincronizarIntegrantesGrupo()/mostrarModalNuevoCliente()
                // para estos mismos campos -- no se inventa ningún default nuevo.
                Object.assign(ficha, {
                    modalidad: fichaAnterior.modalidad,
                    factor: fichaAnterior.factor || 1,
                    tipoCompra: fichaAnterior.tipoCompra || 'Mensualidad',
                    fechaCompra: fichaAnterior.fechaCompra || '',
                    color: fichaAnterior.color || 'amber',
                    vinculacion: fichaAnterior.vinculacion,
                    memberId: fichaAnterior.memberId || '',
                    grupoNombre: fichaAnterior.grupoNombre || '',
                    estadoCliente: fichaAnterior.estadoCliente || 'activo',
                    fechaEstado: fichaAnterior.fechaEstado || '',
                    observacionesEstado: fichaAnterior.observacionesEstado || '',
                    reservaToken: '',
                    reservasOnlineActivas: false,
                    reservasBloqueadasTexto: '',
                    restriccionesReservas: { modo: 'bloquear', bloquesTexto: '' },
                    grupoAbierto: false,
                    capacidadGrupoAbierto: 0,
                    integrantesObj: []
                });
                ficha.facturacionEstadistica = importeEfectivoCliente(ficha);
            }

            // Espejo hacia el roster del grupo (integrantesObj) para que su modal no muestre datos
            // obsoletos si el PT abre "Ver grupo" después de este cambio -- una sola dirección
            // (miembro -> grupo); la otra dirección (grupo -> miembro) la sigue haciendo
            // sincronizarIntegrantesGrupo() al guardar el grupo, sin tocar descuento. Se guarda el
            // valor anterior de la fila para poder deshacer este espejo si falla el guardado real
            // (mismo criterio de "sin falso éxito" que el resto de esta función).
            let filaRosterMirror = null, filaRosterAnterior = null;
            if (esFichaMiembroGrupo(fichaAnterior)) {
                const fichaGrupoPadre = buscarFichaPorId(ficha.vinculacion);
                if (fichaGrupoPadre && Array.isArray(fichaGrupoPadre.integrantesObj)) {
                    filaRosterMirror = fichaGrupoPadre.integrantesObj.find(m => m.id === ficha.memberId) || null;
                    if (filaRosterMirror) {
                        filaRosterAnterior = { ...filaRosterMirror };
                        filaRosterMirror.nombre = ficha.nombre;
                        filaRosterMirror.telefono = ficha.telefono;
                        filaRosterMirror.email = ficha.email;
                    }
                }
            }



            const scopeGuardado = entrenadorVisto;
            let idxEditado = -1;

            if (idFichaEditando) {

                idxEditado = dbClientes[scopeGuardado].findIndex(c => c.id === idFichaEditando);

                if (idxEditado === -1) {
                    // Hallazgo real (hotfix edición de fichas, 2026-09-02): esto antes seguía
                    // hasta guardar/cerrar como si todo hubiera ido bien, sin haber tocado nada
                    // -- silenciosamente no-op si la ficha que se está editando ya no pertenece
                    // al entrenadorVisto actual (p.ej. el selector de admin cambió de PT mientras
                    // el modal estaba abierto).
                    alert('No se ha podido guardar: esta ficha ya no pertenece al entrenador seleccionado. Cierra el modal y vuelve a abrir la ficha.');
                    return;
                }

                dbClientes[scopeGuardado][idxEditado] = ficha;

            } else {

                dbClientes[scopeGuardado].push(ficha);

            }



            if (tipoReal === 'grupo') sincronizarIntegrantesGrupo(ficha);



            localStorage.setItem('bs_db_clientes_v6', JSON.stringify(dbClientes));

            // Hallazgo real (hotfix edición de fichas, 2026-09-02): el guardado en la nube
            // pasaba por programarGuardadoNubeAgenda() (debounce de 350 ms, fire-and-forget,
            // sin await) y el modal se cerraba mostrando éxito de inmediato, ANTES de que el
            // guardado en Firestore hubiera siquiera empezado a intentarse. Si ese guardado
            // fallaba (o quedaba bloqueado por window.bsAgendaAplicandoNube, que además no
            // reprogramaba ningún reintento) el error quedaba solo en consola y el cliente
            // nunca se enteraba: la ficha parecía guardada en la UI pero el valor anterior
            // seguía siendo el real en Firestore. Ahora se espera (await) la escritura real
            // -- sigue usando el mismo guardado dirigido por trainerKey con merge:true de
            // guardarEstadoNubeAgenda(), nunca el documento completo -- y solo si termina bien
            // se cierra el modal y se muestra la ficha como guardada.
            const btnGuardar = document.getElementById('btn-save-client');
            if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando...'; }

            try {

                const resultadoGuardado = await guardarEstadoNubeAgenda(scopeGuardado);
                if (!resultadoGuardado || resultadoGuardado.ok !== true) {
                    throw resultadoGuardado?.err || new Error(resultadoGuardado?.omitido ? 'GUARDADO_OMITIDO_REINTENTAR' : 'GUARDADO_FALLIDO');
                }

                actualizarNombreEnAgendaSiCambia(ficha.id);

                cerrarModal(); recalcularKPIs(); renderClientes(); renderAgenda();

            } catch (err) {

                // Deshace la mutación local: sin esto, dbClientes/localStorage seguirían
                // mostrando el valor nuevo aunque Firestore no lo tenga -- exactamente el
                // "falso éxito" que se pidió eliminar.
                // Busca por id en vez de reutilizar el índice capturado antes del await: si
                // llegó un snapshot de otro PT mientras se esperaba, dbClientes[scopeGuardado]
                // puede ser un array distinto (reemplazado entero por aplicarEstadoNubeAgenda).
                const idxActual = (dbClientes[scopeGuardado] || []).findIndex(c => c.id === ficha.id);
                if (idFichaEditando) {
                    if (fichaAnterior && idxActual !== -1) dbClientes[scopeGuardado][idxActual] = fichaAnterior;
                } else if (idxActual !== -1) {
                    dbClientes[scopeGuardado].splice(idxActual, 1);
                }
                if (filaRosterMirror && filaRosterAnterior) Object.assign(filaRosterMirror, filaRosterAnterior);
                localStorage.setItem('bs_db_clientes_v6', JSON.stringify(dbClientes));
                renderClientes();

                console.error(`[BESOUL Agenda] guardarCliente: fallo al guardar en Firestore · trainerKey=${scopeGuardado} · clientId=${ficha.id} · code=${err?.code || '(sin código)'} · message=${err?.message || err}`, err);
                alert('No se ha podido guardar la ficha en el servidor. Revisa tu conexión e inténtalo de nuevo -- el cambio NO se ha guardado.');

            } finally {

                if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.textContent = 'Guardar Ficha'; }

            }

        }

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