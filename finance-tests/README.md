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
node finance-tests/centros_extract.js && node finance-tests/run_centros_tests.cjs
node finance-tests/finanzas_ux_extract.js && node finance-tests/run_finanzas_ux_tests.cjs
node finance-tests/extract_reparto.js && node finance-tests/run_reparto_actividad_tests.cjs
node finance-tests/extract_cierre.js && node finance-tests/run_cierre_tests.cjs
```

## FINANZAS-UX-V2 (`finanzas_ux_extract.js` / `run_finanzas_ux_tests.cjs`)

Extrae de `finanzas.html` el selector dinámico de centro (`renderSelectorCentrosFinanzas`,
`renderComparativaCentrosFinanzas`, `renderCentrosResumen`) y el panel de avisos de carrera
colapsable (`avisosCarreraColapsado`/`ocultarAvisoCarrera`/etc.). 25 casos: "Todos" siempre
presente y generado dinámicamente (nunca una lista de centros hardcodeada), un centro sin
`economiaConfigurada` marca ⚠ en su pill y "Pendiente" en la comparativa sin inventar una cifra,
seleccionar un centro concreto pinta SOLO su detalle completo (nunca los demás), un id de centro
obsoleto cae de vuelta a "Todos", y el colapso/ocultar del panel de avisos vive en
`localStorage` (nunca en Firestore, nunca cambia qué avisos existen). `renderAlertasCarrera()`
en sí (lógica de rangos por antigüedad de cada PT) no se re-verifica aquí porque no cambió en
FINANZAS-UX-V2 -- solo su presentación pasó de string a `{id, atencion, texto}`.

## Reparto de actividades especiales (`extract_reparto.js` / `run_reparto_actividad_tests.cjs`)

12 casos que reproducen, contra el motor real, el ejemplo pedido explícitamente durante
QA-BESOUL-MEGA-V3-CONT: Verónica / Alfa Prime / Pilates Máquina, plan general de 8 sesiones (95€
en el catálogo real `DEFAULT_CATALOGO_ACTIVIDADES`) con reparto 50/35/15 -> 47,50 € PT / 33,25 €
centro / 14,25 € BESOUL, verificando explícitamente que el share de BESOUL nunca resulta de
restarle el share del centro al total (la resta duplicada que se pidió descartar). También cubre
`distribuirReparto()` (método del mayor resto: la suma de las partes nunca se desvía del importe
original aunque el porcentaje no divida en céntimos exactos) y confirma que Ciclo Indoor conserva
su propio reparto sin heredar nada de Pilates. No existía ningún test de este reparto antes de
esta fase.

## Cierre de meses (`extract_cierre.js` / `run_cierre_tests.cjs`)

14 casos para "closed months immutable": un mes con `dbFinanzas.historico[key]` bloquea
`agregarGasto`/`editarGasto`/`borrarGasto`/`agregarOtroIngreso` (ninguna mutación se aplica, cero
guardados disparados, el usuario recibe el aviso de mes bloqueado) salvo que el mes se reabra
explícitamente (`mesCerradoEditando === key`), en cuyo caso las mutaciones sí aplican y reabrir un
mes no reabre ningún otro. No existía ningún test de este guardián antes de esta fase.
