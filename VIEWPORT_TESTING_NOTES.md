# QA-02 — validación responsive real, método y resultado

## 1. Qué falló primero

`chrome.exe --headless=new --screenshot --window-size=W,H` no tenía ningún efecto sobre el tamaño real capturado en esta instalación de Chrome (siempre ~500px de ancho, sin importar qué se pasara en `--window-size`) -- confirmado con varias combinaciones de flags (`--headless` clásico, con/sin `--user-data-dir` aislado, con `--force-device-scale-factor=1`). No era un problema de sesión compartida de Chrome (se confirmó tras aislar completamente el perfil).

## 2. Alternativa que sí funcionó: CDP directo, sin dependencias npm

Node 24 incluye `WebSocket`/`fetch` nativos, así que se pudo hablar Chrome DevTools Protocol directamente sin instalar Playwright/Puppeteer (no había paquetes npm instalados y no se quiso arriesgar una instalación con acceso a red no verificado):

1. Lanzar Chrome con `--remote-debugging-port=<puerto> --user-data-dir=<perfil aislado propio>` (nunca el perfil real del usuario).
2. `PUT http://127.0.0.1:<puerto>/json/new?about:blank` crea una pestaña y devuelve su `webSocketDebuggerUrl`.
3. Conectar con `new WebSocket(...)`, enviar `Emulation.setDeviceMetricsOverride({width, height, deviceScaleFactor:1, mobile: width<768})` -- esto SÍ controla el viewport exacto, de forma fiable.
4. `Page.navigate` a la URL `file:///...`, esperar `Page.loadEventFired`.
5. Opcionalmente `Runtime.evaluate` para inyectar estado (ver sección 3).
6. `Page.captureScreenshot` (PNG, base64) y guardar.
7. Al terminar, matar **solo el PID que este mismo proceso lanzó** (`process.kill(proc.pid)`) -- nunca `taskkill /IM chrome.exe` ni ningún kill global. Esto es directamente la corrección al incidente reportado en la entrega anterior (se cerró el Chrome real del usuario con un `taskkill` global).

Con esto se consiguieron capturas reales a 320/360/390/430/768/1024/1366px para `index.html`, `agenda.html` y `portal-cliente.html`.

## 3. Cómo se verificó Agenda logueada sin credenciales reales

`agenda.html` exige Firebase Auth real -- sin credenciales, solo se puede capturar la pantalla de login. Para ver la UI logueada de verdad (cabecera compacta, colapso de KPIs, menú "Más") se usó `Runtime.evaluate` para inyectar un estado mínimo DESPUÉS de que la página cargara (nunca antes, nunca modificando el archivo real): variables globales (`dbClientes`, `dbAgenda`, `dbCredenciales`, `rolActivo='pt'`) más las mismas llamadas que ya hace el propio login real (`asegurarEstadoMobileAgenda()`, `renderClientes()`, `renderAgenda()`). Esto NO modifica `agenda.html` en disco ni escribe nada en Firestore -- es puramente una inyección en memoria del navegador de prueba, descartada al cerrar esa instancia aislada.

**Limitación honesta**: la lista de clientes no se renderizó con la carga de prueba mínima (probablemente `renderClientes()`/`calcularContadorClases()` esperan más campos de los que se inyectaron, y el error quedó silenciado por un `try/catch` defensivo puesto a propósito en el script de inyección para que un fallo ahí no impidiera capturar el resto de la pantalla). Se documenta como límite del arnés de pruebas, no como comportamiento verificado del código real -- `dbClientes`/`dbAgenda` reales no se tocaron.

## 4. Resultado

Capturas reales entregadas al usuario (ver mensajes del chat) para:
- `index.html`: 320, 390, 430, 768, 1024, 1366px.
- `agenda.html`: pantalla de login en 320/390/1366px; UI logueada (PT, móvil) en 320/390/430px, con menú "Más" abierto y panel del Asistente abierto; desktop 1366px.
- `portal-cliente.html`: estado de error sin token (320/430px, no necesita red); Home con datos de ejemplo inyectados (~500px, primera iteración antes de tener la herramienta CDP -- ver aviso en el propio mensaje del chat).

No se generaron capturas para `crm.html`/`finanzas.html`/`dashboard.html`/`reservas.html`/`valoracion.html` en esta ronda porque no se modificaron en este bloque de trabajo (excepto el guard de `crm.html`, que es un cambio de 12 líneas en la lógica de login, no de UI visual) -- priorizado el tiempo restante en verificar las páginas realmente tocadas.
