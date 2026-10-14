# Informe 8 — Operación tras el corte: respaldo, reapertura y supervisión (7 días)

Estado a 2026-10-14. Producción con la arquitectura de documentos desde el 13-oct (build
`agenda-arq-documentos-2026-10-13b`, SW v14). Plan Spark. V2 e importador Excel sin cambios.

## 1. Respaldo diario (solo lecturas)

El script `scripts/corte/respaldo-navegador.js` está publicado en la web, pero **no** se carga solo en el
Dashboard: se carga desde la consola del navegador.

1. Abrir `https://app.besoulfitness.com/dashboard.html` e iniciar sesión como **administrador**.
2. Abrir la consola (F12 → Consola) y pegar:
   ```js
   await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/scripts/corte/respaldo-navegador.js?v=' + Date.now(); s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
   await respaldoBesoul();
   ```
3. Se descarga `besoul-respaldo-<fecha>.json` (~3,3 MB) y la consola muestra `[RESPALDO]` con `sha256`,
   `bytes`, `errores` y `estructuraNueva`.

Comprobar en el resultado:
- `errores: []`
- `estructuraNueva`: las 7 colecciones con número (no `{error}`). Referencia 14-oct: semanas 157,
  clientes 427, trainers 21, histórico 269, notas 1, config 1, legado 1.
- `publicClients` ≈ 217, `publicSchedule` ≈ 21.
- `sesiones`/`fichas` del resultado son las del **documento antiguo congelado** (1078/427) y no deben
  cambiar nunca. Los datos vivos están en `estructuraNueva`.

Coste: ~1.700 lecturas por respaldo.

### Integridad del archivo
En PowerShell, en la carpeta de descargas:
```powershell
Get-FileHash .\besoul-respaldo-<fecha>.json -Algorithm SHA256
(Get-Item .\besoul-respaldo-<fecha>.json).Length
```
El hash (en minúsculas) y el tamaño deben coincidir con `sha256` y `bytes` de la consola. Si no coinciden,
borrar el archivo y repetir.

### Dónde guardarlo
- Copia 1: `C:\Users\Usuario\Documents\BESOUL-respaldos` (junto a los anteriores).
- Copia 2: **fuera del equipo**: memoria USB cifrada (BitLocker To Go) o almacenamiento en la nube
  personal con acceso restringido y verificación en dos pasos. Contiene datos personales de clientes:
  nunca en el repositorio, ni por correo, ni en carpetas compartidas.
- Conservar al menos los 7 últimos diarios y el del 13-oct (`2a048f71…`, previo al corte).

## 2. Reapertura controlada

1. Respaldo del día descargado, verificado y con copia 2.
2. Avisar a **un** entrenador: recargar la página (o cerrar y abrir la app) e iniciar sesión.
3. Hace **una operación real** (crear, mover o editar una sesión) y espera el aviso verde
   «Guardado en el servidor». Recarga y comprueba que sigue.
4. Datos mínimos que debe comunicar (sin datos del cliente):
   - email o nombre del entrenador;
   - tipo de operación y **día y hora de la sesión** afectada (y la anterior si la movió);
   - hora aproximada del guardado;
   - si vio «Guardado en el servidor» y si el cambio seguía tras recargar;
   - si ve solo sus clientes;
   - dispositivo (ordenador / iPhone / Android).
5. Verificación técnica (solo lecturas): documentos con `actualizadoEn` posterior a la reapertura y
   `actualizadoPor` = ese entrenador; solo cambia el documento de esa semana (y su ficha si se editó);
   el resto de sesiones de ese documento, idénticas al respaldo del día; `besoulSuite/agenda` sigue con
   `updateTime` 2026-10-13T11:40:44Z; el administrador ve el cambio.
6. Si todo es correcto → avisar al resto de entrenadores.

## 3. Supervisión — próximos 7 días (≈5 min/día)

Referencia real (consola, 24 h del 13→14-oct, incluye la migración y las comprobaciones): 8,5 K lecturas,
923 escrituras (876 de la migración), 11 rechazos de reglas, 0 errores de reglas, máx. 36 listeners.

| Qué | Dónde | Normal | Alerta |
|---|---|---|---|
| Lecturas/día | Firebase → Firestore → Uso | 3.000–10.000 | > 25.000 (50 % de Spark) o un pico sostenido por hora > 3.000 |
| Escrituras/día | idem | 100–1.000 | > 5.000 (25 % de Spark): posible bucle de guardado |
| Rechazos de reglas | idem, «Métricas de las reglas» | < 50/día (el listener de cancelaciones da ~1 por apertura) | > 200/día o crecimiento continuo |
| Errores de reglas | idem | 0 | cualquiera |
| Listeners | idem | proporcional a pestañas abiertas | creciendo sin parar con pocos usuarios |
| Aviso de la Agenda | Agenda abierta como admin | sin aviso / verde | rojo «Sin conexión» > 1 min con internet; «Cambios SIN GUARDAR» |
| Avisos de entrenadores | — | — | «No se ha guardado», sesión que desaparece, ficha ajena visible, aviso de conflicto repetido |
| Documento antiguo | `besoulSuite/agenda` | sin cambios | cualquier escritura (no debería ser posible) |
| Respaldo | §1 | diario, `errores: []` | errores o recuentos que bajan sin motivo |

### Ante una incidencia
1. Anotar hora, usuario, operación y texto exacto del aviso; captura si es posible.
2. Hacer un respaldo (§1) **antes** de cualquier corrección.
3. Si un entrenador pierde un cambio: pedirle que no cierre la pestaña (el cambio se conserva y se
   reintenta) y que pulse «Reintentar».
4. Si hay un bucle de escrituras o lecturas: pedir a todos que cierren la app y avisar.
5. Fallo grave sin corrección rápida: modo contingencia (`07_CORTE_Y_RECUPERACION.md` §5). **Nunca**
   restaurar ni reescribir `besoulSuite/agenda`, ni desplegar reglas sin `verificar-v2-intacto.cjs`.

## 4. Propuesta (pendiente de aprobación): prueba de restauración en entorno aislado

Objetivo: demostrar que un respaldo nuevo permite reconstruir la estructura y que la app funciona con
ello, **sin tocar producción**.

- **Entorno:** Firebase Emulator (proyecto ficticio `demo-besoul-restauracion`, sin credenciales reales),
  con las `firestore.rules` del repositorio. El emulador escucha solo en 127.0.0.1; el respaldo se lee
  del disco local y no sale del equipo.
- **Herramienta nueva (solo para el emulador):** `scripts/corte/restaurar-en-emulador.cjs <respaldo.json>`.
  Se negará a ejecutarse si el proyecto no empieza por `demo-` o si el host no es el emulador.
  1. Carga `estructuraNueva` (7 colecciones), `besoulUsers`, `besoulLeads`, `besoulReservas`,
     `besoulPublicClients`, `besoulPublicSchedule` y `besoulSuite/finanzas` con permisos de
     propietario del emulador, convirtiendo `{__ts}` a Timestamp y conservando `rev`.
  2. Verifica: recuentos por colección = respaldo; huella SHA-256 canónica por documento = respaldo;
     `legadoDesdeDocs` reconstruye las mismas sesiones, fichas e histórico.
- **Prueba funcional:** abrir Agenda, Dashboard, Finanzas y portal contra el emulador con usuarios
  ficticios (admin y un PT) y repetir E1–E22 de `arq_e2e.cjs` sobre los datos restaurados: lectura,
  guardado con `rev`, aislamiento PT, persistencia tras recargar.
- **Casos de recuperación a ensayar:** (a) restauración completa; (b) restauración selectiva de un solo
  documento de semana o ficha (la vía realista); (c) un respaldo con una colección con `error`: debe
  detenerse sin cargar nada.
- **Restauración real (solo si algún día hiciera falta):** sería selectiva, documento a documento,
  respetando la regla `rev == anterior + 1`, con simulación previa y autorización expresa. No se
  prepara para producción hasta que la prueba aislada esté aprobada.
- **Esfuerzo:** 1 jornada. Riesgo para producción: nulo (no usa la cuenta ni el proyecto reales).
