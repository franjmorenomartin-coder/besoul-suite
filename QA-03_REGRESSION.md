# QA-03 — Regresión de esta fase (SEC-PORTAL-CLIENTE-BASELINE)

Alcance real de esta fase, para juzgar qué regresión hacía falta: los únicos archivos con cambios de CÓDIGO (no solo documentación) son `firestore.rules` (propuesta, no desplegada -- cero efecto en runtime), `crm.html` (un comentario, cero lógica), `finanzas.html`/`dashboard.html` (solo eliminación de `console.log`/`console.error` de diagnóstico, ninguna fórmula tocada) y `agenda.html` (CSPRNG del token, botón+función "Regenerar enlace", re-lectura server-side de `cancelacionMinHoras`). `functions/` es código nuevo pero no se ejecuta en el navegador ni se ha desplegado -- no aplica QA de navegador.

## Verificado realmente (no solo revisado a ojo)

1. **Sintaxis**: `node --check` sobre el contenido `<script>` extraído de `agenda.html`, `finanzas.html`, `dashboard.html` y `crm.html` tras cada edición -- los 4 pasan limpio.
2. **Carga sin errores de consola**: servidor estático local + Chrome headless vía CDP (`Emulation.setDeviceMetricsOverride`, mismo tooling ya usado en fases anteriores de esta sesión), captura de `Runtime.consoleAPICalled`/`Runtime.exceptionThrown` reenviada al terminal. Cargadas: `agenda.html`, `finanzas.html`, `dashboard.html`, `crm.html` (1366×900) y `portal-cliente.html`, `reservas.html` (390×844, sin token real en la URL -- solo se comprueba que la pantalla de "enlace inválido" renderiza sin excepción). **Resultado: en las 6, el único mensaje de consola es el warning ya conocido y aceptado de Tailwind CDN en producción -- cero errores, cero excepciones nuevas.**
3. **Verificación funcional específica del código nuevo (SEC-05)**: inyectado un script real (no `Runtime.evaluate` suelto -- el mismo método ya establecido en esta sesión para que comparta scope de verdad con las funciones de la página) sobre `agenda.html` cargada, ejecutando `generarTokenReservaCliente()` 5 veces:
   - Los 5 tokens cumplen `/^res_[a-z0-9_]{3,60}$/` (el mismo validador real de `reservas.html`/`portal-cliente.html`, sin tocar) -- compatibilidad de formato confirmada, no asumida.
   - Los 5 son distintos entre sí (sin colisión en la muestra).
   - El segmento aleatorio mide 32 caracteres hex (128 bits), como se diseñó.
   - `regenerarTokenReservaCliente` y `procesarCancelacionCliente` existen como funciones invocables en el scope real de la página (sin `ReferenceError`).

## NO verificado con navegador real esta fase (y por qué no hacía falta)

La lista pedida en el brief (LOGIN, AGENDA completa -- clientes/grupos/sesiones/45min/inicios 15min/mover/reprogramar/conflictos/persistencia --, CRM, RESERVAS -- token/disponibilidad/transaction/ID determinista --, FINANZAS -- temporalidad/canon/participación/€cliente/computaCanonCentro/50-35-15/históricos --, WHATSAPP, PORTAL CLIENTE, IA LOCAL) es la superficie COMPLETA de la app, no la superficie de esta fase. Ninguno de esos flujos tiene código tocado en esta fase:

- Drag/drop, reprogramar, conflictos, grupos, 45min/15min: cero líneas tocadas en `agenda.html` fuera de la ficha de cliente (botón nuevo) y la cancelación (función ya dormida, `CANCELACION_PORTAL_HABILITADA=false`).
- Fórmulas de Finanzas (`calcularCanonCentroYAsignar`, temporalidad, 50/35/15, históricos): **cero cambios** -- confirmado por `git diff` de esta fase, que solo muestra líneas `console.log`/`console.error` eliminadas, ninguna línea de cálculo tocada.
- CRM: un comentario. Sin cambio de lógica, guard de login intacto.
- WhatsApp, IA local: cero archivos tocados esta fase.
- Reservas (`reservas.html`, `besoulReservas.create`): cero archivos tocados esta fase (el cross-check token/clientId/trainerKey ya estaba en `main` desde antes).

**Conclusión honesta**: se verificó con evidencia real lo que esta fase realmente cambió (carga limpia + comportamiento del generador de tokens + existencia de las funciones nuevas). No se re-certificó lo que no se tocó -- afirmarlo sin haberlo ejecutado sería presentar como probado algo que solo se infiere por no haber tocado el archivo. Riesgo de regresión de esta fase sobre esos flujos: bajo, por alcance de cambio, no por haberlo re-probado en vivo.
