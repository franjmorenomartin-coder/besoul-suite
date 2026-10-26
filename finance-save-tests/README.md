# finance-save-tests/

Pruebas de FIX-FINANZAS-GUARDADO-SEGURO (ver `docs/FINANZAS_GUARDADO_SEGURO.md`). Usan el emulador
de Firestore, las reglas reales de `firestore.rules` y `@firebase/rules-unit-testing` de
`rules-tests/node_modules`. Datos sintéticos: no contienen datos reales.

```bash
firebase emulators:exec --only firestore --project demo-besoul-finanzas "node finance-save-tests/run_guardado_seguro.cjs"
firebase emulators:exec --only firestore --project demo-besoul-restauracion "node finance-save-tests/run_restauracion_selectiva.cjs"
```

- `run_guardado_seguro.cjs`: ejecuta el script real de `finanzas.html` sobre un DOM simulado.
  Reproduce el incidente del 10-10 (guardar antes de cargar) y comprueba que ya no escribe; carga,
  error y documento inexistente; gastos (añadir, modificar, eliminar, copiar fijos), otros ingresos;
  concurrencia entre pestañas y dentro de la pestaña; bloqueo de vaciado y borrado masivo en cliente
  y reglas; marca de versión (`guardadoSeguroEn`): versiones antiguas sin permiso de escritura;
  operaciones legítimas por la interfaz real (gastos, ingresos, entrenadores, centros, cierres).
- `run_restauracion_selectiva.cjs`: `scripts/restaurar-finanzas-selectivo.js` con las reglas nuevas y
  con las anteriores: simulación sin escrituras, confirmación, huella, conflictos, auditoría y reversión
  (solo de lo sobrescrito: nunca vuelve a vaciar configuraciones).
