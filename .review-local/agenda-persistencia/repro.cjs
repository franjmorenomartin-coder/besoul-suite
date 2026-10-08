'use strict';
// Reproducción P0 "el cambio aparece y luego desaparece" -- SOLO emulador.
const L = require('./lib.cjs');

const LAURA = 'laura.revision@example.test';
const CARLOS = 'carlos.revision@example.test';
const ADMIN = 'admin.revision@example.test';
const D = '2026-10-09'; // viernes de la semana visible (hoy 2026-10-08)
const k = h => `${D}_${h}`;
const sesion = (id, nombre) => ({ id, nombre, tipo: 'individual', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', telefono: '600000000', email: `${id}@example.test`, duracionMin: 45 });

const crear = (p, clave, id) => p.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [clave, id]);
const mover = (p, origen, destino) => p.evaluate(([o, d]) => soltarFichaEnCelda(d, '', o), [origen, destino]);
const borrar = (p, clave) => p.evaluate(c => { celdaNotaSeleccionada = c; borrarSesionAgenda(); }, clave);
const nota = (p, clave, txt) => p.evaluate(([c, t]) => { celdaNotaSeleccionada = c; document.getElementById('txt-nota-contenido').value = t; guardarNota(); }, [clave, txt]);
const verComo = (p, t) => p.evaluate(t => { document.getElementById('select-trainer-filter').value = t; cambiarEntrenadorVisto(); }, t);

const resultados = [];
async function salirConCambioPendiente(modo, gap) {
  await L.resetAgenda();
  const laura = await L.abrirSesion(LAURA, 'laura');
  await laura.mouse.click(5, 5);                                // interacción real (requisito del aviso de salida)
  await crear(laura, k('16:00'), 'cli_ana');                    // guardado diferido 350 ms
  await L.espera(gap);
  const t = 4000;
  if (modo === 'navegar') await laura.goto(laura.url().replace('agenda.html', 'index.html'), { timeout: t }).catch(() => {});
  if (modo === 'recargar') await laura.reload({ timeout: t }).catch(() => {});
  if (modo === 'cerrar') await laura.close({ runBeforeUnload: true }).catch(() => {});
  await L.espera(3500);
  const doc = await L.leerDoc();
  const r = { nombre: `salir (${modo}) a los ${gap} ms`, enServidor: !!(doc.agenda.laura || {})[k('16:00')], logs: laura.__logs };
  r.avisado = r.logs.some(l => /DIALOG beforeunload/.test(l));
  r.OK = r.enServidor;
  r.perdidaSilenciosa = !r.enServidor && !r.avisado;
  resultados.push(r); console.log(JSON.stringify(r, null, 1));
}

async function informe(nombre, trainer, claveEsperada, debeExistir, paginas, extra = {}) {
  await L.espera(2500);
  const doc = await L.leerDoc();
  const enServidor = !!((doc.agenda || {})[trainer] || {})[claveEsperada];
  const vistas = {};
  for (const [et, p] of Object.entries(paginas)) {
    const s = await L.pantalla(p, trainer);
    vistas[et] = s.claves.includes(claveEsperada);
  }
  // recarga de la primera página (sesión autora)
  const [etAutor, autor] = Object.entries(paginas)[0];
  await L.recargar(autor);
  if (extra.trasRecarga) await extra.trasRecarga(autor);
  await L.espera(800);
  const tras = (await L.pantalla(autor, trainer)).claves.includes(claveEsperada);
  const logs = Object.values(paginas).flatMap(p => p.__logs);
  const r = { nombre, claveEsperada, debeExistir, pantallaJustoTrasAccion: extra.inmediata, enServidor, vistas, [`${etAutor}_trasRecarga`]: tras, OK: enServidor === debeExistir && tras === debeExistir && Object.values(vistas).every(v => v === debeExistir), logs };
  resultados.push(r);
  console.log(JSON.stringify(r, null, 1));
}

const ESCENARIOS = {
  // E1: línea base -- crear sesión sin nadie más escribiendo.
  async E1_crear_simple() {
    await L.resetAgenda();
    const laura = await L.abrirSesion(LAURA, 'laura');
    const admin = await L.abrirSesion(ADMIN, 'admin'); await verComo(admin, 'laura');
    await crear(laura, k('10:00'), 'cli_rosa');
    await informe('E1 crear simple', 'laura', k('10:00'), true, { laura, admin });
  },
  // E2: Laura crea (guardado diferido 350 ms) y Carlos guarda SU agenda en esa ventana.
  async E2_crear_mientras_otro_PT_guarda() {
    await L.resetAgenda({ carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const carlos = await L.abrirSesion(CARLOS, 'carlos');
    const admin = await L.abrirSesion(ADMIN, 'admin'); await verComo(admin, 'laura');
    await crear(laura, k('10:00'), 'cli_rosa');
    await L.espera(60);
    await mover(carlos, k('08:00'), k('12:00')); // guardado inmediato del otro PT
    await informe('E2 crear mientras otro PT guarda', 'laura', k('10:00'), true, { laura, admin, carlos });
  },
  // E3: Laura borra una sesión (diferido) y Carlos guarda en la ventana.
  async E3_borrar_mientras_otro_PT_guarda() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') }, carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const carlos = await L.abrirSesion(CARLOS, 'carlos');
    await borrar(laura, k('10:00'));
    await L.espera(60);
    await mover(carlos, k('08:00'), k('12:00'));
    await informe('E3 borrar mientras otro PT guarda', 'laura', k('10:00'), false, { laura, carlos });
  },
  // E4: admin (viendo a Laura) y Laura editan la agenda de Laura casi a la vez.
  async E4_admin_y_PT_misma_agenda() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const admin = await L.abrirSesion(ADMIN, 'admin'); await verComo(admin, 'laura');
    await crear(laura, k('16:00'), 'cli_ana');      // diferido 350 ms
    await mover(admin, k('10:00'), k('11:00'));     // inmediato
    await L.espera(2500);
    const doc = await L.leerDoc();
    const sl = await L.pantalla(laura, 'laura'), sa = await L.pantalla(admin, 'laura');
    const r = { nombre: 'E4 admin + PT misma agenda', servidor: Object.keys(doc.agenda.laura || {}).sort(), pantallaLaura: sl.claves, pantallaAdmin: sa.claves, logs: [...laura.__logs, ...admin.__logs] };
    r.OK = r.servidor.includes(k('16:00')) && r.servidor.includes(k('11:00'));
    r.avisado = r.logs.some(l => /DIALOG.*NO se ha guardado/.test(l)); r.pantallasIgualAServidor = Object.entries(r).filter(([k]) => /^(pantalla|tab)/.test(k)).every(([, v]) => JSON.stringify(v) === JSON.stringify(r.servidor)); r.perdidaSilenciosa = !r.OK && !r.avisado; r.OK = r.OK || (r.avisado && r.pantallasIgualAServidor);
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E5: dos pestañas de la misma PT; la segunda edita antes de recibir el eco de la primera.
  async E5_dos_pestanas_misma_PT() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const t1 = await L.abrirSesion(LAURA, 'tab1');
    const t2 = await L.abrirSesion(LAURA, 'tab2', t1.__ctx);
    await crear(t1, k('16:00'), 'cli_ana');
    await crear(t2, k('18:00'), 'cli_eva');
    await L.espera(2500);
    const doc = await L.leerDoc();
    const r = { nombre: 'E5 dos pestañas misma PT', servidor: Object.keys(doc.agenda.laura || {}).sort(), tab1: (await L.pantalla(t1, 'laura')).claves, tab2: (await L.pantalla(t2, 'laura')).claves, logs: [...t1.__logs, ...t2.__logs] };
    r.OK = r.servidor.includes(k('16:00')) && r.servidor.includes(k('18:00'));
    r.avisado = r.logs.some(l => /DIALOG.*NO se ha guardado/.test(l)); r.pantallasIgualAServidor = Object.entries(r).filter(([k]) => /^(pantalla|tab)/.test(k)).every(([, v]) => JSON.stringify(v) === JSON.stringify(r.servidor)); r.perdidaSilenciosa = !r.OK && !r.avisado; r.OK = r.OK || (r.avisado && r.pantallasIgualAServidor);
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E6: dos ediciones seguidas de Laura (mover inmediato + crear) mientras Carlos guarda.
  async E6_dos_ediciones_seguidas_con_otro_PT() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') }, carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const carlos = await L.abrirSesion(CARLOS, 'carlos');
    await mover(laura, k('10:00'), k('11:00'));
    await mover(carlos, k('08:00'), k('12:00'));
    await L.espera(30);
    await crear(laura, k('16:00'), 'cli_ana');
    await L.espera(2500);
    const doc = await L.leerDoc();
    const r = { nombre: 'E6 dos ediciones seguidas + otro PT', servidor: Object.keys(doc.agenda.laura || {}).sort(), pantallaLaura: (await L.pantalla(laura, 'laura')).claves, logs: [...laura.__logs, ...carlos.__logs] };
    r.OK = r.servidor.includes(k('11:00')) && r.servidor.includes(k('16:00')) && !r.servidor.includes(k('10:00'));
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E7: nota de Laura + guardado de Carlos en la ventana (notas = mapa compartido completo).
  async E7_nota_y_otro_PT() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') }, carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const carlos = await L.abrirSesion(CARLOS, 'carlos');
    await nota(laura, k('10:00'), 'NOTA-LAURA-123');
    await crear(carlos, k('14:00'), 'cli_luis'); // diferido
    await L.espera(2500);
    const doc = await L.leerDoc();
    const r = { nombre: 'E7 nota + otro PT', notasServidor: doc.notas, notasLaura: (await L.pantalla(laura, 'laura')).notas, carlosServidor: Object.keys(doc.agenda.carlos || {}), logs: [...laura.__logs, ...carlos.__logs] };
    r.OK = JSON.stringify(doc.notas || {}).includes('NOTA-LAURA-123') && r.carlosServidor.includes(k('14:00'));
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E8: UN solo usuario, sin nadie más: mueve una sesión y enseguida crea otra.
  async E8_ediciones_rapidas_un_usuario() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    await L.espera(2500); // ya pasada la publicación inicial del login
    await mover(laura, k('10:00'), k('11:00'));   // guardado inmediato -> después publica portal
    await L.espera(Number(process.env.GAP || 150));
    await crear(laura, k('16:00'), 'cli_ana');     // guardado diferido 350 ms
    const inmediata = (await L.pantalla(laura, 'laura')).claves;
    await informe('E8 ediciones rápidas, un usuario', 'laura', k('16:00'), true, { laura }, { inmediata });
  },
  // E9: UN solo usuario crea una sesión nada más entrar (publicación inicial del portal en curso).
  async E9_crear_nada_mas_entrar() {
    await L.resetAgenda();
    const laura = await L.abrirSesion(LAURA, 'laura');
    await crear(laura, k('16:00'), 'cli_ana');
    const inmediata = (await L.pantalla(laura, 'laura')).claves;
    await informe('E9 crear nada más entrar', 'laura', k('16:00'), true, { laura }, { inmediata });
  },
  // E10: E8 repetido con borrado rápido tras crear.
  async E10_crear_y_borrar_rapido() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    await L.espera(2500);
    await crear(laura, k('16:00'), 'cli_ana');
    await L.espera(1200);                           // primer guardado hecho, publicación en curso
    await borrar(laura, k('10:00'));
    await informe('E10 crear y luego borrar', 'laura', k('10:00'), false, { laura });
  },
  // E11: recurrencia semanal (3 semanas) mientras otro PT guarda.
  async E11_recurrencia_mientras_otro_PT_guarda() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') }, carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const carlos = await L.abrirSesion(CARLOS, 'carlos');
    await laura.evaluate(c => {
      celdaNotaSeleccionada = c;
      let inp = document.getElementById('recurrent-until');
      if (!inp) { inp = document.createElement('input'); inp.id = 'recurrent-until'; document.body.appendChild(inp); }
      inp.value = '2026-10-30';
      crearRecurrenciaSemanalSesion();
    }, k('10:00'));
    await L.espera(60);
    await mover(carlos, k('08:00'), k('12:00'));
    await L.espera(2500);
    const esperadas = ['2026-10-09_10:00', '2026-10-16_10:00', '2026-10-23_10:00', '2026-10-30_10:00'];
    const doc = await L.leerDoc();
    const servidor = Object.keys(doc.agenda.laura || {}).sort();
    await L.recargar(laura);
    const trasRecarga = (await L.pantalla(laura, 'laura')).claves;
    const r = { nombre: 'E11 recurrencia + otro PT', servidor, trasRecarga, carlos: Object.keys(doc.agenda.carlos || {}), logs: [...laura.__logs, ...carlos.__logs].filter(l => !/DIALOG confirm/.test(l)) };
    r.OK = esperadas.every(c => servidor.includes(c) && trasRecarga.includes(c)) && r.carlos.includes(k('12:00'));
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E12: habilitar un slot fuera de disponibilidad (guardado inmediato) + otro PT guarda.
  async E12_habilitar_slot_disponibilidad() {
    await L.resetAgenda({ carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    // Laura con disponibilidad del viernes solo 06:00-20:00: las 21:00 quedan fuera
    const doc0 = await L.leerDoc(); doc0.disponibilidadReservas.laura.semanal['5'] = { activo: true, bloques: [{ inicio: '06:00', fin: '20:00' }] }; await L.escribirDoc(doc0);
    const laura = await L.abrirSesion(LAURA, 'laura');
    const carlos = await L.abrirSesion(CARLOS, 'carlos');
    const ok = await laura.evaluate(c => habilitarSlotSobreLaMarcha(c), k('21:00'));
    await mover(carlos, k('08:00'), k('12:00'));
    await L.espera(2500);
    const doc = await L.leerDoc();
    const disp = doc.disponibilidadReservas.laura;
    await L.recargar(laura);
    const enPantalla = await laura.evaluate(c => slotDisponibleParaClave(c, 'laura'), k('21:00'));
    const r = { nombre: 'E12 habilitar slot + otro PT', habilitadoLocal: ok, bloqueosServidor: disp.bloqueos, excepcionesServidor: Object.keys(disp.excepciones || {}), slotDisponibleTrasRecarga: enPantalla, logs: [...laura.__logs, ...carlos.__logs] };
    r.OK = enPantalla === true && Object.keys(doc.agenda.carlos).includes(k('12:00'));
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E13: aceptar una solicitud de reserva del portal -> sesión real en agenda + solicitud aceptada.
  async E13_aceptar_reserva() {
    await L.resetAgenda();
    await L.escribirRuta('besoulReservas/res_e2e_1', { trainerKey: 'laura', clientId: 'cli_rosa', clientName: 'Rosa Ficticia', fechaISO: D, hora: '17:00', clave: k('17:00'), estado: 'pendiente', tipoReserva: 'individual', token: 'tok_ficticio', createdAt: '2026-10-08T07:00:00.000Z' });
    const laura = await L.abrirSesion(LAURA, 'laura');
    await laura.waitForFunction(() => dbSolicitudesReservas && dbSolicitudesReservas.res_e2e_1, null, { timeout: 15000 });
    await laura.evaluate(() => aceptarSolicitudReserva('res_e2e_1'));
    await L.espera(2500);
    const doc = await L.leerDoc();
    const reserva = await L.leerRuta('besoulReservas/res_e2e_1');
    await L.recargar(laura);
    const trasRecarga = (await L.pantalla(laura, 'laura')).claves;
    const r = { nombre: 'E13 aceptar reserva', sesionEnServidor: !!(doc.agenda.laura || {})[k('17:00')], estadoReserva: reserva.estado, trasRecarga, logs: laura.__logs };
    r.OK = r.sesionEnServidor && reserva.estado === 'aceptada' && trasRecarga.includes(k('17:00'));
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E14: editar nota de sesión y recargar; otra sesión autorizada (admin) la ve.
  async E14_nota_recarga_y_admin() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const laura = await L.abrirSesion(LAURA, 'laura');
    const admin = await L.abrirSesion(ADMIN, 'admin'); await verComo(admin, 'laura');
    await nota(laura, k('10:00'), 'Nota E14');
    await L.espera(2500);
    const doc = await L.leerDoc();
    const admNotas = (await L.pantalla(admin, 'laura')).notas;
    await L.recargar(laura);
    const notasTras = (await L.pantalla(laura, 'laura')).notas;
    const clave = `laura__${k('10:00')}`;
    const r = { nombre: 'E14 nota + recarga + admin', servidor: doc.notas[clave], admin: admNotas[clave], trasRecarga: notasTras[clave], logs: [...laura.__logs, ...admin.__logs] };
    r.OK = r.servidor === 'Nota E14' && r.admin === 'Nota E14' && r.trasRecarga === 'Nota E14';
    resultados.push(r); console.log(JSON.stringify(r, null, 1));
  },
  // E15-E17: crear una sesión y SALIR de la Agenda mientras el cambio está pendiente (50 ms: en la
  // espera de 350 ms) o con el guardado ya en curso (450 ms: transacción en vuelo).
  //   E15 = navegar a otra página de la app · E16 = recargar · E17 = cerrar la pestaña
  // El arnés responde "Quedarse" si el navegador pide confirmación de salida (lo que el aviso recomienda).
  async E15a_navegar_en_espera() { await salirConCambioPendiente('navegar', 50); },
  async E15b_navegar_guardando() { await salirConCambioPendiente('navegar', 450); },
  async E16a_recargar_en_espera() { await salirConCambioPendiente('recargar', 50); },
  async E16b_recargar_guardando() { await salirConCambioPendiente('recargar', 450); },
  async E17a_cerrar_en_espera() { await salirConCambioPendiente('cerrar', 50); },
  async E17b_cerrar_guardando() { await salirConCambioPendiente('cerrar', 450); },
};

(async () => {
  const solo = process.argv.slice(2);
  const repeticiones = Number(process.env.REP || 1);
  for (const [n, f] of Object.entries(ESCENARIOS)) {
    if (solo.length && !solo.some(s => n.startsWith(s))) continue;
    for (let i = 0; i < repeticiones; i++) {
      console.log(`\n===== ${n} (rep ${i + 1}) =====`);
      try { await f(); } catch (e) { console.log('ERROR escenario', e.message); resultados.push({ nombre: n, OK: false, error: e.message }); }
      const b = await L.navegador(); for (const c of b.contexts()) await c.close();
    }
  }
  console.log('\n===== RESUMEN =====');
  resultados.forEach(r => console.log(`${r.OK ? 'OK   ' : 'FALLO'}  ${r.nombre}${r.perdidaSilenciosa ? '  (PÉRDIDA SILENCIOSA)' : ''}`));
  await Promise.race([L.cerrar(), L.espera(5000)]);
  process.exit(0);
})();
