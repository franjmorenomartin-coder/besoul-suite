# Besoul V1 — Reingeniería de Firestore · Resumen ejecutivo

Fecha: 2026-10-13 · Rama: `ARQ-V1-FIRESTORE-ESCALABLE` (solo documentación; nada implementado ni desplegado).
Producción auditada: `agenda-sync-p0-2026-10-09` (commit `f3720f4`). Toda consulta a producción fue de **solo lectura**.

## En una frase

Toda la información viva de Besoul (clientes, sesiones, disponibilidad, histórico, notas de **todos** los
entrenadores) está guardada en **una sola "hoja"** de Firestore que tiene un tamaño máximo de 1 MiB. El hotfix
del 9 de octubre evita que unos usuarios pisen los cambios de otros, pero **la hoja se vuelve a llenar en unas
4–5 semanas** (hacia mediados de noviembre de 2026). Cuando se llene, **nadie podrá guardar nada**.

## Qué pasa hoy (explicado sin tecnicismos)

| Problema | ¿Está resuelto? |
|---|---|
| Cambios de un usuario que borraban los de otro | **Sí, en lo esencial** (hotfix 9-oct): ahora se fusionan o se avisa del conflicto. |
| "Guardado" que en realidad no se guardaba | **Sí** (hotfix): solo se confirma cuando el servidor responde. |
| La hoja única se llena | **No.** Ganamos espacio una vez (compactación); no se puede repetir. Crece ~230 KB/mes. |
| Un entrenador puede descargar los datos de clientes de los demás | **No.** Es inherente a tener una sola hoja. |
| Cada guardado hace descargar la hoja entera (~800 KB) a todos los dispositivos conectados | **No.** Explica lentitud en móviles y consumo de datos. |
| Las sesiones guardan una copia de la ficha del cliente del día en que se crearon | **No.** Agenda y Finanzas pueden calcular importes con datos distintos. |

## Qué proponemos

Pasar de "una hoja para todo" a **un archivador con fichas separadas**:

- **Una hoja por entrenador y día** con sus sesiones, bloqueos y notas. Un día tiene un número limitado de
  huecos, así que esa hoja **nunca puede crecer sin límite**, aunque Besoul tenga 10 veces más clientes.
- **Una hoja por cliente.**
- **Una hoja por entrenador** con su configuración y horario semanal.
- **Una hoja por cliente y mes** para el histórico.

Ventajas: no vuelve a existir un límite de tamaño global; dos entrenadores nunca compiten por la misma hoja;
dos reservas al mismo hueco se resuelven de forma segura (solo una gana); cada entrenador solo puede leer lo suyo;
y cada cambio mueve kilobytes, no casi un megabyte.

## Qué decisión necesitamos de ti

1. **Medida puente (recomendada, ~2 semanas de trabajo, antes de mediados de noviembre):** trasladar los **meses ya cerrados** (junio–septiembre) a la nueva
   estructura definitiva, en modo solo lectura. Libera espacio suficiente para trabajar sin prisa en la
   migración completa y es, además, el primer paso de esa migración (no es trabajo desechable).
2. **Migración completa (~2 semanas adicionales; ~4 en total):** pasar clientes, agenda viva, disponibilidad y CRM a la
   nueva estructura con una **ventana de mantenimiento controlada** (sin doble escritura), con respaldo
   verificado y plan de recuperación.
3. **Dos decisiones de negocio:** (a) si una sesión debe **congelar el precio** del día en que se creó o usar
   siempre la tarifa actual de la ficha; (b) si las sesiones de **meses cerrados** pueden seguir editándose.

Nada de esto se ejecutará sin tu autorización expresa.

## Documentos

1. [Informe 1 — Diagnóstico](01_DIAGNOSTICO.md)
2. [Informe 2 — Inventario y trazabilidad](02_INVENTARIO.md)
3. [Informe 3 — Arquitectura](03_ARQUITECTURA.md)
4. [Informe 4 — Migración](04_MIGRACION.md)
5. [Informe 5 — Hoja de ruta, pruebas y monitorización](05_HOJA_DE_RUTA.md)

Convenciones usadas en todos los informes:
**[HECHO]** verificado en código o en datos reales · **[RIESGO]** técnicamente fundamentado, no observado ·
**[HIPÓTESIS]** pendiente de verificar · **[HOTFIX]** ya corregido por `agenda-sync-p0-2026-10-09`.
