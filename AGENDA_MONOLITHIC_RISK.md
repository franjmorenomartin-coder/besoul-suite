# Riesgo de Agenda monolítica — documentado, NO migrado en esta fase

`besoulSuite/agenda` es un único documento Firestore que contiene, anidado por `trainerKey`, los datos de **todos** los entrenadores del gimnasio a la vez: `clientes`, `agenda`, `disponibilidadReservas`, `historicoClientes`, `pruebasCRM`, más un mapa plano `notas` (`"trainerKey__clave"`). Este documento es el corazón operativo de toda la Suite -- `agenda.html` lo lee/escribe en cada sesión.

Esta fase **no migra nada**. Este documento es la auditoría exacta pedida (qué lee/escribe un PT hoy, aislamiento real, límite de Firestore Rules dentro de un documento monolítico) más una propuesta de arquitectura futura, sin ejecutarla.

## 1. Qué lee un PT hoy

Al hacer login como PT no-admin, `ejecutarLogin()` fija `dbCredenciales = { [trainerKeyPropio]: perfil }` -- **solo su propio perfil**, no el de otros PT. Pero eso es una decisión de la app, no algo que Firestore imponga: la primera lectura del documento completo (`onSnapshot`/`get()` sobre `besoulSuite/agenda`) sí trae, técnicamente, el JSON completo con TODOS los trainers -- la app simplemente elige no usar más que la porción de `entrenadorVisto` al pintar la UI. Un PT que inspeccione el objeto en la consola del navegador (`dbClientes`, `dbAgenda` completos, no filtrados) puede ver los datos de otros PT que ya llegaron en esa misma lectura, sin necesitar ninguna llamada adicional a Firestore.

## 2. Qué puede escribir un PT hoy

`guardarEstadoNubeAgenda(trainerKeyScope)` construye un payload dirigido (`estadoLocalAgendaParaNube(scope)`, con claves de ruta punteada tipo `clientes.<trainerKey>`) y lo aplica con `.update(payload)` (no `.set()` -- hallazgo real de 2026-09-02, documentado en el propio código: `.set(..., {merge:true})` trataba las claves con punto como nombres de campo LITERALES, no como rutas anidadas; `.update()` sí las interpreta como ruta real). En la práctica, el código de la app **siempre** dirige sus escrituras al `trainerKey` correcto -- nunca se ha encontrado, en esta sesión ni en las anteriores, un camino de código que escriba la porción de OTRO trainer por accidente.

## 3. Aislamiento actual — solo de aplicación, no de Firestore

- **Lectura**: `isActiveUser() && docId=='agenda'` -- cualquier usuario activo lee el documento COMPLETO. Sin aislamiento de Firestore.
- **Escritura**: misma regla -- cualquier usuario activo puede, en teoría, enviar un `.update()` con una ruta punteada apuntando a `clientes.<CUALQUIER-otro-trainerKey>`. Firestore lo aceptaría: la Rule no distingue QUÉ trainerKey se está tocando, solo que el usuario esté activo.
- Existe una propuesta ya escrita, comentada, NO activa (`firestore.rules`, bloque "OPCIONAL / FASE 2") que restringiría la escritura a que `request.resource.data.<campo>.diff(resource.data.<campo>).affectedKeys().hasOnly([myTrainerKey()])` para cada uno de los 5 campos anidados por trainer -- es decir, "solo puedes tocar TU porción de cada campo, dentro del mismo documento". No se activa en esta fase (instrucción explícita: no migrar Agenda todavía).

## 4. Limitaciones reales de Firestore Rules dentro de un documento monolítico

Aunque se activara el bloque FASE 2 de arriba, seguirían existiendo límites estructurales que NINGUNA regla puede resolver mientras todo viva en un solo documento:

- **Lectura sigue siendo todo-o-nada.** Firestore Rules no tienen "field-level read security" dentro de un único `get()`/`onSnapshot()` de documento -- o lees el documento entero, o no lees nada. Por más que se active FASE 2 para escritura, un PT seguirá recibiendo, en cada lectura, los datos completos de TODOS los demás trainers. Field-level read isolation solo es posible separando los datos en documentos/colecciones distintos por trainer.
- **Límite de tamaño de documento** (1 MiB por documento en Firestore) -- con clientes/agenda/histórico de TODOS los trainers en un solo documento, el crecimiento del gimnasio (más PT, más clientes, más meses de histórico) converge hacia ese límite de forma más rápida que si estuviera repartido.
- **Contención de escritura** -- Firestore recomienda no superar ~1 escritura/segundo sostenida sobre el MISMO documento. Con todos los PT escribiendo (agenda, notas, avisos, cancelaciones) contra el mismo `besoulSuite/agenda`, el límite de contención es compartido por TODO el gimnasio, no por trainer -- un gimnasio con muchos PT activos simultáneamente podría empezar a ver escrituras en cola/reintento, algo que una estructura por-trainer no tendría.

## 5. Arquitectura futura propuesta (NO ejecutada en esta fase)

```
agendaByTrainer/{trainerKey}          <- un documento por trainer (o incluso una subcolección
  clientes: {...}                        más, ver abajo, si un solo documento por trainer también
  agenda: {...}                          creciera demasiado con el tiempo)
  disponibilidadReservas: {...}
  historicoClientes: {...}
  pruebasCRM: {...}
  notas: {...}
```

Con esta forma, la Rule de aislamiento sería trivial y real (no una whitelist de `affectedKeys()` sobre un documento compartido):
```
match /agendaByTrainer/{trainerKey} {
  allow read, write: if isAdmin() || (isActiveUser() && trainerKey == myTrainerKey());
}
```

Esto resolvería a la vez la lectura (ya no todo-o-nada) y la escritura (ya no depende de que la app "se porte bien" con rutas dirigidas -- Firestore lo impone). También distribuye la contención de escritura por documento (un pico de actividad de un PT no compite con el resto), y aleja el límite de tamaño de documento (crece por trainer, no por gimnasio entero).

**Costo/riesgo de migrar, para que quede documentado y no se subestime**: requiere (a) un script de migración one-shot que lea `besoulSuite/agenda` y escriba N documentos nuevos, (b) reescribir CADA lectura/escritura de `agenda.html` que hoy asume el documento único (`window.bsAgendaCloudDocRef`, `onSnapshot` sobre un solo doc, `guardarEstadoNubeAgenda()`), (c) periodo de convivencia o corte coordinado (todos los PT deben estar fuera de la app durante el corte, o se duplica temporalmente la escritura a ambos esquemas), (d) volver a auditar TODO lo que depende de leer varios trainers a la vez desde un admin (p.ej. `cargarPerfilesUsuariosFirebase()` ya usa una colección aparte, `besoulUsers`, así que ese patrón de "N documentos, uno por entidad" ya es familiar en el resto del proyecto). No es una tarde de trabajo -- es un proyecto propio, con su propio plan de corte y rollback. No se ejecuta nada de esto en esta fase.
