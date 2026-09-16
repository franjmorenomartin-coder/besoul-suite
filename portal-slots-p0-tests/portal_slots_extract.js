function dateISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function timeToMin(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; }

function minToTime(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

function dayIndexMonSun(d) { const x = d.getDay(); return x === 0 ? 7 : x; }

function normalizarDiaTexto(v) { return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function parseBloqueosCliente() {
      const texto = clientData?.reservasBloqueadasTexto || clientData?.restriccionesReservas?.bloquesTexto || '';
      return String(texto || '').split('\n').map(l => l.trim()).filter(Boolean).map(linea => {
        const l = normalizarDiaTexto(linea);
        const m = l.match(/(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|[1-7])\s+([0-2]?\d:[0-5]\d)\s*-\s*([0-2]?\d:[0-5]\d)/i);
        if (!m) return null;
        const dias = { lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 7 };
        const dia = dias[m[1]] || Number(m[1]);
        return { dia, inicio: m[2].padStart(5, '0'), fin: m[3].padStart(5, '0') };
      }).filter(Boolean);
    }

function bloqueadoPorCliente(iso, min) {
      const d = new Date(`${iso}T00:00:00`);
      const dia = dayIndexMonSun(d);
      return parseBloqueosCliente().some(b => b.dia === dia && min < timeToMin(b.fin) && (min + 45) > timeToMin(b.inicio));
    }

function normalizarBloques(bloques) {
      return (Array.isArray(bloques) ? bloques : []).map(b => ({ inicio: String(b?.inicio || '').slice(0, 5), fin: String(b?.fin || '').slice(0, 5) })).filter(b => b.inicio && b.fin && b.inicio < b.fin).sort((a, b) => a.inicio.localeCompare(b.inicio));
    }

function fusionarBloques(bloques) {
      const lista = normalizarBloques(bloques);
      if (!lista.length) return [];
      const out = [{ ...lista[0] }];
      for (let i = 1; i < lista.length; i++) {
        const ultimo = out[out.length - 1], actual = lista[i];
        if (actual.inicio <= ultimo.fin) { if (actual.fin > ultimo.fin) ultimo.fin = actual.fin; } else out.push({ ...actual });
      }
      return out;
    }

function bloquesDisponibilidadFechaCliente(fechaISO) {
      const disp = scheduleData?.disponibilidad || {};
      const d = new Date(`${fechaISO}T00:00:00`);
      const dia = dayIndexMonSun(d);
      const semanal = disp.semanal?.[dia];
      const excepcion = disp.excepciones?.[fechaISO];
      if (excepcion) {
        if (excepcion.activo === false) return [];
        if (excepcion.override === true) return excepcion.activo ? normalizarBloques(excepcion.bloques) : [];
      }
      let bloques = [];
      if (semanal?.activo) bloques = bloques.concat(normalizarBloques(semanal.bloques));
      if (excepcion?.activo !== false) bloques = bloques.concat(normalizarBloques(excepcion?.bloques));
      return fusionarBloques(bloques);
    }

function slotBloqueadoPorPT(iso, min) {
      const lista = scheduleData?.disponibilidad?.bloqueos?.[iso] || [];
      return new Set((Array.isArray(lista) ? lista : []).map(x => String(x || '').slice(0, 5))).has(minToTime(min));
    }

function slotOcupado(clave) { return !!(scheduleData.ocupados && scheduleData.ocupados[clave]); }

function bloqueLibre(iso, min) {
      return !slotOcupado(`${iso}_${minToTime(min)}`) && !slotOcupado(`${iso}_${minToTime(min + 15)}`) && !slotOcupado(`${iso}_${minToTime(min + 30)}`);
    }

function intervalosOcupadosDentroBloque(iso, start, end) {
      const ocupados = []; let abierto = null;
      for (let m = start; m < end; m += 15) {
        const ocupado = slotOcupado(`${iso}_${minToTime(m)}`) || slotBloqueadoPorPT(iso, m) || bloqueadoPorCliente(iso, m);
        if (ocupado && abierto === null) abierto = m;
        if (!ocupado && abierto !== null) { ocupados.push({ inicio: abierto, fin: m }); abierto = null; }
      }
      if (abierto !== null) ocupados.push({ inicio: abierto, fin: end });
      return ocupados;
    }

function huecosLibresFecha(iso) {
      const huecos = [];
      bloquesDisponibilidadFechaCliente(iso).forEach(b => {
        const start = timeToMin(b.inicio), end = timeToMin(b.fin);
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return;
        const ocupados = intervalosOcupadosDentroBloque(iso, start, end);
        let cursor = start;
        ocupados.forEach(o => {
          if (o.inicio > cursor) huecos.push({ inicio: cursor, fin: o.inicio, tieneAnterior: cursor > start, tieneSiguiente: true });
          cursor = Math.max(cursor, o.fin);
        });
        if (cursor < end) huecos.push({ inicio: cursor, fin: end, tieneAnterior: cursor > start, tieneSiguiente: false });
      });
      return huecos.map(h => ({ ...h, duracion: h.fin - h.inicio })).filter(h => h.duracion >= 45);
    }

function iniciosEficientesHueco(h) {
      const out = [];
      if (h.tieneAnterior) { for (let m = h.inicio; m + 45 <= h.fin; m += 45) out.push(m); return out; }
      if (h.tieneSiguiente) { const tmp = []; for (let fin = h.fin; fin - 45 >= h.inicio; fin -= 45) tmp.push(fin - 45); return tmp.reverse(); }
      for (let m = h.inicio; m + 45 <= h.fin; m += 45) out.push(m);
      return out;
    }

function generarSlotsReserva() {
      const out = []; const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const now = new Date(); const minNow = now.getHours() * 60 + now.getMinutes();
      const vistos = new Set();
      for (let i = 0; i < 30; i++) {
        const d = new Date(hoy); d.setDate(hoy.getDate() + i);
        const iso = dateISO(d);
        huecosLibresFecha(iso).forEach(h => {
          iniciosEficientesHueco(h).forEach(m => {
            if (i === 0 && m <= minNow + 120) return;
            if (!bloqueLibre(iso, m)) return;
            const clave = `${iso}_${minToTime(m)}`;
            if (vistos.has(clave)) return;
            vistos.add(clave);
            out.push({ iso, hora: minToTime(m), label: `${labelFecha(iso)} · ${minToTime(m)}` });
          });
        });
      }
      return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.hora.localeCompare(b.hora));
    }