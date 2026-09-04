# FASE 6 — ¿Se puede aislar la escritura de `notas` sin migración estructural?

## El problema

`notas` es un mapa plano dentro de `besoulSuite/agenda`: `{ "trainerKey__clave": "texto" }` -- por ejemplo `{ "carmen__2026-09-10_10:00": "cliente pidió cambiar la hora" }`. A diferencia de `clientes`/`agenda`/`disponibilidadReservas`/`historicoClientes`/`pruebasCRM` (que están anidados **por trainerKey como clave de primer nivel**, p.ej. `clientes.carmen`), `notas` mezcla trainerKey y clave de sesión en una sola cadena de texto al mismo nivel. Por eso el bloque FASE 2 ya escrito en `firestore.rules` la deja fuera de la comprobación estricta, con el comentario "notas queda fuera de la comprobación estricta: es un mapa plano".

## ¿Puede Firestore Rules comprobar "todas las claves modificadas empiezan por `miTrainerKey + '__'`"?

**No, de forma robusta, con el mecanismo `affectedKeys()`/`hasOnly()` que ya usa el resto de FASE 2.**

`diff().affectedKeys()` devuelve un **conjunto (`Set`) de claves**, y `hasOnly(lista)` compara ese conjunto contra una lista **exacta y estática** (o derivada de datos ya conocidos, como `[myTrainerKey()]`) -- no contra un **patrón**. El lenguaje de Firestore Rules (CEL restringido) no ofrece ninguna de estas dos capacidades necesarias para lo que se pide:

1. **Ningún operador de coincidencia de patrón sobre CADA elemento de un conjunto dinámico.** Existe `string.matches(regex)` para comprobar UNA cadena conocida de antemano, pero no hay `set.all(x, x.matches(regex))` ni ningún equivalente de "for all" / "every" sobre un `Set<String>` de tamaño y contenido no conocidos en tiempo de escritura de la regla. `affectedKeys()` devuelve claves arbitrarias (`"ptA__2026-09-10_10:00"`, `"ptA__2026-09-11_08:15"`, ...) que Rules no puede iterar con un predicado.
2. **No se puede construir "la lista de todas las claves válidas" de antemano**, porque `clave` (la parte después de `__`) es una fecha+hora arbitraria -- un conjunto infinito/no enumerable. `hasOnly()` solo funciona cuando se puede escribir la lista completa de claves permitidas de antemano (como `[myTrainerKey()]`, una lista de un solo elemento conocido), no cuando la lista permitida depende de un patrón sobre datos futuros.

Se intentó deliberadamente NO inventar una versión "aproximada" de esto (p.ej. comprobar solo la PRIMERA clave modificada, o asumir que si el tamaño del diff es 1 basta) -- cualquier atajo de ese tipo sería una protección frágil con casos borde reales (una escritura que modifique 2 notas a la vez, una propia y una ajena, pasaría el chequeo "aproximado" si el orden de iteración pone la propia primero). Se descarta explícitamente, tal como pedía el enunciado.

## Lo que SÍ sería robusto (pero es un cambio de forma de datos, no de Rules)

Si `notas` se reestructurara de `{"trainerKey__clave": texto}` a `notas.<trainerKey>.<clave>` (anidado, igual que los otros 5 campos), la MISMA línea que ya protege a `clientes`/`agenda`/etc. protegería a `notas` sin necesidad de ningún truco adicional:
```
&& request.resource.data.notas.diff(resource.data.notas).affectedKeys().hasOnly([myTrainerKey()])
```
Este es un cambio de **forma de datos** (una migración pequeña y acotada, no la migración estructural completa de Agenda a `agendaByTrainer/{trainerKey}`), pero sigue siendo una migración real: requiere (a) un script que transforme el mapa plano existente al nuevo formato anidado, (b) actualizar los 3 puntos de lectura/escritura de `notas` en `agenda.html` (`claveNotaAgenda()`, `fijarNotaAgenda()`, `obtenerNotaAgenda()`, `moverNotaAgenda()`) para leer/escribir la nueva ruta, (c) probar que no queda ninguna nota huérfana en el formato antiguo. No se ejecuta en esta fase -- se documenta como el camino real si se decide cerrar este hueco más adelante, separable de la migración grande de `agendaByTrainer`.

## Decisión para esta fase

**`notas` queda documentada como riesgo WRITE residual, sin mitigar.** Confirmado con una prueba real contra el emulador de Firestore (`run_tests.mjs`, caso "notas: PT A SÍ puede escribir una clave de notas de OTRO trainer"): bajo el ruleset candidato de FASE 2, un PT activo puede escribir CUALQUIER clave dentro de `notas`, incluida una perteneciente a otro trainerKey -- el peor caso posible es que un PT pueda alterar o borrar la nota privada de otro PT sobre una sesión ajena. No puede, en cambio, alterar la CITA en sí (`agenda.<trainerKey>.<clave>`, sí protegida) ni ningún dato de cliente -- el impacto está acotado a un campo de texto informativo, no a datos operativos ni de facturación.
