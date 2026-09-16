function ahoraISO() { return new Date().toISOString(); }

function claveAgendaDesdeFechaPrueba(iso) {
  if (!iso) return { ok:false, error:'La prueba no tiene fecha.' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { ok:false, error:'La fecha de prueba no es válida.' };
  const inicio = 6 * 60;
  const fin = 22 * 60;
  const duracion = 45;
  const total = d.getHours() * 60 + d.getMinutes();
  if (total < inicio || total + duracion > fin) {
    return { ok:false, error:'La prueba queda fuera del horario visible de agenda (06:00-22:00).' };
  }
  let slot = inicio + Math.round((total - inicio) / duracion) * duracion;
  if (slot + duracion > fin) slot = fin - duracion;
  if (slot < inicio) slot = inicio;
  const franja = formatoHoraAgendaDesdeMinutos(slot);
  return { ok:true, clave:`${formatoFechaAgendaLocalDesdeDate(d)}_${franja}`, franja, normalizada: slot !== total };
}

function formatoHoraAgendaDesdeMinutos(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function formatoFechaAgendaLocalDesdeDate(fecha) {
  const pad = n => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth()+1)}-${pad(fecha.getDate())}`;
}

function debeVersePruebaEnAgenda(leadData) {
  return leadData && leadData.estado === 'Prueba agendada' && !!leadData.fechaPrueba && !!leadData.trainerKey;
}

function objetoPruebaAgendaCRM(leadId, leadData, claveInfo) {
  return {
    id: `crm_trial_${leadId}`,
    tipo: 'lead',
    tipoCita: 'pruebaCRM',
    esPruebaCRM: true,
    noSumaFacturacion: true,
    nombre: leadData.nombre || 'Lead CRM',
    telefono: leadData.telefono || '',
    email: leadData.email || '',
    modalidad: 'Prueba CRM',
    tipoPrueba: leadData.tipoPrueba || 'Valoración inicial',
    duracionPrueba: leadData.duracionPrueba || '45 min',
    factor: 1,
    tipoCompra: 'Prueba CRM',
    color: 'cyan',
    descuentoPct: 0,
    estadoCliente: 'lead',
    leadId,
    trainerKey: leadData.trainerKey || '',
    trainerName: leadData.trainerName || textoTrainer(leadData.trainerKey),
    centroId: leadData.centroId || 'sin-centro',
    centroNombre: leadData.centroNombre || textoCentro(leadData.centroId),
    fuenteCaptacion: leadData.fuente || '',
    medioCaptacion: leadData.medioCaptacion || '',
    notaEntrenadorPrueba: leadData.notaEntrenadorPrueba || '',
    notasComercialesCRM: leadData.notas || '',
    objetivoCliente: leadData.objetivo || '',
    horarioPreferido: leadData.horarioPreferido || '',
    fechaPrueba: leadData.fechaPrueba || '',
    franjaAgenda: claveInfo?.franja || '',
    rentabilidadCRM: 0,
    creadoDesdeCRMEn: ahoraISO(),
    updatedAt: ahoraISO()
  };
}

async function sincronizarPruebaAgendaDesdeLead(leadId, leadData, avisar = true) {
  if (!leadId || !db) return { visible:false };

  const agendaRef = db.collection('besoulSuite').doc('agenda');
  const borrados = {};
  const resultado = { visible:false, clave:'', trainerKey:leadData.trainerKey || '', error:'' };

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(agendaRef);
      const agendaData = snap.exists ? snap.data() : {};
      const agenda = agendaData.agenda || {};
      const pruebasCRM = agendaData.pruebasCRM || {};
      const camposSimples = {
        ultimaActualizacionLocal: ahoraISO(),
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      };
      // FIX-PT-AVAILABILITY-PERSISTENCE-V2 (mismo hallazgo aplicado aquí): un trainerKey puede
      // legítimamente contener un punto (causa raíz real ya confirmada en agenda.html con
      // "fran.jmorenomartin"). Antes, estas rutas se construían como STRINGS concatenados
      // ("agenda.<trainerKey>.<clave>") dentro de un objeto para tx.update() -- Firestore
      // interpreta CADA punto de esa cadena como separador de ruta anidada real, así que un
      // trainerKey con punto habría partido la ruta en más niveles de los que existen realmente.
      // rutasAnidadas guarda los segmentos SIN concatenar; FieldPath(...) los usa como literales,
      // sin volver a partirlos, al construir la llamada final a tx.update() (forma varargs).
      const rutasAnidadas = [];

      // Borrar cualquier prueba anterior de este lead, tanto del mapa principal agenda
      // como del mapa auxiliar pruebasCRM. Usamos FieldValue.delete() sobre rutas exactas
      // para evitar que Firestore ignore cambios por mezcla parcial de mapas.
      Object.keys(agenda || {}).forEach(trainerKey => {
        const agendaTrainer = agenda[trainerKey] || {};
        Object.keys(agendaTrainer).forEach(clave => {
          const cita = agendaTrainer[clave];
          if (cita && cita.esPruebaCRM === true && cita.leadId === leadId) {
            rutasAnidadas.push({ segmentos: ['agenda', trainerKey, clave], valor: firebase.firestore.FieldValue.delete() });
            if (!borrados[trainerKey]) borrados[trainerKey] = {};
            borrados[trainerKey][clave] = true;
          }
        });
      });

      Object.keys(pruebasCRM || {}).forEach(trainerKey => {
        const agendaTrainer = pruebasCRM[trainerKey] || {};
        Object.keys(agendaTrainer).forEach(clave => {
          const cita = agendaTrainer[clave];
          if (cita && cita.leadId === leadId) {
            rutasAnidadas.push({ segmentos: ['pruebasCRM', trainerKey, clave], valor: firebase.firestore.FieldValue.delete() });
            if (!borrados[trainerKey]) borrados[trainerKey] = {};
            borrados[trainerKey][clave] = true;
          }
        });
      });

      if (debeVersePruebaEnAgenda(leadData)) {
        const claveInfo = claveAgendaDesdeFechaPrueba(leadData.fechaPrueba);
        if (!claveInfo.ok) {
          resultado.error = claveInfo.error;
        } else {
          const trainerKey = leadData.trainerKey;
          const ocupadaAgenda = agenda?.[trainerKey]?.[claveInfo.clave];
          const ocupadaPrueba = pruebasCRM?.[trainerKey]?.[claveInfo.clave];
          const ocupadaSeBorra = !!(borrados?.[trainerKey]?.[claveInfo.clave]);
          const ocupada = !ocupadaSeBorra && (ocupadaAgenda || ocupadaPrueba);

          if (ocupada) {
            resultado.error = `La franja ${claveInfo.clave.replace('_', ' ')} ya está ocupada por ${ocupada.nombre || 'otra cita'}. Lead guardado, pero la prueba no se ha colocado en Agenda.`;
          } else {
            const citaPrueba = objetoPruebaAgendaCRM(leadId, leadData, claveInfo);
            rutasAnidadas.push({ segmentos: ['agenda', trainerKey, claveInfo.clave], valor: citaPrueba });
            rutasAnidadas.push({ segmentos: ['pruebasCRM', trainerKey, claveInfo.clave], valor: citaPrueba });
            resultado.visible = true;
            resultado.clave = claveInfo.clave;

            if (claveInfo.normalizada && avisar) {
              setTimeout(() => alert(`La prueba se mostrará en Agenda en la franja más cercana: ${claveInfo.clave.replace('_', ' ')}.`), 50);
            }
          }
        }
      }

      // Hallazgo real (confirmado contra el código fuente del SDK de Firestore, mismo bug ya
      // corregido en agenda.html/guardarEstadoNubeAgenda y finanzas.html/
      // guardarCatalogoActividadesNube): tx.set(ref, payload, {merge:true}) trata una clave con
      // punto DENTRO del payload (p.ej. "agenda.veronica.2026-09-05_10:00") como un nombre de
      // campo literal, no como ruta anidada -- la prueba nunca llegaba a verse realmente en
      // Agenda pese a no dar ningún error. tx.update() sí interpreta las claves con punto del
      // payload como ruta anidada real (incluido con FieldValue.delete(), su caso de uso
      // estándar) -- PERO solo si esa clave nunca tiene más puntos de los que representan
      // niveles reales, algo que ya no podemos garantizar si trainerKey contiene un punto (ver
      // rutasAnidadas arriba). Se pasa cada ruta como FieldPath explícito (forma varargs) en vez
      // de reconstruir el string, para que un trainerKey con punto nunca se parta de más.
      const argsUpdate = [];
      Object.keys(camposSimples).forEach(k => argsUpdate.push(k, camposSimples[k]));
      rutasAnidadas.forEach(r => argsUpdate.push(new firebase.firestore.FieldPath(...r.segmentos), r.valor));
      tx.update(agendaRef, ...argsUpdate);
    });

    await db.collection('besoulLeads').doc(leadId).set({
      agendaPruebaVisible: resultado.visible,
      agendaPruebaClave: resultado.clave || '',
      agendaPruebaTrainerKey: resultado.trainerKey || '',
      agendaPruebaError: resultado.error || '',
      agendaPruebaSyncAt: ahoraISO()
    }, { merge:true });

    if (resultado.error && avisar) alert(resultado.error);
    return resultado;
  } catch (err) {
    console.error('Error sincronizando prueba CRM con Agenda:', err);
    const msg = 'Lead guardado, pero no se ha podido sincronizar la prueba con Agenda. Revisa permisos/reglas o vuelve a guardar.';
    await db.collection('besoulLeads').doc(leadId).set({
      agendaPruebaVisible: false,
      agendaPruebaClave: '',
      agendaPruebaTrainerKey: resultado.trainerKey || '',
      agendaPruebaError: msg,
      agendaPruebaSyncAt: ahoraISO()
    }, { merge:true }).catch(() => {});
    if (avisar) alert(msg);
    return { ...resultado, visible:false, error:msg };
  }
}