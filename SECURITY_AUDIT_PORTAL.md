# SEC-01 — Auditoría de seguridad: `besoulPublicClients/{token}` y modelo de token

No se despliega nada a partir de este documento. Es una auditoría, con límites documentados explícitamente en vez de una afirmación genérica de "seguro".

## 1. Listado exacto de campos expuestos al cliente hoy

Leído directamente del `batch.set(...)` real en `agenda.html` (no de memoria, releído para este documento):

| Campo | Contenido | ¿Dato sensible de terceros? |
|---|---|---|
| `token` | El mismo token que ya posee (viene en su URL) | No |
| `clientId` | Su propio id de ficha | No |
| `clientName` | Su propio nombre | No |
| `trainerKey`, `trainerName` | Su entrenador asignado | No |
| `centroId`, `centroNombre` | Su centro | No |
| `email`, `telefono` | Sus propios datos de contacto | No |
| `activo`, `reservasOnlineActivas` | Flags de si su acceso está habilitado | No |
| `restriccionesReservas`, `reservasBloqueadasTexto` | Bloqueos horarios de SU ficha (p.ej. "no lunes 18-20h") | No |
| `sesionesContratadas`, `sesionesUsadas`, `sesionesPendientes`, `periodoSesiones` | Su propio contador de sesiones | No |
| `proximaSesion`, `proximasSesiones`, `sesionesRecientes` | Sus propias citas (fecha/hora/clave), máx. 5 futuras + 3 pasadas | No |
| `cancelacionMinHoras` | Configuración de plazo de cancelación de su ficha | No |
| `avisos` | Sus propios avisos (máx. 10), `{id, fecha, contenido}` | No |
| `updatedAt` | Marca de tiempo de la última sincronización | No |

**Confirmado que NO contiene** (comprobado leyendo el payload completo del `batch.set`, no solo revisado a ojo):
- Precio/tarifa/facturación en euros de su propia cartera o de otros clientes.
- Rentabilidad, canon, reparto 50/35/15, ni ningún dato de Finanzas.
- Datos de NINGÚN otro cliente del mismo entrenador (el documento es 1:1 por token, nunca una lista).
- Notas internas del PT (`notaEntrenador`, notas de agenda) -- no se copian a este documento.
- Contratos, PDFs firmados, ni ninguna URL de documento.
- El `clave` (id de slot `fecha_hora`) de sus sesiones sí viaja, pero es un identificador operativo (franja horaria), no un dato privado de un tercero.

## 2. Modelo de token — análisis honesto

`generarTokenReservaCliente()` (agenda.html):
```js
function generarTokenReservaCliente() {
  const a = Math.random().toString(36).slice(2, 10);   // 8 caracteres base36
  const b = Date.now().toString(36);                    // timestamp, NO aleatorio
  return `res_${a}_${b}`;
}
```

**Hallazgo real, no hipotético**: el token tiene dos partes, y solo UNA es aleatoria.
- `b` (el segmento final) es un **timestamp en milisegundos codificado en base36 -- no es un secreto**. Cualquiera que conozca aproximadamente CUÁNDO se generó un token (p.ej. "cuando se dio de alta ese cliente", dato que en muchos casos no es privado) puede reconstruir `b` exactamente o acotarlo a un rango muy pequeño.
- `a` (el segmento aleatorio real) usa `Math.random()`, que en V8 **no es un generador criptográficamente seguro** (no hay garantía de imprevisibilidad frente a un atacante que estudie el motor, aunque en la práctica no hay un exploit trivial conocido contra Chrome/V8 actual). 8 caracteres base36 son ~41 bits de espacio de búsqueda nominal (36^8 ≈ 2,8 × 10^12), pero al no ser CSPRNG ese número es un techo teórico, no una garantía real de imprevisibilidad.
- **Mitigante real que sí existe**: la regla `allow list: if false` impide enumerar la colección, y cada intento de adivinar un token exige una llamada `get()` real contra Firestore (facturable, con monitorización/logs, y sujeta a las cuotas del proyecto) -- un ataque de fuerza bruta masivo no es gratis ni silencioso. Esto reduce el riesgo PRÁCTICO de fuerza bruta ingenua, pero no compensa que el diseño del token en sí sea más débil de lo que aparenta.

**Recomendación (no aplicada)**: sustituir por `crypto.getRandomValues()` (disponible en todos los navegadores modernos, ya usado implícitamente por Firebase Auth internamente) para los 16 bytes completos, sin usar timestamp como parte del identificador -- p.ej. `res_` + 22 caracteres base64url de `crypto.getRandomValues(new Uint8Array(16))`, elevando el espacio de búsqueda real a 128 bits verdaderamente aleatorios, sin ninguna parte adivinable.

## 3. Expiración / revocación / reutilización

- **No hay expiración por tiempo.** Un token generado hoy es válido indefinidamente salvo acción manual.
- **Revocación SÍ es posible, pero manual**: `activo: c.reservasOnlineActivas !== false` -- si el PT desactiva `reservasOnlineActivas` en la ficha del cliente, el siguiente ciclo de sincronización (`publicarReservasPublicas`, disparado por cualquier cambio en Agenda) escribe `activo:false`, y tanto `reservas.html` como `portal-cliente.html` ya comprueban ese flag y bloquean el acceso (`if (!snap.exists || snap.data().activo === false)`).
- **No hay rotación de token.** `if (!c.reservaToken) c.reservaToken = generarTokenReservaCliente();` -- solo genera uno si el campo está vacío. Si un token se filtra (compartido por error, capturado en un enlace reenviado, etc.), hoy NO hay una función en la UI para "regenerar el enlace de este cliente" -- habría que borrar manualmente `reservaToken` de la ficha (vía consola/edición directa) para forzar que se genere uno nuevo en el siguiente ciclo.
- **Un token es compartible por naturaleza** (es un enlace, cualquiera con el enlace entra) -- este es el modelo de diseño elegido (capability URL), no un fallo, pero significa que "un cliente solo accede a su propia cuenta" depende de que el cliente no reenvíe su propio enlace a terceros. Esto es idéntico al riesgo que ya asumía `reservas.html` antes de esta fase -- no es nuevo, se hereda.

**Recomendación (no aplicada)**: añadir un botón "Regenerar enlace" en la ficha del cliente (Agenda) que limpie `reservaToken` y fuerce la generación de uno nuevo con el algoritmo mejorado de la sección 2, e invalide expresamente el antiguo (borrando el documento `besoulPublicClients/{tokenAntiguo}` en el mismo paso, no dejándolo huérfano).

## 4. Conclusión

El aislamiento **entre clientes** es sólido (documento 1:1, sin `list`, sin datos cruzados) -- confirmado, no solo afirmado. El punto débil real está en la **fortaleza del propio token** (parcialmente predecible por el timestamp, generado con un PRNG no criptográfico) y en la **ausencia de expiración/rotación**. Ninguno de los dos es una vulnerabilidad crítica inmediata (dado el coste de fuerza bruta contra Firestore y que `list` está deshabilitado), pero tampoco se puede llamar "seguro" sin matizarlo -- quedan documentadas ambas recomendaciones, ninguna aplicada.

## 5. SEC-05 (2026-09-04) — ambas recomendaciones de este documento, implementadas

- **§2 aplicada**: `generarTokenReservaCliente()` (`agenda.html`) ahora usa `crypto.getRandomValues(new Uint8Array(16))` -- 128 bits reales de entropía, codificados en hex (32 caracteres), en vez de los ~41 bits nominales (no garantizados) de `Math.random()`. El segmento de timestamp se conserva al final del token (`res_<32 hex>_<timestamp base36>`) por compatibilidad de formato con el validador `TOKEN_RE`/`TOKEN_RESERVA_RE` ya desplegado en `reservas.html`/`portal-cliente.html` -- sigue sin ser secreto, pero ya no es la única fuente de imprevisibilidad: el segmento hex por sí solo ya es computacionalmente inviable de adivinar.
- **§3 aplicada**: nuevo botón "Regenerar enlace" en la ficha del cliente (Agenda, visible solo si `c.reservaToken` ya existe) -- `regenerarTokenReservaCliente(idCliente)` genera un token nuevo (algoritmo de arriba), lo asigna a la ficha, y marca el documento `besoulPublicClients/{tokenAntiguo}` con `activo:false` de forma explícita (mismo flag que `reservas.html`/`portal-cliente.html` ya comprueban para bloquear acceso) -- el enlace antiguo deja de servir de inmediato, no queda huérfano.
- **Compatibilidad, explícita**: ningún token ya emitido con `Math.random()` se invalida por este cambio -- el formato de salida no cambió, solo la fuente de aleatoriedad de los tokens generados a partir de ahora. La migración de tokens antiguos a la versión CSPRNG es progresiva y bajo demanda (vía "Regenerar enlace", cliente por cliente), nunca forzada en bloque -- instrucción explícita del brief que originó esta fase.
- **Lo que sigue sin resolver** (fuera de alcance de SEC-05, no se ha tocado): sigue sin existir expiración automática por tiempo -- un token (nuevo o viejo) sigue siendo válido indefinidamente hasta que alguien lo regenere o desactive `reservasOnlineActivas` manualmente. Aceptado como riesgo residual documentado, no como pendiente silencioso.
