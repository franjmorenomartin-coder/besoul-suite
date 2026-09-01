# BESOUL_WORK_STATE.md

Estado de trabajo para continuidad entre sesiones de Claude Code en el proyecto BESOUL Suite (`C:\Users\Usuario\BESOUL_CODE\besoul-suite`). Léelo primero, junto con `git status`/`git log`, antes de reanudar. No repitas análisis ya documentado aquí como completado.

**No contiene secretos.**

---

## Puntos de recuperación (rollback)

- Tag `checkpoint-pre-baseline-2026-09-01` (en `origin`) — apunta al commit `bfa9d81`, estado inmediatamente anterior a empezar la BASELINE. Rollback seguro: `git checkout checkpoint-pre-baseline-2026-09-01`.
- Rama `UI-003` (en `origin`) — contiene AGENDA-015 + UI-003A (rediseño visual de agenda.html) + flujo de solicitud de eliminación de cliente, ya comiteado (`bfa9d81`) y pusheado.
- Stash `stash@{0}` en el historial de stash del repo local — `"On UI-002B: UI-002B: rediseño visual valoracion.html (pendiente de revisión)"`. **No está pusheado** (los stash no se pushean); si se pierde el working directory local, ese trabajo de valoracion.html se perdería. Pendiente: aplicarlo en una rama propia (`UI-002B`) y pushearlo cuando se retome esa página.
- `main` en origin sigue en `54198ca` (AGENDA-015 fusionado). No se ha tocado.

## Rama de trabajo actual

`BESOUL-BASELINE`, creada desde `UI-003` (commit `bfa9d81`), pusheada a `origin/BESOUL-BASELINE`. Toda la BASELINE se desarrolla aquí. **No merge a `main` sin validación explícita del usuario.**

## Archivos que NUNCA deben entrar en un commit

`agenda-15min-optimizada-prueba.html`, `reservas-45min-optimizada-prueba.html` — son solo referencia local, siguen sin trackear (`??`) en cada `git status`, intencionalmente.

---

## FASE 0 — Checkpoint

✅ Completada.
- `bfa9d81` en `UI-003`: commit de seguridad con el trabajo previo pendiente (UI-003A + solicitud de eliminación).
- Tag `checkpoint-pre-baseline-2026-09-01` creado y pusheado.
- Rama `BESOUL-BASELINE` creada y pusheada desde ahí.

## Trabajo ya validado/aprobado por el usuario antes de la BASELINE (no re-analizar)

- **AGENDA-015**: motor de disponibilidad con granularidad 15 min (sesión sigue siendo 45 min), cálculo de huecos/microgaps/capacidad real vía `intervalosOperativosDia`/`intervalosOcupadosDia`/`huecosOperativosDia`/`resumenHuecosDia`, KPI semanal agregado desde ese motor. Reservas: bloques consecutivos de 45 min para el cliente con heurística de compactación. **Aprobado y fusionado en `main` (PR #8, commit `f8b8400`/`54198ca`).**
- **UI-003A**: rediseño visual "dark premium" de `agenda.html` (header, KPIs, tarjetas de cita/slot-libre/gap/insights, columnas semanales, tarjeta de cliente). **Aprobado por el usuario, comiteado (`bfa9d81`), pendiente de fusión a `main` como parte de esta BASELINE.**
- **Flujo de solicitud de eliminación de cliente**: PT solicita → admin revisa impacto en vivo → aprueba/rechaza. Aprobar hace `estadoCliente='baja'` + trazabilidad sobre la ficha existente (nunca hard-delete), bloquea si hay citas futuras (individuales o como asistente de grupo abierto), desactiva `besoulPublicClients/{token}` si aplica. Nueva colección `besoulSolicitudesEliminacion` (id/clienteId/clienteNombre/trainerKey/centroId/centroNombre/solicitadoPor/solicitadoEn/motivo/motivoTexto/estado/revisadoPor/revisadoEn/notasAdmin/snapshot*). **Aprobado, comiteado (`bfa9d81`).**
- **SEC-010 (propuesta de Rules para `besoulSolicitudesEliminacion`)**: diseñada y **aprobada conceptualmente**, NO desplegada todavía. Regla propuesta completa más abajo en la sección FASE 3.
- **SEC-011 (análisis de aislamiento/concurrencia de `besoulSuite/agenda`)**: análisis completo ya realizado y aprobado conceptualmente. Resumen de hallazgos reutilizables abajo en FASE 1/2 — **no repetir la investigación, ya está hecha**.

---

## FASE 1 — Mapeo `besoulSuite/agenda` (ya investigado, reutilizar)

Documento único, payload de `estadoLocalAgendaParaNube()` (agenda.html:1229):
```
clientes: { trainerKey: [ficha, ...] }               // map anidado por trainerKey
agenda: { trainerKey: { "fecha_hora": cita } }        // map anidado por trainerKey
pruebasCRM: { trainerKey: { clave: prueba } }         // map anidado por trainerKey
disponibilidadReservas: { trainerKey: {...} }         // map anidado por trainerKey
notas: { "trainerKey__fecha_hora": texto }            // MAP PLANO, prefijo en el string — NO anidado como los demás
historicoClientes: { trainerKey: { clienteId: {mes:...} } } // map anidado por trainerKey
ultimaActualizacionLocal, actualizadoEn
```
`guardarEstadoNubeAgenda()` (línea 1253) hace `window.bsAgendaCloudDocRef.set(payload)` **sin `{merge:true}`** — sobrescritura completa del documento, siempre, para cualquier función que guarde (21 puntos de llamada mapeados, ver detalle en el análisis SEC-011 de la conversación — todas las funciones "normales" de PT tocan solo `entrenadorVisto`, pero el `.set()` de todas formas reenvía el documento entero desde memoria). No existe `runTransaction` para este documento en ningún punto.

## FASE 2 — Concurrencia (CRÍTICO, ya diagnosticado — pendiente CORREGIR)

**Diagnóstico confirmado** (no repetir el análisis): como cada guardado es un `.set()` completo desde la copia local en memoria, si Rubén guarda mientras la copia local de Carmen todavía no ha recibido (vía `onSnapshot`) el cambio de Rubén, el guardado de Carmen sobrescribe el documento entero con su copia desactualizada → el cambio de Rubén desaparece silenciosamente. Ventana de riesgo: propagación `onSnapshot` + debounce de 350ms (`programarGuardadoNubeAgenda`).

**Corrección diseñada, pendiente de implementar** (siguiente acción de esta sesión): cambiar `guardarEstadoNubeAgenda()`/`estadoLocalAgendaParaNube()` para escribir con notación de punto + `{merge:true}` dirigido solo al `trainerKey` que realmente cambió, en vez de reenviar los 5 mapas completos:
```js
db.collection('besoulSuite').doc('agenda').set({
  [`clientes.${trainerKey}`]: dbClientes[trainerKey],
  [`agenda.${trainerKey}`]: dbAgenda[trainerKey],
  [`disponibilidadReservas.${trainerKey}`]: dbDisponibilidadReservas[trainerKey],
  [`historicoClientes.${trainerKey}`]: dbHistoricoClientes[trainerKey],
  [`pruebasCRM.${trainerKey}`]: dbPruebasCRM[trainerKey],
  actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
}, { merge: true });
```
Esto arregla la concurrencia sin necesidad de migrar de documento monolítico. **`notas` es un caso especial** (clave plana `trainerKey__clave`, no anidada) — no puede aislarse igual con notación de punto por trainerKey completo; opciones: (a) enviar el mapa `notas` completo igual que hoy (riesgo de carrera solo en notas, aceptable como riesgo residual menor documentado), o (b) migrar `notas` a `notas[trainerKey][clave]` anidado. Decisión pendiente de tomar en esta sesión al implementar — por defecto, si no hay tiempo, aplicar (a) y dejarlo como riesgo residual documentado, ya que notas es el campo de menor criticidad de negocio de los 5.

Funciones que llaman a `guardarEstadoNubeAgenda`/`programarGuardadoNubeAgenda` (para localizar todos los puntos a adaptar si se decide tocar la función central en vez de cada call site — tocar solo la función central `guardarEstadoNubeAgenda`/`estadoLocalAgendaParaNube` basta, no hace falta tocar los 21 call sites individualmente, siempre que se les pase el trainerKey correcto): `guardarCliente`, `borrarFichaCliente`, `actualizarNombreEnAgendaSiCambia`, `habilitarSlotSobreLaMarcha`, `ocultarSlotDisponibilidad`, `limpiarBloqueosDisponibilidadSemana`, `soltarFichaEnCelda`, `copiarLinkReservaCliente`, `guardarDisponibilidadReservas`, `aprobarSolicitudEliminacion`, `aceptarSolicitudReserva`, `crearRecurrenciaSemanalSesion`, `borrarFuturasRecurrentesSesion`, `actualizarCitaGrupoAbiertoActual`, `guardarNota`, `borrarSesionAgenda`, `guardarResumenClienteMes`, `guardarMesEnHistorico`. **Importante**: `aprobarSolicitudEliminacion`/`aceptarSolicitudReserva` escriben sobre `s.trainerKey`/`r.trainerKey` (no necesariamente `entrenadorVisto` — el admin actúa sobre el trainerKey de la solicitud). El cambio a merge dirigido debe usar el trainerKey correcto según el contexto de cada función, no asumir siempre `entrenadorVisto`.

**Siguiente acción exacta si se retoma aquí**: implementar el cambio de `estadoLocalAgendaParaNube()`/`guardarEstadoNubeAgenda()` a escritura dirigida por trainerKey, decidir el enfoque para `notas`, validar sintaxis, probar mentalmente los 21 call sites, commit `fix: prevent concurrent agenda overwrites`.

## FASE 3 — Firestore Security (SEC-010 aprobado conceptualmente, NO desplegado)

Identidad real: Firebase Auth email/password. `besoulUsers/{email}` con `activo`/`rol`/`trainerKey`. Helpers ya existentes en las reglas actuales: `isActiveUser()`, `isAdmin()`, `myTrainerKey()`. `usuarioLogeado` en el cliente ES el `trainerKey` (agenda.html:2381), no el email — coherente con `myTrainerKey()`.

**Regla propuesta para `besoulSolicitudesEliminacion`** (texto completo, lista para aplicar cuando se autorice el despliegue real — recordar que esto se hace en la consola/CLI de Firebase, fuera de este repo, `SECURITY_RULES.md` solo lo documenta):
```js
match /besoulSolicitudesEliminacion/{solicitudId} {
  allow create: if request.resource.data.estado == 'pendiente'
    && (!('revisadoPor' in request.resource.data) || request.resource.data.revisadoPor == '')
    && (!('revisadoEn' in request.resource.data) || request.resource.data.revisadoEn == null)
    && (
         (isActiveUser()
           && request.resource.data.trainerKey == myTrainerKey()
           && request.resource.data.solicitadoPor == myTrainerKey())
         || (isAdmin() && request.resource.data.solicitadoPor == myTrainerKey())
       );

  allow read: if isAdmin()
    || (isActiveUser() && resource.data.trainerKey == myTrainerKey());

  allow update: if isAdmin()
    && resource.data.estado == 'pendiente'
    && request.resource.data.estado in ['aprobada', 'rechazada']
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['estado', 'revisadoPor', 'revisadoEn', 'notasAdmin']);

  allow delete: if false;
}
```

**Aislamiento por trainerKey en `besoulSuite/agenda`** (SEC-011, conceptualmente posible con `diff()`/`affectedKeys()` sobre mapas anidados — NO requiere migrar de documento monolítico) — **depende de que primero se implemente FASE 2** (escritura dirigida por trainerKey), porque si el cliente sigue reenviando el documento completo desde una copia potencialmente obsoleta, una regla de aislamiento estricta rechazaría guardados legítimos (falso positivo por copia local desactualizada). Regla conceptual (pendiente, para después de Fase 2):
```js
match /besoulSuite/{docId} {
  allow read: if signedIn() && docId == 'agenda';
  allow write: if docId == 'agenda' && (
    isAdmin()
    || (isActiveUser()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['clientes','agenda','disponibilidadReservas','historicoClientes','pruebasCRM','notas','actualizadoEn','ultimaActualizacionLocal'])
        && request.resource.data.clientes.diff(resource.data.clientes).affectedKeys().hasOnly([myTrainerKey()])
        && request.resource.data.agenda.diff(resource.data.agenda).affectedKeys().hasOnly([myTrainerKey()])
        && request.resource.data.disponibilidadReservas.diff(resource.data.disponibilidadReservas).affectedKeys().hasOnly([myTrainerKey()])
        && request.resource.data.historicoClientes.diff(resource.data.historicoClientes).affectedKeys().hasOnly([myTrainerKey()])
        && request.resource.data.pruebasCRM.diff(resource.data.pruebasCRM).affectedKeys().hasOnly([myTrainerKey()])
       )
  );
  allow read, write: if isAdmin() && docId == 'finanzas';
}
```
`notas` deliberadamente fuera de la comprobación estricta por el problema de clave plana ya documentado en FASE 2 — riesgo residual aceptado y documentado, no bloqueante.

**`besoulPublicClients`** — SÍ contiene `trainerKey` (confirmado en `publicarReservasPublicas()`). Regla propuesta:
```js
match /besoulPublicClients/{token} {
  allow get: if true;
  allow list: if false;
  allow create: if isActiveUser() && request.resource.data.trainerKey == myTrainerKey();
  allow update: if isAdmin()
    || (isActiveUser() && resource.data.trainerKey == myTrainerKey() && request.resource.data.trainerKey == resource.data.trainerKey);
  allow delete: if isAdmin();
}
```

**Orden de despliegue recomendado** (para minimizar riesgo de romper producción): 1) `besoulSolicitudesEliminacion` (independiente, sin dependencias) → 2) implementar Fase 2 en código (merge dirigido) → validar en producción unos días → 3) `besoulPublicClients` (ownership) → 4) `besoulSuite/agenda` (aislamiento, la más delicada, requiere que Fase 2 lleve tiempo funcionando bien primero).

**Ninguna de estas reglas se ha desplegado todavía.** Requiere acceso a la consola/CLI de Firebase, que esta sesión no verificó tener. Ver "Riesgos" al final.

---

## FASE 4 — Baja segura de clientes
✅ Ya implementada y comiteada (ver arriba). Sin pendientes de código; pendiente solo el despliegue de Rules de FASE 3.

## FASE 5 — Modelo mensual de tarifas (EN CURSO — siguiente fase a completar)

Funciones relevantes ya localizadas en `agenda.html` (pendiente de análisis profundo, no completado todavía en esta sesión): `sesionesContratadasFicha` (línea 1900), `fichaBaseParaContador` (línea 1924), `contarSesionesAgendadas` (línea 2213), `calcularContadorClases` (línea 2237), `sumarMeses` (línea 1888).

**Decisión de principio ya tomada por el usuario (no reabrir la discusión, solo verificar/aplicar)**: el saldo mensual debe ser `saldo(clienteId, mesKey) = contratadasDelCiclo - consumidasEnEseMes`, determinista, reconstruible sin depender de un reset físico/cron/temporizador. Para bonos con vigencia (ej. 10 sesiones/3 meses), NO aplicar reset mensual — deben conservar su comportamiento actual de ventana de vigencia. Los meses cerrados no deben recalcularse retroactivamente si cambia la ficha después.

**Pendiente en esta sesión**: leer completas las 5 funciones listadas arriba, determinar si `calcularContadorClases` YA sigue el principio (cálculo determinista por mes) o si hay algún acumulador/contador con estado mutable que requiera reset. Verificar específicamente la rama no-bono (mensual) de `calcularContadorClases` — solo se leyó la rama `esBono` en la investigación previa de esta conversación, la rama mensual no se leyó todavía.

**Siguiente acción exacta**: `Read agenda.html` líneas 1888-2270 completas antes de tocar nada, para no asumir.

## FASE 6-14
No iniciadas todavía en esta sesión de trabajo autónomo. Ver el prompt maestro del usuario (conversación) para el detalle completo de cada fase si esta sesión termina antes de llegar aquí.

---

## Riesgos conocidos (acumulados hasta ahora)

- **Sin acceso confirmado a Firebase CLI/consola en este entorno** — las Rules diseñadas en FASE 3 están listas pero no se ha verificado que esta sesión pueda desplegarlas. Si no se puede, quedan como propuesta para que el usuario las aplique manualmente.
- `notas` con esquema de clave plana (`trainerKey__clave`) es una excepción a los mecanismos de aislamiento/merge dirigido diseñados para los otros 4 mapas — riesgo residual menor, documentado, no bloqueante para la baseline.
- El stash de `UI-002B` no está pusheado — vive solo en este working directory local.

## Siguiente acción exacta (para retomar si esta sesión se corta aquí)

1. Implementar FASE 2 (escritura dirigida por trainerKey en `guardarEstadoNubeAgenda`/`estadoLocalAgendaParaNube`), commit `fix: prevent concurrent agenda overwrites`, push a `BESOUL-BASELINE`.
2. Continuar FASE 5: leer completas las funciones de contador (líneas 1888-2270 de `agenda.html`) y verificar/corregir el modelo mensual.
3. Seguir con el resto de fases del prompt maestro en orden de prioridad.
