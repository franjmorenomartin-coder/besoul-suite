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

## 3. Propuesta de Rules (NO desplegada) si el bloqueo debe ser real y no solo de UI

Si la decisión de "PT no accede a CRM" es definitiva también a nivel de dato (no solo de pantalla), la regla debería quedar así — **requiere autorización explícita y despliegue manual, fuera de esta rama**:

```
match /besoulLeads/{leadId} {
  allow read: if isAdmin();
  allow create: if isPublicTrialLead() || isAdmin();
  allow update: if isAdmin();
  allow delete: if isAdmin();
}
```

**Efecto colateral a evaluar antes de desplegar esto**: `iniciarSincronizacionLeadsCRMAgenda()` en `agenda.html` lee `besoulLeads` filtrando por `trainerKey` para mostrar las pruebas CRM del propio PT dentro de Agenda (tarjetas de "Valoración" en el calendario). Si se restringe `read` a solo `isAdmin()`, esa sincronización dejaría de funcionar para PT y las pruebas CRM desaparecerían de su Agenda — habría que decidir explícitamente si eso es aceptable o si esa lectura concreta necesita quedar exceptuada (p. ej. permitiendo `read` solo cuando `resource.data.trainerKey == myTrainerKey()` pero sin permitir `create`/`update`, que es lo que de verdad da "acceso a CRM" en la práctica). Esta decisión no se ha tomado — queda documentada, no resuelta.

## 4. Qué NO se ha tocado en esta rama

- `firestore.rules` — cero cambios, cero despliegue.
- Datos reales de Firestore — ninguno modificado.
- El resto de colecciones (`besoulSuite/agenda`, `besoulUsers`, `besoulSolicitudesReservas`, etc.) — sin cambios de Rules ni de guard, fuera de alcance de este ticket.
