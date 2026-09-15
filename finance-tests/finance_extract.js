const TARIFAS_2026 = {

            "Individual Plan": { 1: 120, 2: 210, 3: 300, 4: 380, 5: 450 },

            "Individual Suelta": { 1: 30 }, "Individual Bono": { 10: 270 },

            "Pareja": { 1: 90, 2: 160, 3: 210, 4: 270, 5: 300 }, // PRECIO POR PERSONA

            "Trío": { 1: 70, 2: 120, 3: 150, 4: 170, 5: 200 }, // PRECIO POR PERSONA

            "Grupo Reducido Plan": { 1: 45, 2: 80, 3: 110, 4: 130, 5: 150 }, // PRECIO POR PERSONA

            "Grupo Reducido Suelta": { 1: 12 }, "Grupo Reducido Bono": { 10: 105 },

            "Grupo Aire Libre": { 1: 30, 2: 40, 3: 50, 4: 60, 5: 70 }, // PRECIO POR PERSONA

            "Miembro Subordinado": { 1: 0 } // Para los autogenerados

        }
TARIFAS_2026["Individual Bono 8"] = { 8: TARIFAS_2026["Individual Bono"][10] };
TARIFAS_2026["Grupo Reducido Bono 8"] = { 8: TARIFAS_2026["Grupo Reducido Bono"][10] };

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

function buscarFichaPorId(id) {

            if (!dbClientes[entrenadorVisto]) return null;

            return dbClientes[entrenadorVisto].find(c => c.id === id) || null;

        }

function fichaBaseParaContador(ficha) {

            if (!ficha) return null;

            if (ficha.vinculacion) return buscarFichaPorId(ficha.vinculacion) || ficha;

            return ficha;

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

function calcularFacturacionBaseSinDescuento(ficha) {
            if (!ficha) return 0;
            return tarifaBaseFicha(ficha) * multiplicadorFacturacionFicha(ficha);
        }

function calcularFacturacionEstadisticaMiembro(fichaGrupo, fichaMiembro) {

            if (!fichaGrupo) return 0;

            if (fichaMiembro) return importeEfectivoCliente(fichaMiembro);

            const miembros = fichaGrupo.integrantesObj && fichaGrupo.integrantesObj.length ? fichaGrupo.integrantesObj.length : 1;

            return calcularFacturacionGrupoTotal(fichaGrupo) / miembros;

        }

function calcularFacturacionFicha(ficha, mesKey) {

            if (!ficha) return 0;

            // Hallazgo real (2026-09-03): tarifaBaseFicha() solo entiende TARIFAS_2026[ficha.modalidad]
            // -- para una ficha de actividad especial, ficha.modalidad es el texto descriptivo
            // ("Actividad: Pilates Máquina · ..."), nunca una clave real, así que devolvía 0 de
            // forma determinista para CUALQUIER cliente de actividad especial (tarjeta de Agenda,
            // KPIs, rentabilidad/sesión -- todo lo que se construye sobre esta función). Misma
            // fuente de catálogo que el preview del modal (catalogoActividadesVivo()) y misma
            // lógica conceptual que finanzas.html/dashboard.html: la actividad especial NUNCA pasa
            // por el motor estándar (tarifaBaseFicha), tiene su propia resolución.
            if (ficha.actividadEspecialId) {
                return calcularFacturacionActividadFicha(ficha, entrenadorVisto, mesKey || claveMesVisible()).total;
            }

            if (ficha.modalidad === 'Miembro Subordinado') {

                const grupoPadre = buscarFichaPorId(ficha.vinculacion);

                if (grupoPadre) return calcularFacturacionEstadisticaMiembro(grupoPadre, ficha);

                return parseFloat(ficha.facturacionEstadistica || 0);

            }

            return calcularFacturacionGrupoTotal(ficha);

        }