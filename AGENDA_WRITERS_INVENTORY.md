# Inventario exhaustivo de escritores de `besoulSuite/agenda`

Búsqueda completa del repositorio (no asumido que `guardarEstadoNubeAgenda()` sea el único escritor -- demostrado por búsqueda real de `.collection('besoulSuite').doc('agenda')`/`doc(BS_AGENDA_DOC_ID)` combinado con `.set(`/`.update(`/`tx.set(`/`tx.update(`/`batch.set(`/`batch.update(` en TODOS los `.html`/`.js` del repo, no solo `agenda.html`). Resultado: **3 archivos escriben, no 1**. Un cuarto (`dashboard.html`) y un script (`scripts/backup-firestore.js`) solo LEEN. Ningún otro archivo (`reservas.html`, `portal-cliente.html`, `valoracion.html`, `prueba.html`, `functions/cancelacionCliente.js`) referencia `besoulSuite/agenda` en absoluto.

## 1. `agenda.html` — `guardarEstadoNubeAgenda(trainerKeyScope)`

- **Archivo/línea**: `agenda.html:1571-1621`
- **Actor esperado**: PT o ADMIN activo (login-gated a nivel de app; `entrenadorVisto` fijo al propio `trainerKey` para PT no-admin)
- **Método**: `bsAgendaCloudDocRef.update(payload)` — rutas punteadas reales (`.update()`, no `.set({merge:true})` -- ver el hallazgo de 2026-09-02 documentado en el propio código sobre por qué `.update()` es el método correcto para este payload)
- **Campos afectados**: `clientes.<trainerKey>`, `agenda.<trainerKey>`, `disponibilidadReservas.<trainerKey>`, `historicoClientes.<trainerKey>`, `pruebasCRM.<trainerKey>`, `notas.*` (mapa plano, ver sección de `notas` más abajo), `actualizadoEn`, `ultimaActualizacionLocal` -- vía `estadoLocalAgendaParaNube(scope)`
- **`trainerKey` utilizado**: `scope = trainerKeyScope || entrenadorVisto` -- siempre UN solo trainerKey por llamada, nunca varios a la vez
- **Compatible con FASE 2**: **SÍ** — verificado con pruebas reales de emulador (`PT A puede escribir varios campos propios a la vez`, simula esta función exactamente)

## 2. `finanzas.html` — `guardarCatalogoActividadesNube(payload)`

- **Archivo/línea**: `finanzas.html:1662-1673`, invocada desde `toggleActividadTrainer()` (1644), `crearActividadEspecial()` (1685), `editarRepartoActividadDesdeUI()` (1725), `editarTarifasActividadDesdeUI()` (1752)
- **Actor esperado**: **ADMIN únicamente** (`finanzas.html` exige `rolActivo==='admin'` en su login, ya vigente antes de esta fase)
- **Método**: `agendaRef.update(payload)` — rutas punteadas reales, mismo patrón que `agenda.html`
- **Campos afectados**: `catalogoActividades.<actividadId>`, `trainerActividades.<trainerKey>`, `tarifasActividadVersiones.<actividadId>`, `repartoActividadVersiones.<actividadId>` -- **NINGUNO de estos 4 campos está en la whitelist de FASE 2** (`hasOnly(['clientes','agenda','disponibilidadReservas','historicoClientes','pruebasCRM','notas','actualizadoEn','ultimaActualizacionLocal'])`)
- **`trainerKey` utilizado**: solo `trainerActividades.<trainerKey>` está realmente indexado por trainerKey; los otros 3 están indexados por `actividadId` (una clave de catálogo compartido, no un trainerKey)
- **Compatible con FASE 2**: **SÍ, pero exclusivamente porque el actor es SIEMPRE admin** (`isAdmin()` bypasa la whitelist entera). Si esta función se invocara alguna vez desde una sesión no-admin, FASE 2 la RECHAZARÍA de raíz -- los 4 campos ni siquiera están en la lista permitida para PT. Verificado con prueba real de emulador (`ADMIN puede escribir catalogoActividades.*`, `PT A NO puede escribir catalogoActividades.*`) -- ambos resultados son el comportamiento CORRECTO y deseado, no un fallo.

## 3. `crm.html` — 3 puntos de escritura, los 3 solo alcanzables como ADMIN (ROLE-01 bloquea el login de cualquier PT a `crm.html` antes de revelar `app-content`)

### 3a. `sincronizarPruebaAgendaDesdeLead(leadId, leadData, avisar)`
- **Archivo/línea**: `crm.html:1126-1232`
- **Método**: `tx.update(agendaRef, updatePayload)` dentro de una `runTransaction`
- **Campos afectados**: `agenda.<trainerKey>.<clave>` (set o `FieldValue.delete()`), `pruebasCRM.<trainerKey>.<clave>` (set o delete), `ultimaActualizacionLocal`, `actualizadoEn`
- **`trainerKey` utilizado**: **potencialmente VARIOS a la vez** -- primero recorre TODOS los trainerKeys de `agenda`/`pruebasCRM` buscando y borrando cualquier prueba anterior de ese `leadId` (relevante si un lead fue reasignado de un PT a otro), y solo después coloca la prueba nueva bajo `leadData.trainerKey`. En el caso normal (lead nunca reasignado) solo toca un trainerKey; en el caso de reasignación, toca dos.
- **Compatible con FASE 2**: **SÍ, solo por ser admin.** Con un actor no-admin, esta función violaría el whitelist en el momento en que tocara un segundo trainerKey.

### 3b. `sincronizarClienteAgendaDesdeLeadConvertido(leadId)`
- **Archivo/línea**: `crm.html:1235-1295`
- **Método**: `tx.set(agendaRef, {clientes, ultimaActualizacionLocal, actualizadoEn}, {merge:true})` dentro de una `runTransaction` -- **`.set()` con objeto completo, no rutas punteadas**, pero `merge:true` sobre una clave SIN punto (`clientes`) hace que Firestore fusione el mapa recursivamente; como solo se muta el array de UN trainerKey antes de reescribirlo, el resultado observado por `diff()` es idéntico a una escritura dirigida
- **Campos afectados**: `clientes` (objeto completo, todos los trainerKeys se releen y reescriben, pero solo el que tiene un cliente con `leadId`/`convertedClientId` coincidente cambia de valor)
- **`trainerKey` utilizado**: busca en TODOS los trainerKeys (prioriza `trainerPreferente`) -- estructuralmente puede tocar más de uno si hay datos duplicados/inconsistentes, aunque en el caso normal solo toca uno
- **Compatible con FASE 2**: **SÍ, solo por ser admin**

### 3c. `convertirLeadEnCliente(...)` (transacción principal de conversión)
- **Archivo/línea**: `crm.html:1410-1452`
- **Método**: `tx.set(agendaRef, {clientes, agenda, ultimaActualizacionLocal, actualizadoEn}, {merge:true})`
- **Campos afectados**: `clientes` (push del nuevo cliente en `clientes[trainerKey]`, un solo trainerKey), `agenda` (pasado por `eliminarPruebaAgendaEnObjeto(agenda, leadEditandoId)`, que **recorre TODOS los trainerKeys** buscando y borrando cualquier prueba con ese `leadId`, sin restringirse al `trainerKey` de destino)
- **`trainerKey` utilizado**: `clientes` -- uno solo (el `trainerKey` de destino de la conversión). `agenda` -- potencialmente varios, por el mismo motivo que 3a
- **Compatible con FASE 2**: **SÍ, solo por ser admin**

## 4. `dashboard.html` — solo lectura

`dashboard.html:1202` (`onSnapshot`) y `:1208` (`get()`) -- confirmado, sin ningún `.set(`/`.update(` sobre `besoulSuite/agenda` en todo el archivo. No aplica a FASE 2.

## 5. `scripts/backup-firestore.js` — solo lectura

`scripts/backup-firestore.js:705` (`get()`, dentro de un backup de datos) y `:77` (loop genérico sobre `BESOUL_SUITE_DOCS`, también solo `get()`). Script de respaldo, nunca escribe. No aplica a FASE 2.

## 6. Fuera del inventario, deliberadamente

`agenda-15min-optimizada-prueba.html` (raíz del repo) contiene un escritor con el patrón `.set(payload)` (sin `merge`/rutas dirigidas -- el mismo bug ya corregido en el resto del código). **No se cuenta como escritor real**: es un archivo de prueba, explícitamente fuera de Git (untracked) por instrucción del usuario, nunca desplegado, nunca cargado por ningún flujo de producción.

## Conclusión para FASE 2

Los 4 campos anidados por trainerKey que SÍ importan a la whitelist de FASE 2 (`clientes`, `agenda`, `disponibilidadReservas`, `historicoClientes`, `pruebasCRM`) reciben escrituras de **3 archivos**, no solo `agenda.html`. Los 3 son compatibles con FASE 2 tal como está redactada HOY -- pero por dos motivos distintos:
- `agenda.html` (el único escritor alcanzable por un PT no-admin): compatible porque construye SIEMPRE payloads dirigidos a un único trainerKey, el propio.
- `finanzas.html` y `crm.html` (ambos exclusivamente admin): compatibles porque `isAdmin()` bypasa la whitelist entera -- no porque sus payloads respeten el patrón de un-solo-trainerKey (de hecho, 2 de los 3 puntos de `crm.html` pueden tocar más de un trainerKey en la misma escritura, por diseño, cuando hay reasignación de lead).

**Esto significa que activar FASE 2 no rompe ningún flujo real hoy** (los 3 escritores están cubiertos, dos por diseño de payload y uno por bypass de rol), pero también significa que **si algún día se quisiera restringir el bypass de `isAdmin()` sobre `besoulSuite/agenda`** (fuera de alcance de esta fase), habría que rediseñar `sincronizarPruebaAgendaDesdeLead()` y `convertirLeadEnCliente()` primero, porque dependen estructuralmente de poder tocar más de un trainerKey en una sola escritura.
