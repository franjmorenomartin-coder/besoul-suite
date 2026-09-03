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

### MIGUEL FENECH — RESUELTO (2026-09-01)

**Causa confirmada**: `besoulUsers/miguel.fenech@besoulfitness.com` tenía `trainerKey = "Lillo"` (con mayúscula) mientras los datos operativos (agenda, clientes) usaban `"lillo"` (minúscula) — case mismatch simple, exactamente la hipótesis que se había planteado abajo.

**Corrección**: aplicada manualmente por el usuario en Firestore, `"Lillo"` → `"lillo"`. **No se ha migrado ningún dato, no se ha movido nada, no hay alias ni hardcode específico para Miguel** — funcionamiento recuperado correctamente porque los datos operativos ya estaban en la clave correcta desde el principio; solo el perfil estaba mal.

**Protección estructural añadida** (commit siguiente, para prevenir recurrencia en general, no solo para Miguel): nueva función `normalizarTrainerKey(valor)` en `agenda.html` (minúsculas, sin acentos vía `\p{Diacritic}`, sin espacios, solo `[a-z0-9._-]`), aplicada en `crearEntrenador()` al dar de alta un nuevo PT. La validación de duplicados (`if (dbCredenciales[user])`) ya operaba sobre la clave normalizada, así que dos claves que solo difieran en mayúsculas/acentos ya no pueden coexistir al crear un entrenador nuevo desde la app. **No se ha hecho migración masiva de trainerKeys existentes** (solo se protegen altas nuevas, tal como se pidió). `guardarEntrenadorExistente()` no necesita el mismo cambio porque no crea claves nuevas, reutiliza la existente.

**Verónica Dell'Agnese debe darse de alta usando este mecanismo ya protegido** (`crearEntrenador()` con la normalización activa) — sin necesidad de ningún paso manual adicional para evitar su propio case-mismatch.

---

### Hallazgo original (contexto, ya resuelto arriba)

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
- **FASE 6-7 (temporalidad financiera)**: ✅ **COMPLETADA en esta sesión** (commit siguiente en `BESOUL-BASELINE`). Ver detalle completo en la nueva sección "FASE 6-7 — RESUELTA" más abajo. `TARIFAS_2026` (tarifas de cliente hardcodeadas en `finanzas.html`, copia separada de la de `agenda.html`) queda **deliberadamente fuera de alcance** de este cambio — no está cubierta por los casos F1-F5 (que son sobre canon/rango/centro de PT, no sobre tarifas de cliente) y versionarla requeriría convertirla de constante JS a configuración en Firestore, un rediseño mayor que se deja para cuando se aborde el catálogo de tarifas de Verónica (FASE 9-13), momento natural para unificar ambos.
- **FASE 8 (mensualidades/bonos)**: principio ya verificado como correcto en `agenda.html` (ver arriba). Pendiente confirmar que `finanzas.html` no duplica esta lógica de forma inconsistente.
- **FASE 9-13 (Verónica Dell'Agnese + catálogo de tarifas + reparto 50/35/15)**: **funcionalidad nueva completa, no iniciada**. Requiere: (a) confirmar que el perfil de Verónica ya existe en `besoulUsers` (email `veronica.dellagnese@besoulfitness.com`) o si hay que crearlo primero — no inventar trainerKey; (b) diseñar un catálogo de tarifas configurable (servicio/plan/segmento/sesiones/precio/vigencia) como estructura de DATOS en Firestore, no hardcodeado en JS — reutilizar el patrón ya existente de `dbFinanzas.trainerSettings`/`centros` como referencia de "configuración editable por admin"; (c) modelo de reparto porcentual configurable (no solo para Verónica) con validación de suma=100% y redondeo determinista en céntimos; (d) modelo MIXTO por PT (actividad especial + clientes PT estándar simultáneos, sin mezclar). Esto es, en la práctica, una funcionalidad nueva de tamaño comparable a todo lo hecho hasta ahora en esta sesión junta — no intentar en una sola pasada apresurada dado que toca datos financieros reales.
- **FASE 14-16 (mobile)**: agendar/reprogramar sin drag YA resuelto en `agenda.html` (ver arriba). Pendiente: extender el mismo principio (touch-first, sin drag obligatorio) a cualquier otro punto de arrastre que quede, y validar visualmente en 375/390/430px (no hay navegador headless en este entorno, requiere validación manual del usuario).
- **FASE 17 (Reservas)**: ✅ resuelta — el race de `copiarLinkReservaCliente()` vs publicación real ya se corrigió en esta misma sesión de baseline (commit `2fd4b77` — la función pasó a `async` y espera `guardarEstadoNubeAgenda()`/`publicarReservasPublicas()` antes de copiar el link). Esta nota quedaba desactualizada de una fase anterior del documento; corregida ahora.
- **FASE 18 (CRM)**: pendiente auditar referencias huérfanas `convertedClientId`/`leadId` tras una baja lógica de cliente (ya se detectó en SEC-011 que `sincronizarClienteAgendaDesdeLeadConvertido()` falla silenciosamente si no encuentra el cliente — comportamiento a revisar, no necesariamente a "arreglar" ya que con baja lógica (no hard-delete) el cliente SIGUE existiendo en el array, así que este riesgo concreto ya está mitigado por el propio flujo de baja seguro implementado).
- **FASE 19 (Finanzas completa)**: pendiente, depende de completar FASE 6-13 primero.
- **FASE 20 (backup de datos Firestore)**: ✅ propuesta preparada — `scripts/backup-firestore.js` + `scripts/README.md` (nuevo, no forma parte de la app servida). Exporta a JSON local `besoulUsers`, `besoulLeads`, `besoulPublicConfig`, `besoulValoracionRegistry`, `besoulPublicClients`, `besoulPublicSchedule`, `besoulReservas`, `besoulSolicitudesEliminacion`, `besoulSuite/agenda`, `besoulSuite/finanzas`. Solo lectura, no borra ni modifica nada. **No ejecutado nunca desde aquí** (sin credenciales de servicio) — el responsable del proyecto debe ejecutarlo manualmente o programarlo (Task Scheduler/cron) tras descargar su propia clave de servicio de Firebase Console. Alternativa más robusta (export gestionado de Cloud Firestore / Cloud Function programada) documentada como opción futura pero requiere activar facturación de Google Cloud — no preparada sin autorización explícita de gasto.
- **FASE 21 (hard-delete)**: ✅ auditado y corregido en esta sesión (fork de investigación + fix). `borrarFichaCliente()` en agenda.html ya estaba degradado (sesión anterior). Auditoría encontró dos casos reales equivalentes:
  - `crm.html` `eliminarLead()` — hacía `.delete()` real de un lead. Corregido: ahora hace baja lógica (`estado:'Eliminado'` + `eliminadoEn`/`eliminadoPor`, `.set({...},{merge:true})` en vez de `.delete()`), y `leadsFiltrados` excluye `estado==='Eliminado'` del tablero activo (desaparece de la vista, pero el documento se conserva en Firestore para auditoría/recuperación manual). No se añadió UI de "papelera de leads" (a diferencia de finanzas, ver abajo) — pendiente si se quiere un tablero de recuperación simétrico al de solicitudes de eliminación de clientes.
  - `finanzas.html` `borrarHistorico(key)` — hacía `delete dbFinanzas.historico[key]` de un cierre mensual auditado, sin ninguna forma de recuperarlo (el `esAdmin()` que el fork echó en falta en este archivo no hacía falta: `finanzas.html` ya exige `rol==='admin'` en el login, línea ~1635, así que el hueco real no era de permisos sino de irreversibilidad). Corregido: ahora mueve el snapshot a `dbFinanzas.historicoBorrado[key]` (array, últimos 5) antes de borrar de `historico`, y nueva función `restaurarHistoricoBorrado(key)` lo devuelve tal cual estaba. La tabla de Histórico muestra los meses en papelera con un botón "Restaurar".
  - Revisados y descartados como de menor severidad (ya tienen guards/alternativas razonables, no se tocaron): `borrarGasto`/`borrarOtroIngreso` (línea de gasto/ingreso individual, no un cierre completo; ya protegidos por `puedeEditarMes()` en meses cerrados) y `eliminarCentro` (ya bloquea centros base/con entrenadores asignados y ofrece `desactivarCentro` como alternativa preferida).
- **FASE 22 (tests)**: no iniciado. Sin navegador headless/Playwright disponible en este entorno — se documentarían casos de prueba manuales (ya listados por el usuario en su prompt: F1-F9, V1-V10, concurrencia, mobile) para que el usuario los ejecute, no automatizables desde aquí sin herramientas de navegador.
- **FASE 23 (UX/UI premium global)**: `agenda.html` ya tiene el rediseño (UI-003A). Pendiente propagar a `dashboard.html`, `crm.html`, `finanzas.html`, `reservas.html`, `index.html`, `valoracion.html` — alcance grande, ya analizado en detalle en un UI-003 audit anterior de esta misma conversación (componentes a unificar, orden de implementación recomendado: valoracion→reservas→crm→finanzas→dashboard→index). No iniciado en esta sesión de baseline.

### FASE 6-7 — RESUELTA (2026-09-01): temporalidad de configuración financiera

**Problema confirmado por el fork de investigación de esta sesión**: `dbFinanzas.trainerSettings[key]` y `dbFinanzas.centros[id]` eran objetos planos sin ningún campo de fecha/vigencia. `editarTrainer()`/`editarCentro()` escribían en vivo sin ningún guard de mes (a diferencia de `gastos`/`otrosIngresos`, que ya respetan `puedeEditarMes()`). `construirCalculoVivo(mesKey)` leía siempre la config VIVA actual para cualquier mes que no tuviera ya un cierre (`historico[mesKey]`) — así que un cambio de canon hecho hoy sí recalculaba silenciosamente meses pasados todavía abiertos. Los meses YA cerrados (`cerrarMesActual()` → `crearSnapshotCierre()`, que congela `configSnapshot: {centros, trainerSettings}`) ya estaban protegidos — el hueco real era solo en meses abiertos.

**Solución implementada** (`finanzas.html`, sin tocar Firestore Rules — no es una colección nueva, solo nuevas claves dentro del mismo doc `besoulSuite/finanzas` ya permitido solo para admin): modelo de **entradas versionadas por rango de meses**, no snapshot completo mensual (evita duplicar toda la config cada mes).

- Nuevas claves en `dbFinanzas`: `trainerSettingsVersiones[trainerKey] = [{desde:'YYYY-MM', hasta?:'YYYY-MM', <campo>:valor, _legacy?, _registradoEn, _registradoPor}, ...]` y `centrosVersiones[centroId] = [...]` (mismo formato). Vacías por defecto — 100% retrocompatible, no migra nada existente.
- `valorEfectivoTemporal(versiones, campo, mesKey, fallback)`: entre las entradas cuyo rango cubre `mesKey`, gana la de `desde` más reciente; en empate de `desde`, gana la entrada puntual de un solo mes (`desde==hasta`) sobre una abierta "desde...en adelante". Sin entradas que cubran el mes, usa `fallback` (el valor legacy congelado o, si nunca se versionó ese campo, el valor vivo actual — ver siguiente punto).
- `registrarVersionTemporal(...)`: la PRIMERA vez que se versiona un campo, congela el valor vivo *anterior al cambio* como entrada base `{desde:'0000-01', ...}` — así los meses pasados (incluidos los que aún no tienen ninguna entrada) siguen resolviendo al valor histórico real, nunca al nuevo valor vivo.
- `settingsTrainerParaMes(key, mesKey)` / `centroParaMes(centroLive, mesKey)`: envuelven la config viva aplicando el resolver solo a los campos que afectan al cálculo de facturación (`canonFijoIndependiente`, `aporteIndividualCliente`, `coordBonusPorPt`, `coordMaxPts`, `coordMaxBonus`, `pactoEspecial`, `sistemaPago`, `centroId` para trainer; `canonFijo`, `ptsIncluidos`, `canonPt`, `canonPtReducidoDesde`, `canonPtReducido` para centro). Se usan SOLO dentro de `construirCalculoVivo(mesKey)` y `centroTrainer(key, perfil, mesKey)` (nuevo 3er parámetro opcional) — los paneles de configuración (`renderConfigTrainers`/`renderConfigCentros`) y las llamadas de "roster actual" (`contarPosterioresCentro`/`contarActivosCentroParaCoordinacion`, avisos de aniversario) siguen leyendo la config VIVA sin resolver por mes, a propósito: representan "cuántos PT hay hoy en este centro", un hecho del presente, no un dato versionable por mes — ampliar esto sería sobre-ingeniería fuera de los casos F1-F9 pedidos.
- UX en `editarTrainer(key,campo,valor)` / `editarCentro(id,campo,valor)`: si el campo editado es de los temporales Y cambia de valor realmente (no un no-op), se pregunta con `confirm()` nativo (mismo idioma que el resto de la app, que ya usa `confirm()`/`prompt()` para cierres de mes): Aceptar = "Solo este mes" (no toca la config viva, solo añade una entrada puntual para `mesTrabajoKey()`), Cancelar = "Desde este mes en adelante" (actualiza la config viva Y registra la versión, protegiendo los meses anteriores). El campo de config puede "revertir" visualmente tras un "solo este mes" porque la base viva no cambió — es el comportamiento correcto, no un bug.
- Verificado mentalmente contra F1 (cambio "desde septiembre": agosto resuelve al valor legacy, septiembre y octubre al nuevo) y F2 (override puntual "solo septiembre" con un valor distinto: septiembre resuelve al puntual, octubre vuelve al "desde" normal) — ambos casos correctos con el algoritmo de prioridad implementado.
- Los meses YA cerrados siguen sin tocar este mecanismo en absoluto (`construirCalculoActual` sigue devolviendo el snapshot congelado tal cual si no está en `mesEnEdicion`).

**No hecho a propósito**: no se tocó `TARIFAS_2026` (ver nota arriba, deferred a FASE 9-13); no se añadió UI dedicada de "editar con selector de fecha" (se usó `confirm()` nativo, consistente con el resto de `finanzas.html` y con el principio de cambio mínimo); no se versionó `fechaAlta` (es un hecho histórico único, no una política que cambie con el tiempo) ni el roster para el bono de coordinador (ver punto anterior).

### FASE 9-13 — RESUELTA (2026-09-01): Verónica Dell'Agnese, catálogo de actividades y reparto porcentual

✅ **Implementada en esta sesión** (checkpoint previo: tag `checkpoint-pre-veronica-2026-09-01`). Tarifas reales entregadas por el usuario y cargadas como **datos de configuración**, nunca hardcodeadas en el motor de cálculo.

**Dónde vive el catálogo — decisión de arquitectura clave**: en `besoulSuite/agenda` (NO en `besoulSuite/finanzas`). Motivo: las Rules actuales (`SECURITY_RULES.md`) permiten a cualquier usuario autenticado leer/escribir `besoulSuite/agenda` (`signedIn() && docId=='agenda'`), pero `besoulSuite/finanzas` está restringido a `isAdmin()`. Un PT no-admin como Verónica necesita LEER el catálogo desde `agenda.html` al dar de alta una ficha de cliente de actividad — si el catálogo viviera en `finanzas`, esto habría requerido desplegar un cambio de Rules (bloqueado, sin credenciales aquí). Poniéndolo en `agenda` se evita ese problema por completo, sin aumentar la exposición real de datos (el documento `agenda` ya expone toda la cartera/precios de clientes a cualquier usuario autenticado hoy — SEC-011 ya lo documentó como riesgo conocido, no es una regresión nueva). `finanzas.html` ya recibía el doc `agenda` completo en vivo (`agendaRef.onSnapshot`), así que solo necesitó lectura; para editar el catálogo desde el panel de Finanzas, escribe directamente contra `agendaRef` (que ya tenía como referencia) con `merge:true`.

**Estructura de datos** (nuevas claves top-level en el documento `besoulSuite/agenda`, todas opcionales/vacías por defecto — no rompe nada existente):
- `catalogoActividades: { <actividadId>: { id, nombre, centroId, activo, unidadCiclo, duracionCiclo, reparto:{partes:[{destino,pct}]}, modalidades:{ <modId>: { nombre, tipo:'ciclo_no_acumulable'|'bono_vigencia', segmentos:{ <segId>: { nombre, porPersona, planes:[{sesiones,precio}] } } } } } }` — valor por defecto ya seedeado en código vía `DEFAULT_CATALOGO_ACTIVIDADES` (constante duplicada e idéntica en `agenda.html` y `finanzas.html`, mismo patrón que `DEFAULT_CENTROS`/`TARIFAS_2026`) con Pilates Máquina y Ciclo Indoor/Spinning bajo `alfa_prime`, tarifas reales del usuario ya cargadas (General/Empresa/Jubilados × 4/8/12 clases; Bono 10 individual/pareja/trío; VIP individual/pareja/trío), reparto 50/35/15 (entrenador/centro/besoul) en ambas.
- `trainerActividades: { <trainerKey>: [actividadId, ...] }` — qué entrenadores pueden ofrecer qué actividad; vacío hasta que el admin lo marque desde Finanzas > Configuración > tarjeta del entrenador (checkboxes nuevos, generados dinámicamente desde el catálogo, no hardcodeados).
- `tarifasActividadVersiones` / `repartoActividadVersiones`: mismo mecanismo de vigencia por mes ya construido en FASE 6-7 (`entradaEfectivaTemporal`, reutilizada tal cual — refactoricé `valorEfectivoTemporal` para apoyarse en ella, sin cambiar su comportamiento), aplicado aquí a nivel de objeto completo (todo el árbol `modalidades`, o todo el array `partes`) en vez de campo a campo, porque se editan como unidad desde el panel admin.

**Motor de cálculo** (`finanzas.html`, dentro de `construirCalculoVivo`): una ficha con `f.actividadEspecialId` **nunca** pasa por `calcularComisionAvanzada` (rango/canon PT) — se calcula aparte con `calcularFacturacionActividadFicha` (el PLAN determina el importe completo, nunca precio-por-sesión × sesiones, salvo en modalidades `bono_vigencia` que reconocen ingreso por sesión agendada reutilizando `sesionesAgendadasFacturablesFichaMes` sin cambios) y `repartoEfectivoActividad` + `distribuirReparto` (reparto determinista a céntimos por método del mayor resto — verificado a mano contra los dos ejemplos del usuario: Pilates General 8 clases 95€ → 47,50/33,25/14,25 exacto; Ciclo General 8 clases 75€ → 37,50/26,25/11,25 exacto). El resultado se SUMA a `row.ptNeto`/`row.bsBruto` del mismo trainer que ya tenía su reparto PT estándar calculado — así conviven sin mezclarse (modelo mixto pedido para Verónica, pero genérico para cualquier trainer). El 35% del centro se acumula aparte en `centros[centroId].ingresosActividades` y **no** entra en `total.beneficio` (nunca fue dinero de BESOUL, a diferencia del canon).

**Alta de Verónica**: no se ha creado su perfil desde aquí (sigue sin credenciales de Firestore en este entorno) — el admin debe usar el flujo normal `crearEntrenador()` en Agenda (ya protegido con `normalizarTrainerKey()` desde la sesión anterior, sin necesidad de ningún paso manual extra). Email a usar: `veronica.dellagnese@besoulfitness.com`, centro `alfa_prime`. Tras crearla, el admin debe marcar sus actividades autorizadas (Pilates Máquina / Ciclo Indoor) desde Finanzas > Configuración > su tarjeta, y desde ahí ya puede dar de alta sus clientes de actividad en Agenda (toggle "Cliente de actividad especial" en la ficha, visible solo si el trainer tiene alguna actividad autorizada).

**No hecho / limitaciones conocidas, a propósito**:
- Editor de tarifas/reparto en Finanzas usa `prompt()`/JSON en textarea nativo (mismo idioma que el resto de la app, que ya usa `prompt()`/`confirm()` en todos lados) — no una UI de tabla editable. Suficiente para la frecuencia de cambio esperada (unas pocas veces al año), evita una UI grande no pedida explícitamente.
- El ciclo "4 semanas" de Ciclo Indoor es solo una etiqueta comercial (`unidadCiclo`/`duracionCiclo`, meramente informativos) — operativamente ambas actividades facturan por **mes de calendario** (`claveMes`), igual que el resto de la app. Decisión explícita del usuario: "no inventes una equivalencia si no es necesaria para esta Baseline".
- `crearSnapshotCierre()` no se tocó para incluir el catálogo de actividades en su `configSnapshot` — no hace falta para la integridad del cierre (los importes de facturación/reparto de cada trainer ya quedan congelados dentro de `trainers`/`centros` en el snapshot), solo sería útil para auditoría forense de "qué tarifa exacta existía". Mejora opcional futura, no bloqueante.
- No se ha probado en navegador real (sin entorno con Firestore/credenciales aquí) — pendiente que el usuario lo valide manualmente contra los casos V1-V10 que él mismo definió.
- El texto de `renderContadorHTML` en `agenda.html` (contador de clases restantes) sigue diciendo genéricamente "Bono 3 meses" para bonos de actividad — es la MISMA ventana de vigencia que los bonos PT estándar (reutilizada sin cambios, ya que el usuario no especificó una duración distinta para el bono de Pilates), solo que el texto no menciona "Pilates" explícitamente. Cosmético, no afecta al cálculo.

### Siguiente acción exacta (para retomar si esta sesión se corta aquí)

1. Validación manual por el usuario: crear a Verónica vía `crearEntrenador()`, marcarle sus actividades autorizadas, dar de alta un cliente de cada tipo (mensual General/Empresa/Jubilados, bono 10, VIP pareja/trío) y comprobar contra V1-V10 que facturación y reparto salen como se espera. Reportar cualquier discrepancia antes de considerar esto cerrado.
2. Miguel Fenech: cerrado y documentado arriba, no requiere ninguna acción de continuación salvo que el usuario reporte una recurrencia del problema.
3. Herramienta de auditoría "matriz trainerKey" (solo lectura) sigue pendiente si se quiere detectar mismatches similares a Miguel Fenech en otros PT — no bloqueante.
4. Continuar con el resto del roadmap maestro (mobile/reservas/CRM/finanzas completa/backup/hard-delete/UX-UI global/tests — ver fases 14-23 más arriba, siguen igual de pendientes).

---

## MÓDULO — BESOUL WhatsApp Click-to-Chat (2026-09-02)

✅ **Implementado en `agenda.html`** (checkpoint previo: tag `checkpoint-pre-whatsapp-2026-09-02`). MVP sin infraestructura externa (nada de WhatsApp Business API/Twilio/Meta Cloud/webhooks) — el PT/admin siempre pulsa un botón explícito, se abre `wa.me` con el mensaje precargado. No hay envío automático, no se afirma "entregado"/"leído" (wa.me no lo informa) — como mucho "WhatsApp abierto".

**Motor único centralizado** (nombres exactos pedidos por el usuario, todos en `agenda.html`):
- `normalizarTelefonoWhatsApp(telefono)` — quita todo salvo dígitos/`+`, quita `+`/`00` inicial, antepone `34` SOLO a un número español de 9 dígitos sin prefijo (`/^[6789]\d{8}$/`), nunca duplica prefijo ya presente, devuelve `null` si no queda un número de 8-15 dígitos válido (evita enlaces rotos — WA-01 a WA-04 verificados a mano).
- `crearMensajeWhatsApp(tipo, datos)` — 6 plantillas en `BS_WHATSAPP_PLANTILLAS`: `reminder_tomorrow`, `reservation_accepted`, `reservation_rejected`, `appointment_created`, `appointment_rescheduled`, `appointment_cancelled`.
- `crearUrlWhatsApp(telefono, mensaje)` / `abrirWhatsApp(telefono, mensaje)`.
- `ofrecerWhatsApp(tipo, datos, tituloAccion)` + modal `#modal-whatsapp-offer`: patrón genérico reutilizado en los 5 flujos de abajo — muestra "✓ acción realizada" con un botón "Enviar WhatsApp" (deshabilitado y con texto "Revisar teléfono" si el número no normaliza) y otro "Terminar". Nunca abre WhatsApp solo; siempre requiere el clic del usuario.

**Flujos conectados** (los 5 pedidos en la sección 26-30 del prompt maestro):
- Nueva cita individual (`soltarFichaEnCelda`, rama sin `claveOrigen`) → `appointment_created`. Se omite para grupos (abiertos: sin asistentes todavía; cerrados: necesitarían aviso por integrante, no implementado aquí).
- Reprogramación (`soltarFichaEnCelda`, rama con `claveOrigen` — cubre tanto el drag de escritorio como `moverSesionDesdeModalNota()` del flujo móvil, que delega en la misma función) → `appointment_rescheduled`, usa la clave/fecha-hora DESTINO.
- Cancelación (`borrarSesionAgenda`) → `appointment_cancelled`, usa los datos de la cita capturados ANTES de borrarla. Se omite para grupos y pruebas CRM.
- Reserva aceptada (`aceptarSolicitudReserva`) → `reservation_accepted`, solo tras el `await` exitoso del `.set()` de Firestore (si falla, se guarda igualmente el cambio local de agenda pero se avisa al admin y NO se ofrece WhatsApp — ver WA-10).
- Reserva rechazada (`rechazarSolicitudReserva`) → `reservation_rejected`, solo tras el `await` exitoso (ya hacía `return` en el catch original).

**Avisos de mañana** (nuevo botón en el header de Agenda, junto a "Reservas", badge con recuento): `fechaMananaISO()`/`listaAvisosManana()` recorren `dbAgenda[entrenadorVisto]` filtrando por la clave de fecha = mañana real (no depende de qué semana esté navegando el calendario). Grupos abiertos y cerrados se desglosan en una fila por asistente/integrante (nunca una acción colectiva ni teléfonos cruzados entre clientes — WA-08). Badge recalculado en cada `recalcularKPIs()` (ya se llama tras todo guardado relevante).

**Aislamiento (WA-13)**: todo lee `dbAgenda[entrenadorVisto]`/`dbClientes[entrenadorVisto]`, que ya está restringido por el mecanismo existente de la app (un PT no-admin no puede cambiar `entrenadorVisto`) — no se ha añadido ningún acceso nuevo cross-trainer.

**No hecho a propósito / limitaciones conocidas**:
- Grupos cerrados no reciben oferta de WhatsApp al crear/cancelar la sesión (solo en Avisos de mañana) — evita construir una UI de "N botones tras una acción" en esta pasada; ampliable después si se pide.
- No hay persistencia de "marcado como avisado" (el prompt del usuario lo dejaba como opcional de bajo valor para el MVP) — cada apertura del modal de Avisos de mañana recalcula desde cero, sin recordar qué WhatsApp ya se pulsó.
- No probado en navegador real (sin entorno con Firestore/credenciales aquí). WA-05/06/07/09/11/12/14 verificados por lectura de código, no ejecutados.

**Pendiente si se retoma**: casos WA-01 a WA-14 completos en navegador real; considerar extender el aviso a grupos cerrados si el usuario lo pide; ampliar "avisos de mañana" con un botón "marcar todos como avisados" si aporta valor una vez probado en producción.

---

## Reservas — auditoría y fixes (2026-09-02)

✅ Auditoría de fiabilidad (fork de investigación) + correcciones aplicadas en `reservas.html` y `firestore.rules` (propuesta, no desplegada).

**Hallazgo real corregido**: la "revalidación" en `enviarSolicitud()` antes de enviar (`bloqueLibre()`/`gruposAbiertosDisponibles()`) comparaba los datos en memoria cargados al abrir la página CONTRA SÍ MISMOS, no contra Firestore — en el primer intento de un cliente, esa comprobación nunca podía fallar por una franja tomada por otra persona después de cargar la página (TOCTOU real). El accept-time check en `agenda.html` (`aceptarSolicitudReserva`/`hayConflictoBloqueSesion`) ya impedía que esto corrompiera la agenda REAL del PT, pero permitía que se acumularan solicitudes 'pendiente' duplicadas para la misma franja sin que el cliente perdedor se enterara hasta un rechazo manual.

**Fix**: `besoulReservas` ahora usa un id determinista (`${trainerKey}__${clave}` individual, `${trainerKey}__${clave}__${clientId}` para grupo abierto — así distintos clientes SÍ pueden solicitar el mismo grupo en paralelo, cada uno su propia plaza) y la creación se hace dentro de `db.runTransaction()`, que lee ese documento exacto justo antes de escribir: si ya existe CUALQUIER documento en ese id (pendiente, aceptada o rechazada), rechaza con "Justo acaban de solicitar esa misma franja" y refresca la disponibilidad (`init()`).

**Limitación conocida y documentada a propósito** (no un descuido): las Rules desplegadas hoy solo permiten `create` a un cliente público no autenticado, nunca `update` sobre un documento que ya existe — así que NO se puede sobrescribir una solicitud ya rechazada para reintentar la misma franja exacta por el portal; ese id queda "consumido" permanentemente para el portal público aunque el hueco real siga libre. Dos formas de resolverlo sin tocar Rules ahora mismo, si se convierte en un problema real: (a) que `rechazarSolicitudReserva()` en `agenda.html` borre el documento en vez de solo marcarlo (el admin SÍ tiene permiso de `delete` ya hoy), liberando el id; o (b) el admin borra manualmente el documento atascado desde Firebase Console. No implementado en esta pasada — se prioriza no tocar la filosofía de "nunca hard-delete sin necesidad real" ya aplicada al resto de la app hasta confirmar que hace falta.

**`firestore.rules` (propuesta, no desplegada)**: se añadió una comprobación cruzada en `besoulReservas.create` — antes solo validaba la FORMA del payload, así que cualquiera con CUALQUIER token válido de un entrenador podía escribir una reserva con el `clientId` de OTRO cliente del mismo entrenador (suplantación), porque `besoulPublicClients` permite lectura pública. Ahora exige `exists(besoulPublicClients/{token})` y que `clientId`/`trainerKey` coincidan con lo que ese token realmente tiene guardado.

**No corregido, documentado como limitación arquitectónica** (fuera de proporción para esta pasada): si el entrenador no tiene `agenda.html` abierto, `besoulPublicSchedule.{trainerKey}.ocupados` no se actualiza en tiempo real con las solicitudes pendientes de otros clientes navegando el portal simultáneamente — no causa doble reserva real (el accept-time check sigue protegiendo), pero aumenta la tasa de solicitudes "muertas" que requieren limpieza manual. Solucionarlo requeriría una Cloud Function o cambiar el modelo de publicación, no viable sin credenciales/gasto aquí.

## CRM — auditoría y fixes (2026-09-02)

✅ Auditoría de fiabilidad + correcciones en `crm.html` (`eliminarLead` ya se había corregido antes, fuera de este bloque).

**`convertirLeadEnCliente()` — hallazgo real corregido**: aunque la escritura ya usaba `db.runTransaction()` (que SÍ protege correctamente contra que dos entrenadores editando la agenda a la vez se pisen — Firestore reintenta toda la transacción si el documento cambió entre la lectura y el commit, así que escribir el mapa `clientes` completo dentro de una transacción real es seguro, a diferencia del `.set()` sin transacción que sí era un bug real en `agenda.html` antes de la FASE 2), había un bug de carrera distinto: en un reintento automático de la transacción (dos conversiones casi simultáneas del mismo lead, o doble clic), el `existe` check correctamente evitaba crear un cliente duplicado, pero el documento del lead se seguía guardando con `convertedClientId` apuntando al id que ESE intento concreto había generado — que en el intento perdedor nunca llegó a crearse. Resultado: referencia colgante en el lead hacia un cliente fantasma. Corregido: `clienteIdFinal` se recalcula DENTRO de la transacción en cada intento, reutilizando el id REAL del cliente ya creado (detectado por `leadId`) cuando aplica. También se añadió `try/catch` con `alert()` (antes un fallo era una promesa rechazada sin ningún aviso al usuario) y se deshabilita el botón "Convertir" durante la operación como defensa adicional contra el doble clic.

**`sincronizarClienteAgendaDesdeLeadConvertido()` — hallazgo real corregido**: su `catch` solo hacía `console.error`, nunca relanzaba. Su único llamador (`guardarLead()`) SÍ tiene su propio try/catch con alert, pero como el error se tragaba dentro, ese catch externo nunca se disparaba — el modal se cerraba como si todo hubiera ido bien aunque la ficha de Agenda vinculada al lead se hubiera quedado desincronizada, sin ningún aviso. Corregido: ahora relanza con un mensaje claro que distingue "el lead sí se guardó, pero la sincronización con Agenda falló".

**`guardarLead()` / `historial` — hallazgo real corregido**: `eventosTemporales` (el historial editado en el modal) es una foto tomada al ABRIR el modal; al guardar con `{merge:true}`, Firestore reemplaza el array `historial` ENTERO (no fusiona elemento a elemento) — si otra persona añadió una entrada a ese mismo lead mientras este admin tenía el modal abierto, esa entrada desaparecía sin aviso. Nueva función `fusionarHistorialConServidor()`: antes de guardar, relee el `historial` real del servidor y añade cualquier entrada que falte localmente (nunca al revés), usando `fecha+texto+userEmail` como firma de deduplicación.

**Revisado y descartado (severidad baja, ya aceptado como límite conocido del proyecto)**: desincronización de `trainerKey`/nombre denormalizado en leads si se renombra un entrenador (mismo tipo de gap ya aceptado para Miguel Fenech — no se hace migración automática); ausencia de deduplicación de leads por teléfono/email en la creación manual desde CRM (sí existe deduplicación real, vía transacción, en la creación pública desde `valoracion.html`, ya verificada aparte esta sesión).

## UX/UI premium global (FASE 23) — pasada "cambios seguros" completa (2026-09-02)

✅ Aplicada a las 6 páginas restantes (`agenda.html` ya tenía su rediseño completo de UI-003A): `valoracion.html`, `reservas.html`, `index.html`, `crm.html`, `finanzas.html`, `dashboard.html`. Commits: `bf4ecf9`, `21d3eca`, `ab745a6`, `8ea3060`, `e08bec9`, `0c7e448`.

**Alcance seguido**: exactamente la sección 3 ("Cambios seguros") de `UI_ROADMAP_BESOUL.md` — focus rings (`focus:ring-2 focus:ring-{acento del módulo}`), radios normalizados a `rounded-xl`, `<label for>` asociado donde faltaba, `aria-live`/`role="alert"` en mensajes de error, `role="dialog" aria-modal="true"` en el modal de CRM. `valoracion.html` y `reservas.html` (client-facing, menor riesgo) recibieron además un panel de confirmación de éxito con check verde, consistente entre ambas.

**Deliberadamente NO hecho** (sección 4 del roadmap, "cambios con riesgo" — requieren revisión listener-por-listener antes de tocar el DOM, no se mezclan con un commit de estilo): sustituir las tablas de CRM/Finanzas/Dashboard por cards en mobile (patrón ya usado en agenda.html); añadir bottom-nav a los módulos que no lo tienen. Ambos quedan como el siguiente bloque de trabajo si se quiere seguir profundizando en UI, cada uno en su propio ticket/commit aislado.

## UI-003B — CRM mobile (2026-09-02)

✅ Checkpoint previo: tag `checkpoint-pre-ui003-estructural-2026-09-02`.

**Cambio**: tabla de leads → cards en mobile (`md:hidden`), tabla se conserva intacta en desktop (`hidden md:block`) — decisión explícita de "no sobreingeniería": mantener la tabla en el DOM y alternar por CSS es más robusto que reconstruir todo el listado condicionalmente en JS.

**Listeners revisados**: la tabla original solo tenía UN listener por fila (`onclick="abrirModalLead('${l.id}')"` en el botón "Abrir") — nada de sort/drag/otros handlers enganchados a las filas. La vista mobile reutiliza exactamente esa misma función global, mismo id de lead, ninguna lógica nueva. `renderTablaLeads()` ahora llama a `renderCardsLeadsMobile()` al final (nueva función, mismo array `leadsFiltrados`, mismos helpers `badgeEstado()`/`textoCentro()`/`textoTrainer()`/`labelFuenteCRM()`/`formatoFecha()` ya usados en la tabla) — un único punto de verdad para el filtrado, dos plantillas de salida.

**Modal `#modal-lead`**: pasa a bottom-sheet real en mobile (`align-items:flex-end` + `border-radius` solo arriba), mismo patrón exacto ya validado en `agenda.html`. Antes solo estaba anclado arriba con altura casi completa, no era un bottom-sheet.

**Copy**: corregido el texto de confirmación en `valoracion.html` (pedido suelto del usuario, sin hito propio) — "revisará tu solicitud y contactará contigo para confirmar día y hora."

**No tocado**: lógica de `guardarLead`/`convertirLeadEnCliente`/`eliminarLead`/filtros — cero cambios de JS de negocio, solo plantillas de render y CSS de un modal.

**Pruebas realizadas**: lectura completa de `renderTablaLeads()`/`aplicarFiltros()`/`abrirModalLead()` para confirmar el único contrato DOM real (`lead-table-body` + el id del lead pasado a `abrirModalLead`). Sin navegador real disponible aquí — pendiente validación visual del usuario en 375/390/430px y en desktop.

**Siguiente**: UI-003C Finanzas mobile.

## UI-003C — Finanzas mobile (2026-09-02)

**Jerarquía KPI**: la fila de 7 cajas iguales (`grid-cols-2 md:grid-cols-3 xl:grid-cols-7`) se sustituye por 2 cifras dominantes (Beneficio neto, Facturación cartera — `text-3xl`, cards más grandes) + una fila secundaria de 5 cajas más pequeñas debajo (Neto PT/BESOUL bruto/Otros ingresos/Cánones/Gastos). Mismos IDs exactos (`kpi-beneficio-neto`, `kpi-fact-total`, etc.) — `pintarTodo()` sigue escribiendo en los mismos elementos, cero cambios de JS.

**Indicador de vigencia temporal** ("SOLO ESTE MES" vs "DESDE EN ADELANTE" visualmente inequívoco, pedido explícito): nuevo badge "⏱ Vigencia temporal" en la card de cada entrenador (`renderConfigTrainers`), cada centro (`renderConfigCentros`) y cada actividad especial (`renderConfigActividades`, separado en "Tarifas con vigencia"/"Reparto con vigencia"), calculado leyendo si `trainerSettingsVersiones`/`centrosVersiones`/`tarifasActividadVersiones`/`repartoActividadVersiones` tienen alguna entrada real (no solo la base `_legacy`). Tooltip explica qué campos varían por mes. No se toca el motor de cálculo, es puramente informativo sobre datos que ya existían.

**Histórico → cards en mobile**: la tabla (`min-w-[760px]`, forzaba scroll horizontal) se mantiene intacta en desktop (`hidden md:table`); nueva vista de cards (`md:hidden`) con la misma jerarquía (beneficio destacado arriba, 4 cifras secundarias, mismos botones Ver/Reabrir/Recalcular/Borrar apuntando a las mismas funciones). `renderHistorico()` ahora rellena ambas vistas desde el mismo `dbFinanzas.historico`/`historicoBorrado`, sin lógica nueva.

**Gastos/Otros ingresos**: cada campo de las cards (ya eran `<div>`, no tablas) gana una etiqueta visible solo en mobile (`md:hidden`) — antes, al apilarse verticalmente en pantallas pequeñas, un `<select>`/`<input>` suelto sin contexto no se entendía sin mirar la posición en la rejilla de escritorio. Mismos `onchange`/`onclick`/índices exactos.

**Texto**: labels de la card-resumen por centro subidos de `text-[10px]` a `text-[11px]` para las cifras principales (el detalle secundario real, tipo "ses. mensuales" o el desglose de coste de sede, se queda en 9px como metadata). La tabla técnica de desglose por entrenador DENTRO de cada centro (9 columnas con sub-detalle) se deja tal cual, con su propio scroll horizontal contenido (`overflow-x-auto` local, no de página) — es detalle de auditoría denso, no la vista principal, y comprimirlo a cards sin perder legibilidad requeriría su propio ticket.

**Listeners revisados**: ninguna función de negocio tocada (`editarGasto`, `editarOtroIngreso`, `borrarGasto`, `borrarOtroIngreso`, `cargarMesHistorico`, `reabrirMesCerradoParaEdicion`, `recalcularCierreMes`, `borrarHistorico`, `restaurarHistoricoBorrado`, `editarTrainer`, `editarCentro`) — todas siguen recibiendo exactamente los mismos argumentos desde los mismos `onclick`/`onchange`, solo cambia el HTML que los envuelve.

**Siguiente**: UI-003D Dashboard mobile.

## UI-003D — Dashboard mobile (2026-09-02)

**Jerarquía KPI**: 12 cajas iguales (`grid-cols-2 md:grid-cols-4 2xl:grid-cols-12`) → 2 cifras dominantes (Beneficio neto, Facturación — `text-3xl`) + rejilla secundaria de 10 cajas más pequeñas debajo. Mismos IDs exactos (`kpi-beneficio`, `kpi-facturacion`, `kpi-besoul`, etc.) — `pintarKPIs()` no se toca.

**`tabla-centros`/`tabla-trainers` → cards en mobile**: ambas tablas eran de solo lectura (cero `onclick`/listeners por fila, confirmado antes de tocar nada), así que la conversión es la más segura de las tres páginas — ningún contrato JS que preservar más allá del `id` del `tbody`. `pintarTablas(res)` ahora rellena también `#cards-centros-mobile`/`#cards-trainers-mobile` (mismos arrays `centros`/`trainers`, mismos filtros ya aplicados) sin tocar la función que alimenta el gráfico ni las tablas desktop.

**Dejado intencionadamente con scroll horizontal contenido**: el mapa de ocupación (`#heatmap`, matriz día×hora, `min-w-[700px]`) — es una rejilla densa, no una lista de entidades, así que "cards" no es la forma natural de representarlo; se mantiene con su propio `overflow-x-auto` interno, no scroll de página. Mismo criterio que la tabla de desglose por entrenador en Finanzas (UI-003C).

**Listeners revisados**: `pintarTablas`/`pintarHeatmap`/`pintarGraficas`/`pintarOportunidades` no tienen ningún `onclick` en sus plantillas — dashboard es de solo lectura por diseño (`<p class="...">Dashboard de solo lectura...</p>` ya en el header). Cero riesgo de romper una acción.

**Siguiente**: UI-003E navegación global (header/bottom-nav consistentes en todos los módulos, respetando permisos reales).

## UI-003E — Navegación global (2026-09-02)

**Modelo de permisos real verificado antes de tocar nada** (no se inventó ningún permiso visual nuevo): `agenda.html`/`crm.html` — cualquier usuario activo (PT o admin) puede entrar, cada página gestiona visibilidad de acciones admin internamente. `finanzas.html`/`dashboard.html` — login bloqueado a `rol!=='admin'` (ambos ya tiraban `throw new Error(...)` antes de este cambio; confirmado leyendo el código, no asumido).

**CRM (`crm.html`)**: header gana enlaces "Dashboard"/"Finanzas" (antes solo tenía "Agenda"+"Finanzas", y "Finanzas" se mostraba a CUALQUIERA aunque un PT no pudiera realmente entrar — corregido: ahora también oculto por defecto). Nueva bottom-nav (`#bottom-nav-global`, `md:hidden`, primera barra inferior de esta página, no había ninguna antes) con Dashboard/Agenda/CRM/Finanzas/Más — Dashboard y Finanzas ocultos por defecto (`hidden`) y solo se revelan (clase `hidden` quitada + `grid-cols-3`→`grid-cols-5`) dentro del mismo bloque `if (esAdmin())` que ya existía para gatear otras acciones admin de esta página — reutiliza el rol real, no lo duplica.

**Finanzas/Dashboard**: ambas ya eran admin-only en su propio login, así que su bottom-nav (nueva en las dos) muestra los 5 accesos siempre, sin lógica condicional adicional. `finanzas.html` gana el enlace "Dashboard" que le faltaba en el header.

**Agenda**: **NO se le añadió una segunda barra inferior** — ya tiene su propia tab-bar interna (`#mobile-agenda-tabs`: Agenda/Clientes/Grupos/Reservas, navegación DENTRO del módulo, no entre módulos) y apilar dos barras habría sido exactamente el ruido que se pidió evitar. En su lugar, el header (que no tenía NINGÚN enlace cruzado a otros módulos) gana "CRM" (siempre) y "Dashboard"/"Finanzas" (ocultos por defecto, revelados en el mismo bloque `if (rolActivo === 'admin') {...} else {...}` que ya alternaba `btn-admin-entrenadores`/`btn-admin-solicitudes-eliminacion` — mismo patrón exacto, mismo rol real). Se añadió `flex-wrap` a la fila de botones del header para que quepan sin desbordar en pantallas intermedias.

**Acento del ítem activo**: cada página resalta su propio nav item con SU acento ya establecido en `DESIGN_SYSTEM_BESOUL.md` (CRM=cyan, Finanzas=emerald, Dashboard=purple) y dejan el resto en gris neutro — nunca los 5 coloreados a la vez en la misma pantalla, que es la lectura que se le da a "no utilizar cinco colores diferentes, una única acción/acento principal": uno resaltado, el resto neutro, por página.

**`<main>` de las 3 páginas con nueva bottom-nav** gana `pb-24 md:pb-6` (o equivalente) para que el contenido no quede tapado detrás de la barra fija en mobile.

**Listeners revisados**: cero funciones de negocio tocadas — todo son enlaces `<a href>` de navegación entre páginas o clases CSS de mostrar/ocultar reutilizando checks de rol ya existentes (`esAdmin()` en CRM, `rolActivo==='admin'` en Agenda). No se ha tocado auth ni el login de ninguna página.

**Siguiente**: UI-003F coherencia final (revisión de conjunto: tipografía, espaciados, empty/success/error states, antes de parar para la revisión visual del usuario).

## UI-003F — coherencia final (2026-09-02)

Barrido de cierre sin cambios de código adicionales — todo lo que pedía ya quedó resuelto en los pasos B-E:
- Tipografía: revisado `text-[9px]`/`text-[10px]` restante en CRM/Finanzas/Dashboard — en todos los casos son etiquetas de metadata sobre un valor más grande (`text-sm`/`text-3xl`), nunca contenido principal en sí. Coincide con la regla pedida ("pequeño solo para metadata realmente secundaria").
- Touch targets: los ítems de la nueva bottom-nav (`py-2.5` + icono + texto) rondan 50-56px de alto, por encima del mínimo táctil recomendado (44px).
- Estados de éxito: `valoracion.html`/`reservas.html` comparten el mismo patrón de check verde (UI-003 rollout inicial).
- Sin errores de sintaxis detectados en la relectura de cada bloque tocado esta sesión (agenda/crm/finanzas/dashboard).

**Parada según lo pedido — no se continúa a UX/UI más allá de este punto sin revisión visual del usuario.**

### Resumen para la revisión visual del usuario

**Commits de esta fase estructural** (todos en `BESOUL-BASELINE`, sin merge a `main`): `f651895` (UI-003B CRM), `21533a6` (UI-003C Finanzas), `575d9cf` (UI-003D Dashboard), `431fba9` (UI-003E navegación global). Checkpoint de seguridad previo: tag `checkpoint-pre-ui003-estructural-2026-09-02`.

**Módulos transformados**: CRM (tabla de leads → cards en mobile, modal bottom-sheet), Finanzas (jerarquía KPI, cards de histórico en mobile, badges de vigencia temporal, labels en gastos/ingresos), Dashboard (jerarquía KPI, tablas de centros/entrenadores → cards en mobile), navegación global (header consistente + bottom-nav nueva en CRM/Finanzas/Dashboard, header ampliado en Agenda sin segunda barra inferior).

**Qué revisar en PC (desktop, ≥768px)**: las tablas de CRM/Finanzas/Dashboard deben verse exactamente igual que antes (no deberían haber cambiado en absoluto ahí); los nuevos enlaces de header (Dashboard/CRM/Finanzas cruzados) deben aparecer correctamente según el rol con el que inicies sesión — como PT no deberías ver "Dashboard" ni "Finanzas" en ningún header.

**Qué revisar en móvil (375/390/430px)**: cards de leads en CRM, cards de histórico/gastos/ingresos en Finanzas, cards de centros/entrenadores en Dashboard; la bottom-nav nueva en CRM/Finanzas/Dashboard (no debe tapar contenido al hacer scroll hasta el final); en Agenda, confirma que SOLO ves su tab-bar interna de siempre (Agenda/Clientes/Grupos/Reservas) y que los enlaces cruzados nuevos del header son alcanzables (probablemente envueltos/wrap, no una segunda barra).

**Limitaciones pendientes, documentadas a propósito** (no son bugs, son decisiones de alcance explicadas en las secciones UI-003C/D de arriba): la tabla técnica de desglose por entrenador dentro de cada centro en Finanzas sigue con scroll horizontal contenido (no cards); el mapa de ocupación (heatmap) en Dashboard igual; una franja de Reservas ya solicitada una vez (aunque fuera rechazada) no puede volverse a pedir por el portal público con el mismo id, por una restricción real de las Rules de Firestore actuales (ver sección "Reservas — auditoría y fixes").

## AUDITORÍA CRÍTICA — Verónica Dell'Agnese (2026-09-02)

✅ **Bug real encontrado y corregido, con evidencia de código (no una suposición).**

**Lo que se pidió**: verificar de forma estricta, sin asumir nada, que el reparto 50/35/15 (Verónica/Alfa Prime/BESOUL) para Pilates Máquina y Ciclo Indoor está realmente implementado y usado en Finanzas, Agenda y Dashboard — no solo "parece correcto".

### 1. Estado encontrado

- **`finanzas.html`** (motor de cálculo principal, `construirCalculoVivo()`): lógica de actividades especiales SÍ implementada y correcta (construida en FASE 9-13 de esta misma sesión, re-verificada ahora línea por línea).
- **`agenda.html`** (creación de la ficha del cliente): SÍ implementada y correcta — `sesionesContratadasFicha()` línea 2213 (`if (ficha.actividadEspecialId) return parseInt(ficha.planSesiones) || 0;`), guardado de `actividadEspecialId`/`modalidadId`/`segmentoId`/`planSesiones`/`numPersonas` en `guardarCliente()` línea ~3818, catálogo cargado desde Firestore en `aplicarEstadoNubeAgenda()` líneas 1458-1459. Todo confirmado intacto.
- **`dashboard.html`**: ❌ **NO implementada. Bug real confirmado.** Este archivo tiene su **propio motor de cálculo financiero completamente duplicado e independiente** de `finanzas.html` (`TARIFAS_2026` propio, `construirCalculoMes()` propio — no reutiliza `construirCalculoVivo()`). Ese motor duplicado no tenía NINGÚN conocimiento de `actividadEspecialId`, `DEFAULT_CATALOGO_ACTIVIDADES`, reparto porcentual, ni de la temporalidad de `trainerSettings`/`centros` (FASE 6-7).

### 2. Problema detectado, con evidencia exacta

Para una ficha de actividad de Verónica, el motor de Dashboard (antes del fix) ejecutaba `calcularFacturacionFichaFinanzas(f, key, mesKey)` → `calcularFacturacionFichaSimple(ficha)` → `tarifaBaseFicha(ficha)` → `TARIFAS_2026[ficha.modalidad]`. Como el `modalidad` de una ficha de actividad es una etiqueta descriptiva (`"Actividad: Pilates Máquina · Plan mensual · General"`, no una clave real de `TARIFAS_2026`), esa búsqueda devuelve `undefined` → `tarifaBaseFicha` devuelve `0` → la ficha entera se descarta con `{total:0, tipo:'sin_importe'}` (`dashboard.html:385` original, antes del fix).

**Consecuencia real**: Dashboard mostraría a Verónica con **0€ de facturación, 0€ de reparto PT, 0€ para Alfa Prime, 0€ para BESOUL** por sus clases de Pilates/Ciclo, mientras SÍ contaría a esos clientes en "clientes activos" (`contarPersonasFicha` no distingue tipo de ficha) — un panorama doblemente incorrecto: cartera inflada, ingresos invisibles. Finanzas, mientras tanto, ya mostraba los números correctos — es decir, **Finanzas y Dashboard habrían mostrado cifras distintas para el mismo mes**, exactamente el tipo de discrepancia que motivó la sospecha del usuario.

**Segundo problema, mismo origen**: el motor duplicado de Dashboard tampoco resolvía `trainerSettings`/`centros` por mes (`dbFinanzas.trainerSettings?.[key] || {}` en crudo, sin pasar por el resolutor temporal de FASE 6-7) — así que un canon/rango con vigencia "solo este mes" o "desde este mes en adelante" se habría visto YA correcto en Finanzas pero desactualizado/incorrecto en Dashboard para meses pasados.

### 3. Cambios realizados

**`dashboard.html`** únicamente (ni `finanzas.html` ni `agenda.html` necesitaron cambios — ya estaban bien):
- Port exacto del motor de temporalidad de `finanzas.html`: `CAMPOS_TEMPORALES_TRAINER`, `CAMPOS_TEMPORALES_CENTRO`, `entradaEfectivaTemporal()`, `valorEfectivoTemporal()`, `settingsTrainerParaMes()`, `centroParaMes()`.
- Port exacto del catálogo y motor de actividades especiales: `DEFAULT_CATALOGO_ACTIVIDADES` (mismos precios reales que `agenda.html`/`finanzas.html`), `catalogoActividadesVivo()`, `actividadEfectivaParaMes()`, `repartoEfectivoActividad()`, `distribuirReparto()` (redondeo determinista a céntimos, método del mayor resto), `calcularFacturacionActividadFicha()`.
- `centroTrainer(key, perfil)` → `centroTrainer(key, perfil, mesKey)` (mismo cambio que ya se hizo en `finanzas.html`).
- `construirCalculoMes()`: la rama `f.actividadEspecialId` ahora existe (idéntica a `construirCalculoVivo()`), nunca pasa por `calcularComisionAvanzada` (rango/canon PT estándar), se suma aparte a `ptNeto`/`bsBruto` del mismo entrenador — modelo mixto correcto. `centros[centroId].ingresosActividades` nuevo, informativo, no entra en `total.beneficio` (nunca fue dinero de BESOUL, igual que en Finanzas).
- Verificado que NINGÚN otro trainer se ve afectado: sin `trainerSettingsVersiones` ni fichas con `actividadEspecialId`, `settingsTrainerParaMes`/la rama de actividad devuelven exactamente lo mismo que antes — cero cambio numérico para el resto de la cartera.

### 4. Validación — flujo completo trazado con datos reales del código

Cliente de Verónica, Pilates Máquina, segmento General, plan 8 clases, `numPersonas=1`, mes 2026-09, sin overrides temporales todavía:
- `calcularFacturacionActividadFicha`: `plan.precio=95` (línea de `DEFAULT_CATALOGO_ACTIVIDADES.pilates_maquina.modalidades.plan.segmentos.general.planes`), `porPersona=true` → `precioTotal = 95 × 1 = 95€`.
- `repartoEfectivoActividad` → reparto vivo `50/35/15`.
- `distribuirReparto(95, [50,35,15])`: 9500 céntimos → 4750/3325/1425 céntimos exactos (sin resto que repartir) → **Verónica 47,50€ · Alfa Prime 33,25€ · BESOUL 14,25€**. Suma = 95,00€ exacto.
- Este resultado es ahora **idéntico** en `construirCalculoVivo()` (Finanzas) y `construirCalculoMes()` (Dashboard) — mismo código, mismos datos de entrada, mismo resultado. Coincide exactamente con el ejemplo que el propio usuario dio en el prompt original de Verónica.
- Caso bono (Pilates individual, bono 10, 450€, 3 sesiones agendadas el mes): `valorSesion=45€`, `total=135€` → reparto `67,50/47,25/20,25`, suma 135,00€ exacto. Verificado con la misma fórmula.

### 5. Cómo verificarlo tú mismo

1. En Finanzas → Configuración, marca a Verónica (una vez creada con `crearEntrenador()`) con las actividades "Pilates Máquina"/"Ciclo Indoor" autorizadas.
2. Dale de alta un cliente de actividad en Agenda (toggle "Cliente de actividad especial").
3. Compara el KPI "Facturación"/"Beneficio neto" del mes en `finanzas.html` y en `dashboard.html`: con este fix, deben coincidir exactamente. Antes del fix, Dashboard habría mostrado esa parte en 0.
4. Revisa la card de Verónica en Finanzas > Configuración: si alguna vez editas su canon/reparto con "solo este mes", el badge "⏱ Vigencia temporal" debe aparecer, y el histórico de meses cerrados no debe cambiar.

**Nota importante — límite de esta auditoría**: esto verifica que el MOTOR es correcto (probado por trazado de código con cifras reales). No puedo verificar si el perfil real de Verónica ya existe en `besoulUsers` ni si algún cliente de actividad ya está dado de alta en producción — este entorno no tiene credenciales de Firestore. Esa parte requiere que tú lo confirmes en la consola de Firebase o dentro de la propia app.

## RELEASE CANDIDATE 2026-09-02

Checkpoint: tag `checkpoint-pre-release-candidate-2026-09-02`. Rama `BESOUL-BASELINE`, working tree limpio salvo los dos ficheros de referencia siempre sin trackear.

**Corrección real encontrada durante esta auditoría** (commit `d3ba60b`): `aprobarSolicitudEliminacion()` en `agenda.html` podía mostrar el aviso "hubo un error al sincronizar" y, sin `return`, caer igualmente en un segundo `alert` incondicional de "dada de baja correctamente" — dos mensajes contradictorios seguidos. Corregido: un único alert final que refleja el resultado real. El resto de funciones de escritura con alert de éxito (`confirmarSolicitudEliminacion`, `crearEntrenador`, `rechazarSolicitudEliminacion`, las de CRM/Reservas ya corregidas en la sesión anterior) se revisaron y ya hacían `await` antes de confirmar y no caían en el catch hacia el éxito.

**Comparación estricta Finanzas vs Dashboard (post `ff1f4e4`)**: diff directo de `DEFAULT_CATALOGO_ACTIVIDADES`, `distribuirReparto`, `calcularFacturacionActividadFicha`, `entradaEfectivaTemporal`/`valorEfectivoTemporal`/`settingsTrainerParaMes`/`centroParaMes`, `sesionesAgendadasFacturablesFichaMes` y `calcularComisionAvanzada` entre ambos archivos — **sin divergencias**, texto idéntico salvo indentación. `calcularCanonCentroYAsignar`/`calcularRepartoPorTramosBesoul` no fueron tocados por el port (nunca se editaron independientemente en ninguno de los dos archivos) y se confirmaron sin divergencia por inspección. No se hizo (ni se pidió) unificar el motor duplicado — queda para una fase posterior, tal como se indicó.

### Estado por módulo

| Módulo | Estado |
|---|---|
| **Agenda** — crear/editar cliente, agendar, reprogramar, cancelar, 45 min, inicios 15 min, grupos, bonos, mensualidades | OK — verificado por lectura de código; motor AGENDA-015 no se ha tocado en ninguna fase de esta sesión (UI-003 fue solo visual, Verónica/WhatsApp fueron aditivos) |
| **Agenda** — WhatsApp | OK — confirmado por el usuario en la revisión visual |
| **Agenda** — Avisos mañana | OK — verificado, usa fecha real del día siguiente, no depende de la semana navegada |
| **Agenda** — móvil sin drag obligatorio | OK — agendar (ya existía) y reprogramar (añadido esta sesión) funcionan por selección táctil; drag se conserva como acelerador de escritorio |
| **CRM** — crear/editar lead, historial, prueba, convertir, sincronización con Agenda | OK — auditado y corregidas 3 carreras reales en la sesión anterior (commit `98d41cb`): id de cliente fantasma en reintento de conversión, error silencioso en sincronización con Agenda, pérdida de entradas de historial concurrentes |
| **CRM** — errores visibles | OK tras los fixes de `98d41cb` |
| **Reservas** — token/disponibilidad/solicitud/aceptación/rechazo/conflicto | OK — transacción con id determinista impide doble reserva real (commit `98d41cb`) |
| **Reservas** — no doble reserva | OK, verificado por trazado de código |
| **Finanzas** — cambio de mes, canon/rango/centro/tarifas temporales, mes cerrado | OK — FASE 6-7, verificado con ejemplo numérico (agosto 1.090€ no cambia al editar septiembre a 1.200€) |
| **Finanzas** — mensualidades/bonos | OK — ya eran correctos antes de esta sesión (histórico congelado por mes para mensualidades; ventana de vigencia propia para bonos) |
| **Finanzas** — reparto actividad especial / PT estándar / modelo mixto / Verónica / 50-35-15 / no doble facturación | OK — verificado con trazado completo (95€ → 47,50/33,25/14,25€ exacto); modelo mixto confirmado: la ficha de actividad nunca pasa por `calcularComisionAvanzada` |
| **Dashboard** — mismos criterios económicos que Finanzas, actividades especiales, temporalidad | OK tras `ff1f4e4` — antes de ese commit era un **BLOCKER real** (cifras distintas a Finanzas para el mismo mes); ahora motor idéntico, verificado por diff directo |
| **Valoración** — formulario, deduplicación, éxito, conversión posterior en CRM | OK — deduplicación por transacción real (email+teléfono), verificado en auditoría anterior de esta sesión |
| **WhatsApp** | OK — confirmado por el usuario |
| **Mobile / navegación / bottom-nav** | OK — verificado que Agenda conserva su tab-bar interna sin una segunda barra apilada; CRM/Finanzas/Dashboard con bottom-nav nueva filtrada por rol real |
| **PWA (sw.js)** | OK — estrategia network-first correcta, sin bug; versión de caché subida a v6 esta sesión |
| **Roles — PT no ve módulos admin** | OK — verificado contra el modelo de permisos real (`esAdmin()`/`rolActivo==='admin'`), no un permiso visual inventado |
| **Verónica — tarifas Ciclo/Pilates/Bono/VIP y reparto 50/35/15** | OK en el motor (los tres archivos coinciden con las cifras exactas dadas por el usuario) — **validación con datos reales pendiente**: no se puede confirmar desde este entorno si ya existen fichas reales `clientes.veronica` con actividad en Firestore (sin credenciales aquí) |
| **Firestore Rules** | **PROPUESTA PREPARADA, NO DESPLEGADA** — ver detalle abajo |
| **Backups** | Script preparado (`scripts/backup-firestore.js`), no ejecutado nunca desde este entorno |

### Firestore Rules — estado exacto (no confundir código preparado con reglas desplegadas)

`firestore.rules` en la raíz del repo contiene la propuesta completa y está explícitamente marcado en su cabecera: *"ESTADO: propuesta lista para desplegar. NO se ha aplicado a producción desde este entorno."* Las reglas realmente desplegadas hoy son las documentadas en `SECURITY_RULES.md` ("Reglas Firestore actuales"), que **no incluyen**:
- Una regla para `besoulSolicitudesEliminacion` → cae en el catch-all `allow read, write: if false` → **el flujo de baja segura de clientes (construido y usado en esta sesión) probablemente falla con permission-denied contra Firestore real ahora mismo**, hasta que alguien despliegue la propuesta.
- Ownership por `trainerKey` en `besoulPublicClients` → cualquier usuario activo (no solo el dueño) puede tocar el enlace público de otro entrenador. Riesgo pre-existente, no introducido en esta sesión, con fix ya preparado.
- Cross-check de `token`/`clientId`/`trainerKey` en `besoulReservas.create` → un usuario con un token válido de un entrenador podría en teoría escribir una reserva con el `clientId` de otro cliente del mismo entrenador. Riesgo pre-existente, con fix ya preparado.

Ninguna de estas tres reglas se ha desplegado desde este entorno (sin Firebase CLI ni credenciales aquí). Esto **no se clasifica como blocker de esta Baseline** porque: (a) es un riesgo pre-existente antes de esta sesión, no introducido ahora; (b) el remedio ya está completamente preparado y documentado; (c) su despliegue requiere una acción manual del responsable del proyecto (Firebase Console o CLI) que este entorno no puede ejecutar. Se marca como **acción pendiente de alta prioridad para el responsable del proyecto**, no como bloqueo técnico de esta RC.

### Limitaciones conocidas (no bloquean, documentadas a propósito)

- Reservas: una franja ya solicitada una vez (aunque fuera rechazada) no puede reintentarse con el mismo id por el portal público, por la restricción real de las Rules actuales (`create` sí, `update` no, para clientes anónimos).
- Motor financiero duplicado entre Finanzas y Dashboard (ahora sincronizado en resultados, pero sigue siendo dos copias de código) — unificarlo queda para una fase posterior, no es esta Baseline.
- Sin datos reales de Verónica en Firestore para validar en producción (no verificable desde este entorno).
- Tabla de desglose por entrenador en Finanzas y heatmap en Dashboard mantienen scroll horizontal contenido (no se convirtieron a cards, ver UI-003C/D).

### Blockers

**Ninguno encontrado.** El único candidato a blocker real de esta sesión (Dashboard mostrando cifras financieras distintas a Finanzas para Verónica/actividades) ya fue corregido en `ff1f4e4` y verificado por diff directo.

## Revisión final de seguridad — besoulSuite/agenda: signedIn() → isActiveUser() (2026-09-02)

✅ Corregido en `firestore.rules` (propuesta, sigue sin desplegar). Hallazgo del usuario, verificado: `signedIn()` solo comprueba `request.auth != null && request.auth.token.email != null` — NO comprueba el perfil en `besoulUsers`. Un usuario autenticado pero marcado `activo:false` conservaba acceso de lectura/escritura al documento `besoulSuite/agenda` completo (todos los clientes/citas de todos los PT). Cambiado a `isActiveUser()`. Verificado que no rompe ningún flujo real: tanto `agenda.html` como el único otro escritor de este documento (`crm.html`, `convertirLeadEnCliente`) ya exigen `activo===true` a nivel de aplicación antes de dejar operar — el cambio de Rules solo cierra el hueco de que las Rules por sí solas no lo exigían. El bloque OPCIONAL/FASE 2 (comentado, aislamiento de escritura por trainerKey) sigue sin activar, cambio independiente.

**Modelo de aislamiento documentado sin exagerar** (ver detalle completo en `SECURITY_RULES.md`): ownership real por trainerKey en `besoulLeads`/`besoulPublicClients`/`besoulReservas`/`besoulSolicitudesEliminacion`; `besoulSuite/finanzas` solo admin; **`besoulSuite/agenda` sin aislamiento de lectura por PT** (limitación arquitectónica real, no resuelta ni resoluble solo con Rules mientras el documento sea monolítico) y sin aislamiento de escritura activo (FASE 2 preparada, comentada, pendiente de activar tras validación en producción).

## PWA — verificación (2026-09-02)

Revisado `sw.js`: estrategia network-first con fallback a caché (correcta, no sirve HTML obsoleto mientras hay conexión — sin bug). Se subió `CACHE_NAME` de v5 a v6 (commit `8e743df`) para que los usuarios offline reciban el código de esta sesión en cuanto vuelvan a conectar.

## Reservas públicas — "No se ha podido cargar la disponibilidad" (diagnóstico, 2026-09-02)

⚠️ **No es un fix del bug — es diagnóstico + instrumentación.** No se pudo reproducir aquí (sin navegador/Firestore de producción disponibles en este entorno), y la traza de código no encuentra una causa que explique el fallo.

**Descartado con evidencia de código** (no por suposición):
- `reservas.html` solo hace `.doc(token).get()` / `.doc(trainerKey).get()` contra `besoulPublicClients`/`besoulPublicSchedule` — nunca `list`/`query`/`onSnapshot` de colección. Confirmado leyendo `init()` completo (`reservas.html:278-306` tras el cambio de hoy).
- Las Rules — tanto las YA reales (documentadas en `SECURITY_RULES.md`) como las recién propuestas en `firestore.rules` — tienen `allow get: if true;` IDÉNTICO para `besoulPublicClients` y `besoulPublicSchedule`. El despliegue de hoy solo endureció `create`/`update` de `besoulPublicClients` y añadió cross-check a `besoulReservas.create` — ninguno de los dos toca el `get` que usa la carga inicial. **Conclusión: por lo que dice el código de las Rules, el despliegue de hoy no debería poder causar este fallo.**
- Los tokens actuales (`generarTokenReservaCliente()` en `agenda.html:5707`) solo generan `[a-z0-9_]`, sin caracteres inválidos para un ID de documento.
- `AGENDA-015` (commit `f8b8400`) no cambió el esquema que `publicarReservasPublicas()` escribe en Firestore (verificado leyendo la función completa, `agenda.html:6384-6468`) — mismo `semanal/excepciones/bloqueos` que `reservas.html` espera.
- Todas las funciones de render entre las dos lecturas y mostrar `#app` (`renderSlots`, `generarSlots`, `huecosLibresFecha`, `renderGroupSlots`, `gruposAbiertosDisponibles`...) ya usan `?.`/`||[]`/`||{}` de forma defensiva (endurecidas en AGENDA-015) — no se encontró un `TypeError` reproducible por inspección.

**No se pudo descartar** (requiere reproducción real): un documento `besoulPublicClients/{token}` legacy/stale sin `trainerKey`, o cualquier causa que solo se manifieste con datos reales de producción — el `catch` anterior mezclaba permission-denied, red y cualquier excepción JS en un único mensaje, sin forma de distinguirlos desde aquí.

**Cambio aplicado** (`reservas.html`, función `init()`): el `catch` ahora registra en consola (nunca en la UI pública) la etapa exacta (`lectura_besoulPublicClients` / `lectura_besoulPublicSchedule` / `render_disponibilidad`), el token, el `trainerKey` si ya se resolvió, y `err.code`/`err.message` del error real de Firebase. El mensaje de error mostrado al cliente en pantalla no cambia. Cero cambios de Rules, cero cambios de arquitectura, cero cambios de comportamiento salvo el propio logging.

**Siguiente paso real para cerrar esto**: reproducir en el navegador con el token real que falla, abrir la consola de DevTools y leer la línea `[BESOUL Reservas] Fallo en "..."`. Si `code` es `permission-denied`, hay que comparar carácter a carácter las Rules realmente pegadas en Firebase Console contra `firestore.rules` de este repo (posible error de copiado/despliegue manual, no reproducible por lectura de código). Si `code` es otra cosa (`not-found`, `unavailable`, o ninguno — es decir, una excepción JS), la etapa indicada en el log señala exactamente dónde mirar a continuación.

## HOTFIX-CLIENT-SAVE — edición de ficha de cliente no persistía (2026-09-02)

✅ **Blocker real confirmado y corregido, post-merge a `main` (rama `HOTFIX-CLIENT-SAVE`, sin merge todavía).**

**Síntoma**: editar un campo de ficha de cliente (p.ej. teléfono) parecía guardarse (la UI lo aceptaba, el modal se cerraba sin error) pero al reabrir la ficha o recargar la página, el valor anterior seguía ahí.

**Causa raíz confirmada por código** (`agenda.html`): `guardarEstadoNubeAgenda()` — la función que hace el guardado real en Firestore (`.set(payload, {merge:true})` dirigido por trainerKey) — **resolvía como éxito en TODOS los casos, incluidos los de fallo**:
- Si el guard `!window.bsAgendaCloudDocRef || window.bsAgendaAplicandoNube` bloqueaba el guardado, devolvía `Promise.resolve()` sin distinguir "omitido" de "guardado".
- Si `.set()` fallaba de verdad (red, permisos, cuota...), el `.catch(err => console.error(...))` interno se limitaba a loguear y devolvía una promesa RESUELTA (nunca rechazada) — el error quedaba solo en consola, nunca llegaba al código que llamó a la función.

Y `guardarCliente()` (el guardado de ficha desde el modal) llamaba a esto vía `programarGuardadoNubeAgenda()` (debounce de 350 ms, fire-and-forget, sin `await`) y cerraba el modal + mostraba la ficha como guardada de forma SÍNCRONA e INCONDICIONAL, sin esperar ni comprobar el resultado real del guardado en absoluto.

**Corrección aplicada** (mínima, sin tocar el mecanismo de escritura dirigida por trainerKey):
- `guardarEstadoNubeAgenda()` ahora resuelve `{ok:true}` en éxito real y `{ok:false, err|omitido}` en cualquier otro caso — sigue sin rechazar la promesa nunca, así que las demás llamadas fire-and-forget existentes (debounce, disponibilidad, aceptar/rechazar reservas...) siguen funcionando exactamente igual, no se tocó ningún otro flujo.
- `guardarCliente()` ahora es `async`, llama directamente (sin pasar por el debounce) a `guardarEstadoNubeAgenda(entrenadorVisto)` y hace `await` del resultado real. Solo si `ok===true` cierra el modal y muestra la ficha como guardada. Si falla: deshace la mutación local (dbClientes + localStorage vuelven al valor anterior, buscando por id, no por índice capturado, para ser seguro incluso si llegó un snapshot de otro PT mientras se esperaba), mantiene el modal abierto, muestra un `alert` explícito de que NO se ha guardado, y hace `console.error` con la etapa/trainerKey/clientId/`error.code`/`error.message` reales (sin datos personales).
- Añadido además un guard defensivo: si al guardar `idFichaEditando` ya no aparece en `dbClientes[entrenadorVisto]` (p.ej. el selector de admin cambió de PT con el modal abierto), avisa y no guarda nada, en vez de seguir silenciosamente sin tocar nada y cerrar como si hubiera ido bien.
- Botón "Guardar Ficha" se deshabilita y muestra "Guardando..." durante el `await` (mismo patrón ya usado en `enviarSolicitud()` de `reservas.html`), para evitar doble envío.

### ACTUALIZACIÓN CRÍTICA (mismo día): la causa real no era solo el falso-éxito — el write nunca tocaba el campo real

✅ **Confirmado contra el código fuente del SDK de Firestore (`parseSetData`/`parseObject`/`parseUpdateData`), no por suposición.**

`estadoLocalAgendaParaNube()` construye el payload dirigido con claves de punto (`clientes.<trainerKey>`, `agenda.<trainerKey>`, etc.) y `guardarEstadoNubeAgenda()` lo enviaba con `.set(payload, {merge:true})`. **`.set(..., {merge:true}) solo interpreta como ruta anidada las claves de punto que vienen en la opción `mergeFields` — las claves de punto DENTRO del propio objeto de datos se tratan como un nombre de campo LITERAL de nivel superior.** Es decir: esta escritura dirigida por trainerKey, construida en la FASE 2/commit `0505374`, **nunca ha actualizado el campo real anidado `clientes.<trainerKey>`** — escribía en un campo fantasma desconectado literalmente llamado `"clientes.<trainerKey>"`, sin que Firestore diera ningún error (la escritura en sí es válida). Esto explica el bug de edición de clientes de raíz (el fix anterior de esta misma sección era necesario pero no suficiente: `ok:true` se devolvía igualmente, porque el `.set()` sí "tenía éxito") y, además, el mismo patrón afecta a:
- `finanzas.html` → `guardarCatalogoActividadesNube()` (checkbox de actividades autorizadas, catálogo de actividades, tarifas/reparto con vigencia) — **NO corregido en este hotfix, fuera de alcance hoy, confirmado pero no tocado.**
- `crm.html` → `sincronizarPruebaAgendaDesdeLead()` (colocar la prueba de un lead en Agenda) — **NO corregido en este hotfix, fuera de alcance hoy, confirmado pero no tocado.**

**Corrección aplicada** (commit `7a589c4`, mismo día): `guardarEstadoNubeAgenda()` cambia `.set(payload, {merge:true})` → `.update(payload)` — `.update()` sí divide las claves de punto del objeto en rutas anidadas reales (confirmado contra `parseUpdateData`, incluye soporte nativo para `FieldValue.delete()`/`FieldValue.serverTimestamp()`). Mismo payload, mismo trainerKey dirigido, sin cambiar forma ni arquitectura. Esto es lo que hace que el mecanismo de `guardarCliente()` descrito arriba funcione de verdad de extremo a extremo, no solo que reporte el resultado correctamente.

**También corregido en el mismo commit**: `actualizarCitaGrupoAbiertoActual()` (añadir/quitar cliente de una sesión de grupo abierto) — antes usaba `programarGuardadoNubeAgenda()` (debounce fire-and-forget, mismo patrón de falso-éxito). Ahora es `async`, espera el resultado real de `guardarEstadoNubeAgenda()` y deshace la mutación local de `dbAgenda` si falla, con `alert` + `console.error` (sin datos personales) — mismo patrón que `guardarCliente()`.

**Validación**: sin navegador/Firestore de producción disponibles en este entorno — validado por trazado de código: `git diff main --stat` confirma que en toda la rama `HOTFIX-CLIENT-SAVE` solo cambian `agenda.html` y este documento; ningún otro llamador de `guardarEstadoNubeAgenda()`/`programarGuardadoNubeAgenda()` (creación de cita individual, reprogramar, disponibilidad, aceptar/rechazar reserva) cambia su forma de llamada ni depende del valor resuelto, así que no hay regresión de contrato en ninguno de ellos. `reservas.html`, `crm.html`, `finanzas.html`, `dashboard.html`, `firestore.rules` sin tocar. **Pendiente de que el usuario confirme con una prueba real en producción** (editar teléfono de un cliente y añadir/quitar un asistente de un grupo abierto, cerrar/reabrir, recargar).

**No tocado**: Finanzas, Reservas, WhatsApp, UI/diseño, Firestore Rules, el mecanismo de escritura dirigida por trainerKey (`estadoLocalAgendaParaNube`), ningún otro llamador de `guardarEstadoNubeAgenda()`.

**Rama**: `HOTFIX-CLIENT-SAVE`, creada desde `main` (`7418fc7`). Sin merge todavía.

## Reservas — token malformado "?t=~?t=res_xxx" (confirmado y corregido, 2026-09-02)

✅ **Causa real localizada con evidencia de código, no supuesta.**

**Síntoma reportado**: URL con `?t=~%3Ft%3Dres_hbjaxre_ms5q2pzo` en vez de `?t=res_hbjaxre_ms5q2pzo`. Decodificado una vez: el parámetro `t` recibido era literalmente el string `~?t=res_hbjaxre_ms5q2pzo`.

**Origen descartado con evidencia** (no había que tocarlo, y no se tocó): todo el lado de generación en `agenda.html` es limpio.
- `generarTokenReservaCliente()` (`agenda.html:5707`) solo produce `res_<base36>_<base36>`, sin caracteres especiales.
- `c.reservaToken` solo se asigna en dos sitios (`agenda.html:5750` y `:6443`), ambos llamando directamente a `generarTokenReservaCliente()` — nunca desde un campo de texto libre ni desde datos pegados por un usuario.
- `urlReservasCliente(token)` (`agenda.html:5718`) hace un único `encodeURIComponent(token)` sobre un token ya limpio — sin doble envoltura.
- `copiarTextoBesoul()` (`agenda.html:5722`) copia el texto tal cual, sin transformarlo.
- El módulo WhatsApp click-to-chat (`BS_WHATSAPP_PLANTILLAS`, `agenda.html:2002-2017`) **no incluye el enlace de reservas en ningún mensaje** — es un motor totalmente aparte (recordatorios/confirmaciones de citas), así que no puede ser el vector de corrupción.
- `copiarLinkReservaCliente()` (`agenda.html:5735`) sí republica `besoulPublicClients/{token}` antes de copiar en ambas ramas: si el cliente aún no tenía token, `await guardarEstadoNubeAgenda()` (que encadena `.then(() => publicarReservasPublicas())`, `agenda.html:1406-1408`); si ya lo tenía, llama a `publicarReservasPublicas()` directamente. Confirmado que el enlace copiado desde Agenda siempre corresponde a un documento ya publicado.

**Causa real**: `usarTokenManual()` en `reservas.html` (input `#manual-token`, pantalla que aparece cuando se entra sin `?t=`). Tomaba lo que hubiera en el campo, SIN normalizar ni validar, y lo envolvía directamente: `location.href = ...?t=${encodeURIComponent(t)}`. Si un usuario pegaba ahí algo que ya venía roto — una URL completa, o un fragmento tipo `~?t=res_xxx` (típico de un enlace reenviado/copiado desde un chat, con el dominio/ruta recortados y un `~` sobrante delante) — la función lo volvía a envolver en un `?t=` nuevo en vez de recuperar el token real de dentro. `encodeURIComponent("~?t=res_hbjaxre_ms5q2pzo")` produce exactamente `~%3Ft%3Dres_hbjaxre_ms5q2pzo` — coincide carácter a carácter con lo reportado. El propio token suelto (`res_hbjaxre_ms5q2pzo`) tiene el formato real de `generarTokenReservaCliente()`, así que probablemente SÍ existía como documento real — no puedo confirmarlo desde este entorno sin acceso a Firestore de producción, y no lo doy por hecho.

**Corrección aplicada** (`reservas.html`): nueva función única `normalizarTokenReserva(raw)` (contrato: solo acepta tokens con formato real `res_[a-z0-9_]{3,60}`, desenvuelve hasta 5 capas de `decodeURIComponent`, recupera lo que hay tras la última `t=` si venía como `?t=...`/`~?t=...`/URL completa, corta `&`/`#` sobrantes, devuelve `null` si no puede recuperar algo válido — nunca acepta texto arbitrario). Aplicada en dos puntos:
- `init()`: el parámetro `?t=`/`?token=` de la URL ahora se normaliza antes de usarse — si había un parámetro pero no se pudo recuperar un token válido, se muestra el error controlado existente ("No se ha encontrado tu enlace..."); si no había parámetro en absoluto, se sigue mostrando la pantalla de código manual (comportamiento sin cambios).
- `usarTokenManual()`: ahora normaliza lo pegado en el campo antes de construir la URL; si no puede recuperar un token válido, muestra un `alert` y no redirige — así no se puede volver a generar un enlace `?t=` doblemente envuelto desde este punto.
- Autotest determinista inline (`autotestNormalizarTokenReserva`, se ejecuta solo, `console.warn` si algo falla) cubriendo: token limpio, `?t=...`, `~?t=...`, URL completa, el string exacto reportado en producción y su equivalente URL-encoded, más casos inválidos (texto arbitrario, vacío, `res_` sin cuerpo).

**Enlaces nuevos generados desde Agenda**: sin cambios — ya eran (y siguen siendo) exactamente `https://.../reservas.html?t=<token>`, un único parámetro, sin anidar.

**No se modificaron datos reales, no se regeneraron tokens masivamente, no se tocaron Firestore Rules.**

Commit: ver `git log` (mensaje `fix: normalize/validate reservation token, stop re-wrapping malformed manual input`).

## BESOUL-NEXT-UX-NOTIFICATIONS — buzón + WhatsApp múltiple + auditoría UX/mobile (2026-09-03)

Rama `BESOUL-NEXT-UX-NOTIFICATIONS`, desde `main` (`4b0aeb9`). Checkpoint: tag `checkpoint-pre-ux-notifications-2026-09-03`. **Sin merge a `main` todavía.**

**Auditoría UX/mobile** (fork de investigación, solo lectura, sin navegador/Firebase Auth real disponible en este entorno — evidencia por código, no clic-a-clic): encontró double-scroll (outer + inner `overflow-y-auto` simultáneos) en 6 modales de `agenda.html` (`modal-cliente`, `modal-disponibilidad-reservas`, `modal-solicitudes-reservas`, `modal-solicitudes-eliminacion`, `modal-avisos-manana`, y `modal-whatsapp-offer` sin tratamiento bottom-sheet en absoluto); dos botones de grupos abiertos bajo el mínimo táctil de ~44px; confirmó que el patrón de reprogramar-sin-drag y el resto de flujos táctiles ya funcionan; confirmó que Finanzas (heatmap/desglose por entrenador) y Dashboard mantienen scroll horizontal contenido correctamente (sin fuga a nivel de página); confirmó estado real de acceso — `agenda.html`/`crm.html` sin gate de rol (cualquier activo entra), `finanzas.html`/`dashboard.html` ya admin-only.

**P1 — Mobile Agenda (commits `2a9bf58`, `edbda35`)**: eliminado el double-scroll en los 6 modales (cada uno queda con una única capa de scroll — la interna donde ya existía sin condicionar por breakpoint, y correctamente restaurado el scroll en desktop donde `modal-cliente`/`modal-historico-cliente` dependían del exterior). Botones "Añadir cliente"/"Quitar" del panel de grupo abierto agrandados a ~44px. Solo CSS/clases, cero lógica JS tocada.

**P2 — WhatsApp a varios clientes (commit `768421e`)**: nuevo botón "Enviar aviso a clientes" en Agenda → modal con buscador, selección múltiple (seleccionar visibles/deseleccionar), mensaje libre, y un paso de envío con un botón "Abrir WhatsApp" por cliente que reutiliza `abrirWhatsApp()` sin duplicar lógica de teléfono/URL. "Preparado" es estado local de sesión, nunca persistido, nunca se afirma "enviado". Sin escrituras a Firestore, sin colección nueva.

**P3 — Buzón/notificaciones (commits `0337c6f`, `cd7fd84`)**: colección nueva `besoulNotifications/{id}` (fuera del monolito de agenda a propósito), Rules propuestas (lectura por trainerKey propio o admin; create abierto a cualquier activo — deliberado, permite notificar a otro PT; update whitelisteado a `read`/`readAt`; sin delete) — **no desplegadas, mismo estado "propuesta" que el resto de Rules de esta sesión**. UI: campana + badge en el header de Agenda, panel bottom-sheet, marcar leída/todas leídas — mismo patrón `onSnapshot`→badge→render que solicitudes de eliminación/reservas. Dos disparadores reales conectados (aprobar/rechazar solicitud de baja → notifica al PT afectado); el resto de tipos de aviso listados por el usuario quedan como trabajo futuro sobre la misma arquitectura.

**P4 — Bugs conocidos Finanzas/CRM (commits `2c61075`, `9f65df8`)**: mismo fix `set(...,{merge:true})`→`update()` que ya se aplicó y validó en producción para `agenda.html` (ver sección HOTFIX-CLIENT-SAVE arriba), aplicado ahora a `finanzas.html` (`guardarCatalogoActividadesNube` — arregla el checkbox de actividades autorizadas y las 5 llamadas más que pasan por esa función) y `crm.html` (`sincronizarPruebaAgendaDesdeLead` — arregla que la prueba de un lead se vea realmente en Agenda). Commits separados, sin mezclar con cambios de UX, tal como se pidió.

**P5 — Mobile admin**: auditado, sin hallazgo que justifique un cambio de código (selector de "Auditar PT" algo apretado en 375px pero funcional; scroll horizontal contenido de Finanzas/Dashboard ya confirmado correcto). Sin commit.

**Pendiente de decisión del usuario**: desplegar las Rules de `besoulNotifications` (sin esto el buzón fallará con `permission-denied`, capturado y silencioso — el badge se queda en 0); validar en producción los 4 bloques de esta rama; autorizar merge a `main`.
