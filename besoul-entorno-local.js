// BESOUL -- MODO REVISIÓN LOCAL (Firebase Emulator). HOTFIX-CRM-DUPLICADOS-FECHA-ALTA.
//
// Permite abrir las páginas V1 en el propio ordenador contra el Firebase Emulator con datos
// ficticios, sin NINGUNA posibilidad de tocar el proyecto real.
//
// CÓMO SE ACTIVA (las TRES condiciones a la vez; si falla una, este archivo no hace nada):
//   1. hostname EXACTAMENTE localhost, 127.0.0.1 o [::1]   (app.besoulfitness.com nunca)
//   2. protocolo http:                                     (producción se sirve por https)
//   3. petición explícita: ?emulador=1 en la URL (se recuerda en sessionStorage de ESE origen
//      local para poder navegar entre páginas; ?emulador=0 lo apaga)
//
// QUÉ HACE SI SE ACTIVA:
//   - sustituye la configuración de Firebase por un proyecto "demo-besoul-revision": los ids
//     "demo-*" no existen en Google y el SDK solo puede hablar con el emulador, así que aunque
//     algo fallara en la conexión al emulador, NUNCA podría llegar al proyecto besoul-suite;
//   - conecta Auth (127.0.0.1:9099) y Firestore (127.0.0.1:8085) al emulador;
//   - muestra una franja fija "MODO REVISIÓN LOCAL" para que nadie lo confunda con producción.
//
// En producción el archivo se carga pero `decidirModoEmulador` devuelve null en la primera
// comprobación (hostname) y no se toca nada: mismo comportamiento que antes.
(function (root) {
  'use strict';

  var HOSTS_LOCALES = ['localhost', '127.0.0.1', '[::1]', '::1'];
  var CLAVE_SESION = 'bs_modo_emulador_local';
  var PROYECTO_DEMO = 'demo-besoul-revision';

  /** Función pura (testeable): null = producción/normal; objeto = modo emulador. */
  function decidirModoEmulador(loc, almacen) {
    if (!loc) return null;
    var host = String(loc.hostname || '').toLowerCase();
    if (HOSTS_LOCALES.indexOf(host) === -1) return null;
    if (loc.protocol !== 'http:') return null;
    var params;
    try { params = new URLSearchParams(loc.search || ''); } catch (e) { return null; }
    var valor = params.get('emulador');
    try {
      if (valor === '0') { if (almacen) almacen.removeItem(CLAVE_SESION); return null; }
      if (valor === '1' && almacen) almacen.setItem(CLAVE_SESION, '1');
    } catch (e) { /* almacenamiento bloqueado: solo vale el parámetro explícito */ }
    var recordado = false;
    try { recordado = !!almacen && almacen.getItem(CLAVE_SESION) === '1'; } catch (e) { recordado = false; }
    if (valor !== '1' && !recordado) return null;
    return {
      projectId: PROYECTO_DEMO,
      firestore: { host: '127.0.0.1', port: 8085 },
      authUrl: 'http://127.0.0.1:9099',
    };
  }

  function configFirebaseEmulador(configOriginal, modo) {
    return {
      apiKey: 'demo-local-emulador',
      authDomain: modo.projectId + '.firebaseapp.com',
      projectId: modo.projectId,
      storageBucket: modo.projectId + '.appspot.com',
      messagingSenderId: '0',
      appId: 'demo-local',
    };
  }

  function pintarFranja() {
    var pintar = function () {
      if (!document.body || document.getElementById('bs-franja-emulador')) return;
      var d = document.createElement('div');
      d.id = 'bs-franja-emulador';
      d.setAttribute('role', 'status');
      d.textContent = 'REVISIÓN LOCAL · emulador · datos ficticios';
      d.title = 'Modo revisión local: Firebase Emulator con datos ficticios. Nada de esto es producción.';
      // Franja fina ARRIBA (no tapa la navegación inferior de V1 en móvil); no captura clics.
      d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#7c2d12;color:#fff;font:700 10px/14px system-ui,sans-serif;text-align:center;padding:1px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;opacity:.9';
      document.body.appendChild(d);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintar); else pintar();
  }

  /** Envuelve firebase.initializeApp: misma llamada de siempre en cada página, pero con la
   *  configuración demo y los emuladores conectados antes de cualquier uso. */
  function activar(firebase, modo) {
    if (!firebase || firebase.__bsEmuladorActivo) return;
    var original = firebase.initializeApp.bind(firebase);
    firebase.initializeApp = function (config, nombre) {
      var app = original(configFirebaseEmulador(config, modo), nombre);
      try { if (firebase.auth) firebase.auth(app).useEmulator(modo.authUrl, { disableWarnings: true }); } catch (e) { console.error('[BESOUL emulador] Auth', e); }
      try { if (firebase.firestore) firebase.firestore(app).useEmulator(modo.firestore.host, modo.firestore.port); } catch (e) { console.error('[BESOUL emulador] Firestore', e); }
      return app;
    };
    firebase.__bsEmuladorActivo = true;
  }

  var api = { decidirModoEmulador: decidirModoEmulador, configFirebaseEmulador: configFirebaseEmulador, PROYECTO_DEMO: PROYECTO_DEMO, HOSTS_LOCALES: HOSTS_LOCALES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof window !== 'undefined' && window.location) {
    var almacen = null;
    try { almacen = window.sessionStorage; } catch (e) { almacen = null; }
    var modo = decidirModoEmulador(window.location, almacen);
    root.BESOUL_MODO_EMULADOR = modo; // null en producción
    if (modo && root.firebase) { activar(root.firebase, modo); pintarFranja(); console.warn('[BESOUL] MODO REVISIÓN LOCAL activo: emulador ' + modo.projectId); }
  }
})(typeof window !== 'undefined' ? window : globalThis);
