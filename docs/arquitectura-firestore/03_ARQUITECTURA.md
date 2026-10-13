# Informe 3 — Arquitectura Firestore definitiva

## 1. Principios

1. **Ningún documento crece con el tiempo ni con el número de clientes.** Cada documento tiene un tamaño acotado
   por una magnitud física (huecos de un día) o por una entidad (un cliente, un mes).
2. **La unidad de escritura es la unidad de conflicto.** Lo que debe ser atómico (no solapar sesiones de un
   entrenador en un día) vive en un mismo documento; lo independiente, en documentos distintos.
3. **Aislamiento por reglas, no por la app.** Cada documento lleva `trainerKey`; un PT solo puede leer/escribir lo suyo.
4. **Operaciones, no estados.** El cliente envía "crear/mover/cancelar sesión X" con un `opId`, ejecutado en
   transacción; nunca "esta es mi copia del entrenador entera".
5. **Simplicidad:** sin backend propio obligatorio (encaja con GitHub Pages + Firestore). Cloud Functions opcionales.

## 2. Esquema recomendado

```
besoulTrainers/{trainerKey}                      ← config y horario semanal (≤ 20 KB)
  trainerKey, nombre, centroId, activo
  disponibilidadSemanal{...}, configReservas{...}, actividades[...]   (hoy: disponibilidadReservas.<tk> sin días, trainerActividades.<tk>)
  rev, actualizadoEn, actualizadoPor

besoulClientes/{clientId}                        ← una ficha (≈ 0,7–2 KB)
  trainerKey, tipo (individual|grupo|miembro), grupoId?, estado, nombre, nombreNorm, telefono, email,
  tarifa{modalidad, planSesiones, tipoCompra, descuentoPct, ...}, contratoCliente, reservaToken,
  restriccionesReservas, leadId?, datosCRM{...}, fechaAlta, rev, actualizadoEn, actualizadoPor

besoulAgendaDias/{trainerKey}_{YYYY-MM-DD}       ← un entrenador, un día (típico 1–6 KB; máx. ≈ 60 KB)
  trainerKey, fecha (YYYY-MM-DD), mes (YYYY-MM)
  sesiones: { <sesionId>: { hora:'10:15', duracionMin:45, tipoCita, clientId|grupoId|leadId,
                            nombreMostrado, asistentes[...], capacidad?, estadoCancelacion?,
                            economia{...snapshot mínimo según decisión D1}, recurrenciaId?, origen{...},
                            creadoEn, creadoPor, actualizadoEn, actualizadoPor } }
  bloqueoDia: null | { motivo, por, en }          (hoy: excepciones[fecha].activo=false)
  excepcionHorario: null | {...}                  (hoy: excepciones[fecha])
  slotsOcultos: ['10:00', ...]                     (hoy: bloqueos[fecha])
  notas: { <sesionId|hora>: texto }                (hoy: notas.<tk>__<clave>)
  ultimasOps: [ opId, ... ] (últimas 50)           ← idempotencia
  rev, actualizadoEn, actualizadoPor

besoulHistoricoClientes/{trainerKey}_{clientId}_{YYYY-MM}   ← snapshot mensual congelado (≈ 0,5 KB)
  trainerKey, clientId, mes, ...campos actuales de historicoClientes

besoulRecurrencias/{recurrenciaId}  (opcional)  ← definición de serie; las ocurrencias viven en los días
```

Sin cambios: `besoulUsers`, `besoulLeads`, `besoulReservas`, `besoulNotifications`, `besoulSolicitudesEliminacion`,
`besoulValoracionRegistry`, `besoulPublicClients`, `besoulPublicSchedule` (con reglas endurecidas).
`besoulSuite/finanzas`: fuera del alcance inmediato; recomendado partir `historico`/`auditoriaCierres` por mes
en una fase posterior si la medición confirma el crecimiento.

### Identificadores estables

- `sesionId` = `s_` + UUID generado en el cliente. **Mover** una sesión cambia `hora` (o el documento del día), no el id.
- `clientId` actual se conserva (ya es estable). `trainerKey` actuales se conservan (incluidos los que tienen punto;
  en IDs de documento el punto es válido; en rutas de campo se usa siempre `FieldPath`).

## 3. Alternativas evaluadas

| Alternativa | Ventajas | Inconvenientes | Veredicto |
|---|---|---|---|
| **A. Documento por sesión** (`besoulSesiones/{id}`) | Unidad mínima; consultas naturales | Un SDK cliente **no puede consultar dentro de una transacción**: prevenir solapes exige igualmente un documento "candado" por entrenador-día; más lecturas para pintar una semana (n sesiones vs 7 días); más docs que reconciliar en la migración | Descartada como principal |
| **B. Documento por entrenador** (`agendaByTrainer/{tk}`) | Migración más sencilla; aislamiento | Sigue creciendo sin límite con la historia del entrenador (≈ 1 MiB en pocos años para un PT con mucha actividad) | Descartada (solo aplaza) |
| **C. Documento por entrenador-mes** | Menos documentos | ~150–200 sesiones/mes en un PT intenso → 100 KB+ y contención durante todo el mes | Aceptable, inferior a D |
| **D. Documento por entrenador-día** ✅ | Tamaño acotado físicamente; solape = invariante dentro de 1 doc; vista semana = 7 lecturas; contención mínima | Movimientos entre días tocan 2 docs (transacción) | **Recomendada** |
| E. Cloud Function como única vía de escritura | Lógica centralizada | Requiere plan Blaze y despliegue de funciones (hoy no hay ninguna desplegada); latencia | No necesaria; opcional para reservas |

## 4. Consultas e índices

| Pantalla | Consulta | Lecturas |
|---|---|---|
| Agenda PT, semana | `besoulAgendaDias` where `trainerKey==tk` and `fecha` between lunes–domingo | ≤ 7 |
| Agenda admin, día de todos | where `fecha==d` | ≤ nº entrenadores |
| Finanzas mes | where `mes==m` (admin) | ≈ entrenadores × días con actividad (hoy ≈ 300–400) |
| Fichas PT | `besoulClientes` where `trainerKey==tk` | nº fichas del PT (hoy ≈ 23 de media) |
| Histórico mes | `besoulHistoricoClientes` where `trainerKey==tk` and `mes==m` | nº clientes del PT |

Índices compuestos: `besoulAgendaDias (trainerKey ASC, fecha ASC)`, `besoulAgendaDias (trainerKey ASC, mes ASC)`,
`besoulHistoricoClientes (trainerKey ASC, mes ASC)`, `besoulClientes (trainerKey ASC, estado ASC)`.
**Exenciones de índice** (field overrides) para `sesiones`, `notas`, `ultimasOps`, `tarifa`, `contratoCliente`:
evita el límite de 40.000 entradas de índice por documento y reduce coste.

Listeners: solo sobre el rango visible (semana/día) y el conjunto de fichas del PT; se cancelan al cambiar de vista.
Dashboard: lecturas puntuales (`get`) por rango, no listeners sobre todo el histórico; meses cerrados desde
`besoulSuite/finanzas.historico` (ya existe — [HIPÓTESIS] verificar que cubre todos los KPIs).

## 5. Concurrencia, integridad e idempotencia

- **Crear/editar/cancelar sesión:** transacción sobre `besoulAgendaDias/{tk}_{fecha}`: leer, comprobar
  `opId ∉ ultimasOps` (si está: ya aplicada → éxito idempotente), comprobar solapes `[inicio, inicio+dur)` contra
  sesiones no canceladas, `bloqueoDia`, `slotsOcultos` y capacidad de grupo; escribir con `rev+1`.
- **Mover sesión entre días:** transacción sobre 2 documentos día (origen y destino).
- **Bloquear un día con sesiones:** la misma transacción ve las sesiones → regla de negocio explícita (rechazar o
  exigir confirmación listando las sesiones afectadas). Hoy no es atómico.
- **Aceptar reserva:** transacción sobre `besoulReservas/{id}` + día + (lectura) ficha: crea la sesión y marca
  `aceptada` **atómicamente** (elimina el estado intermedio actual).
- **Fichas:** transacción con comprobación de `rev`; conflicto **por campo** (si admin cambió `telefono` y PT cambió
  `nota`, ambos se aplican; solo el mismo campo genera conflicto).
- **Conversión de lead:** transacción lead + ficha nueva (id determinista `c_<leadId>`, evita duplicados) + día de la
  prueba (borra la prueba con `FieldValue.delete()` sobre su `sesionId`). Corrige el bug de `merge`.
- **Cola de salida persistente** (IndexedDB/localStorage) con `opId`: tras recarga o reconexión se reintenta sin
  duplicar. El indicador de guardado solo marca "Guardado" tras confirmar la transacción ([HOTFIX] se conserva).
- **Integridad referencial:** la sesión guarda `clientId`; un borrado de ficha con sesiones futuras se rechaza o
  exige cancelarlas; validador periódico (Informe 5) detecta huérfanos.

## 6. Reglas de seguridad (borrador, no desplegar)

```
function esMio(tk) { return isActiveUser() && tk == myTrainerKey(); }

match /besoulAgendaDias/{diaId} {
  allow read:   if isAdmin() || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
  allow create: if (isAdmin() || esMio(request.resource.data.trainerKey))
                && diaId == request.resource.data.trainerKey + '_' + request.resource.data.fecha
                && request.resource.data.rev == 1;
  allow update: if (isAdmin() || (esMio(resource.data.trainerKey)))
                && request.resource.data.trainerKey == resource.data.trainerKey
                && request.resource.data.fecha == resource.data.fecha
                && request.resource.data.rev == resource.data.rev + 1;     // control optimista en servidor
  allow delete: if isAdmin();
}
match /besoulClientes/{clientId} {
  allow read: if isAdmin() || (isActiveUser() && resource.data.trainerKey == myTrainerKey());
  allow create: if isAdmin() || esMio(request.resource.data.trainerKey);
  allow update: if (isAdmin() || (esMio(resource.data.trainerKey) && request.resource.data.trainerKey == resource.data.trainerKey))
                && request.resource.data.rev == resource.data.rev + 1;
  allow delete: if isAdmin();
}
match /besoulTrainers/{tk}           { allow read: if isAdmin() || esMio(tk); allow write: if isAdmin() || esMio(tk); }
match /besoulHistoricoClientes/{id}  { /* igual patrón por trainerKey */ }
match /besoulPublicSchedule/{tk}     { allow get: if true; allow write: if isAdmin() || esMio(tk); }   // endurecido
match /besoulSuite/{docId}           { /* tras migrar: agenda → read admin, write false (congelado) */ }
```

Efectos: un PT **ya no puede leer** datos de otros PT; una versión antigua de la app en caché **no puede escribir**
en el documento congelado; las escrituras sin `rev` correcto se rechazan aunque no usen transacción.
El cambio de entrenador de un cliente (traspaso) es solo de admin.

## 7. Dimensionamiento a 10 años

Datos medidos: 410 fichas (363 activas), 18 entrenadores, ~320 sesiones/mes, sesión 480 B, ficha 653 B.

| Escenario | Hipótesis | Clientes activos año 10 | Sesiones/mes año 10 | Sesiones acumuladas 10 años |
|---|---|---|---|---|
| E1 Medido | +50 altas/mes, bajas ~35 %/año ([HIPÓTESIS]: tasa de bajas no medida), ratio actual 0,9 sesiones/ficha activa/mes | ≈ 1.700 | ≈ 1.500 | ≈ 160.000 |
| E2 Sin bajas | +50/mes acumulativo, ratio 0,9 | ≈ 6.400 | ≈ 5.700 | ≈ 360.000 |
| E3 Estrés | E2 con 2 sesiones/semana por cliente activo (8,7/mes) y 60 entrenadores | ≈ 6.400 | ≈ 55.000 | ≈ 3.500.000 |

| Magnitud | E1 | E2 | E3 | Límite Firestore |
|---|---|---|---|---|
| Doc entrenador-día (máx.) | ~6 KB | ~10 KB | ≤ ~60 KB (96 huecos de 15 min; grupos abiertos con asistentes) | 1 MiB ✅ |
| Doc ficha | ~1 KB | ~1 KB | ~2 KB | 1 MiB ✅ |
| Nº docs día (10 años) | ~40.000 | ~60.000 | ~200.000 | sin límite ✅ |
| Almacenamiento total | < 0,5 GB | < 1 GB | ~3–5 GB | coste ≈ 0,18 USD/GB-mes |
| Escrituras/s por doc | ≪ 1 | ≪ 1 | ≪ 1 (un PT no hace >1 cambio/s en su día) | 1/s sostenido ✅ |

El tamaño del documento crítico depende de **cuántos huecos tiene un día**, no de cuántos clientes tiene Besoul.
Por eso el diseño no necesita limpiezas periódicas.

**Costes** ([HIPÓTESIS] tarifas aproximadas; plan actual no confirmado): hoy cada guardado provoca ~800 KB de
descarga por dispositivo conectado; con el nuevo modelo, ~5 KB. Lecturas en E2 estimadas: PT ≈ 7–30 lecturas por
apertura de semana; finanzas ≈ 400–600 por mes consultado. Previsión E2: < 1,5 M lecturas/mes → del orden de
1 USD/mes en plan de pago; podría superar la cuota gratuita diaria (50.000 lecturas) si el dashboard recalcula años
completos con frecuencia → por eso meses cerrados se leen de los resúmenes de finanzas.

## 8. Por qué es sostenible con 50 altas/mes durante 10 años

- Cada alta añade **un documento** de ~1 KB; ninguna estructura compartida crece.
- Cada sesión vive en el documento de **su día**; los días pasados dejan de escribirse y no se descargan salvo consulta.
- Coste por cambio y por apertura de pantalla **constante** (no crece con la historia).
- Aislamiento, solapes y conflictos se garantizan por **documento + transacción + reglas**, no por heurísticas.
