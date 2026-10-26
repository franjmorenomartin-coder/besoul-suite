// GESTION-ENTRENADORES: retirada de acceso en la Agenda (complemento de las reglas, que ya deniegan
// todo a un perfil con activo != true -- ver rules-tests/run_acceso_retirado_tests.cjs). Funciones
// REALES de agenda.html, extraídas por nombre, contra Firebase y localStorage simulados:
//   - un perfil desactivado no entra: error 'usuario-inactivo', se borra la caché del dispositivo y se
//     cierra la sesión de Authentication;
//   - con la sesión abierta, si administración retira el acceso (activo:false o perfil borrado), la
//     app cierra la sesión (logout); un perfil activo no la cierra;
//   - la escucha queda registrada para cancelarse al cerrar sesión.
//   node logout-cache-tests/run_acceso_retirado_tests.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'agenda.html'), 'utf8');

function extraer(nombre) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${nombre}\\s*\\(`).exec(html);
  if (!m) throw new Error(`No se encontró function ${nombre}`);
  let i = html.indexOf('{', m.index), d = 0;
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return html.slice(m.index, i);
}
const codigo = ['cerrarSesionAccesoRetirado', 'vigilarAccesoUsuario', 'cargarPerfilUsuarioFirebase', 'perfilFirestoreAcredencial', 'emailDocId', 'trainerKeyDesdeEmail'].map(extraer).join('\n');

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

function entorno(perfilDoc) {
  const reg = { signOut: 0, logout: 0, cacheLimpia: 0, idbBorrada: 0, alertas: [], escuchas: [] };
  const docRef = id => ({
    get: async () => ({ exists: !!perfilDoc, data: () => perfilDoc }),
    onSnapshot: (ok) => { const e = { id, ok, cancelada: false }; reg.escuchas.push(e); return () => { e.cancelada = true; }; },
  });
  const fb = { firestore: () => ({ collection: () => ({ doc: docRef }) }) };
  const window = { BesoulDatos: { cacheIndexedDB: () => ({ borrarTodo: async () => { reg.idbBorrada++; } }) } };
  const ctx = {
    window, BesoulDatos: window.BesoulDatos, indexedDB: {},
    firebase: { auth: () => ({ signOut: () => { reg.signOut++; } }) },
    inicializarFirebaseBesoul: () => fb,
    limpiarCacheSensibleBesoul: () => { reg.cacheLimpia++; },
    logout: () => { reg.logout++; window.bsCerrandoSesion = true; },
    alert: t => reg.alertas.push(String(t)),
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)),
  };
  const n = Object.keys(ctx);
  const api = new Function(...n, `${codigo}\nreturn { cerrarSesionAccesoRetirado, vigilarAccesoUsuario, cargarPerfilUsuarioFirebase };`)(...n.map(k => ctx[k]));
  return { api, reg, window };
}

(async () => {
  console.log('=== 1. Perfil desactivado al iniciar sesión ===');
  {
    const { api, reg } = entorno({ rol: 'pt', trainerKey: 'andres', activo: false });
    let err = null;
    try { await api.cargarPerfilUsuarioFirebase({ email: 'andres@x.com', uid: 'u1' }); } catch (e) { err = e; }
    check('Rechaza el acceso con código usuario-inactivo', err && err.code, 'usuario-inactivo');
    check('Mensaje claro en español', /acceso a BESOUL está retirado/.test(err && err.message), true);
    await api.cerrarSesionAccesoRetirado();
    check('Borra la caché del dispositivo (localStorage sensible + IndexedDB) y cierra la sesión', [reg.cacheLimpia, reg.idbBorrada, reg.signOut], [1, 1, 1]);
  }
  {
    const { api } = entorno({ rol: 'pt', trainerKey: 'igor', activo: true });
    const p = await api.cargarPerfilUsuarioFirebase({ email: 'igor@x.com', uid: 'u2' });
    check('Perfil activo: entra con normalidad', [p.activo, p.trainerKey], [true, 'igor']);
  }

  console.log('\n=== 2. Sesión abierta: administración retira el acceso ===');
  {
    const { api, reg, window } = entorno({ activo: true });
    api.vigilarAccesoUsuario('andres@x.com');
    check('Escucha su propio perfil y queda registrada para cancelarse al cerrar sesión', [reg.escuchas.length, reg.escuchas[0].id, window.bsAgendaCloudUnsubs.length], [1, 'andres@x.com', 1]);
    const escucha = reg.escuchas[0].ok;
    escucha({ exists: true, data: () => ({ activo: true }) });
    check('Perfil activo: no cierra la sesión', reg.logout, 0);
    escucha({ exists: true, data: () => ({ activo: false }) });
    check('activo:false: avisa y cierra la sesión', [reg.logout, reg.alertas.length], [1, 1]);
    escucha({ exists: true, data: () => ({ activo: false }) });
    check('No repite el cierre mientras ya está cerrando', reg.logout, 1);
    window.bsAgendaCloudUnsubs[0]();
    check('La escucha se cancela', reg.escuchas[0].cancelada, true);
  }
  {
    const { api, reg } = entorno({ activo: true });
    api.vigilarAccesoUsuario('adrian@x.com');
    reg.escuchas[0].ok({ exists: false, data: () => null });
    check('Perfil eliminado: también cierra la sesión', reg.logout, 1);
  }

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail) { console.log('FALLOS:'); fails.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
})();
