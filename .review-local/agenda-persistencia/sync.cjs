'use strict';
// HOTFIX-V1-AGENDA-SYNC-P0 -- reproducción multiusuario (entrenador + administración) contra el
// Firebase Emulator con datos ficticios. "Laura Ficticia" hace el papel del entrenador del caso real
// (Miguel Fenech); el admin ve su agenda desde OTRO contexto de navegador (otra cookie/sesión Auth).
// El estado final se comprueba SIEMPRE leyendo Firestore directamente, además de cada pantalla.
//
//   node sync.cjs                # todos los escenarios
//   node sync.cjs S2 S10         # solo los que empiezan por esos prefijos
//   LAT=300 node sync.cjs        # con latencia de red añadida en todos los navegadores
const L = require('./lib.cjs');

const LAURA = 'laura.revision@example.test';
const CARLOS = 'carlos.revision@example.test';
const ADMIN = 'admin.revision@example.test';
// Semana visible = semana actual (hoy 2026-10-09, viernes). Lunes 05 .. domingo 11.
const D = '2026-10-09';
const k = (h, d = D) => `${d}_${h}`;
const sesion = (id, nombre) => ({ id, nombre, tipo: 'individual', modalidad: 'Individual Plan', factor: 1, tipoCompra: 'Mensualidad', color: 'amber', descuentoPct: 0, estadoCliente: 'activo', telefono: '600000000', email: `${id}@example.test`, duracionMin: 45 });

const crear = (p, clave, id) => p.evaluate(([c, i]) => soltarFichaEnCelda(c, i), [clave, id]);
const mover = (p, origen, destino) => p.evaluate(([o, d]) => soltarFichaEnCelda(d, '', o), [origen, destino]);
const verComo = (p, t) => p.evaluate(t => { document.getElementById('select-trainer-filter').value = t; cambiarEntrenadorVisto(); }, t);
const ocultarSlot = (p, clave) => p.evaluate(c => { ocultarSlotDisponibilidad(c); renderAgenda(); }, clave);
// "Bloquear un día" tal como lo hace un PT: + Disponibilidad -> "solo esta semana" -> desmarcar el día.
async function bloquearDia(p, dia /* 1=lunes..7=domingo */) {
  return p.evaluate(async d => {
    abrirModalDisponibilidadReservas();
    document.getElementById('disp-recurrente-semanal').checked = false;
    document.getElementById(`disp-active-${d}`).checked = false;
    setDiaDisponibilidadActivoVisual(d);
    await guardarDisponibilidadReservas();
  }, dia);
}
// Abre el formulario de disponibilidad y lo deja abierto (para guardarlo más tarde).
const abrirDisp = p => p.evaluate(() => abrirModalDisponibilidadReservas());
async function guardarDispAbierta(p, { recurrente = false, cambiarDia = null } = {}) {
  return p.evaluate(async ([rec, dia]) => {
    document.getElementById('disp-recurrente-semanal').checked = rec;
    if (dia) { const el = document.getElementById(`disp-${dia}-b1-end`); el.value = '13:00'; }
    await guardarDisponibilidadReservas();
  }, [recurrente, cambiarDia]);
}
// Retiene los snapshots en tiempo real de una página (simula un canal de escucha lento/atascado:
// proxy, antivirus con inspección HTTPS, long-polling...). Las relecturas explícitas no se retienen.
const retenerSnapshots = p => p.evaluate(() => {
  if (!window.__aplicarOriginal) window.__aplicarOriginal = aplicarEstadoNubeAgenda;
  window.__retenidos = [];
  window.aplicarEstadoNubeAgenda = function (data, opciones) {
    if (!opciones && window.__retener) { window.__retenidos.push(data); return; }
    return window.__aplicarOriginal(data, opciones);
  };
  window.__retener = true;
});
const soltarSnapshots = p => p.evaluate(() => { window.__retener = false; const r = window.__retenidos || []; window.__retenidos = []; if (r.length) window.__aplicarOriginal(r[r.length - 1]); return r.length; });

async function estadoPagina(p, t) {
  return p.evaluate(t => ({
    sesiones: Object.keys((dbAgenda || {})[t] || {}).filter(c => !String(c).includes('__')).sort(),
    excepciones: JSON.parse(JSON.stringify(((dbDisponibilidadReservas || {})[t] || {}).excepciones || {})),
    bloqueos: JSON.parse(JSON.stringify(((dbDisponibilidadReservas || {})[t] || {}).bloqueos || {})),
  }), t);
}
const avisosNoGuardado = p => p.__logs.filter(l => /DIALOG/.test(l) && /NO se ha guardado|No se ha podido|no se ha guardado/i.test(l));
const diaBloqueado = (disp, fecha) => !!(disp && disp.excepciones && disp.excepciones[fecha] && disp.excepciones[fecha].activo === false);

const resultados = [];
function registrar(r) { resultados.push(r); console.log(JSON.stringify(r, null, 1)); }

async function abrirPar(agendaExtra) {
  await L.resetAgenda(agendaExtra);
  const pt = await L.abrirSesion(LAURA, 'PT');
  const admin = await L.abrirSesion(ADMIN, 'ADMIN'); await verComo(admin, 'laura');
  await L.espera(1500); // publicación inicial tras login
  return { pt, admin };
}

const ESCENARIOS = {
  // S1: el PT bloquea un día y oculta un slot; el admin, que ya tiene abierta su agenda, debe verlo.
  async S1_PT_bloquea_admin_observa() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await bloquearDia(pt, 5);                  // viernes 09 (tiene una sesión)
    await ocultarSlot(pt, k('18:00', '2026-10-08'));
    await L.espera(2500);
    const doc = await L.leerDoc();
    const ea = await estadoPagina(admin, 'laura');
    const r = { nombre: 'S1 PT bloquea, admin observa', servidorBloqueado: diaBloqueado(doc.disponibilidadReservas.laura, D), adminVeBloqueo: !!(ea.excepciones[D] && ea.excepciones[D].activo === false), adminVeSlotOculto: !!(ea.bloqueos['2026-10-08'] || []).includes('18:00'), sesionSigue: !!doc.agenda.laura[k('10:00')], avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)] };
    r.OK = r.servidorBloqueado && r.adminVeBloqueo && r.adminVeSlotOculto && r.sesionSigue;
    registrar(r);
  },
  // S2: el admin modifica OTRA sesión mientras el PT trabaja (cambios compatibles, casi simultáneos).
  async S2_admin_y_PT_sesiones_distintas() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia'), [k('12:00')]: sesion('cli_ana', 'Ana Ficticia') } });
    await Promise.all([mover(pt, k('10:00'), k('11:00')), mover(admin, k('12:00'), k('13:00'))]);
    await L.espera(3000);
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const r = { nombre: 'S2 admin y PT mueven sesiones distintas a la vez', servidor: srv, pantallaPT: (await estadoPagina(pt, 'laura')).sesiones, pantallaAdmin: (await estadoPagina(admin, 'laura')).sesiones, avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)] };
    r.ambosGuardados = srv.includes(k('11:00')) && srv.includes(k('13:00')) && !srv.includes(k('10:00')) && !srv.includes(k('12:00'));
    r.pantallasIgualServidor = JSON.stringify(r.pantallaPT) === JSON.stringify(srv) && JSON.stringify(r.pantallaAdmin) === JSON.stringify(srv);
    r.OK = r.ambosGuardados && r.pantallasIgualServidor;
    registrar(r);
  },
  // S3: el PT bloquea un día mientras el admin crea una sesión ese mismo día (cambios distintos).
  async S3_PT_bloquea_admin_crea() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await Promise.all([bloquearDia(pt, 4), crear(admin, k('16:00'), 'cli_ana')]);
    await L.espera(3000);
    const doc = await L.leerDoc();
    const r = { nombre: 'S3 PT bloquea jueves + admin crea sesión a la vez', bloqueoEnServidor: diaBloqueado(doc.disponibilidadReservas.laura, '2026-10-08'), sesionAdminEnServidor: !!doc.agenda.laura[k('16:00')], avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)] };
    r.OK = r.bloqueoEnServidor && r.sesionAdminEnServidor;
    registrar(r);
  },
  // S4: ambos modifican disponibilidad y sesiones.
  async S4_ambos_disponibilidad_y_sesiones() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia'), [k('12:00')]: sesion('cli_ana', 'Ana Ficticia') } });
    await Promise.all([
      (async () => { await ocultarSlot(pt, k('19:00', '2026-10-06')); await mover(pt, k('10:00'), k('09:00')); })(),
      (async () => { await ocultarSlot(admin, k('20:00', '2026-10-07')); await crear(admin, k('17:00'), 'cli_eva'); })(),
    ]);
    await L.espera(3000);
    const doc = await L.leerDoc();
    const d = doc.disponibilidadReservas.laura;
    const srv = Object.keys(doc.agenda.laura).sort();
    const r = { nombre: 'S4 ambos: disponibilidad + sesiones', servidor: srv, bloqueos: d.bloqueos, avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)] };
    r.OK = (d.bloqueos['2026-10-06'] || []).includes('19:00') && (d.bloqueos['2026-10-07'] || []).includes('20:00') && srv.includes(k('09:00')) && srv.includes(k('17:00')) && !srv.includes(k('10:00'));
    registrar(r);
  },
  // S5: cambios rápidos consecutivos de ambos.
  async S5_rafagas() {
    const { pt, admin } = await abrirPar({ laura: { [k('08:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await Promise.all([
      (async () => { for (const h of ['09:00', '10:00', '11:00']) { await mover(pt, k(Number(h.slice(0, 2)) - 1 < 10 ? `0${Number(h.slice(0, 2)) - 1}:00` : `${Number(h.slice(0, 2)) - 1}:00`), k(h)); await L.espera(120); } })(),
      (async () => { await crear(admin, k('15:00'), 'cli_ana'); await L.espera(100); await crear(admin, k('17:00'), 'cli_eva'); await L.espera(100); await ocultarSlot(admin, k('20:00')); })(),
    ]);
    await L.espera(3500);
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const r = { nombre: 'S5 ráfagas de cambios de ambos', servidor: srv, bloqueos: doc.disponibilidadReservas.laura.bloqueos, pantallaPT: (await estadoPagina(pt, 'laura')).sesiones, pantallaAdmin: (await estadoPagina(admin, 'laura')).sesiones, avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)] };
    r.OK = JSON.stringify(srv) === JSON.stringify([k('11:00'), k('15:00'), k('17:00')]) && (r.bloqueos[D] || []).includes('20:00') && JSON.stringify(r.pantallaPT) === JSON.stringify(srv) && JSON.stringify(r.pantallaAdmin) === JSON.stringify(srv);
    registrar(r);
  },
  // S6 + S7: recargar ambas pantallas y cerrar/reabrir ambas sesiones -> lo mismo que el servidor.
  async S6_S7_recargar_y_reabrir() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await bloquearDia(pt, 3);
    await crear(admin, k('16:00'), 'cli_ana');
    await L.espera(2500);
    await L.recargar(pt); await L.recargar(admin); await verComo(admin, 'laura');
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const tras = { pt: await estadoPagina(pt, 'laura'), admin: await estadoPagina(admin, 'laura') };
    await pt.__ctx.close(); await admin.__ctx.close();
    const pt2 = await L.abrirSesion(LAURA, 'PT2'); const admin2 = await L.abrirSesion(ADMIN, 'ADMIN2'); await verComo(admin2, 'laura');
    const reab = { pt: await estadoPagina(pt2, 'laura'), admin: await estadoPagina(admin2, 'laura') };
    const r = { nombre: 'S6/S7 recargar y reabrir', servidor: srv, bloqueoServidor: diaBloqueado(doc.disponibilidadReservas.laura, '2026-10-07') };
    r.OK = r.bloqueoServidor && srv.includes(k('16:00')) && [tras.pt, tras.admin, reab.pt, reab.admin].every(e => JSON.stringify(e.sesiones) === JSON.stringify(srv) && e.excepciones['2026-10-07'] && e.excepciones['2026-10-07'].activo === false);
    registrar(r);
  },
  // S8: desconexión temporal del PT con un cambio hecho sin conexión; vuelve la conexión.
  async S8_desconexion_temporal() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await pt.__ctx.setOffline(true);
    await crear(pt, k('16:00'), 'cli_ana');
    await L.espera(4000);
    const durante = await estadoPagina(pt, 'laura');
    const statusDurante = await pt.evaluate(() => (document.getElementById('bs-estado-guardado') || {}).innerText || '(sin indicador)');
    await crear(admin, k('18:00'), 'cli_eva');
    await pt.__ctx.setOffline(false);
    await L.espera(8000);
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const ept = await estadoPagina(pt, 'laura');
    const r = { nombre: 'S8 desconexión temporal del PT', pantallaPTSinConexion: durante.sesiones, indicadorSinConexion: statusDurante, servidor: srv, pantallaPT: ept.sesiones, avisos: avisosNoGuardado(pt), logsPT: pt.__logs.slice(-6) };
    // Correcto: o se guarda al volver la conexión, o el PT recibe un aviso claro y conserva el cambio
    r.cambioPTGuardado = srv.includes(k('16:00'));
    r.cambioAdminIntacto = srv.includes(k('18:00'));
    r.perdidaSilenciosa = !r.cambioPTGuardado && r.avisos.length === 0;
    r.OK = r.cambioAdminIntacto && r.cambioPTGuardado && JSON.stringify(ept.sesiones) === JSON.stringify(srv);
    registrar(r);
  },
  // S9: el admin alterna entre agendas de distintos entrenadores mientras ellos trabajan.
  async S9_admin_alterna_entrenadores() {
    await L.resetAgenda({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') }, carlos: { [k('08:00')]: sesion('cli_tomas', 'Tomas Ficticio') } });
    const pt = await L.abrirSesion(LAURA, 'PT'); const carlos = await L.abrirSesion(CARLOS, 'CARLOS');
    const admin = await L.abrirSesion(ADMIN, 'ADMIN');
    await verComo(admin, 'laura'); await crear(admin, k('12:00'), 'cli_ana');
    await verComo(admin, 'carlos'); await crear(admin, k('12:00'), 'cli_luis');
    await mover(pt, k('10:00'), k('09:00')); await mover(carlos, k('08:00'), k('07:00'));
    await verComo(admin, 'laura');
    await L.espera(3000);
    const doc = await L.leerDoc();
    const r = { nombre: 'S9 admin alterna entre entrenadores', laura: Object.keys(doc.agenda.laura).sort(), carlos: Object.keys(doc.agenda.carlos).sort(), adminLaura: (await estadoPagina(admin, 'laura')).sesiones, adminCarlos: (await estadoPagina(admin, 'carlos')).sesiones, avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin), ...avisosNoGuardado(carlos)] };
    r.OK = JSON.stringify(r.laura) === JSON.stringify([k('09:00'), k('12:00')]) && JSON.stringify(r.carlos) === JSON.stringify([k('07:00'), k('12:00')]) && JSON.stringify(r.adminLaura) === JSON.stringify(r.laura) && JSON.stringify(r.adminCarlos) === JSON.stringify(r.carlos);
    registrar(r);
  },
  // S10a: CAUSA RAÍZ 1 -- el bloqueo del PT sobrevive a un guardado fallido de disponibilidad del admin
  // seguido de una operación normal (crear sesión). El canal en tiempo real del admin va lento.
  async S10a_bloqueo_tras_guardado_fallido_admin() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await retenerSnapshots(admin);
    await abrirDisp(admin);
    await bloquearDia(pt, 5);                                   // el PT bloquea el viernes (guardado OK)
    await L.espera(1200);
    // El snapshot retenido llega mientras la transacción fallida del admin se resuelve (dos canales
    // independientes: escucha en tiempo real y transacción). Desde ahí, el canal vuelve a la normalidad.
    await admin.evaluate(() => { const o = gestionarGuardadoAgendaFallido; window.gestionarGuardadoAgendaFallido = async function (...a) { window.__retener = false; const r = window.__retenidos || []; window.__retenidos = []; if (r.length) window.__aplicarOriginal(r[r.length - 1]); return o(...a); }; });
    await guardarDispAbierta(admin, { recurrente: true, cambiarDia: 1 }); // admin cambia el lunes
    await L.espera(800);
    await crear(admin, k('18:00', '2026-10-06'), 'cli_ana');    // operación normal posterior del admin
    await L.espera(3000);
    const doc = await L.leerDoc();
    const r = { nombre: 'S10a bloqueo del PT tras guardado fallido del admin + otra operación', bloqueoEnServidor: diaBloqueado(doc.disponibilidadReservas.laura, D), sesionAdmin: !!doc.agenda.laura[k('18:00', '2026-10-06')], avisosPT: avisosNoGuardado(pt), avisosAdmin: avisosNoGuardado(admin) };
    r.perdidaSilenciosaDelBloqueo = !r.bloqueoEnServidor && r.avisosPT.length === 0;
    r.OK = r.bloqueoEnServidor;
    registrar(r);
  },
  // S10b: CAUSA RAÍZ 2 -- formulario de disponibilidad abierto ANTES del bloqueo del PT y guardado
  // DESPUÉS (con el canal en tiempo real funcionando perfectamente).
  async S10b_formulario_abierto_antes_del_bloqueo() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await abrirDisp(admin);                                     // el admin abre "+ Disponibilidad"
    await bloquearDia(pt, 5);                                   // el PT bloquea el viernes
    await L.espera(2500);                                       // el admin YA ha recibido el cambio
    await guardarDispAbierta(admin, { recurrente: false, cambiarDia: 1 }); // y guarda su formulario
    await L.espera(2500);
    const doc = await L.leerDoc();
    const r = { nombre: 'S10b formulario de disponibilidad abierto antes del bloqueo', bloqueoEnServidor: diaBloqueado(doc.disponibilidadReservas.laura, D), lunesAdmin: doc.disponibilidadReservas.laura.excepciones['2026-10-05'] || null, avisosPT: avisosNoGuardado(pt), dialogosAdmin: admin.__logs.filter(l => /DIALOG/.test(l)) };
    r.perdidaSilenciosaDelBloqueo = !r.bloqueoEnServidor && r.avisosPT.length === 0;
    r.OK = r.bloqueoEnServidor;
    registrar(r);
  },
  // S10c: bloqueo del PT + muchas operaciones posteriores de ambos (sesiones, notas, fichas).
  async S10c_bloqueo_sobrevive_operaciones() {
    const X = '2026-10-07';
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia'), [k('10:00', X)]: sesion('cli_ana', 'Ana Ficticia') } });
    await bloquearDia(pt, 5);
    await L.espera(800);
    await crear(admin, k('16:00', '2026-10-06'), 'cli_ana'); await mover(pt, k('10:00', X), k('11:00', X));
    await crear(pt, k('17:00', '2026-10-07'), 'cli_eva'); await ocultarSlot(admin, k('07:00', '2026-10-06'));
    await L.espera(3000);
    const doc = await L.leerDoc();
    const r = { nombre: 'S10c bloqueo sobrevive a otras operaciones', bloqueoEnServidor: diaBloqueado(doc.disponibilidadReservas.laura, D), servidor: Object.keys(doc.agenda.laura).sort(), avisos: [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)] };
    r.OK = r.bloqueoEnServidor && r.servidor.includes(k('16:00', '2026-10-06')) && r.servidor.includes(k('11:00', X)) && r.servidor.includes(k('10:00'));
    registrar(r);
  },
  // S11: CAUSA RAÍZ 3 -- el admin guarda; mientras su guardado termina (publicación del portal), el PT
  // guarda otro cambio. ¿Llega el cambio del PT a la pantalla del admin sin recargar?
  async S11_snapshot_durante_guardado_admin() {
    const r0 = [];
    for (const gap of [150, 400, 800]) {
      const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia'), [k('12:00')]: sesion('cli_ana', 'Ana Ficticia') } });
      await mover(admin, k('12:00'), k('13:00'));
      await L.espera(gap);
      await bloquearDia(pt, 4);
      await mover(pt, k('10:00'), k('09:00'));
      await L.espera(4000);
      const doc = await L.leerDoc();
      const ea = await estadoPagina(admin, 'laura');
      const srv = Object.keys(doc.agenda.laura).sort();
      // y si ahora el admin hace otro cambio, ¿se guarda?
      await crear(admin, k('19:00'), 'cli_eva');
      await L.espera(3000);
      const doc2 = await L.leerDoc();
      r0.push({ gap, servidor: srv, adminVe: ea.sesiones, adminVeBloqueo: !!(ea.excepciones['2026-10-08'] && ea.excepciones['2026-10-08'].activo === false), siguienteCambioAdminGuardado: !!doc2.agenda.laura[k('19:00')], avisosAdmin: avisosNoGuardado(admin), avisosPT: avisosNoGuardado(pt), bloqueoServidorAntes: diaBloqueado(doc.disponibilidadReservas.laura, '2026-10-08'), bloqueoSigue: diaBloqueado(doc2.disponibilidadReservas.laura, '2026-10-08') });
      const b = await L.navegador(); for (const c of b.contexts()) await c.close();
    }
    const r = { nombre: 'S11 cambio del PT mientras termina un guardado del admin', intentos: r0 };
    r.OK = r0.every(x => JSON.stringify(x.adminVe) === JSON.stringify(x.servidor) && x.adminVeBloqueo && x.siguienteCambioAdminGuardado && x.bloqueoSigue);
    registrar(r);
  },
  // S12: ficha de cliente abierta por el admin; el PT cambia el teléfono; el admin guarda su ficha.
  async S12_ficha_abierta_desactualizada() {
    const { pt, admin } = await abrirPar({});
    await admin.evaluate(() => editarFicha('cli_rosa'));
    await pt.evaluate(async () => { editarFicha('cli_rosa'); document.getElementById('cust-phone').value = '611999888'; await guardarCliente(); });
    await L.espera(2000);
    await admin.evaluate(async () => { document.getElementById('cust-email').value = 'rosa.nueva@example.test'; await guardarCliente(); });
    await L.espera(2500);
    const doc = await L.leerDoc();
    const rosa = doc.clientes.laura.find(c => c.id === 'cli_rosa');
    const r = { nombre: 'S12 ficha abierta desactualizada', telefono: rosa.telefono, email: rosa.email, dialogosAdmin: admin.__logs.filter(l => /DIALOG/.test(l)) };
    r.perdidaSilenciosa = rosa.telefono !== '611999888' && !r.dialogosAdmin.some(l => /cambiado|cambios|actualiz/i.test(l));
    r.OK = rosa.telefono === '611999888';
    registrar(r);
  },
  // S13: conflicto REAL: PT y admin mueven LA MISMA sesión a horas distintas a la vez. Correcto: queda
  // una sola sesión, el que pierde recibe un aviso explícito que nombra la sesión y ambas pantallas
  // acaban iguales al servidor. Nunca dos copias ni ninguna desaparición silenciosa.
  async S13_conflicto_real_misma_sesion() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await Promise.all([mover(pt, k('10:00'), k('11:00')), mover(admin, k('10:00'), k('15:00'))]);
    await L.espera(3500);
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const avisos = [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)];
    const r = { nombre: 'S13 conflicto real: misma sesión movida por ambos', servidor: srv, pantallaPT: (await estadoPagina(pt, 'laura')).sesiones, pantallaAdmin: (await estadoPagina(admin, 'laura')).sesiones, avisos };
    r.unaSolaSesion = srv.length === 1 && (srv[0] === k('11:00') || srv[0] === k('15:00'));
    r.avisoExplicito = avisos.length >= 1 && avisos.some(a => /sesión del 2026-10-09 10:00|misma|a la vez/.test(a));
    r.OK = r.unaSolaSesion && r.avisoExplicito && JSON.stringify(r.pantallaPT) === JSON.stringify(srv) && JSON.stringify(r.pantallaAdmin) === JSON.stringify(srv);
    registrar(r);
  },
  // S14: desconexión LARGA (más que el plazo de confirmación): el cambio NO puede verse como guardado;
  // se avisa, se conserva y se guarda al volver la conexión, sin pisar lo que el admin hizo mientras.
  async S14_desconexion_larga() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await pt.__ctx.setOffline(true);
    await crear(pt, k('16:00'), 'cli_ana');
    await L.espera(23000);
    const indicador = await pt.evaluate(() => (document.getElementById('bs-estado-guardado') || {}).innerText || '(sin indicador)');
    const pendiente = await pt.evaluate(() => hayCambiosAgendaSinConfirmar());
    await crear(admin, k('18:00'), 'cli_eva');
    await bloquearDia(admin, 2);
    await pt.__ctx.setOffline(false);
    await L.espera(9000);
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const indicadorFinal = await pt.evaluate(() => (document.getElementById('bs-estado-guardado') || {}).innerText || '(sin indicador)');
    const r = { nombre: 'S14 desconexión larga del PT (> plazo de confirmación)', indicadorSinConexion: indicador, cambiosMarcadosPendientes: pendiente, avisosPT: pt.__logs.filter(l => /DIALOG/.test(l)), servidor: srv, bloqueoAdmin: diaBloqueado(doc.disponibilidadReservas.laura, '2026-10-06'), pantallaPT: (await estadoPagina(pt, 'laura')).sesiones, indicadorFinal };
    r.OK = /SIN GUARDAR/.test(indicador) && pendiente === true && r.avisosPT.some(a => /TODAVÍA NO ESTÁN GUARDADOS/.test(a)) && srv.includes(k('16:00')) && srv.includes(k('18:00')) && r.bloqueoAdmin && JSON.stringify(r.pantallaPT) === JSON.stringify(srv) && /Guardado en el servidor/.test(indicadorFinal);
    registrar(r);
  },
  // S16: PT y admin crean a la vez sesiones en huecos DISTINTOS pero solapados (10:00 y 10:15). Correcto:
  // nunca dos sesiones solapadas en el servidor; el que pierde recibe aviso.
  async S16_sesiones_solapadas_a_la_vez() {
    const { pt, admin } = await abrirPar({});
    await Promise.all([crear(pt, k('10:00'), 'cli_rosa'), crear(admin, k('10:15'), 'cli_ana')]);
    await L.espera(3500);
    const doc = await L.leerDoc();
    const srv = Object.keys(doc.agenda.laura).sort();
    const avisos = [...avisosNoGuardado(pt), ...avisosNoGuardado(admin)];
    const r = { nombre: 'S16 sesiones solapadas creadas a la vez', servidor: srv, pantallaPT: (await estadoPagina(pt, 'laura')).sesiones, pantallaAdmin: (await estadoPagina(admin, 'laura')).sesiones, avisos };
    r.OK = srv.length === 1 && avisos.length >= 1 && JSON.stringify(r.pantallaPT) === JSON.stringify(srv) && JSON.stringify(r.pantallaAdmin) === JSON.stringify(srv);
    registrar(r);
  },
  // S17: nunca "✓ Sesión reprogramada · Enviar WhatsApp" antes de que el servidor lo confirme.
  async S17_exito_solo_tras_confirmacion() {
    const { pt } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const modalVisible = () => pt.evaluate(() => !document.getElementById('modal-whatsapp-offer').classList.contains('hidden'));
    await pt.__ctx.setOffline(true);
    await mover(pt, k('10:00'), k('11:00'));
    await L.espera(3000);
    const sinConexion = await modalVisible();
    await pt.__ctx.setOffline(false);
    await L.espera(30000);
    const doc = await L.leerDoc();
    const r = { nombre: 'S17 aviso de éxito/WhatsApp solo tras confirmación del servidor', modalSinConexion: sinConexion, modalTrasConfirmar: await modalVisible(), guardado: !!doc.agenda.laura[k('11:00')] };
    r.OK = r.modalSinConexion === false && r.guardado && r.modalTrasConfirmar === true;
    registrar(r);
  },
  // S18: el PT guarda una ficha desde MÓVIL (390 px) y el admin guarda otra ficha del PT; ambos
  // confirmados, botón restaurado, sesiones guardadas sin copias de portal/contrato.
  async S18_fichas_PT_movil_y_admin() {
    const { pt, admin } = await abrirPar({ laura: { [k('10:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    await pt.setViewportSize({ width: 390, height: 844 });
    await pt.evaluate(async () => { editarFicha('cli_ana'); document.getElementById('cust-phone').value = '622333444'; await guardarCliente(); });
    await admin.evaluate(async () => { editarFicha('cli_eva'); document.getElementById('cust-email').value = 'eva.nueva@example.test'; await guardarCliente(); });
    await crear(pt, k('12:00'), 'cli_ana');
    await L.espera(3000);
    const doc = await L.leerDoc();
    const f = id => doc.clientes.laura.find(c => c.id === id);
    const r = { nombre: 'S18 ficha PT (móvil) + ficha admin + sesión', telAna: f('cli_ana').telefono, emailEva: f('cli_eva').email, botonPT: await pt.evaluate(() => document.getElementById('btn-save-client').textContent), botonAdmin: await admin.evaluate(() => document.getElementById('btn-save-client').textContent), dialogos: [...pt.__logs, ...admin.__logs].filter(l => /DIALOG/.test(l)), camposSesion: Object.keys(doc.agenda.laura[k('12:00')] || {}).filter(x => /reservaToken|contratoCliente|restriccionesReservas/.test(x)), tokenEnFicha: !!f('cli_ana').reservaToken };
    r.OK = r.telAna === '622333444' && r.emailEva === 'eva.nueva@example.test' && r.botonPT === 'Guardar Ficha' && r.botonAdmin === 'Guardar Ficha' && r.camposSesion.length === 0 && !!doc.agenda.laura[k('12:00')] && r.tokenEnFicha;
    registrar(r);
  },
  // S15: tiempos: cuánto tarda en confirmarse cada guardado (acción -> confirmación del servidor).
  async S15_tiempos_de_guardado() {
    const { pt } = await abrirPar({ laura: { [k('08:00')]: sesion('cli_rosa', 'Rosa Ficticia') } });
    const tiempos = await pt.evaluate(async ([a, b, c, d]) => {
      const out = [];
      for (const [origen, destino] of [[a, b], [b, c], [c, d], [d, a]]) {
        const t0 = performance.now();
        soltarFichaEnCelda(destino, '', origen);
        const limite = performance.now() + 25000;
        await new Promise(r => { const iv = setInterval(() => { if (!hayCambiosAgendaSinConfirmar() || performance.now() > limite) { clearInterval(iv); r(); } }, 10); });
        out.push(Math.round(performance.now() - t0));
      }
      return out;
    }, [k('08:00'), k('09:00'), k('10:00'), k('11:00')]);
    const r = { nombre: 'S15 tiempo hasta confirmación del servidor (ms, 4 movimientos seguidos)', tiempos, media: Math.round(tiempos.reduce((x, y) => x + y, 0) / tiempos.length) };
    r.OK = true;
    registrar(r);
  },
};

(async () => {
  const solo = process.argv.slice(2);
  const repeticiones = Number(process.env.REP || 1);
  for (const [n, f] of Object.entries(ESCENARIOS)) {
    if (solo.length && !solo.some(s => n.startsWith(s))) continue;
    for (let i = 0; i < repeticiones; i++) {
      console.log(`\n===== ${n} (rep ${i + 1}) =====`);
      try { await f(); } catch (e) { console.log('ERROR escenario', e.stack); resultados.push({ nombre: n, OK: false, error: e.message }); }
      const b = await L.navegador(); for (const c of b.contexts()) await c.close();
    }
  }
  console.log('\n===== RESUMEN =====');
  resultados.forEach(r => console.log(`${r.OK ? 'OK   ' : 'FALLO'}  ${r.nombre}${r.perdidaSilenciosa || r.perdidaSilenciosaDelBloqueo ? '  (PÉRDIDA SILENCIOSA)' : ''}`));
  await Promise.race([L.cerrar(), L.espera(5000)]);
  process.exit(0);
})();
