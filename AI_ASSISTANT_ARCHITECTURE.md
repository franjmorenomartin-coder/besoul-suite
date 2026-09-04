# BESOUL Assistant — arquitectura (MVP local + futuro backend seguro)

## 1. Qué existe hoy (AI-01, `agenda.html`)

Un panel "✨ Asistente" (drawer en desktop, bottom-sheet en móvil) que responde preguntas sobre la agenda del PT que ha iniciado sesión, calculando las respuestas **enteramente en el navegador**, sobre los datos que `agenda.html` ya tiene cargados en memoria (`dbClientes[entrenadorVisto]`, `dbAgenda[entrenadorVisto]`). No es un modelo de lenguaje: es un motor de patrones/reglas (`motorAsistenteBesoul()`) que reconoce un puñado de intenciones por palabras clave y reutiliza funciones de cálculo ya existentes (`calcularContadorClases`, iteración de `dbAgenda`).

Cubre hoy:
- Resumen de agenda de hoy/mañana (lista de citas con hora y nombre).
- Clientes activos que llevan N días sin venir (o sin histórico).
- Clientes activos con sesiones contratadas pendientes de usar.
- Para "buscar hueco" / "sugerir horario": respuesta explicativa que remite al calendario (huecos libres ya se ven en verde) — no calcula esto todavía, se declara explícitamente en la propia respuesta en vez de fingir un resultado.
- Cualquier otra pregunta: mensaje honesto de "no sé responder eso todavía en modo local" + qué sí puede hacer.

## 2. Garantías de seguridad del MVP (ya cumplidas)

- **Cero llamadas de red.** Todo el cálculo ocurre en `motorAsistenteBesoul()`, síncrono, sobre variables ya en memoria.
- **Cero API keys en el frontend.** No hay ninguna credencial de proveedor de IA en este código.
- **Cero escritura.** El asistente nunca llama a `guardarEstadoNubeAgenda()`, ni muta `dbAgenda`/`dbClientes`. Es advisory-only por construcción, no por una comprobación añadida encima — no existe ningún camino de código desde el asistente hacia una escritura.
- **Cero datos salen del PT autenticado.** Solo lee lo que `entrenadorVisto` ya tiene cargado (los mismos datos que ya ve en su propia Agenda).

## 3. Qué NO es esto todavía

- No entiende lenguaje natural real más allá de los patrones de palabras clave programados.
- No aprende ni mejora con el uso.
- No cruza "busca un hueco para Juan el jueves" con disponibilidad real todavía — identificado como el ejemplo más pedido y el que requiere más lógica (cruzar disponibilidad publicada + duración de sesión + preferencia de cliente), dejado fuera de este MVP a propósito por alcance, no por descuido.
- No genera borradores de mensaje de WhatsApp todavía (pedido en el brief) — el flujo real de WhatsApp (`ofrecerWhatsApp()`) ya existe en `agenda.html` para otras acciones; conectar el asistente a generar *texto* de borrador (nunca enviar) es una extensión natural de `motorAsistenteBesoul()`, no requiere backend, y queda como siguiente paso de esta misma fase local si se prioriza.

## 4. Arquitectura futura (backend real, NO implementada, NO autorizada a desplegar)

Cuando se quiera pasar de "reglas locales" a un LLM real, la única forma segura de hacerlo sin exponer API keys ni datos de clientes es intercalar un backend propio:

```
navegador (agenda.html)
   │  1. pregunta del PT + contexto MÍNIMO necesario
   │     (nunca el dump completo de dbAgenda/dbClientes)
   ▼
Cloud Function / endpoint propio (autenticado con el mismo Firebase Auth
del usuario -- verifica ID token, aplica las MISMAS reglas de acceso que
Firestore Rules: un PT solo puede pedir sobre SU PROPIA agenda)
   │  2. la función arma un prompt acotado, con los datos ya
   │     pre-filtrados/agregados en el propio backend (no el dato crudo
   │     de otros clientes), y llama al proveedor de LLM con SU credencial,
   │     nunca la del navegador
   ▼
Proveedor de LLM (Anthropic/OpenAI/...)
   │  3. respuesta de texto
   ▼
Cloud Function
   │  4. la función NUNCA ejecuta acciones de escritura por sí sola --
   │     si el LLM "sugiere" mover una cita, la función devuelve una
   │     PROPUESTA estructurada (no una escritura), que el frontend
   │     muestra como una confirmación explícita ("¿Aplicar esta
   │     sugerencia? Sí/No") -- la escritura la sigue disparando el
   │     click humano, por el mismo camino de código que ya usa hoy
   │     soltarFichaEnCelda()/agendarFichaSeleccionadaEnCelda(), no uno
   │     nuevo controlado por el asistente.
   ▼
navegador -- muestra la respuesta / la propuesta de acción
```

Puntos no negociables para cuando se implemente:
1. **La API key del proveedor de LLM vive solo en el backend**, nunca en el HTML/JS servido al navegador.
2. **Autorización por Firebase Auth ID token** en cada llamada al backend -- el backend debe volver a verificar que el PT solo puede preguntar sobre su propio `trainerKey`, replicando la misma lógica que ya protege Firestore (`isActiveUser()`, `myTrainerKey()`).
3. **El backend nunca reenvía datos crudos de clientes de terceros** al proveedor de LLM -- solo agregados/resúmenes ya filtrados por el propio backend antes de construir el prompt.
4. **Ninguna acción de escritura la dispara el LLM directamente.** Cualquier sugerencia de "mover cita"/"crear reserva"/etc. vuelve al frontend como propuesta, y el humano debe confirmar explícitamente antes de que se ejecute -- reutilizando las funciones de escritura ya validadas y probadas (nunca un camino de escritura nuevo específico del asistente).
5. **Rate limiting y logging de auditoría** en el backend (quién preguntó qué y cuándo), separado del logging de negocio existente.
6. Este diseño requiere: (a) elegir proveedor de LLM, (b) crear el proyecto de Cloud Functions (o equivalente) con su propia gestión de secretos, (c) definir el contrato exacto petición/respuesta, (d) decidir qué acciones concretas puede "proponer" el asistente en la v2. Ninguno de estos cuatro pasos se ha iniciado -- este documento es la referencia para cuando se autorice esa fase, no una implementación parcial.
