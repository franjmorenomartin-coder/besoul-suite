// ARQ-V1-MIGRACION-IMPL — RESPALDO COMPLETO desde la consola del navegador (sesión de ADMINISTRADOR
// en app.besoulfitness.com), sin claves de servicio. Solo LEE. Mismo procedimiento que el respaldo
// verificado del 13-oct. Descarga un JSON y muestra su SHA-256 (calculado ANTES de descargar).
//   1) Pegar este archivo en la consola.   2) await respaldoBesoul()
//   3) En el equipo: sha256sum <archivo> debe coincidir con el hash mostrado.
(function () {
  window.respaldoBesoul = async function () {
    const fs = firebase.firestore();
    const ser = v => { if (v === null || v === undefined) return v; if (typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() }; if (Array.isArray(v)) return v.map(ser); if (typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = ser(v[k]); }); return o; } return v; };
    const out = { exportadoEn: new Date().toISOString(), por: (firebase.auth().currentUser || {}).email || '', versionApp: typeof BS_APP_BUILD_TAG !== 'undefined' ? BS_APP_BUILD_TAG : '' };
    const [ag, fin] = await Promise.all([fs.collection('besoulSuite').doc('agenda').get({ source: 'server' }), fs.collection('besoulSuite').doc('finanzas').get({ source: 'server' })]);
    out.besoulSuite = { agenda: ser(ag.data()), finanzas: ser(fin.data()) };
    out.agendaUpdateTime = ag.updateTime ? ag.updateTime.toDate().toISOString() : null;
    for (const col of ['besoulUsers', 'besoulLeads', 'besoulReservas', 'besoulSolicitudesEliminacion', 'besoulNotifications', 'besoulValoracionRegistry']) {
      try { const s = await fs.collection(col).get({ source: 'server' }); out[col] = s.docs.map(d => ({ id: d.id, data: ser(d.data()) })); } catch (e) { out[col] = { error: e.code }; }
    }
    const d = ag.data() || {};
    const tks = Array.from(new Set([...Object.keys(d.clientes || {}), ...Object.keys(d.agenda || {}), ...Object.keys(d.disponibilidadReservas || {})]));
    out.besoulPublicSchedule = (await Promise.all(tks.map(t => fs.collection('besoulPublicSchedule').doc(t).get().then(s => (s.exists ? { id: t, data: ser(s.data()) } : null)).catch(e => ({ id: t, error: e.code }))))).filter(Boolean);
    const tokens = []; Object.values(d.clientes || {}).forEach(l => (l || []).forEach(c => { if (c && c.reservaToken) tokens.push(c.reservaToken); }));
    out.besoulPublicClients = [];
    for (let i = 0; i < tokens.length; i += 40) {
      const parte = await Promise.all(tokens.slice(i, i + 40).map(t => fs.collection('besoulPublicClients').doc(t).get().then(s => (s.exists ? { id: t, data: ser(s.data()) } : null)).catch(e => ({ id: t, error: e.code }))));
      out.besoulPublicClients.push(...parte.filter(Boolean));
    }
    const texto = JSON.stringify(out);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const nombre = `besoul-respaldo-${out.exportadoEn.replace(/[:.]/g, '-')}.json`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' })); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    const r = { nombre, sha256: hash, bytes: new TextEncoder().encode(texto).length, sesiones: Object.values(d.agenda || {}).reduce((n, x) => n + Object.keys(x || {}).length, 0), fichas: Object.values(d.clientes || {}).reduce((n, x) => n + (Array.isArray(x) ? x.length : 0), 0), agendaUpdateTime: out.agendaUpdateTime, errores: Object.keys(out).filter(k => out[k] && out[k].error) };
    console.log('[RESPALDO]', r);
    return r;
  };
  console.log('Listo: await respaldoBesoul()');
})();
