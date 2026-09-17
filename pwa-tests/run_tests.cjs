// HARDENING-PRE-BASELINE-v3.2.1 (PWA-CLIENT): ejecuta sw.js VERBATIM (el archivo real, sin
// reimplementar su lógica) dentro de un ServiceWorkerGlobalScope simulado, y dispara su propio
// listener 'fetch' contra escenarios reales: portal-cliente.html con token en la query string
// (debe servir SU PROPIO fallback offline, nunca index.html) vs. agenda.html/crm.html/etc (deben
// seguir cayendo a index.html, el login PT/admin, como antes). Nunca toca red ni caché real.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const swSource = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else { fail++; fails.push(`${desc} :: got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'} -- ${desc} :: got=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// Mock mínimo y fiel de Cache Storage: cachea por URL completa, y respeta {ignoreSearch:true}
// igual que el CacheStorage real (compara solo pathname si se pide, si no, URL exacta).
// Las claves precacheadas son rutas relativas ("./agenda.html") y las peticiones reales llegan
// con URL absoluta ("https://.../agenda.html?t=..") -- un Cache Storage real las resuelve ambas
// contra la URL del propio Service Worker al guardarlas; aquí basta con comparar por el nombre de
// archivo (basename), suficiente para este sitio de un único directorio plano.
function basename(u) { return u.split('?')[0].split('/').pop(); }
function crearCachesFalso(entradas) {
  const store = new Map(entradas.map(u => [u, { _url: u, _marker: 'cached:' + u }]));
  return {
    open() {
      return Promise.resolve({
        addAll(urls) { urls.forEach(u => store.set(u, { _url: u, _marker: 'cached:' + u })); return Promise.resolve(); },
        put(req) { store.set(req.url, { _url: req.url, _marker: 'cached:' + req.url }); return Promise.resolve(); },
      });
    },
    match(reqOrUrl, opts) {
      const url = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
      if (opts && opts.ignoreSearch) {
        for (const [k, v] of store) if (basename(k) === basename(url)) return Promise.resolve(v);
        return Promise.resolve(undefined);
      }
      for (const [k, v] of store) if (basename(k) === basename(url) && k.includes('?') === url.includes('?')) return Promise.resolve(v);
      return Promise.resolve(undefined);
    },
    keys() { return Promise.resolve([...store.keys()].map(u => 'cache:' + u)); },
    delete() { return Promise.resolve(true); },
  };
}

function crearScopeFalso(caches) {
  const listeners = {};
  const self = {
    addEventListener(tipo, cb) { listeners[tipo] = cb; },
    skipWaiting() {}, clients: { claim() {} },
  };
  const contexto = { self, caches, fetch: () => Promise.reject(new Error('offline (simulado)')) };
  vm.createContext(contexto);
  vm.runInContext(swSource, contexto);
  return { listeners, self };
}

async function simularFetchOffline(listeners, url) {
  const req = { method: 'GET', url };
  let resultado;
  const event = {
    request: req,
    respondWith(p) { resultado = p; },
  };
  listeners.fetch(event);
  return resultado;
}

(async () => {

  console.log('=== FALLBACK OFFLINE: portal-cliente.html con token propio -- nunca cae a index.html (login PT) ===');
  {
    const caches = crearCachesFalso(['./index.html', './portal-cliente.html', './agenda.html']);
    const { listeners } = crearScopeFalso(caches);
    const resultado = await simularFetchOffline(listeners, 'https://app.besoulfitness.com/portal-cliente.html?t=res_abc123def456');
    check('portal-cliente.html?t=... offline: sirve SU PROPIO cache (ignoreSearch), no index.html', resultado._marker, 'cached:./portal-cliente.html');
  }

  console.log('\n=== FALLBACK OFFLINE: agenda.html (staff) sigue cayendo a index.html (login PT/admin), sin cambios ===');
  {
    const caches = crearCachesFalso(['./index.html', './portal-cliente.html', './agenda.html']);
    const { listeners } = crearScopeFalso(caches);
    const resultado = await simularFetchOffline(listeners, 'https://app.besoulfitness.com/agenda.html');
    // agenda.html SÍ está precacheado -- ignoreSearch la encuentra a ella misma primero (comportamiento
    // ya existente y correcto: si la página en sí está en caché, se sirve ella, no el fallback).
    check('agenda.html offline: se sirve a sí misma desde caché', resultado._marker, 'cached:./agenda.html');
  }

  console.log('\n=== FALLBACK OFFLINE: petición desconocida/no precacheada (staff) cae a index.html, NUNCA al Portal ===');
  {
    const caches = crearCachesFalso(['./index.html', './portal-cliente.html', './agenda.html']);
    const { listeners } = crearScopeFalso(caches);
    const resultado = await simularFetchOffline(listeners, 'https://app.besoulfitness.com/alguna-ruta-desconocida-de-staff');
    check('ruta desconocida (contexto staff): cae a index.html por defecto', resultado._marker, 'cached:./index.html');
  }

  console.log('\n=== CORE_ASSETS: manifest-portal.json y portal-cliente.html están precacheados ===');
  {
    const m = /const CORE_ASSETS = \[([\s\S]*?)\];/.exec(swSource);
    check('CORE_ASSETS existe', !!m, true);
    const lista = m[1];
    check('./manifest-portal.json está en CORE_ASSETS', lista.includes(`'./manifest-portal.json'`), true);
    check('./portal-cliente.html está en CORE_ASSETS', lista.includes(`'./portal-cliente.html'`), true);
  }

  console.log('\n=== TOKEN PERSISTENCE (PWA-CLIENT): normalizarToken() sigue rechazando cualquier valor no válido ===');
  {
    // Extraído verbatim de portal-cliente.html -- la misma función que decide qué se guarda en
    // localStorage (bs_portal_ultimo_token) para el relanzamiento offline/instalado. Un token
    // inválido nunca debe poder persistirse ni aceptarse, venga de la URL o de localStorage.
    const portalHtml = fs.readFileSync(path.join(__dirname, '..', 'portal-cliente.html'), 'utf8');
    function extractBalanced(html, startIndex, openChar, closeChar) {
      let i = html.indexOf(openChar, startIndex);
      let depth = 0;
      for (; i < html.length; i++) {
        if (html[i] === openChar) depth++;
        else if (html[i] === closeChar) { depth--; if (depth === 0) { i++; break; } }
      }
      return i;
    }
    const reConst = /const TOKEN_RE = \/[^\n]+\/;/;
    const mConst = reConst.exec(portalHtml);
    const reFn = /function normalizarToken\(raw\) \{/;
    const mFn = reFn.exec(portalHtml);
    check('TOKEN_RE y normalizarToken() se encuentran en portal-cliente.html', !!(mConst && mFn), true);
    const fnBody = portalHtml.slice(mFn.index, extractBalanced(portalHtml, mFn.index, '{', '}'));
    const sandbox = new Function(mConst[0] + '\n' + fnBody + '\nreturn { normalizarToken };')();
    check('token válido real (res_...) se acepta', sandbox.normalizarToken('res_abc123def_456'), 'res_abc123def_456');
    check('cadena vacía -> null (nunca se persistiría)', sandbox.normalizarToken(''), null);
    check('basura/XSS-like -> null', sandbox.normalizarToken('<script>alert(1)</script>'), null);
    check('token de OTRO formato (p.ej. un UUID cualquiera) -> null', sandbox.normalizarToken('123e4567-e89b-12d3-a456-426614174000'), null);
  }

  console.log(`\n${pass}/${pass + fail} pruebas OK.`);
  if (fail > 0) { console.log('\nFALLOS:'); fails.forEach(f => console.log(' -', f)); process.exitCode = 1; }
})().catch(err => { console.error('ERROR EJECUTANDO TESTS:', err); process.exitCode = 1; });
