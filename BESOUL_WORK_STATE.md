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

## ACTUALIZACIÓN — sesión autónoma BESOUL-BASELINE (2026-09-01, continuación)

El usuario sustituyó las instrucciones parciales por un prompt maestro ampliado (22 fases: seguridad, identidad trainerKey, finanzas temporales versionadas, nueva entrenadora Verónica Dell'Agnese con modelo de reparto de ingresos por actividad, catálogo de tarifas Pilates/Ciclo Indoor, mobile, UX/UI global, tests). Autonomía total concedida, con 8 motivos explícitos de STOP. Este documento refleja el estado real tras trabajar varias fases; **no repetir la investigación ya documentada aquí**.

### HECHO en esta sesión (commits en `BESOUL-BASELINE`, todos pusheados)

- `bfa9d81` — checkpoint de seguridad (UI-003A + solicitud de eliminación, ya existente antes de esta sesión).
- `8c87c0f` — creación de este archivo.
- `0505374` — **FASE 2 (concurrencia, CRÍTICO) + parte de FASE 8 (modelo mensual)**: escritura dirigida por trainerKey con `merge:true` en `guardarEstadoNubeAgenda()`/`estadoLocalAgendaParaNube()` (ver detalle completo arriba en este documento, sección "FASE 2"). `calcularContadorClases(ficha, claveMes)` ahora usa snapshot histórico congelado si el mes ya se cerró, evitando recálculo retroactivo.
- `c32aab4` — **FASE 4 (Firestore Security)**: `firestore.rules` completo preparado (SEC-010 + ownership `besoulPublicClients` + aislamiento opcional por trainerKey en `besoulSuite/agenda`, comentado, a activar tras validar Fase 2 en producción). **NO desplegado** — este entorno no tiene Firebase CLI ni credenciales (motivo de STOP explícito nº4, solo para la acción de *desplegar*, no para prepararlo).
- `3d446e4` — **FASE 14 (mobile, parte "Reprogramar")**: `modal-nota` gana selector de día/hora + botón "Mover a esta franja", reutilizando `soltarFichaEnCelda(destino,'',origen)` (la misma lógica que ya usa el drag de escritorio) y `huecosOperativosDia` (motor de AGENDA-015). El flujo "tocar cliente → tocar slot" para citas NUEVAS ya existía de antes (`fichaSeleccionadaMovilId`/`seleccionarFichaParaAgendaMovil`) — confirmado funcional, no requería cambios. Fix menor de paso: `<summary>` "Más acciones" de la tarjeta de cliente no tenía `stopPropagation`, así que abrirlo también seleccionaba el cliente para agendar (efecto no intencionado de UI-003A).

### HALLAZGO IMPORTANTE — Miguel Fenech / identidad trainerKey (FASE 5) — REQUIERE TU VERIFICACIÓN, NO LO HE CORREGIDO

**No puedo determinar cuál es el dato correcto sin consultar Firestore real** (sin credenciales en este entorno) — esto es el motivo de STOP nº7 ("no puedes determinar cuál es el dato correcto"), aplicado específicamente a este punto, no a toda la baseline.

Lo que SÍ confirmé leyendo el código real de `finanzas.html`:
- La resolución de `trainerKey` en Finanzas es, en el diseño, unificada: `trainerKeyPerfil(p) = p.trainerKey` (del perfil `besoulUsers` cargado), y ese mismo `key` se usa tanto para leer `agendaData.clientes[key]`/`agendaData.agenda[key]` como para `dbFinanzas.trainerSettings[key]` (canon/rango/centro configurados por el admin). En teoría, si todo viene de la misma fuente (`besoulUsers.trainerKey`), Agenda y Finanzas deberían coincidir siempre.
- **PERO** el código ya contiene dos parches históricos que confirman que este PT concreto ha tenido más de una clave a lo largo del tiempo:
  - Línea 245: `lillo: 'lagunillas', miguel_fenech: 'lagunillas', ...` — mapa hardcodeado de centro por defecto que trata `lillo` y `miguel_fenech` como **dos claves distintas**.
  - Línea 394-395: `// Compatibilidad por si Miguel Fenech/Lillo fue creado con otra clave. if ((key === 'miguel' || nombre.includes('fenech') || nombre.includes('lillo')) && !nombre.includes('luna')) return 'lagunillas';` — parche explícito ya existente para el mismo problema, pero **solo cubre la resolución de centro**, no la de `trainerSettings` (canon/rango) ni la del roster de PT que decide si aparece con cartera.
  - También hay listas hardcodeadas por nombre en más sitios (`TRAINERS_EXCLUIDOS_FINANZAS`, `TRAINERS_ADMIN_CON_CARTERA`) — patrón `if trainer == X` repetido varias veces en el archivo, justo el antipatrón que tú mismo pediste evitar para Verónica.

**Hipótesis más probable** (no confirmada): en algún momento se creó/editó el perfil de Miguel Fenech en `besoulUsers` con una clave (p.ej. `miguel_fenech`), pero la configuración de canon/rango/centro en `dbFinanzas.trainerSettings` (que un admin rellena a mano desde la pantalla Centros/PT) se guardó bajo la clave antigua (`lillo`). Como `centroTrainer()`/el cálculo de canon leen `dbFinanzas.trainerSettings[key]` con el `key` ACTUAL del perfil, si ese `key` no coincide con la clave bajo la que realmente está guardada la configuración, Finanzas mostraría canon/rango vacíos y probablemente por eso también facturación/clientes en 0 en las vistas que dependen de esa configuración — mientras Agenda, que solo depende de `besoulUsers.trainerKey` + `agendaData.clientes[key]` sin pasar por `trainerSettings`, sigue mostrando sus datos reales correctamente.

**Lo que NO he hecho, a propósito**: no he tocado `dbFinanzas.trainerSettings` ni ningún dato real, ni he añadido un tercer parche hardcodeado tipo `if key==='lillo'`. Añadir más parches por nombre perpetuaría el problema para el próximo caso (exactamente lo que hay que evitar, per tu instrucción para Verónica).

**Lo que SÍ puedes hacer tú para resolverlo de forma segura** (requiere ver los datos reales, que yo no puedo consultar desde aquí):
1. Abrir Firebase Console → Firestore → `besoulUsers` → buscar el documento de Miguel Fenech (por email) → confirmar el valor exacto de `trainerKey`.
2. Abrir `besoulSuite/finanzas` → campo `trainerSettings` → comprobar si existe una entrada bajo esa MISMA clave, o si la configuración de canon/rango está bajo `lillo`/otra clave distinta.
3. Si están bajo claves distintas: mover manualmente (copiar) la configuración de `trainerSettings.lillo` a `trainerSettings.<trainerKey real>` en Firestore (edición manual puntual de datos, no requiere cambio de código) y confirmarme para que yo elimine entonces los parches hardcodeados (líneas 245/394-395/y las listas `TRAINERS_*`) sustituyéndolos por la resolución unificada real, sin perder ninguna configuración.

**Siguiente acción exacta si retomas esto**: pedir al usuario el valor real de `besoulUsers/{email-miguel}.trainerKey` y las claves existentes en `dbFinanzas.trainerSettings`, antes de tocar nada de finanzas.html relativo a este caso. Mientras tanto, es seguro construir la "matriz interna" de auditoría (nombre/email/trainerKey/key-clientes/key-agenda/key-histórico/key-finanzas/centro) que pediste como herramienta de diagnóstico — eso SÍ es código nuevo de solo lectura, sin riesgo, y ayudaría a detectar este tipo de mismatch para todos los PT de un vistazo. No implementada todavía en esta sesión por falta de tiempo/tokens, ver pendientes abajo.

### PENDIENTE — alcance muy grande, no iniciado todavía en esta sesión (fases 6-22 del prompt maestro)

Para que una futura sesión no tenga que releer todo el prompt del usuario, resumen de lo que falta, en el mismo orden de prioridad que dio el usuario:

- **FASE 5 (cierre)**: herramienta de auditoría "matriz trainerKey" (solo lectura) + resolución manual del caso Miguel Fenech (bloqueada por falta de acceso a datos reales, ver arriba).
- **FASE 6-7 (temporalidad financiera)**: hoy `finanzas.html` NO tiene versionado temporal de configuración (canon/rango/centro/tarifas) — un cambio de canon a día de hoy probablemente SÍ afecta a meses anteriores no cerrados (comportamiento a auditar y corregir: modelo "base + override con `effectiveFrom`" o snapshot por mes, sin duplicar configuración completa cada mes). Los "meses cerrados" (`dbFinanzas.historico[mesKey]`, cerrados vía `cerrarMesActual()`) YA son inmutables (confirmado en SEC-011) — el riesgo real está en los meses TODAVÍA ABIERTOS cuando se edita retroactivamente un parámetro. Requiere diseño cuidadoso antes de tocar código de finanzas (dato sensible, real).
- **FASE 8 (mensualidades/bonos)**: principio ya verificado como correcto en `agenda.html` (ver arriba). Pendiente confirmar que `finanzas.html` no duplica esta lógica de forma inconsistente.
- **FASE 9-13 (Verónica Dell'Agnese + catálogo de tarifas + reparto 50/35/15)**: **funcionalidad nueva completa, no iniciada**. Requiere: (a) confirmar que el perfil de Verónica ya existe en `besoulUsers` (email `veronica.dellagnese@besoulfitness.com`) o si hay que crearlo primero — no inventar trainerKey; (b) diseñar un catálogo de tarifas configurable (servicio/plan/segmento/sesiones/precio/vigencia) como estructura de DATOS en Firestore, no hardcodeado en JS — reutilizar el patrón ya existente de `dbFinanzas.trainerSettings`/`centros` como referencia de "configuración editable por admin"; (c) modelo de reparto porcentual configurable (no solo para Verónica) con validación de suma=100% y redondeo determinista en céntimos; (d) modelo MIXTO por PT (actividad especial + clientes PT estándar simultáneos, sin mezclar). Esto es, en la práctica, una funcionalidad nueva de tamaño comparable a todo lo hecho hasta ahora en esta sesión junta — no intentar en una sola pasada apresurada dado que toca datos financieros reales.
- **FASE 14-16 (mobile)**: agendar/reprogramar sin drag YA resuelto en `agenda.html` (ver arriba). Pendiente: extender el mismo principio (touch-first, sin drag obligatorio) a cualquier otro punto de arrastre que quede, y validar visualmente en 375/390/430px (no hay navegador headless en este entorno, requiere validación manual del usuario).
- **FASE 17 (Reservas)**: pendiente revisar el race `copiarLinkReservaCliente()` vs publicación real (ya se identificó en una sesión anterior que `guardarEstadoNubeAgenda()` es fire-and-forget sin esperar confirmación antes de copiar el link — sigue sin corregir).
- **FASE 18 (CRM)**: pendiente auditar referencias huérfanas `convertedClientId`/`leadId` tras una baja lógica de cliente (ya se detectó en SEC-011 que `sincronizarClienteAgendaDesdeLeadConvertido()` falla silenciosamente si no encuentra el cliente — comportamiento a revisar, no necesariamente a "arreglar" ya que con baja lógica (no hard-delete) el cliente SIGUE existiendo en el array, así que este riesgo concreto ya está mitigado por el propio flujo de baja seguro implementado).
- **FASE 19 (Finanzas completa)**: pendiente, depende de completar FASE 6-13 primero.
- **FASE 20 (backup de datos Firestore)**: no iniciado. Sin Firebase CLI en este entorno no se puede implementar un export automático real; a proponer: script Node/CLI para que el usuario lo ejecute con sus propias credenciales (fuera de este entorno), o Cloud Function de backup programado (requiere despliegue con credenciales que no tengo).
- **FASE 21 (hard-delete)**: `borrarFichaCliente()` ya degradado a acción legacy no prominente (hecho en sesión anterior). No se ha auditado si existen otras funciones destructivas equivalentes en `crm.html`/`finanzas.html`.
- **FASE 22 (tests)**: no iniciado. Sin navegador headless/Playwright disponible en este entorno — se documentarían casos de prueba manuales (ya listados por el usuario en su prompt: F1-F9, V1-V10, concurrencia, mobile) para que el usuario los ejecute, no automatizables desde aquí sin herramientas de navegador.
- **FASE 23 (UX/UI premium global)**: `agenda.html` ya tiene el rediseño (UI-003A). Pendiente propagar a `dashboard.html`, `crm.html`, `finanzas.html`, `reservas.html`, `index.html`, `valoracion.html` — alcance grande, ya analizado en detalle en un UI-003 audit anterior de esta misma conversación (componentes a unificar, orden de implementación recomendado: valoracion→reservas→crm→finanzas→dashboard→index). No iniciado en esta sesión de baseline.

### Siguiente acción exacta (para retomar si esta sesión se corta aquí)

1. Preguntar al usuario por el `trainerKey` real de Miguel Fenech en `besoulUsers` y las claves existentes en `dbFinanzas.trainerSettings` (bloqueador de FASE 5, ver arriba) — o, si no se puede resolver ahora, construir primero la herramienta de auditoría de solo lectura ("matriz trainerKey") que no requiere esa respuesta.
2. Diseñar (sin implementar hasta tener claro el modelo) la temporalidad de configuración financiera (FASE 6-7) — es el siguiente bloque de prioridad alta que toca datos reales sensibles, requiere diseño cuidadoso antes de escribir código.
3. Cuando se aborde: Verónica Dell'Agnese + catálogo de tarifas + reparto porcentual (FASE 9-13) — funcionalidad nueva grande, tratar como su propio bloque de trabajo, no mezclar con fixes de integridad de datos.
