# Notices Tests — avisos internos PT → cliente (PORTAL-NOTICES-FIX)

Auditoría end-to-end pedida explícitamente ("no asumas que los avisos internos están operativos,
demuéstralo"): PT envía un aviso -> ¿dónde se guarda? -> contador -> histórico -> proyección
cliente -> Portal Avisos -> leído/no leído.

## Qué representaba el contador (demostrado, no asumido)

El contador "Avisos (N)" de la card de un cliente y el modal "Avisos enviados" leen **la misma
fuente** (`ficha.avisosPortal`), así que entre ellos son consistentes. El problema real:
`publicarAvisoPortalCliente()` mutaba `ficha.avisosPortal` (el objeto vive dentro de
`dbClientes[trainerKey]`) y lo guardaba en `localStorage` + lo publicaba a la proyección pública
(`besoulPublicClients/{token}`, vía `publicarReservasPublicasDebounced()`) -- pero **nunca** lo
guardaba en el documento compartido `besoulSuite/agenda`. `aplicarEstadoNubeAgenda()` hace
`dbClientes = data.clientes || {}` (reemplazo TOTAL) en cada snapshot -- así que en cuanto llegaba
CUALQUIER snapshot no relacionado (una disponibilidad guardada, un cliente editado, cualquier cosa
de cualquier PT), el aviso desaparecía de la vista del propio PT que lo acababa de enviar --
exactamente "aparece un 1, luego 'Sin avisos enviados todavía.'" reportado. Era, literalmente,
**dato local/de sesión, nunca persistido**, no un dato legacy ni un canal distinto.

## Fix

`publicarAvisoPortalCliente()` ahora también llama a `programarGuardadoNubeAgenda(entrenadorVisto)`
(debounced -- avisar a varios clientes en un lote llama a esta función en bucle, y así se
coalescen en un único guardado real) tras mutar `avisosPortal`. Sin colección ni Rules nuevas:
`besoulSuite/agenda` ya admite escritura de cualquier usuario activo (`firestore.rules`, línea
~134); esto es exactamente el mismo mecanismo que ya usan clientes/agenda/disponibilidad.

El badge de Avisos del Portal Cliente (`badge-avisos-nav`, portal-cliente.html) lee
`clientData.avisos`, publicado por `publicarReservasPublicas()` desde el mismo `avisosPortal` --
ahora que este persiste de verdad, el badge deja de poder desincronizarse de la misma forma.
`leídos/no leídos` sigue siendo local por dispositivo (`localStorage`, `leidosLocal()`) -- diseño
ya aceptado en una fase anterior, no requiere Rules nuevas, no se ha tocado.

## Tests (7, negative control incluido)

Reproduce el escenario exacto (enviar aviso -> contador en memoria = 1 -> [antes: cualquier
snapshot lo borraba] -> ahora: sigue en el documento remoto y sobrevive una recarga completa),
más lotes de varios clientes coalescidos en un único guardado, y que un mensaje vacío no crea nada
(validación real, no solo visual). Verificado manualmente que el mismo control negativo falla
contra el código previo a este fix (mueve temporalmente `agenda.html` a la versión pre-fix) y pasa
contra el fix.

## Cómo ejecutar

```bash
node notices-tests/extract.js && node notices-tests/run_tests.cjs
```
