let calculoActual = null;

let centroSeleccionadoFinanzas = 'todos';

const LS_AVISOS_COLAPSADO = 'bs_finanzas_avisos_colapsado';

const LS_AVISOS_OCULTOS = 'bs_finanzas_avisos_ocultos';

function escapeHTML(valor){ return String(valor ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

function dinero(num){ return (Number(num)||0).toLocaleString('es-ES',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' €'; }

function numero(num){ return (Number(num)||0).toLocaleString('es-ES',{maximumFractionDigits:0}); }

function economiaCentroConfigurada(centro) { return centro?.economiaConfigurada !== false; }

function claseDesviacion(valor){ return (valor || 0) > 0 ? 'text-red-300' : ((valor || 0) < 0 ? 'text-emerald-300' : 'text-slate-300'); }

function descripcionCanonCentro(c){
      const partes = [`Fijo ${dinero(c.canonFijoTotal||0)}`];
      if ((c.canonExtrasRegulares||0) > 0) partes.push(`PT ${numero(c.canonExtrasRegulares)}×${dinero(c.canonPorPt||0)} = ${dinero((c.canonExtrasRegulares||0)*(c.canonPorPt||0))}`);
      if ((c.canonExtrasReducidos||0) > 0) partes.push(`PT reducido ${numero(c.canonExtrasReducidos)}×${dinero(c.canonPorPtReducido||0)} = ${dinero((c.canonExtrasReducidos||0)*(c.canonPorPtReducido||0))}`);
      if ((c.ptsIncluidos||0) > 0) partes.push(`incluye ${numero(c.ptsIncluidos)} PT`);
      return partes.join(' · ');
    }

function seleccionarCentroFinanzas(id){ centroSeleccionadoFinanzas = id; renderCentrosResumen(); }

function renderSelectorCentrosFinanzas(centrosOrden){
      const sel = document.getElementById('centros-selector');
      if (!sel) return;
      if (centroSeleccionadoFinanzas !== 'todos' && !centrosOrden.some(c => c.id === centroSeleccionadoFinanzas)) centroSeleccionadoFinanzas = 'todos';
      const pill = (id, label, pendiente) => {
        const activo = centroSeleccionadoFinanzas === id;
        const base = 'px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition';
        const clase = activo ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-500/50';
        return `<button type="button" onclick="seleccionarCentroFinanzas('${escapeHTML(id)}')" class="${base} ${clase}">${escapeHTML(label)}${pendiente ? ' ⚠' : ''}</button>`;
      };
      sel.innerHTML = [pill('todos', 'Todos', false)].concat(
        centrosOrden.map(c => pill(c.id, c.nombre, !economiaCentroConfigurada(c)))
      ).join('');
    }

function renderComparativaCentrosFinanzas(centrosOrden){
      return `
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-x-auto">
          <table class="w-full text-[11px] min-w-[760px]">
            <thead class="text-slate-500 uppercase"><tr><th class="text-left py-2">Centro</th><th class="text-right">Clientes</th><th class="text-right">Fact. cartera</th><th class="text-right">PT</th><th class="text-right">BESOUL</th><th class="text-right">Canon</th><th class="text-right">Neto centro</th></tr></thead>
            <tbody class="divide-y divide-slate-800/60">
              ${centrosOrden.map(c => `<tr class="hover:bg-slate-900/40 cursor-pointer" onclick="seleccionarCentroFinanzas('${escapeHTML(c.id)}')">
                <td class="py-2 text-white font-semibold">${escapeHTML(c.nombre)}</td>
                <td class="text-right">${numero(c.clientes)}</td>
                <td class="text-right font-mono">${dinero(c.facturacion)}</td>
                <td class="text-right font-mono text-amber-400">${dinero(c.ptNeto)}</td>
                <td class="text-right font-mono text-emerald-400">${dinero(c.bsBruto)}</td>
                <td class="text-right font-mono text-red-300">-${dinero(c.canon)}</td>
                <td class="text-right font-mono">${economiaCentroConfigurada(c) ? `<b class="text-cyan-400">${dinero(c.bsBruto - c.canon)}</b>` : '<span class="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5 font-bold uppercase whitespace-nowrap">Pendiente</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }

function renderCentrosResumen(){
      const cont = document.getElementById('centros-resumen');
      const centrosOrden = Object.values(calculoActual.centros).filter(c => c.id !== 'sin_centro' || c.trainers.length > 0);
      renderSelectorCentrosFinanzas(centrosOrden);
      if (!centrosOrden.length) { cont.innerHTML = '<div class="text-xs text-slate-500">Sin datos.</div>'; return; }
      if (centroSeleccionadoFinanzas === 'todos') { cont.innerHTML = renderComparativaCentrosFinanzas(centrosOrden); return; }
      const centrosAMostrar = centrosOrden.filter(c => c.id === centroSeleccionadoFinanzas);
      cont.innerHTML = centrosAMostrar.map(c => `
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
          <div class="flex justify-between items-start gap-3">
            <div><h3 class="text-sm font-black text-white">${escapeHTML(c.nombre)}</h3><p class="text-[10px] text-slate-500">${c.trainers.length} entrenador(es) · ${numero(c.clientes)} cliente(s)</p></div>
            ${economiaCentroConfigurada(c) ? `<div class="text-right"><div class="text-[10px] text-slate-500 uppercase font-bold">Neto centro</div><div class="text-sm font-black text-cyan-400">${dinero(c.bsBruto - c.canon)}</div></div>` : `<span class="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full px-2.5 py-1 font-bold uppercase whitespace-nowrap">Economía pendiente de configurar</span>`}
          </div>
          ${!economiaCentroConfigurada(c) ? `<div class="text-[11px] text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 leading-relaxed">Este centro todavía no tiene condiciones económicas reales configuradas (canon, reparto, etc.). Las cifras de facturación de sus clientes/PT se siguen calculando con normalidad -- lo que falta es el canon/reparto propio de este centro, no se está aplicando ninguno inventado ni copiado de otro centro.</div>` : ''}
          <div class="grid grid-cols-2 md:grid-cols-7 gap-2 text-center text-[11px]">
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">Fact. cartera</span><b>${dinero(c.facturacion)}</b></div>
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">Valor agenda</span><b>${dinero(c.facturacionAgenda||0)}</b><small class="block text-[9px] text-slate-500">${numero(c.sesionesMensualesAgendadas||0)}/${numero(c.sesionesMensualesPrevistas||0)} ses. mensuales</small></div>
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">Desv.</span><b class="${claseDesviacion(c.desviacionAgenda||0)}">${dinero(c.desviacionAgenda||0)}</b></div>
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">PT</span><b class="text-amber-400">${dinero(c.ptNeto)}</b></div>
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">BESOUL</span><b class="text-emerald-400">${dinero(c.bsBruto)}</b></div>
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">Canon ordinario</span><b class="text-red-400">-${dinero(c.canon)}</b><small class="block text-[9px] text-slate-500">${escapeHTML(descripcionCanonCentro(c))}${c.numTrainersExentos ? ` · ${numero(c.numTrainersExentos)} PT exento(s) de canon` : ''}</small></div>
            <div class="bg-slate-900 rounded p-2"><span class="block text-slate-500 uppercase text-[9px]">Participación centro</span><b class="text-purple-300">${dinero(c.participacionCentro||0)}</b><small class="block text-[9px] text-slate-500">Clientes ${dinero(c.participacionClientes||0)} · Activ. especiales ${dinero(c.ingresosActividades||0)}</small><small class="block text-[9px] text-slate-500">No resta del beneficio BESOUL</small></div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-[11px] min-w-[1040px]"><thead class="text-slate-500 uppercase"><tr><th class="text-left py-2">Entrenador</th><th class="text-right">Clientes</th><th class="text-right">Fact. cartera</th><th class="text-right">Valor agenda</th><th class="text-right">Desviación</th><th class="text-right">Neto PT</th><th class="text-right">BESOUL bruto</th><th class="text-right">Coste sede</th><th class="text-right">BESOUL neto</th></tr></thead><tbody class="divide-y divide-slate-800/60">
              ${c.trainers.length ? c.trainers.sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(t => {
                const detalleDesv = (t.motivosDesviacion||[]).length ? `<div class="text-[9px] text-slate-500 max-w-[220px] ml-auto">${(t.motivosDesviacion||[]).map(escapeHTML).join('<br>')}</div>` : `<div class="text-[9px] text-slate-500">${(t.desviacionSesiones||0) === 0 ? 'Agenda alineada' : 'Ver sesiones contratadas vs agendadas'}</div>`;
                return `<tr><td class="py-2 text-white font-semibold"><div>${escapeHTML(t.nombre)} <span class="text-[9px] text-slate-500">${escapeHTML(t.key)}</span></div><div class="text-[9px] text-cyan-400">${escapeHTML(t.sistemaAplicado || 'Base por tramos')}</div></td><td class="text-right">${numero(t.clientes)}</td><td class="text-right font-mono"><div>${dinero(t.facturacion)}</div><div class="text-[9px] text-slate-500">Mensual ${dinero(t.facturacionMensual||0)} · bonos/sueltas ${dinero(t.facturacionVariable||0)}${t.sesionesBonosSueltas ? ` · ${t.sesionesBonosSueltas} ses.` : ''}${t.coordinacionBonus ? ` · coord. ${dinero(t.coordinacionBonus)}` : ''}${t.soloImputacionGastos ? ` · solo imputación gastos${t.clientesAgendaNoComputados ? ` · cartera no computada: ${numero(t.clientesAgendaNoComputados)}` : ''}` : ''}</div></td><td class="text-right font-mono"><div>${dinero(t.facturacionAgenda||0)}</div><div class="text-[9px] text-slate-500">${numero(t.sesionesMensualesAgendadas||0)}/${numero(t.sesionesMensualesPrevistas||0)} ses. mensuales</div></td><td class="text-right font-mono ${claseDesviacion(t.desviacionAgenda||0)}"><div>${dinero(t.desviacionAgenda||0)}</div>${detalleDesv}</td><td class="text-right font-mono text-amber-400">${dinero(t.ptNeto)}</td><td class="text-right font-mono text-emerald-400">${dinero(t.bsBruto)}</td><td class="text-right font-mono text-red-300"><div>-${dinero(t.canonCentroShare||0)}</div><div class="text-[9px] text-slate-500">${t.computaCanonCentro === false ? 'Exento de canon ordinario' : `Fijo ${dinero(t.canonFijoShare||0)} · variable media ${dinero(t.canonPtShare||0)}`}</div></td><td class="text-right font-mono ${(t.bsNetoCentro||0) >= 0 ? 'text-cyan-400' : 'text-red-400'}">${dinero(t.bsNetoCentro||0)}</td></tr>`;
              }).join('') : '<tr><td colspan="9" class="py-3 text-center text-slate-500">Sin entrenadores asignados.</td></tr>'}
            </tbody></table>
          </div>
        </div>`).join('');
    }

function avisosCarreraColapsado(){ try { return localStorage.getItem(LS_AVISOS_COLAPSADO) !== '0'; } catch(e){ return true; } }

function setAvisosCarreraColapsado(v){ try { localStorage.setItem(LS_AVISOS_COLAPSADO, v ? '1' : '0'); } catch(e){} }

function avisosCarreraOcultosSet(){ try { return new Set(JSON.parse(localStorage.getItem(LS_AVISOS_OCULTOS) || '[]')); } catch(e){ return new Set(); } }

function setAvisosCarreraOcultosSet(s){ try { localStorage.setItem(LS_AVISOS_OCULTOS, JSON.stringify([...s])); } catch(e){} }

function toggleAvisosCarrera(){ setAvisosCarreraColapsado(!avisosCarreraColapsado()); renderAlertasCarrera(); }

function ocultarAvisoCarrera(id){ const s = avisosCarreraOcultosSet(); s.add(id); setAvisosCarreraOcultosSet(s); renderAlertasCarrera(); }

function ocultarTodosAvisosCarrera(){ const s = avisosCarreraOcultosSet(); (window._bsAvisosCarreraVisiblesIds || []).forEach(id => s.add(id)); setAvisosCarreraOcultosSet(s); renderAlertasCarrera(); }

function restaurarAvisosCarreraOcultos(){ setAvisosCarreraOcultosSet(new Set()); renderAlertasCarrera(); }