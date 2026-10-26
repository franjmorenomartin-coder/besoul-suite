# resumen-economico-tests/

Pruebas de IGOR-RESUMEN-ECONOMICO, fase A (Agenda). Ejecutan el script real de `agenda.html` sobre un
DOM simulado. Datos sintéticos: no contienen datos reales.

```bash
node resumen-economico-tests/run_tests.cjs
```

Comprueban que, con `besoulUsers.ocultarResumenEconomico === true`, la Agenda del PT no pinta ni calcula
totales económicos (KPIs de rentabilidad, facturación prevista, valor de agenda, desviación,
rentabilidad de grupo abierto), que los precios individuales siguen visibles, que otro PT y el admin
(también en «ver como») no cambian, y que sin perfil el resumen se oculta (fallo cerrado).
