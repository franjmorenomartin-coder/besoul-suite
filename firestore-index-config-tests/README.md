# Firestore Index Config Tests (FIRESTORE-INDEX-P0)

Valida `firestore.indexes.json` / `firebase.json` / `.firebaserc` (nuevos en este hotfix) contra el
código fuente real de la aplicación -- nunca contra una copia re-tecleada de las queries. Corrige
el error real de producción `too many index entries for entity /besoulSuite/agenda` al guardar
disponibilidad (y potencialmente cualquier otro campo del mismo documento).

## Causa raíz (demostrada, no asumida)

Firestore mantiene, por defecto, un índice automático de campo simple para **cada campo de cada
documento, incluidos recursivamente todos los subcampos de cualquier mapa anidado** (confirmado
contra la documentación oficial: "Fields nested within map fields are indexed too"). El documento
`besoulSuite/agenda` es un megadocumento monolítico cuyos campos principales son MAPAS con claves
dinámicas que crecen sin límite con el uso real de la aplicación:

- `clientes.<trainerKey>` -- un array de fichas de cliente por PT (cada ficha, con decenas de
  campos, aporta más entradas de índice).
- `agenda.<trainerKey>.<fecha_hora>` -- una entrada por CADA sesión agendada jamás, de CADA PT,
  para siempre (nunca se purga).
- `disponibilidadReservas.<trainerKey>.excepciones.<fecha>` / `.bloqueos.<fecha>` -- una entrada
  por cada excepción/bloqueo puntual que cualquier PT haya creado alguna vez.
- `historicoClientes`, `pruebasCRM`, `notas`, `catalogoActividades`, `trainerActividades`,
  `tarifasActividadVersiones`, `repartoActividadVersiones` -- mismos patrones de mapas con claves
  dinámicas (trainerKey/fecha/actividadId).

Cuantos más PT, clientes, sesiones e histórico acumula BESOUL en producción, más entradas de
índice automático genera CADA escritura sobre este documento -- hasta superar el límite duro de
Firestore por documento, momento en el que **cualquier** escritura (incluida la de disponibilidad)
empieza a ser rechazada con `too many index entries for entity`.

## Por qué las exenciones (field overrides) son la solución correcta -- y no una migración

Auditado exhaustivamente TODO el repo (`agenda.html`, `portal-cliente.html`, `finanzas.html`,
`dashboard.html`, `crm.html`) buscando `.where(`, `.orderBy(`, `array-contains`, `array-contains-
any`, `in`, `not-in`, `startAt(`, `endAt(`, `collectionGroup(`: **ninguna query real apunta jamás
a un campo dentro de `besoulSuite/agenda` ni `besoulSuite/finanzas`**. Todo acceso a esos dos
documentos es siempre por referencia directa (`.doc('agenda')`/`.doc('finanzas')`), nunca por
`.where()`/`.orderBy()` sobre la colección `besoulSuite` -- que en sí misma nunca se consulta como
colección (`collection('besoulSuite')` jamás va seguido de `.where`/`.orderBy` en todo el
frontend). Los ÚNICOS `.where()` del repo apuntan a colecciones completamente distintas
(`besoulLeads`, `besoulNotifications`, `besoulReservas`, `besoulSolicitudesEliminacion`,
`besoulCancelacionesCliente`), cada una con su propio índice automático de campo simple, sin
ninguna relación con `besoulSuite`.

Firestore soporta exactamente este caso con **field overrides**: una entrada en
`fieldOverrides` con `"indexes": []` desactiva la indexación automática de un campo (y, para un
campo tipo mapa, de TODOS sus subcampos anidados recursivamente -- confirmado contra
documentación oficial de Google Cloud/Firebase). No borra datos, no migra nada, no cambia el
modelo de datos, no cambia la aplicación: solo deja de mantener índices que ninguna query usa.

## Configuración aplicada

`firestore.indexes.json`:
- `"indexes": []` -- ningún índice compuesto (no hacía falta ninguno: cero queries con múltiples
  condiciones sobre esta colección).
- `"fieldOverrides"`: un wildcard `fieldPath: "*"` para `collectionGroup: "besoulSuite"` (cubre
  TODO campo presente o futuro de `agenda`/`finanzas`, ya que se ha demostrado que la colección
  entera no tiene ninguna query), más 10 entradas explícitas nombrando cada campo-mapa auditado
  (documentación-como-configuración, redundante con el wildcard pero deja constancia exacta de qué
  se auditó campo por campo, tal como se pidió).

`firebase.json`: SOLO declara `firestore` (rules + indexes). Sin `hosting`, sin `functions`, sin
`storage` -- el frontend sigue desplegándose por GitHub Pages, no por Firebase Hosting.

`.firebaserc`: `projectId` = `besoul-suite`, extraído literalmente del `firebaseConfig` ya
desplegado en producción en las 5 páginas de la app (nunca inventado).

## Tests (27)

Ver `run_tests.cjs` -- valida JSON parseable, coherencia del projectId real, que `firebase.json`
no toca Hosting/Functions/Storage, que `firestore.rules` permanece intacto, ausencia de índices
compuestos innecesarios, que el wildcard es seguro (comprobación programática de que ninguna
`.where`/`.orderBy` real apunta a `besoulSuite` en todo el frontend), los 10 campos exentos, y que
ninguna colección con queries reales (`besoulLeads`, etc.) queda tocada por error.

## Despliegue

Firebase CLI **no está autenticado en este entorno** (confirmado: `npx firebase-tools login:list`
-> "No authorized accounts"; el intento real de `firebase deploy --only firestore:indexes
--project besoul-suite` fallo con "Failed to authenticate, have you run firebase login?" --
salida capturada, nada se ha desplegado). Comando exacto que debe ejecutar el usuario, ya
autenticado:

```bash
npx firebase-tools@latest deploy --only firestore:indexes --project besoul-suite
```

(o `firebase deploy --only firestore:indexes --project besoul-suite` si tiene Firebase CLI
instalado globalmente). Este comando **solo** toca índices -- no Rules, no Functions, no Storage,
no Hosting.

## Cómo ejecutar los tests

```bash
node firestore-index-config-tests/run_tests.cjs
```
