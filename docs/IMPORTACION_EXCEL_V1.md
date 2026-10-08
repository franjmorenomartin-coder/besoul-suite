# Importación Excel de clientes y agenda (V1)

Rama: `IMPORT-V1-EXCEL-CLIENTES-AGENDA`. Sirve para la carga inicial de la cartera de un entrenador
(y para cargas ocasionales). Las altas habituales se siguen haciendo a mano en la ficha.

## Uso

Agenda → panel de clientes → **Importar Excel** (visible para admin y PT). Un PT solo puede importar
en su propia agenda y un admin en la agenda que tenga seleccionada, siempre con la plantilla de esa agenda.

1. **Descargar plantilla oficial**. Es un `.xlsx` real generado en el momento con los catálogos
   vigentes de Besoul: entrenadores, modalidades del formulario de ficha, frecuencias permitidas,
   tarifas `TARIFAS_2026`, estados, tipos de grupo y grupos existentes. "Ejemplo ficticio"
   descarga la misma plantilla rellena con datos inventados.
2. Elegir el **periodo** de sesiones (por defecto, el mes en curso; máximo 6 meses).
3. **Subir el Excel**. Besoul lo valida entero y muestra una **vista previa**: clientes nuevos,
   existentes y posibles duplicados, cálculo de tarifa y descuento, grupos, sesiones a crear,
   conflictos, errores y advertencias.
4. Resolver lo pendiente (duplicados dudosos, precio por encima de la tarifa, ampliación de un grupo
   existente), marcar "He revisado las advertencias" y **Confirmar importación**.

## Hojas de la plantilla

| Hoja | Contenido |
|---|---|
| INSTRUCCIONES | Cómo rellenarla, con ejemplos |
| CLIENTES | Una fila por cliente. Solo se escribe el **precio real**; tarifa oficial, descuento, diferencia y "Revisión" son fórmulas protegidas |
| HORARIOS_FIJOS | Una fila por día fijo de un cliente **o** de un grupo; se repite cada semana del periodo |
| SESIONES_VARIABLES | Sesiones puntuales por fecha; la nota se guarda como nota de Agenda |
| GRUPOS | Grupos cerrados (integrantes fijos, cada uno con su precio) y abiertos (capacidad). Los existentes vienen precargados y bloqueados |
| CATALOGOS | Catálogos y tabla de tarifas, protegida |

En Excel, los desplegables tienen mensaje de error y las columnas `[auto]` y los catálogos están
protegidos. **El importador repite todas las validaciones** y nunca usa los valores calculados del
Excel: si alguien altera o borra una fórmula, recibe un aviso y Besoul recalcula con su propia lógica.

## Reglas que respeta (verificadas contra el código real)

- **Tarifa y descuento**. Tarifa = `tarifaBaseFicha` × `multiplicadorFacturacionFicha` (Pareja ×2,
  Trío ×3). Descuento = `(1 − precio/tarifa)·100`, sin redondear, de modo que Besoul factura
  exactamente el precio pactado (ver "Precio pactado exacto"). Un precio superior a la tarifa (Besoul no admite recargos) exige confirmación y se importa con
  descuento 0 %.
- **Integrante de grupo cerrado**. Su descuento propio se calcula sobre la tarifa por persona del
  grupo. Las fichas se crean con la misma `sincronizarIntegrantesGrupo()` del formulario. El grupo
  se agenda **una vez** por franja, nunca por integrante.
- **Grupo abierto**. Su sesión es `grupo_abierto` con capacidad. Los asistentes son clientes
  individuales con su propio plan, y superar la capacidad es un error.
- **Duración**. La sesión dura **45 min** (3 tramos de 15). Un bloque declarado de 10:00 a 11:00
  crea una sesión de 10:00 a 10:45: los 15 min restantes no se reservan ni cuentan como conflicto, y
  la Agenda los muestra como "Franja declarada hasta 11:00 · 15 min libres".
- **Recurrencia**. Las series semanales usan la misma forma que la recurrencia manual
  (`recurrente`, `serieRecurrenteId`, `recurrenteOrigen`).
- **Clientes**. Teléfono y email son obligatorios. Un cliente inactivo o de baja se crea, pero sin
  sesiones, igual que en la Agenda.
- **Identidad**. Se busca por teléfono y email normalizados (`besoul-identidad.js`), nunca por el
  nombre. Coincidencia exacta (teléfono + email + nombre) → existente. Cualquier otra coincidencia,
  incluida una de otra agenda → hay que resolverla antes de importar.
- **Fichas existentes**. Nunca se modifican sin marcar "Actualizar ficha". Solo cambian modalidad,
  frecuencia, tipo de compra, fecha del bono, descuento y estado.
- **Lo que nunca hace**. No borra clientes ni sesiones, no sustituye un hueco ocupado (cliente,
  grupo o prueba CRM: se informa como conflicto y se omite), y no toca CRM, Finanzas, históricos,
  disponibilidad ni V2.
- **Repetir la importación** no duplica nada. Sirve para importar otro mes con el mismo Excel.

## Guardado (compatibilidad con el hotfix P0)

El importador **no tiene un guardado propio**. Aplica el plan en memoria y llama al mismo
`guardarEstadoNubeAgenda(trainerKey, { avisoPropio: true })` que el resto de la Agenda: una sola
transacción por entrenador, con detección de conflictos. El resultado es todo o nada:

- Si falla (red, conflicto con otra sesión, documento demasiado grande), se revierte en memoria
  exactamente lo importado, se avisa de forma visible y Firestore queda intacto.
- Antes de guardar se rehace el plan contra el estado actual. Si la agenda cambió desde la vista
  previa, se vuelve a mostrar la vista previa en lugar de importar algo distinto de lo revisado.
- No se permite importar mientras haya otro guardado de la Agenda pendiente.

## Archivos

- `besoul-importacion.js`: lógica pura (catálogo, plantilla, lectura, validación, plan, aplicación).
- `agenda.html`:
  - el botón, el modal y la integración con las funciones reales;
  - `opcionesFrecuenciaParaModalidad()`, extraída sin cambio de comportamiento de
    `actualizarOpcionesFrecuencia()`;
  - la etiqueta informativa de franja declarada;
  - la marca de versión `import-excel-clientes-agenda-2026-10-08-r2`.
- `sw.js`: precaché de `besoul-importacion.js` (cache v10).
- ExcelJS 4.4.0 se carga **solo al abrir el importador**, desde jsDelivr con integridad SRI.

## Pruebas

Las suites del importador y los Excel de prueba (datos ficticios) viven en la rama de desarrollo
`IMPORT-V1-EXCEL-CLIENTES-AGENDA`. No se integran en `main` ni se publican.

- `importacion-tests/` (Node): `npm install && node run_tests.cjs`, 38 casos con `.xlsx` reales y
  las funciones reales de `agenda.html`. Las fórmulas del Excel se evalúan con HyperFormula y dan la
  misma tarifa y el mismo descuento que Besoul en todas las modalidades y frecuencias.
- `.review-local/importacion/` (navegador real + Firebase Emulator con datos ficticios):
  `e2e.cjs`, 43 comprobaciones. `generar_excels.cjs` crea los Excel de revisión.

## Precio pactado exacto (resuelto)

Besoul no guarda el precio, guarda `descuentoPct` y factura `tarifa × (1 − descuentoPct/100)`
(`importeEfectivoCliente`, sin cambios). Para que el resultado sea **exactamente** el precio pactado:

- **Importador:** guarda el descuento con precisión completa, sin redondear. Por ejemplo, 190 € sobre
  210 € → 9,5238…% → 190,00 € exactos. La columna del Excel muestra 2 decimales, pero contiene el valor
  completo.
- **Ficha (`agenda.html`):** el campo muestra el descuento con 2 decimales. Si el usuario **no lo toca**,
  al guardar se conserva el valor exacto (`fijarCampoDescuentoFicha` / `descuentoCampoFicha`), así que
  abrir y guardar una ficha nunca cambia su importe. Si lo edita, se guarda lo que escribe, como
  siempre.
- No cambia ninguna fórmula de tarifas, bonos, facturación, Finanzas ni Dashboard.
- **Verificado:**
  - unitarios, con precios exactos en individual, pareja, trío, bono e integrante de grupo;
  - E2E I2e/I13a/I13b: 190,00 € tras importar, tras abrir y guardar la ficha, y 10 % al editarlo.

## Un entrenador por plantilla (decisión funcional definitiva)

- La plantilla se genera para la agenda de destino. La columna **Entrenador/PT** es automática y está
  protegida, y el catálogo no contiene entrenadores ajenos.
- Subir la plantilla de otro entrenador, o una fila cambiada a otro entrenador, es un **error** que
  bloquea la importación. No hay importaciones mixtas.
- El admin importa en la agenda que tiene seleccionada, con la plantilla de esa agenda.

## Riesgos residuales

- **Tamaño del documento**. Todo vive en `besoulSuite/agenda` (límite de 1 MiB) y cada sesión
  copia la ficha completa, igual que la Agenda manual. El importador estima el tamaño, avisa a
  partir de unos 700 KB y bloquea por encima de 900 KB. Conviene importar por meses. Ver
  `AGENDA_MONOLITHIC_RISK.md`.
- **ExcelJS desde CDN**. Sin conexión a jsDelivr no se puede generar ni leer el Excel. El resto de
  la Agenda no depende de él.
- **Meses de 5 semanas**. Un plan mensual con horario fijo puede superar las sesiones contratadas
  (frecuencia × 4). La vista previa lo avisa y el contador muestra el exceso; la mensualidad no
  cambia (comportamiento normal de la Agenda).
- **Fuera de alcance**:
  - Clientes de **actividad especial** (Pilates, Ciclo Indoor): no se importan; si ya existen, no
    se modifican.
  - Contratos, avatares, restricciones de reserva por cliente y color: se dejan con los valores por
    defecto del alta manual.
- **Observaciones**. Solo se guardan como motivo de pausa o baja: la ficha no tiene un campo general
  de observaciones.
