# Rules Tests — HARDENING-PRE-BASELINE-v3.2.1

Pruebas REALES de autorización de `firestore.rules` contra el Firebase Emulator Suite oficial
(`@firebase/rules-unit-testing`) — nunca contra Firestore real. `projectId: 'demo-besoul-suite'`
(el prefijo `demo-` fuerza al SDK a modo emulador puro, sin ninguna ruta posible hacia producción).

Requiere JDK 21+ (el Firestore Emulator no arranca con Java 8). Este repo no lo traía instalado;
se instaló Eclipse Temurin JDK 21 vía `winget` para poder ejecutar esta suite.

## `run_tests.cjs` — Rules tal como están HOY en el repo

51/51 pruebas, cubriendo los 7 roles pedidos (ANÓNIMO, AUTH SIN PERFIL, PT A ACTIVO, PT B ACTIVO,
PT INACTIVO, ADMIN, CLIENTE PORTAL) × las 9 colecciones reales, con test positivo y negativo por
Rule relevante. Confirma **empíricamente** (no solo por lectura de código) el hallazgo P0 de la
auditoría maestra: con la Rule actual (`isActiveUser()`, sin FASE 2), un PT activo SÍ puede escribir
la porción `clientes.<otroTrainerKey>` de otro entrenador -- se deja como test informativo, no
como fallo de esta suite, porque documenta el comportamiento real, no lo oculta.

## `run_fase2_candidate_tests.cjs` — determina FASE2_READY empíricamente

Construye en memoria la variante FASE 2 ya escrita y comentada dentro del propio
`firestore.rules` (descomentándola tal cual, sin reescribir ninguna condición a mano) y prueba:
que el hallazgo P0 queda cerrado, que el payload REAL que ya envía hoy `guardarEstadoNubeAgenda()`
(rutas punteadas dirigidas a la propia trainerKey) sigue funcionando sin cambios, que admin
conserva acceso total, y que la lectura sigue siendo por-documento completo (FASE 2 nunca resuelve
eso -- limitación estructural ya documentada en `AGENDA_MONOLITHIC_RISK.md`).

**Resultado: `FASE2_READY = YES`.** `firestore.rules` en el repo NO se ha modificado -- esta suite
es evidencia para la decisión de desplegar, no un despliegue.

## Ejecutar

```
npm install
firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_tests.cjs"
firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_fase2_candidate_tests.cjs"
```

(Si `java -version` es anterior a 21, instala un JDK 21+ antes de ejecutar -- p.ej. `winget install
--id EclipseAdoptium.Temurin.21.JDK` -- y antepón su carpeta `bin` al `PATH` de la sesión.)
