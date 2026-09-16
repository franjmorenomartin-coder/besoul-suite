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

function catalogoActividadesVivo(){ return { ...DEFAULT_CATALOGO_ACTIVIDADES, ...(agendaData.catalogoActividades || {}) }; }

function catalogoActividadVivo(actividadId){ return catalogoActividadesVivo()[actividadId] || null; }

function entradaEfectivaTemporal(entradas, mesKey){
      const candidatas = (entradas||[]).filter(e => e.desde <= mesKey && (!e.hasta || mesKey <= e.hasta));
      if (!candidatas.length) return null;
      candidatas.sort((a,b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : (a.hasta?1:0)-(b.hasta?1:0)));
      return candidatas[candidatas.length-1];
    }

function actividadEfectivaParaMes(actividadId, mesKey){
      const live = catalogoActividadVivo(actividadId);
      if (!live) return null;
      const versiones = agendaData.tarifasActividadVersiones?.[actividadId];
      const entrada = versiones && versiones.length ? entradaEfectivaTemporal(versiones, mesKey) : null;
      return entrada ? { ...live, modalidades: entrada.modalidades } : live;
    }

function repartoLiveActividad(actividadId){ return catalogoActividadVivo(actividadId)?.reparto || null; }

function repartoEfectivoActividad(actividadId, mesKey){
      const versiones = agendaData.repartoActividadVersiones?.[actividadId];
      const entrada = versiones && versiones.length ? entradaEfectivaTemporal(versiones, mesKey) : null;
      if (entrada) return { partes: entrada.partes };
      return repartoLiveActividad(actividadId) || { partes: [] };
    }

function distribuirReparto(monto, partes){
      const centavos = Math.round((Number(monto) || 0) * 100);
      const pesos = (partes || []).map(p => ({ destino: p.destino, pct: Number(p.pct) || 0 }));
      const totalPct = pesos.reduce((s, p) => s + p.pct, 0);
      const resultado = {};
      if (!pesos.length || totalPct <= 0 || centavos <= 0) { pesos.forEach(p => resultado[p.destino] = 0); return resultado; }
      const brutos = pesos.map(p => (centavos * p.pct) / totalPct);
      const floors = brutos.map(b => Math.floor(b));
      const sobrante = centavos - floors.reduce((s, f) => s + f, 0);
      const orden = brutos.map((b, i) => ({ i, resto: b - floors[i] })).sort((a, b) => b.resto - a.resto);
      const finales = floors.slice();
      for (let k = 0; k < sobrante; k++) finales[orden[k % orden.length].i] += 1;
      pesos.forEach((p, i) => { resultado[p.destino] = finales[i] / 100; });
      return resultado;
    }

function validarSumaReparto(partes){
      const suma = (partes || []).reduce((s, p) => s + (Number(p.pct) || 0), 0);
      return Math.abs(suma - 100) < 0.001;
    }

function calcularFacturacionActividadFicha(ficha, trainerKey, mesKey, centroId){
      if (!ficha || !ficha.actividadEspecialId) return { total: 0, tipo: 'sin_actividad', sesionesAgendadas: 0 };
      const cat = actividadEfectivaParaMes(ficha.actividadEspecialId, mesKey);
      const modalidad = cat?.modalidades?.[ficha.modalidadId];
      const segmento = modalidad?.segmentos?.[ficha.segmentoId];
      const plan = segmento ? (segmento.planes || []).find(p => Number(p.sesiones) === Number(ficha.planSesiones)) : null;
      // Logging temporal de diagnóstico (2026-09-03, quitar cuando quede confirmado en
      // producción): paso a paso de la resolución, éxito o fallo, sin PII.
      console.log(`[FINANZAS][ACTIVIDAD_CALCULO] trainerKey=${trainerKey || '(?)'} centerKey=${centroId || '(?)'} mesKey=${mesKey} actividadEspecialId=${ficha.actividadEspecialId} modalidadId=${ficha.modalidadId} segmentoId=${ficha.segmentoId} planSesiones=${ficha.planSesiones} numeroPersonas=${ficha.numPersonas} actividadEncontrada=${!!cat} modalidadEncontrada=${!!modalidad} segmentoEncontrado=${!!segmento} planEncontrado=${!!plan} precioPlan=${plan?.precio ?? '(?)'}`);
      if (!segmento || !plan) {
        // Nunca devolver 0 en silencio: una ficha con actividad especial activa y configurada
        // que no encuentra tarifa es un fallo real (catálogo/ficha desincronizados, id renombrado,
        // versión temporal rota...), no un caso normal de "sin actividad". Sin PII -- solo claves
        // técnicas, nunca nombre/email/teléfono del cliente.
        console.error(`[FINANZAS][TARIFA_NO_ENCONTRADA] trainerKey=${trainerKey || '(?)'} centerKey=${centroId || '(?)'} activityKey=${ficha.actividadEspecialId || '(?)'} modalityKey=${ficha.modalidadId || '(?)'} segmentKey=${ficha.segmentoId || '(?)'} sessions=${ficha.planSesiones ?? '(?)'} mesKey=${mesKey || '(?)'} · fallo en: ${!cat ? 'actividad no existe en catálogo' : !modalidad ? 'modalidad no existe' : !segmento ? 'segmento no existe' : 'ningún plan coincide con las sesiones'}`);
        return { total: 0, tipo: 'actividad_sin_tarifa', sesionesAgendadas: 0 };
      }
      const numPersonas = Math.max(1, parseInt(ficha.numPersonas) || 1);
      const precioTotal = segmento.porPersona ? plan.precio * numPersonas : plan.precio;
      const sesionesAgendadas = sesionesAgendadasFacturablesFichaMes(ficha, trainerKey, mesKey);
      if (modalidad.tipo === 'bono_vigencia') {
        const valorSesion = plan.sesiones ? precioTotal / plan.sesiones : 0;
        const totalBono = sesionesAgendadas * valorSesion;
        console.log(`[FINANZAS][ACTIVIDAD_CALCULO] trainerKey=${trainerKey || '(?)'} centerKey=${centroId || '(?)'} tipo=actividad_bono facturacionFinal=${totalBono}`);
        return { total: totalBono, tipo: 'actividad_bono', sesionesAgendadas, sesionesContratadas: plan.sesiones, precioTotal, actividadId: ficha.actividadEspecialId };
      }
      console.log(`[FINANZAS][ACTIVIDAD_CALCULO] trainerKey=${trainerKey || '(?)'} centerKey=${centroId || '(?)'} tipo=actividad_mensual facturacionFinal=${precioTotal}`);
      return { total: precioTotal, tipo: 'actividad_mensual', sesionesAgendadas, sesionesContratadas: plan.sesiones, precioTotal, actividadId: ficha.actividadEspecialId };
    }