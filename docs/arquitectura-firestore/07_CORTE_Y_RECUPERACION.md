# Informe 7 — Corte de producción y recuperación (procedimiento ejecutable)

Rama: `ARQ-V1-MIGRACION-IMPL`. Contingencia: `CONTINGENCIA-V1-2026-10-13`. Nada de esto está
desplegado. Cada paso que toca producción requiere autorización expresa.

## 0. Identidad del proyecto (verificado en solo lectura, 2026-10-13)

| Comprobación | Resultado |
|---|---|
| Proyecto Firebase | `besoul-suite` (plan Spark), 1 app web `1:215142605598:web:943629a7a9c50c034a1f0f` |
| Web publicada `app.besoulfitness.com` (GitHub Pages, repo `franjmorenomartin-coder/besoul-suite`, rama `main`) | usa exactamente `projectId: "besoul-suite"` y esa `appId` |
| Repositorio V1 (`besoul-v1-crm`) | `.firebaserc` → `besoul-suite`; misma configuración |
| Miembros del proyecto | único miembro: `fran.jmorenomartin@gmail.com` (Propietario) |
| CLI de este equipo | sesión `anhiparkbolas@gmail.com`: solo ve `anhipark-92a84` (AnhiPark). **No usar.** |
| **V2** (`besoul-suite`, rama `DATA-ARCHITECTURE-V2`) | MISMO repositorio de GitHub y MISMO proyecto Firebase; no publicado en Pages; pero el 18-sep se desplegaron reglas V1+V2 y el 2-oct la versión vigente |
| Reglas desplegadas (2-oct, 500 líneas) | = `main` de V1 (13fc1b0) **+ 132 líneas de V2** (cabecera + bloque aditivo). Reconstruidas exactamente (SHA-256 idéntico) en `scripts/corte/firestore.rules.PRODUCCION-2026-10-02.reconstruido` |
| Índices desplegados | 0 compuestos; 22 exenciones (11 V1 + 11 V2) |

Consecuencia: `firestore.rules` y `firestore.indexes.json` de esta rama **conservan literalmente** el bloque
y las exenciones de V2. Diferencias con producción (verificadas): cambian solo `besoulSuite`
(congelado) y `besoulPublicSchedule` (solo el propio entrenador); se añaden 7 colecciones; todos los
demás bloques —incluidos los 7 de V2— son idénticos byte a byte.

## 1. Fallo intermitente del migrador — causa demostrada y corrección

- **Síntoma:** en el emulador, a veces la primera ficha del primer lote se rechazaba con
  `evaluation error at L193:24` (4/10 ejecuciones superadas).
- **Diagnóstico** (sin alterar la temporización, desde el propio migrador): sesión válida, email del token
  correcto, perfil `rol: admin, activo: true` en el servidor, y las lecturas que exigen `isAdmin()`
  funcionaban en el mismo instante. Ese mensaje coincide con el de "perfil inexistente o inactivo";
  una sesión cerrada da `false`, no un error de evaluación.
- **Aislamiento:** desde Dashboard 6/6; desde el CRM sin su sincronización del registro de valoraciones 6/6.
- **Causa:** `sincronizarRegistroValoraciones()` del CRM lanza al abrir un lote que las reglas rechazan
  SIEMPRE (crear `besoulValoracionRegistry` solo está permitido sin sesión). Reproducido sin navegador:
  tras ese rechazo, la siguiente escritura del mismo cliente falla con exactamente ese error; 2 s después,
  funciona. En producción esa sincronización **nunca ha escrito nada** (los 4 registros existentes son
  del formulario público) y solo generaba rechazos.
- **Corrección:** sincronización automática desactivada (`BS_SINCRONIZAR_REGISTRO_VALORACIONES = false`).
  Defensas adicionales del migrador: comprobación de sesión por lote, reintento del lote atómico y
  diagnóstico de sesión/perfil si algo se rechaza.
- **Resultado:** 10/10 ejecuciones completas desde el CRM tras la corrección (antes 4/10); 6/6 desde
  Dashboard.
- **Procedimiento:** el migrador se ejecuta desde **Dashboard** (sin escrituras en segundo plano).

## 2. Contingencia: el histórico completo SIEMPRE accesible

- Los datos anteriores a la fecha `desde` **no se mueven ni se modifican**: permanecen en la estructura
  nueva (verificado tras contingencia y vuelta con el respaldo real: 487 sesiones anteriores idénticas,
  histórico mensual idéntico, 427 fichas).
- Durante la contingencia:
  - la app anterior opera sobre `besoulSuite/agendaContingencia`, con todas las fichas, la disponibilidad,
    el histórico mensual, las notas y las actividades, y las sesiones desde `desde`;
  - **`/consulta/`** publica la app nueva en **solo lectura** con TODO el histórico (Agenda, Dashboard,
    Finanzas), protegida por la app y por las reglas de contingencia (19/19 en la prueba E2E).
- **Tamaño** (respaldo real): `desde` = día 1 del mes → **717.444 B** (margen 331 KB ≈ 6 semanas a
  ~246 KB/mes medidos). Con todo el histórico serían 938.761 B, unos 13 días: por eso el histórico se
  consulta en `/consulta/` y no dentro del documento de contingencia.
- **El documento original `besoulSuite/agenda` nunca se modifica** (huella comprobada en cada prueba).

## 3. Comprobaciones previas (antes de pedir la autorización del corte)

1. Pruebas en verde con el código EXACTO a publicar (sección 7).
2. Respaldo verificado del día (`scripts/corte/respaldo-navegador.js`) y copia fuera del equipo.
3. Autenticar la cuenta correcta en la CLI (sección 6) y comprobar `firebase projects:list` → `besoul-suite`.
4. Aviso a los entrenadores: ventana, no usar la app y recargar al terminar.
5. Rama de publicación preparada (`ARQ-V1-MIGRACION-IMPL` fusionada sobre `main` vigente, sin subir).

## 4. Procedimiento de corte (orden que impide escrituras perdidas y versiones incompatibles)

| # | Acción | Verificación | Detener si |
|---|---|---|---|
| 1 | **Mantenimiento efectivo:** `firebase deploy --only firestore:rules --project besoul-suite --account fran.jmorenomartin@gmail.com`. Desde aquí ninguna versión antigua escribe en `besoulSuite/agenda` y V2 queda intacto | En la consola, Reglas: nueva versión publicada; diff igual al de la sección 0 | Error de despliegue |
| 2 | `firebase deploy --only firestore:indexes --project besoul-suite --account fran.jmorenomartin@gmail.com` (responder **No** si pregunta por borrar algo) | `verificarReglasEIndicesBesoul()` desde Dashboard → `todoListo: true` (solo lecturas) | Índice "FALTA O EN CREACIÓN" tras 15 min |
| 3 | Respaldo final del estado congelado: `respaldoBesoul()` + `sha256sum` | Hash coincide; `agendaUpdateTime` anotado | Hash distinto |
| 4 | Migración desde **Dashboard** (admin): pegar `besoul-datos.js` y `scripts/migrar-agenda-documentos.js`; `await migrarAgendaBesoul()` y luego `await migrarAgendaBesoul({ ejecutar: true })` | `idaYVueltaExacta`, `verificacionServidor: 'IDÉNTICO'`, `originalIntacto: true`, recuentos iguales | Cualquier diferencia o rechazo. Se puede reanudar: lo migrado se reconoce |
| 5 | Publicar la app nueva: push de la rama de publicación a `main` | La web sirve `agenda-arq-documentos-2026-10-13` y SW v13 | Build distinto tras 10 min |
| 6 | Prueba real (sección 8) con un admin y un PT autorizados, en ordenador y móvil | Todo según la sección 8 | Cualquier `permission-denied`, dato ausente o guardado sin confirmar |
| 7 | Reabrir: avisar a los entrenadores para recargar | — | — |

Por qué el orden es seguro: (1) congela el documento antiguo ANTES de leerlo para migrar, así nada
escrito después se pierde (se rechaza con aviso); (4) migra un estado congelado y lo verifica; (5) la
app nueva solo se publica cuando sus datos ya existen; una pestaña antigua abierta no puede escribir
(reglas) y al recargar recibe la versión nueva (SW de red primero).

**Mantenimiento estimado:** 25–35 min (reservar 60).

## 5. Recuperación

| Momento del fallo | Acción | Pérdida |
|---|---|---|
| Pasos 1–4 (sin publicar) | Volver a desplegar `scripts/corte/firestore.rules.PRODUCCION-2026-10-02.reconstruido` (las reglas exactas actuales, con V2). La app actual sigue funcionando con el original intacto | Ninguna (no hubo escrituras en ningún sitio) |
| Interrupción de la migración | Repetir el paso 4: reconoce lo migrado y completa (probado: cortada en 300/876 → IDÉNTICO) | Ninguna |
| Interrupción de la publicación | Repetir el push; mientras, la app antigua no puede escribir (aviso) | Ninguna |
| Tras publicar | **Corrección sobre la marcha** (preferente). Si no es posible → **contingencia**: (a) desplegar `scripts/corte/firestore.contingencia.rules`; (b) `prepararContingenciaBesoul({ desde: 'AAAA-MM-01' })`, primero en simulación; (c) generar `consulta/` con `node scripts/corte/generar-consulta.cjs <worktree contingencia>` y publicar `CONTINGENCIA-V1-2026-10-13` | Ninguna (probado: X y Y conservados) |
| Vuelta desde contingencia | Desplegar `firestore.rules` definitivas, `reincorporarContingenciaBesoul()` (simulación) → `({ ejecutar: true })`, publicar la app nueva | Ninguna (probado con interrupción a mitad: 56/156 → IDÉNTICO A LA CONTINGENCIA) |

## 6. Autenticación (la ejecuta el responsable; aquí no se despliega nada)

```
! firebase login:add fran.jmorenomartin@gmail.com
! firebase projects:list --account fran.jmorenomartin@gmail.com
```
El segundo comando debe listar `besoul-suite`. Todos los comandos de despliegue llevan
`--project besoul-suite --account fran.jmorenomartin@gmail.com` (nunca el proyecto por defecto ni la
cuenta de AnhiPark).

## 7. Pruebas con el código exacto a publicar
Emulador (reglas reales con V2 incluido) 91/91 · E2E páginas reales 23/23 · migrador 10/10 repetido ·
interrupciones con datos reales 14/14 · contingencia con consulta 19/19 · baterías del repositorio en verde
(concurrencia 58/58, CRM 111/111, disponibilidad 52/52, portal 20/20, huecos 42/42, índices 31/31…).

## 8. Prueba real tras el corte (admin + 1 PT autorizado)
1. Admin abre Agenda: todos los entrenadores; recuentos = respaldo.
2. PT abre Agenda: solo lo suyo; ninguna ficha ajena en memoria.
3. PT crea una sesión de prueba en una agenda/cliente de prueba acordado → "Guardado en el servidor";
   la ve el admin en tiempo real; el PT la borra (lápida) → desaparece en ambos.
4. Admin edita un campo de esa ficha de prueba → confirmado; las demás sesiones de la semana intactas.
5. Dashboard y Finanzas cargan; CRM abre sin errores.
6. iPhone Safari y Android: abrir y guardar (pasos 2–3).
7. Consola: sin errores `permission-denied`; uso de Firestore razonable.
