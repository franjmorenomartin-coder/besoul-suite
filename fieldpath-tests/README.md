# FieldPath Tests — writers pendientes del mismo hallazgo (FIELDPATH-P0)

`availability-tests/` ya demostró y corrigió el hallazgo real: un `trainerKey` con un punto
literal (p. ej. `fran.jmorenomartin`, derivado de un email sin `trainerKey` explícito en
`besoulUsers`) corrompe cualquier escritura de Firestore que construya una ruta anidada
concatenando strings (`"campo.<trainerKey>"`) para `.update()`/`tx.update()` -- Firestore
interpreta CADA punto como un separador de ruta real, así que el valor se guarda en más niveles de
los que existen de verdad, nunca en la clave plana que el resto del código lee.

Esa misma auditoría, en su momento, encontró DOS escritores más de `besoulSuite/agenda` con el
mismo patrón, todavía sin corregir:

- `finanzas.html` → `guardarCatalogoActividadesNube()` (escribe `trainerActividades.<trainerKey>`,
  `catalogoActividades.<actividadId>`, `tarifasActividadVersiones.<actividadId>`,
  `repartoActividadVersiones.<actividadId>`).
- `crm.html` → `sincronizarPruebaAgendaDesdeLead()` (escribe `agenda.<trainerKey>.<clave>` y
  `pruebasCRM.<trainerKey>.<clave>` dentro de una transacción, incluido con
  `FieldValue.delete()`).

## Fix

Mismo patrón que en `agenda.html`: `firebase.firestore.FieldPath(...)` trata cada segmento como
LITERAL, sin volver a partirlo por puntos.

- `finanzas.html`: nueva `payloadParaUpdateFirestoreFinanzas(payload)` convierte el objeto de
  payload a la forma varargs de `.update()`, igual que `payloadParaUpdateFirestore()` en
  `agenda.html`.
- `crm.html`: como aquí las rutas tienen 3 segmentos dinámicos (`campo`, `trainerKey`, `clave`) en
  vez de 2, no basta con partir un string ya concatenado -- se recogen los segmentos SIN concatenar
  (`rutasAnidadas`, `{segmentos:[...], valor}`) en el momento en que ya se conocen por separado, y
  se construye `tx.update(ref, ...args)` con `FieldPath(...segmentos)` para cada uno al final.

Comportamiento idéntico para cualquier trainerKey/actividadId sin puntos (la inmensa mayoría hoy).

## Tests (12, negative controls incluidos)

Reproducen el trainerKey con punto contra AMBOS writers y confirman que la clave remota queda
PLANA (nunca un mapa anidado fantasma tipo `{fran: {jmorenomartin: ...}}`), que un trainerKey
normal sigue funcionando exactamente igual, y (para CRM) que re-sincronizar la misma prueba borra
limpiamente la cita antigua sin dejar residuo. Verificado manualmente que ambos negative controls
fallan contra el código previo a este fix (movidos temporalmente a esa versión) y pasan contra el
fix.

## Cómo ejecutar

```bash
node fieldpath-tests/extract.js && node fieldpath-tests/run_tests.cjs
```
