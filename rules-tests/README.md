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

## `run_acceso_retirado_tests.cjs` (GESTION-ENTRENADORES)

Retirada de acceso de un entrenador con las reglas actuales, sin cambiarlas: con `besoulUsers.activo:
true` lee y escribe lo suyo; con `activo: false` se le deniega todo (agenda, fichas, histórico,
disponibilidad, notas, reservas, solicitudes, notificaciones, leads, catálogo, Finanzas) salvo leer su
propio perfil, no puede reactivarse ni borrarse, y sus datos se conservan. Como `run_tests.cjs`, el
emulador debe escuchar en `127.0.0.1:8080` (si `firebase.json` usa otro puerto, pasa `--config` con uno
que fije 8080):

```bash
firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_acceso_retirado_tests.cjs"
```

## `run_finanzas_meses_tests.cjs` (REFORMA-FINANZAS)

Reglas preparadas (sin publicar) de `besoulFinanzasMeses/{AAAA-MM}`. Las operaciones válidas usan el
mismo módulo que Finanzas (`besoul-finanzas-real.js`); las inválidas imitan a un cliente antiguo o
manipulado: solo admin activo lee y escribe; PT, anónimo y admin con acceso retirado, denegados; `rev`
desfasada o que salta, hora del cliente, campos desconocidos (p. ej. un canon automático), cambio de `mes`
y borrado, denegados; transiciones abierto → revisado → cerrado → abierto con autor y hora del servidor;
un mes revisado o cerrado no admite cambios de registros ni reescribir la fotografía; reabrir exige motivo.
Emulador en `127.0.0.1:8080`:

```bash
firebase emulators:exec --only firestore --project demo-besoul-suite "node rules-tests/run_finanzas_meses_tests.cjs"
```
