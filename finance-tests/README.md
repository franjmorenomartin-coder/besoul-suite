# Finance Tests — motor económico de grupos + Bono 8 (FIN-GRUPO-02, PLAN-01)

Pruebas reales del código REAL de `agenda.html`, extraído por nombre con `extract.js`
(conteo de llaves balanceado, mismo patrón que `assistant-tests/`) -- nunca una reimplementación
paralela del motor de facturación.

## Qué contiene

- `extract.js` — extrae `TARIFAS_2026`, `tarifaBaseFicha`, `multiplicadorFacturacionFicha`,
  `obtenerDescuentoFicha`, `aplicarDescuentoImporte`, `esGrupoAbierto`, `esFichaMiembroGrupo`,
  `importeEfectivoCliente`, `fichasMiembrosGrupo`, `calcularFacturacionGrupoTotal`,
  `calcularFacturacionEstadisticaMiembro`, `calcularFacturacionFicha`, `sesionesContratadasFicha`,
  `buscarFichaPorId` de `agenda.html`.
- `finance_extract.js` — generado, no editar a mano.
- `run_tests.cjs` — 18 casos: los 7 casos de economía de grupo pedidos en la auditoría
  (CASO 1/2/3/6/7 con importes exactos del enunciado, incluido el ejemplo literal 54+60+48=162≠180),
  más la igualdad de precio total Bono 8 = Bono 10 por modalidad, número de sesiones (8≠10), y
  Bono 8 + Grupo reducido + descuento individual combinados.

## Por qué no hay más casos de temporalidad/cierre aquí

CASO 4 (descuento desde septiembre, agosto intacto) y CASO 5 (mes cerrado, no recalcular) no se
prueban en este harness porque **no son responsabilidad de esta fórmula**: ese comportamiento ya
lo garantiza el sistema de cierres existente en `finanzas.html` (`crearSnapshotCierre`,
`dbFinanzas.historico[mesKey]`) -- un mes cerrado es un JSON materializado en el momento del
cierre, nunca vuelve a ejecutar `calcularFacturacionFichaSimple`. Verificado leyendo ese código,
no modificado en esta fase. Probarlo de verdad requeriría un harness aparte que reproduzca el
propio motor de cierres de `finanzas.html`, fuera del alcance de esta fórmula concreta.

## Cómo ejecutar

```bash
node finance-tests/extract.js && node finance-tests/run_tests.cjs
```
