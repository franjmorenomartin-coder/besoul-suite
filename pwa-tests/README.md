# PWA Tests — HARDENING-PRE-BASELINE-v3.2.1 (PWA-CLIENT)

Antes de esta fase, `portal-cliente.html` compartía `manifest.json` (`start_url: "./index.html"`)
con el resto de la suite (agenda/crm/finanzas/dashboard), y nunca registraba el service worker.
Efecto real: un cliente que instalaba el Portal desde su enlace con token, al abrir el icono
instalado, aterrizaba en la pantalla de login de PT/admin -- no en su propia cuenta -- y no tenía
ninguna capacidad offline en la página que más lo necesita.

Cambios cubiertos por esta suite:

- `manifest-portal.json` propio (`start_url`/`scope` = `portal-cliente.html`), enlazado solo desde
  `portal-cliente.html`; el resto de páginas siguen usando `manifest.json` sin cambios.
- `portal-cliente.html` ahora registra `sw.js` (antes ausente).
- `sw.js`: el fallback offline usa `ignoreSearch:true` (el token en la query string, distinto por
  cliente, impedía que `portal-cliente.html?t=...` coincidiera nunca con su propia entrada
  precacheada) y, si de verdad no hay nada cacheado para esa página, cae a su PROPIO fallback en
  vez de `index.html` para las rutas del Portal -- nunca al revés.
- `portal-cliente.html`: el token (identidad del cliente, sin Firebase Auth) se recuerda en
  `localStorage` cuando llega por URL, y se recupera de ahí cuando no llega ninguno (relanzamiento
  desde el icono instalado, sin query string) -- un manifest estático en un sitio 100% estático
  (GitHub Pages) no puede llevar un `start_url` distinto por cliente.

`run_tests.cjs` ejecuta `sw.js` VERBATIM dentro de un `ServiceWorkerGlobalScope` simulado (vía
`vm`) y dispara su propio listener `fetch` real contra escenarios offline reales -- nunca una
reimplementación paralela de su lógica. También valida `normalizarToken()` (extraída verbatim de
`portal-cliente.html`) contra entradas inválidas, ya que es la función que decide qué se acepta
persistir en `localStorage`.

## Ejecutar

```
node run_tests.cjs
```
