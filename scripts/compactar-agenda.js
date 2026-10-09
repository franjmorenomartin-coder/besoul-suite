// HOTFIX-V1-AGENDA-SYNC-P0 (2026-10-09) -- COMPACTACIÓN de besoulSuite/agenda (documento a 17 KB del
// límite de 1 MiB de Firestore). Se ejecuta en la consola del navegador con la app abierta y sesión de
// ADMINISTRADOR (no necesita claves de servicio). No se carga desde ninguna página de la app.
//
//   1) Pegar este archivo entero en la consola de app.besoulfitness.com/agenda.html (admin).
//   2) await compactarAgendaBesoul()                    -> SIMULACIÓN: no escribe nada, informa.
//   3) await compactarAgendaBesoul({ ejecutar: true })  -> escribe (solo con autorización).
//
// Qué hace: quita de cada SESIÓN (agenda.<trainer>.<hueco>) cinco campos que son copias de la ficha y
// nunca se leen desde una sesión: contratoCliente, restriccionesReservas, reservaToken,
// reservasBloqueadasTexto, reservasOnlineActivas. La ficha (clientes.<trainer>) los conserva intactos.
// No toca clientes, disponibilidad, bloqueos, histórico, notas, pruebas CRM ni ningún otro campo.
//
// Seguridad: una única transacción (si alguien guarda a la vez, Firestore la repite con los datos
// nuevos: nunca pisa un cambio ajeno). ANTES de escribir verifica, entrenador a entrenador, que el
// número de sesiones y sus huecos son idénticos y que cada sesión conserva exactamente todos los demás
// campos. Si cualquier verificación falla, no escribe nada.
(function () {
  const CAMPOS = ['contratoCliente', 'restriccionesReservas', 'reservaToken', 'reservasBloqueadasTexto', 'reservasOnlineActivas'];
  const LIMITE = 1048576;
  const enc = new TextEncoder();
  function tamano(v) {
    if (v === null || v === undefined || typeof v === 'boolean') return 1;
    if (typeof v === 'number') return 8;
    if (typeof v === 'string') return enc.encode(v).length + 1;
    if (typeof v.toDate === 'function') return 8;
    if (Array.isArray(v)) return v.reduce((a, x) => a + tamano(x), 0);
    return Object.keys(v).reduce((a, k) => a + enc.encode(k).length + 1 + tamano(v[k]), 0);
  }
  const tamanoDoc = d => tamano(d) + 'besoulSuite/agenda'.length + 1 + 16 + 32;
  const esPlano = v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.toDate !== 'function';
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() };
    if (esPlano(v)) { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); }); return o; }
    return v;
  }
  const igual = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  function resumenDisp(d) {
    const r = {};
    Object.keys(d.disponibilidadReservas || {}).forEach(t => { const x = d.disponibilidadReservas[t] || {}; r[t] = JSON.stringify(canon(x)).length; });
    return r;
  }

  window.compactarAgendaBesoul = async function ({ ejecutar = false } = {}) {
    const fs = firebase.firestore();
    const ref = fs.collection('besoulSuite').doc('agenda');
    const informe = await fs.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const d = snap.data();
      const antes = tamanoDoc(d);
      const nuevoAgenda = {};
      const porEntrenador = {};
      const args = [];
      Object.keys(d.agenda || {}).forEach(t => {
        const mapa = d.agenda[t] || {};
        const limpio = {};
        let compactadas = 0;
        Object.keys(mapa).forEach(clave => {
          const s = mapa[clave];
          if (!esPlano(s) || !CAMPOS.some(c => c in s)) { limpio[clave] = s; return; }
          const c = { ...s };
          CAMPOS.forEach(k => { delete c[k]; });
          limpio[clave] = c;
          compactadas++;
        });
        // Verificaciones (todas obligatorias):
        const clavesIguales = igual(Object.keys(mapa).sort(), Object.keys(limpio).sort());
        const restoIgual = Object.keys(mapa).every(clave => {
          const a = mapa[clave], b = limpio[clave];
          if (!esPlano(a)) return igual(a, b);
          const sinCampos = { ...a }; CAMPOS.forEach(k => { delete sinCampos[k]; });
          return igual(sinCampos, b);
        });
        if (!clavesIguales || !restoIgual) throw new Error(`Verificación fallida en la agenda de ${t}: no se escribe nada.`);
        porEntrenador[t] = { sesiones: Object.keys(mapa).length, compactadas, bytesAntes: tamano(mapa), bytesDespues: tamano(limpio) };
        nuevoAgenda[t] = limpio;
        if (compactadas) args.push(new firebase.firestore.FieldPath('agenda', t), limpio);
      });
      const despuesDoc = { ...d, agenda: nuevoAgenda };
      const despues = tamanoDoc(despuesDoc);
      // Nada fuera de "agenda" cambia (comprobación explícita de clientes/disponibilidad/histórico/notas/pruebas).
      ['clientes', 'disponibilidadReservas', 'historicoClientes', 'notas', 'pruebasCRM'].forEach(campo => {
        if (!igual(d[campo], despuesDoc[campo])) throw new Error(`Verificación fallida: ${campo} cambiaría.`);
      });
      const r = {
        modo: ejecutar ? 'EJECUTADO' : 'SIMULACIÓN (no se ha escrito nada)',
        bytesAntes: antes, bytesDespues: despues, liberados: antes - despues,
        margenAntes: LIMITE - antes, margenDespues: LIMITE - despues,
        sesionesTotales: Object.values(porEntrenador).reduce((a, x) => a + x.sesiones, 0),
        sesionesCompactadas: Object.values(porEntrenador).reduce((a, x) => a + x.compactadas, 0),
        entrenadoresAfectados: args.length / 2,
        fichasTotales: Object.values(d.clientes || {}).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0),
        disponibilidad: resumenDisp(d),
        porEntrenador,
      };
      if (ejecutar && args.length) tx.update(ref, ...args);
      return r;
    });
    if (ejecutar) {
      const tras = (await ref.get({ source: 'server' })).data();
      informe.bytesReleidosDelServidor = tamanoDoc(tras);
      informe.sesionesReleidas = Object.values(tras.agenda || {}).reduce((a, x) => a + Object.keys(x || {}).length, 0);
      informe.disponibilidadIntacta = igual(resumenDisp(tras), informe.disponibilidad);
    }
    console.log('[COMPACTACIÓN AGENDA]', informe);
    return informe;
  };
  console.log('compactarAgendaBesoul() listo. Simulación: await compactarAgendaBesoul()  ·  Ejecutar: await compactarAgendaBesoul({ ejecutar: true })');
})();
