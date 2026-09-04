# B7 — Estrategia de compatibilidad con `reservas.html` (enlaces legacy)

`reservas.html` **no se borra** -- sigue existiendo, sigue funcionando exactamente igual que antes, código intacto.

## Mecanismo

Constante `REDIRIGIR_A_PORTAL_V2` en `reservas.html`, **`false` por defecto** (esta fase). Cuando se active (`true`):

- `reservas.html?t=TOKEN` (o `?token=TOKEN`) → `location.replace('portal-cliente.html?token=TOKEN&view=reservar')`, preservando el token normalizado, redirección instantánea antes de que se pinte nada de la UI legacy.
- `reservas.html?t=TOKEN&legacy=1` **nunca redirige** -- sirve la página legacy tal cual, incluso con el flag activo. Vía de escape explícita para depurar/comparar sin tener que desactivar el flag global.
- `Portal Cliente V2` (`?view=reservar`) abre directamente en `Agenda → Reservar`, con el mismo motor de huecos/grupos ya portado (ver commit de Portal V2) -- el cliente nunca ve una pantalla vacía ni tiene que navegar manualmente hasta la reserva.

## Por qué no se activa en esta misma fase

Activar el flag cambia el comportamiento de enlaces **ya enviados por WhatsApp a clientes reales** -- es una decisión de producto con impacto directo en usuarios reales, no una decisión técnica. Queda preparada, probada en el código (sintaxis verificada), pero **apagada** hasta que el usuario revise Portal V2 y decida activarla explícitamente. Cambiar `false` a `true` es el único paso necesario.

## No rompe nada

- El propio `reservas.html` sigue accesible sin token (pantalla de "introduce tu código") y con `&legacy=1`.
- El token no cambia de formato ni de fuente (`TOKEN_RE`/`TOKEN_RESERVA_RE` idénticos en ambos archivos).
- `besoulPublicClients`/`besoulPublicSchedule`/`besoulReservas` -- mismas colecciones, mismas Rules, sin ningún cambio de permisos por este mecanismo.
