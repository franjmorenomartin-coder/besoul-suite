# Rules Unit Tests — SEC-AGENDA-WRITE-ISOLATION

Pruebas reproducibles reales (Firebase Rules Unit Testing, contra el emulador de Firestore) del ruleset candidato para el primer deployment de seguridad post-`SEC-PORTAL-CLIENTE-BASELINE`. No es inspección visual: cada caso ejecuta una operación real (lectura/escritura) contra un Firestore emulado y comprueba que se permite o se deniega, con datos semilla reales copiados del esquema real de `besoulSuite/agenda`.

## Qué contiene

- `firestore.rules.candidate` — el ruleset candidato EXACTO evaluado (los 5 puntos de FASE 9: `isActiveUser()` en Agenda, FASE 2 write isolation, CRM admin-only, ownership `besoulPublicClients`, cross-check `besoulReservas.create`). Deliberadamente NO incluye `besoulSolicitudesEliminacion`/`besoulNotifications`/la rama `avisosLeidos` — ver `RULES_DEPLOYMENT_MATRIX.md` en la raíz del repo para por qué se excluyeron de este primer deployment.
- `run_tests.mjs` — el script de pruebas (32 casos).
- `LAST_RUN_RESULTS.txt` — salida real de la última ejecución (32/32, 2026-09-04).

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
