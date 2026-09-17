# Logout Cache Tests — HARDENING-PRE-BASELINE-v3.2.1

`besoulSuite/agenda` es un documento monolítico: cualquier sesión de `agenda.html` carga en
memoria, y cachea offline en `localStorage`, los datos completos de **todos** los entrenadores
(clientes, agenda, credenciales, disponibilidad, histórico, leads/pruebas CRM, notas) — nunca solo
los del usuario que ha iniciado sesión. Ver `AGENDA_MONOLITHIC_RISK.md`.

Antes de esta fase, `logout()` no limpiaba ninguna de esas claves: el caché multi-PT sobrevivía
indefinidamente en el dispositivo tras cerrar sesión.

`limpiarCacheSensibleBesoul()` (agenda.html) borra selectivamente, nunca con
`localStorage.clear()` a ciegas:

- **Por nombre exacto** (`BS_CLAVES_SENSIBLES_EXACTAS`): las 8 claves `bs_db_*` que contienen el
  estado operativo completo.
- **Por prefijo** (`BS_PREFIJOS_SENSIBLES`): `bs_backup_semana_<trainerKey>_<semana>` — una clave
  por cada combinación de entrenador/semana visitada, cantidad variable.

Se conserva a propósito `bs_modo_agenda_slots_v1` (preferencia de UI, sin PII).

## Ejecutar

```
node extract.js && node run_tests.cjs
```
