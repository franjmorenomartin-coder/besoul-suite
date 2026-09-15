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

function autoCalcularTarifa() {
            // FIX-GROUP-MEMBER-ECONOMICS (2026-09-15): al editar un integrante de grupo,
            // cust-mod/cust-factor están deshabilitados (CLIENT-08) y su <select> NUNCA tuvo una
            // <option value="Miembro Subordinado"> -- asignarle ese valor deja el <select> sin
            // ninguna opción seleccionada (comportamiento estándar del DOM: value pasa a ''), así
            // que este preview leía TARIFAS_2026[''] (undefined) y mostraba 0,00 € en precio
            // base/facturación/rentabilidad para CUALQUIER integrante, con cualquier descuento.
            // El importe REALMENTE GUARDADO (facturacionEstadistica, vía importeEfectivoCliente)
            // siempre fue correcto -- usa tarifaBaseFicha(fichaGrupo), nunca este preview --  por
            // eso Agenda/Finanzas/Dashboard (que leen facturacionEstadistica) nunca mostraron el
            // error: es un bug de PREVIEW en el modal, no del motor económico. Se resuelve aquí
            // usando la MISMA función (tarifaBaseFicha) sobre el GRUPO real del integrante, para
            // que el preview no pueda divergir nunca del cálculo que de verdad se va a guardar.
            const fichaEnEdicion = idFichaEditando ? (dbClientes[entrenadorVisto] || []).find(c => c.id === idFichaEditando) : null;
            const esMiembroEnEdicion = esFichaMiembroGrupo(fichaEnEdicion);
            const fichaGrupoDelMiembro = esMiembroEnEdicion ? buscarFichaPorId(fichaEnEdicion.vinculacion) : null;

            const mod = esMiembroEnEdicion ? (fichaGrupoDelMiembro?.modalidad || '') : document.getElementById('cust-mod').value;
            const factor = esMiembroEnEdicion ? (parseInt(fichaGrupoDelMiembro?.factor) || 1) : (parseInt(document.getElementById('cust-factor').value) || 1);
            const descuentoPct = normalizarPorcentajeDescuento(document.getElementById('cust-discount')?.value || 0);

            // Personas asumidas por facturación en la matriz
            let multiplicadorPersonas = 1;
            if(mod.includes("Pareja")) multiplicadorPersonas = 2;
            if(mod.includes("Trío")) multiplicadorPersonas = 3;

            let personasEnGrupo = 1;
            if(tabFichaActiva === 'grupo') {
                const filas = Array.from(document.querySelectorAll('.member-row'));
                const filasConNombre = filas.filter(row => row.querySelector('.mem-name')?.value.trim()).length;
                personasEnGrupo = filasConNombre > 0 ? filasConNombre : (filas.length > 0 ? filas.length : 1);
                if(mod.includes("Grupo Reducido")) multiplicadorPersonas = personasEnGrupo;
            }
            // Un integrante individual nunca multiplica por cabezas -- su preview es SU importe
            // por persona (igual que importeEfectivoCliente), no el total del grupo.

            const tarifaBasePersona = esMiembroEnEdicion
                ? tarifaBaseFicha(fichaGrupoDelMiembro)
                : (TARIFAS_2026[mod] ? (TARIFAS_2026[mod][factor] || TARIFAS_2026[mod][1] || 0) : 0);
            const facturacionBaseMensual = tarifaBasePersona * multiplicadorPersonas;
            const descuentoEuros = facturacionBaseMensual - aplicarDescuentoImporte(facturacionBaseMensual, descuentoPct);
            const facturacionTotalMensual = aplicarDescuentoImporte(facturacionBaseMensual, descuentoPct);

            document.getElementById('lbl-tarifa-calculada').innerText = `${facturacionTotalMensual.toFixed(2)} €`;
            const lblBase = document.getElementById('lbl-precio-base');
            const lblDesc = document.getElementById('lbl-descuento-aplicado');
            if (lblBase) lblBase.innerText = `${facturacionBaseMensual.toFixed(2)} €`;
            if (lblDesc) lblDesc.innerText = `Descuento: ${formatoPorcentajeDescuento(descuentoPct)}% · -${descuentoEuros.toFixed(2)} €`;

            // RENTABILIDAD POR SESIÓN: Cuota total / Total de sesiones en 4 semanas
            const sesionesMes = mod.includes("Bono 8") ? 8 : (mod.includes("Bono") ? 10 : (mod.includes("Suelta") ? 1 : factor * 4));
            const rentabilidadSesion = sesionesMes > 0 ? facturacionTotalMensual / sesionesMes : 0;
            document.getElementById('lbl-rentabilidad-sesion').innerText = `${rentabilidadSesion.toFixed(2)} €`;
            actualizarPreviewContadorModal();
        }

function actualizarPreviewContadorModal() {

            // FIX-GROUP-MEMBER-ECONOMICS: mismo motivo que en autoCalcularTarifa() -- cust-mod/
            // cust-factor están deshabilitados y vacíos para un integrante de grupo (su <select>
            // nunca tuvo una <option> para 'Miembro Subordinado'). Se resuelven aquí desde el
            // grupo real para que el contador previsto (Bono/Mensualidad, nº de clases) no
            // muestre datos del grupo equivocados ni "0 clases".
            const fichaEnEdicionPreview = idFichaEditando ? (dbClientes[entrenadorVisto] || []).find(c => c.id === idFichaEditando) : null;
            const esMiembroPreview = esFichaMiembroGrupo(fichaEnEdicionPreview);
            const fichaGrupoPreview = esMiembroPreview ? buscarFichaPorId(fichaEnEdicionPreview.vinculacion) : null;

            const mod = esMiembroPreview ? (fichaGrupoPreview?.modalidad || '') : document.getElementById('cust-mod').value;

            const factor = esMiembroPreview ? (parseInt(fichaGrupoPreview?.factor) || 1) : (parseInt(document.getElementById('cust-factor').value) || 1);

            const pType = esMiembroPreview ? (fichaGrupoPreview?.tipoCompra || 'Mensualidad') : document.getElementById('cust-purchase-type').value;

            const pDate = esMiembroPreview ? (fichaGrupoPreview?.fechaCompra || '') : document.getElementById('cust-bono-date').value;

            const fichaTemporal = {

                id: idFichaEditando || 'preview', modalidad: mod, factor: factor, tipoCompra: pType, fechaCompra: pDate

            };

            const contratadas = sesionesContratadasFicha(fichaTemporal);

            if ((pType === 'Bono') || mod.includes('Bono')) {

                const inicio = pDate ? new Date(`${pDate}T00:00:00`) : new Date(lunesActual.getFullYear(), lunesActual.getMonth(), 1);

                const caduca = sumarMeses(inicio, 3);

                document.getElementById('lbl-contador-preview').innerHTML = `Bono de <b class="text-white">${contratadas}</b> clases. Vigencia: <b class="text-amber-400">${formatoFechaCorta(inicio)} - ${formatoFechaCorta(caduca)}</b>.`;

            } else {

                document.getElementById('lbl-contador-preview').innerHTML = `Mensualidad de <b class="text-white">${contratadas}</b> clases al mes según la frecuencia seleccionada.`;

            }

        }