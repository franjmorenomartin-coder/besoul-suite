# ROLE-01 — guards de acceso PT/Admin y riesgo residual

Documento de estado, no de despliegue. Ninguna regla de Firestore se ha modificado ni desplegado a partir de este documento — solo el código cliente (guards de UI) referenciado abajo.

## 1. Estado por módulo (auditado 2026-09-04)

| Módulo | Guard de UI cliente | Regla Firestore real | Resultado |
|---|---|---|---|
| `dashboard.html` | Ya existía: `iniciarApp()` lanza excepción si `perfil.rol !== 'admin'`, cierra sesión y muestra error. No se ha tocado. | `besoulSuite/finanzas` (que dashboard lee) ya exige `isAdmin()` en `firestore.rules`. | **Seguro de verdad** — UI y Rules coinciden. |
| `finanzas.html` | Ya existía: `inicializar()` comprueba `rol!=='admin'`, cierra sesión y alerta. No se ha tocado. | `besoulSuite/finanzas` exige `isAdmin()`. | **Seguro de verdad** — UI y Rules coinciden. |
| `crm.html` | **Nuevo en esta rama**: `iniciarSesionAutenticada()` ahora lanza si `perfil.rol !== 'admin'` (antes permitía PT con vista acotada a sus propios leads). | `besoulLeads` en `firestore.rules` **sigue permitiendo** `read`/`create`/`update` a cualquier usuario activo sobre leads con `trainerKey == myTrainerKey()` — diseñado así deliberadamente cuando CRM sí era accesible para PT. **No se ha modificado.** | **Solo bloqueado en la UI.** Ver riesgo residual abajo. |
| `agenda.html` (enlace a CRM en cabecera) | **Nuevo en esta rama**: el link `#nav-crm` pasa a `hidden` por defecto y solo se muestra si `rolActivo==='admin'`, mismo patrón que `#nav-dashboard`/`#nav-finanzas`. | N/A (es solo un enlace) | Coherente con el resto de accesos admin-only. |
| `agenda.html` (`iniciarSincronizacionLeadsCRMAgenda()`) | **No tocado a propósito.** Sigue trayendo a Agenda las pruebas CRM del propio PT (fichas de valoración en el calendario) — esto es un dato legítimo dentro de la ficha del PT, no un acceso a la página/listado de CRM. | Ya estaba scoped por `trainerKey` en Rules. | Sin cambios, sin riesgo nuevo. |

## 2. Riesgo residual — CRM

**No afirmamos "seguridad completa a nivel de Rules" para CRM.** El bloqueo actual es exclusivamente de interfaz: un PT que abra `crm.html` ahora es redirigido/deslogueado antes de ver `app-content`. Pero la regla real de Firestore para `besoulLeads` sigue siendo:

```
allow read: if isAdmin() || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
allow create: if isPublicTrialLead() || isAdmin() || (isActiveUser() && request.resource.data.trainerKey == myTrainerKey());
allow update: if isAdmin() || (isActiveUser() && resource.data.trainerKey == myTrainerKey() && request.resource.data.trainerKey == myTrainerKey());
allow delete: if isAdmin();
```

Esto significa que un PT con conocimientos técnicos podría seguir leyendo/creando/editando sus propios leads llamando directamente al SDK de Firestore o a la API REST, sin pasar por `crm.html` — la Rule nunca se ha modificado, porque este documento no está autorizado a desplegar cambios de Rules.

## 3. Propuesta de Rules (SEC-02, NO desplegada) si el bloqueo debe ser real y no solo de UI

Diff exacto contra `firestore.rules` líneas 161-177 actuales. **Requiere autorización explícita y despliegue manual, fuera de esta rama.** Verificado contra `isPublicTrialLead()` (línea 81) para confirmar que el alta pública de leads desde `valoracion.html` (`request.auth == null`, condición totalmente independiente del branch de PT) no se ve afectada por ninguna de las dos opciones.

### Opción A — bloqueo completo (PT deja de poder leer/crear/editar SUS PROPIOS leads también vía API)

```diff
 match /besoulLeads/{leadId} {
-  allow read: if isAdmin()
-    || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
+  allow read: if isAdmin();

   allow create: if isPublicTrialLead()
-    || isAdmin()
-    || (isActiveUser() && request.resource.data.trainerKey == myTrainerKey());
+    || isAdmin();

-  allow update: if isAdmin()
-    || (
-      isActiveUser()
-      && resource.data.trainerKey == myTrainerKey()
-      && request.resource.data.trainerKey == myTrainerKey()
-    );
+  allow update: if isAdmin();

   allow delete: if isAdmin();
 }
```

**Efecto real si se despliega**: coincide exactamente con "PT no accede a CRM" a nivel de dato, no solo de pantalla. **Rompe** `iniciarSincronizacionLeadsCRMAgenda()` en `agenda.html` (lee `besoulLeads` filtrando por `trainerKey` para mostrar las pruebas CRM del propio PT como tarjetas "Valoración" en su calendario) -- esa lectura dejaría de tener permiso y las pruebas CRM desaparecerían de la Agenda del PT. Esto contradice la parte del brief que exige que la ficha de Agenda conserve "origen CRM" -- por eso esta opción NO se recomienda sin decidir antes qué hacer con esa sincronización.

### Opción B — recomendada: lectura scoped conservada, escritura bloqueada

```diff
 match /besoulLeads/{leadId} {
   allow read: if isAdmin()
-    || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
+    || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
+    // NOTA: el read se mantiene igual a propósito -- es lo que necesita
+    // iniciarSincronizacionLeadsCRMAgenda() en agenda.html para seguir
+    // mostrando las pruebas CRM del propio PT en su ficha/calendario.
+    // "Acceso a CRM" en la práctica es poder CREAR/EDITAR leads (gestionar
+    // el embudo comercial), no poder leer los propios -- eso ya lo hacía
+    // Agenda antes de que existiera crm.html como página independiente.

   allow create: if isPublicTrialLead()
-    || isAdmin()
-    || (isActiveUser() && request.resource.data.trainerKey == myTrainerKey());
+    || isAdmin();

-  allow update: if isAdmin()
-    || (
-      isActiveUser()
-      && resource.data.trainerKey == myTrainerKey()
-      && request.resource.data.trainerKey == myTrainerKey()
-    );
+  allow update: if isAdmin();

   allow delete: if isAdmin();
 }
```

**Efecto real si se despliega**: un PT (o cualquiera con sus credenciales) ya NO puede crear ni editar leads vía API directa, aunque técnicamente siga pudiendo LEER los suyos (igual que hoy) -- que es exactamente lo que ya necesita `agenda.html` para las tarjetas de Valoración, así que **no rompe nada existente**. Cierra el riesgo residual de "un PT gestiona su embudo comercial sin pasar por crm.html" (crear/convertir/editar leads), que es la capacidad real de "CRM" que se quiere retirar, sin tocar la sincronización de Agenda.

**Recomendación de este documento**: Opción B, precisamente porque no genera un efecto colateral no deseado sobre una función que el propio brief pide conservar. Ninguna de las dos se ha desplegado.

## 4. Qué NO se ha tocado en esta rama

- `firestore.rules` — cero cambios, cero despliegue.
- Datos reales de Firestore — ninguno modificado.
- El resto de colecciones (`besoulSuite/agenda`, `besoulUsers`, `besoulSolicitudesReservas`, etc.) — sin cambios de Rules ni de guard, fuera de alcance de este ticket.
