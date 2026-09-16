function dateISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function dayIndexMonSun(d) { const x = d.getDay(); return x === 0 ? 7 : x; }

function estadoDiaCalendarioMensual(sesionesDia) {
      if (!sesionesDia.length) return null;
      if (sesionesDia.some(s => s.estadoCancelacion === 'cancelada_fuera_plazo')) return 'rojo';
      const hoyISO = dateISO(new Date());
      if (sesionesDia.some(s => s.fechaISO >= hoyISO)) return 'ambar';
      return 'verde';
    }

function badgeEstadoSesion(s) {
      if (s.estadoCancelacion === 'cancelada_fuera_plazo') return '<span class="text-[9px] font-black uppercase text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">Cancelada fuera de plazo</span>';
      const hoyISO = new Date().toISOString().slice(0, 10);
      if (s.fechaISO >= hoyISO) return '<span class="text-[9px] font-black uppercase text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5">Próxima</span>';
      return '<span class="text-[9px] font-black uppercase text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">Realizada</span>';
    }