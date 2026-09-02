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
