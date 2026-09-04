# Rules Unit Tests — SEC-AGENDA-WRITE-ISOLATION

Pruebas reproducibles reales (Firebase Rules Unit Testing, contra el emulador de Firestore) del ruleset candidato para el primer deployment de seguridad post-`SEC-PORTAL-CLIENTE-BASELINE`. No es inspección visual: cada caso ejecuta una operación real (lectura/escritura) contra un Firestore emulado y comprueba que se permite o se deniega, con datos semilla reales copiados del esquema real de `besoulSuite/agenda`.

## Qué contiene

- `firestore.rules.candidate` — el ruleset candidato EXACTO evaluado (los 5 puntos de FASE 9: `isActiveUser()` en Agenda, FASE 2 write isolation, CRM admin-only, ownership `besoulPublicClients`, cross-check `besoulReservas.create`). Deliberadamente NO incluye `besoulSolicitudesEliminacion`/`besoulNotifications`/la rama `avisosLeidos` — ver `RULES_DEPLOYMENT_MATRIX.md` en la raíz del repo para por qué se excluyeron de este primer deployment.
- `run_tests.mjs` — el script de pruebas (32 casos).
- `LAST_RUN_RESULTS.txt` — salida real de la última ejecución (35/35, 2026-09-05, BLOQUE A del weekend build).

## Cómo reproducir

Requiere Node 20+ y un JDK 21+ (el emulador de Firestore de `firebase-tools` reciente ya no soporta Java 8). Nada de esto se instala en el repo ni en el sistema — todo vive en `node_modules` local a un directorio de trabajo aparte.

```bash
mkdir /tmp/besoul-rules-test && cd /tmp/besoul-rules-test
npm init -y
npm install firebase-tools @firebase/rules-unit-testing
cp <repo>/rules-tests/firestore.rules.candidate .
cp <repo>/rules-tests/run_tests.mjs .
cat > firebase.json <<'EOF'
{ "firestore": { "rules": "firestore.rules.candidate" }, "emulators": { "firestore": { "port": 8089 } } }
EOF
JAVA_HOME=<ruta a un JDK 21+> PATH="$JAVA_HOME/bin:$PATH" \
  node_modules/.bin/firebase emulators:exec --project besoul-rules-test --only firestore "node run_tests.mjs"
```

## Qué prueba cada bloque

1. **Agenda — PT sobre su propia rama** (`clientes`/`agenda`/`disponibilidadReservas`/`historicoClientes`/`pruebasCRM`.PT-A): todas deben tener éxito.
2. **Agenda — PT sobre la rama de otro PT**: todas deben fallar, incluida una escritura MIXTA (un campo propio + uno ajeno en el mismo `update`) para confirmar que Firestore rechaza el `update` entero, no solo el campo problemático.
3. **`notas`**: confirma explícitamente que el riesgo residual documentado es real (PT A SÍ puede escribir una clave de `notas` de otro trainer) — este caso se espera que "pase" (`assertSucceeds`) precisamente para demostrar que el hueco sigue abierto, no para ocultarlo.
4. **Perfiles**: sin `besoulUsers` → deny; `activo:false` → deny; sin autenticar → deny — en lectura y escritura.
5. **Admin**: lee, y escribe cruzando varios trainerKeys en un mismo `update` (reproduce el patrón real de `crm.html`) y campos fuera de la whitelist (`catalogoActividades.*`, reproduce `finanzas.html`) — ambos deben tener éxito, y solo por el bypass `isAdmin()`, verificado también negativamente para un PT normal.
6. **`besoulLeads`**: PT ya no puede crear/editar (SEC-04); admin sí; el formulario público de valoración sí sigue pudiendo crear un lead de prueba sin autenticación.
7. **`besoulPublicClients`**: ownership real — el dueño puede revocar su propio token, otro PT no puede tocarlo, admin sí.
8. **`besoulReservas.create`**: el cross-check contra `besoulPublicClients/{token}` acepta una reserva coherente y rechaza una que intente suplantar el `clientId` de otro cliente del mismo token/trainer.

## Hallazgo del propio proceso de pruebas (no del ruleset)

La primera ejecución reportó un falso positivo en "PT A NO puede modificar `disponibilidadReservas.ptB`": el payload de prueba usaba el mismo valor ya sembrado (`{lunes:[]}`), así que Firestore no detectó ningún cambio real en esa clave y `affectedKeys()` quedó vacío -- vacuamente `hasOnly(...)` es verdadero sobre un conjunto vacío. No era un fallo de la Rule, era un fallo del dato de prueba (mismo valor antes/después). Corregido usando un valor realmente distinto; la re-ejecución confirmó el comportamiento correcto. Se documenta aquí porque es el tipo de error que la inspección visual nunca habría detectado en ningún sentido -- ni el error del test, ni si hubiera sido real.

Un segundo caso similar apareció en BLOQUE A: los tests de revocación de `besoulPublicClients` (que revocan `res_tokenA` a propósito) se ejecutan ANTES que los de `besoulReservas`, y sin re-sembrar el token como activo entre bloques, los tests de "token válido" de `besoulReservas` estaban probando, sin querer, un token ya revocado por el bloque anterior. Se corrigió re-sembrando `res_tokenA` (`activo:true`) justo antes del bloque de `besoulReservas`. Ambos casos son el mismo tipo de error -- falta de aislamiento entre casos de prueba que comparten estado del emulador -- y ambos se detectaron y corrigieron por la propia ejecución real, nunca hipotéticamente.

## Hallazgo real del RULESET (BLOQUE A, 2026-09-05) -- corregido en el candidato

`besoulReservas.create` nunca comprobaba el campo `activo` de `besoulPublicClients/{token}` -- solo cruzaba que `clientId`/`trainerKey` correspondieran al token. Un token YA REVOCADO (p.ej. tras pulsar "Regenerar enlace", SEC-05, o tras una baja de cliente) podía seguir creando una reserva real por Firestore directo -- el único bloqueo existente era la comprobación de UI en `reservas.html` (`clientData.activo === false`). Añadido `&& get(...).data.activo != false` a la Rule del candidato. Confirmado con una prueba real: antes del fix, "token revocado sigue reservando" pasaba (mal); después del fix, falla (correcto). **Este cambio vive únicamente en `firestore.rules.candidate`, no desplegado.**
