# Assistant Tests — motor determinista del Asistente BESOUL (AI-04/05/09, B21, D/E/G de la auditoría pre-commit)

Pruebas reales, no inspección visual, del código REAL de `agenda.html` -- mismo criterio que `rules-tests/` y que `finance-tests/`.

## Qué contiene

- `extract.js` — extracción **automática** por nombre de función/const, con conteo de llaves/corchetes balanceado. Reemplaza a la copia manual que existía antes de la auditoría pre-commit (hallazgo real: se llamaba a sí misma "extracción" pero era una copia a mano sin ningún mecanismo de sincronización -- si `agenda.html` cambiaba, `assistant_extract.js` podía quedarse desactualizado en silencio).
- `assistant_extract.js` — **generado por `extract.js`, no editar a mano**. Bloques extraídos: `TARIFAS_2026`, `CAPACIDADES_PT`, `normalizarTextoAsistente`, `LEMAS_VERBOS_ASISTENTE`, `lematizarPalabra`, `distanciaEdicionAcotada`, `palabraCoincideFuzzy`, `buscarCapacidadPT`, `respuestaCapacidadPT`, `respuestaAmbiguaPT`, `respuestaCalculoAsistente`, `respuestaDiagnosticoHueco`, `respuestaAyudaAsistente`.
- `run_tests.cjs` — 164 casos reales: cálculo determinista, capacidades con conjugaciones/typos/puntuación/mayúsculas, ambigüedad (E4), permisos por rol, diagnóstico de huecos, corrección Ana/mañana (D3), fallback honesto, y regresión de los 24 casos originales.
- `LAST_RUN_RESULTS.txt` — salida real de la última ejecución.

## Cómo regenerar el extracto tras cambiar `agenda.html`

```bash
node assistant-tests/extract.js
```

No hay que tocar números de línea a mano -- busca las funciones/consts por nombre.

## Cómo ejecutar

```bash
node assistant-tests/extract.js && node assistant-tests/run_tests.cjs
```

Sin dependencias, sin emulador, sin Firestore -- `dbAgenda`/`dbDisponibilidadReservas`/`entrenadorVisto`/`formatoFechaLocal` se inyectan como mocks mínimos.

## Bugs reales encontrados por esta batería (no hipotéticos)

1. **Coincidencia de capacidades por substring exacto era demasiado frágil** (encontrado en la sesión original): corregido a coincidencia por conjunto de palabras.
2. **"N de M sesiones" resuelto mal** (sesión original): "quedan 3 de 8" daba 37.5% en vez de 62.5% -- corregido detectando "queda/quedan/restan".
3. **Puntuación rompía TODO el matching** (auditoría pre-commit): `normalizarTextoAsistente` no quitaba `¿?¡!.,;"'()`, así que "¿cómo agendo?" dejaba los tokens "¿como" y "agendo?" pegados a los signos -- nunca coincidían con ningún alias. Cualquier pregunta bien escrita en español fallaba por esto, no por falta de aliases. Corregido; `:` se conserva a propósito porque el diagnóstico de huecos necesita `"18:15"` intacto.
4. **Conjugaciones no cubiertas** ("cómo reprogramo", "como agendo"): los aliases solo tenían el infinitivo. Corregido con `LEMAS_VERBOS_ASISTENTE`, un diccionario cerrado y explícito (nunca un stemmer genérico).
5. **Falso positivo por subcadena, no por palabra**: un cliente llamado "Ana" coincidía con "mañana" (que sin tilde en la ñ contiene literalmente "ana") en la detección de "¿de qué cliente hablas?". Corregido exigiendo palabra completa.
6. **Valor mágico `18:15`** en la regex de activación del diagnóstico de huecos -- residuo de haber construido la función a partir de ese ejemplo concreto. Eliminado (`agendar`/`hueco` ya cubrían cualquier hora).
7. **"aplicar 15% a 120" no calculaba** (regex de detección de descuento solo reconocía "aplico", 1ª persona, no el infinitivo "aplicar" que pide el enunciado). Corregido.
8. **Test de permisos (B11) era tautológico**: verificaba que "0 capacidades son admin-only", lo cual nunca ejercitaba el camino de bloqueo real. Ahora se prueba también con una capacidad admin-only sintética para confirmar que el filtro por rol funciona de verdad.

Todos se encontraron y corrigieron en la misma sesión en la que se escribió el código -- exactamente el valor de probar con casos reales en vez de solo revisar el código a ojo.
