# Auditoría UX/UI · openGym como referencia visual para BESOUL

Documento de análisis. openGym se usa exclusivamente como **referencia de inspiración visual/UX**. No se ha copiado ni se copiará código, CSS, JS ni assets del proyecto. Todo lo descrito aquí se reimplementará desde cero con código propio de BESOUL.

## 1. Licencia detectada

**GNU AGPL-3.0-or-later** (archivo `LICENSE` en la raíz del proyecto, confirmado también en `frontend/package.json` y `api/package.json`). Copyright del proyecto: Duarte Santos, 2026.

Notas adicionales relevantes (`NOTICE.md`):
- Los diagramas corporales (`body-paths.js`) derivan de **MuscleMap** (Melih Colpan), licencia **MIT** — requiere mantener el aviso de copyright si se reutiliza tal cual. No se va a reutilizar.
- Los datos de ejercicios provienen de un dataset externo con sus propios términos, no distribuido en el repo.
- Existe una "App store exception" (permiso adicional bajo la sección 7 de la AGPL) para poder distribuir el binario móvil en tiendas de apps.

## 2. Riesgos legales / de licencia

La AGPL-3.0 es una licencia **copyleft fuerte con cláusula de red**: si se copia o deriva código de openGym y ese código se distribuye, o se ofrece como servicio accesible por red (SaaS), existe obligación de liberar el código fuente completo del proyecto derivado bajo la misma licencia.

**Qué activa el riesgo:**
- Copiar/pegar fragmentos de CSS, JS o JSX literales.
- Reutilizar los SVGs/iconos propios del proyecto.
- Reutilizar `body-paths.js` sin mantener la atribución MIT que exige.
- Reutilizar imágenes/assets del repo.

**Qué NO activa el riesgo:**
- Mirar capturas de pantalla y entender patrones de layout, jerarquía, paleta o tipografía.
- Recrear una paleta de colores, una estructura de navegación o un estilo de tarjeta **con código propio**, escrito desde cero.
- El "look and feel" general (tarjetas oscuras, bottom-nav, chips redondeados) no es apropiable vía copyright de software — son patrones de interfaz muy extendidos, no expresión de código.

**Uso comercial**: la AGPL no lo prohíbe, pero si BESOUL derivara código de openGym y lo comercializara como SaaS cerrado, tendría que liberar su propio código fuente — inasumible para un producto comercial cerrado. Para uso de inspiración visual sin copiar código, esta obligación no aplica.

**Atribución**: no requerida para inspirarse visualmente. Solo sería necesaria si se reutilizara literalmente el material MIT de MuscleMap (no aplica, no se reutiliza).

**Conclusión práctica**: es seguro usar openGym como referencia de inspiración visual (paleta, jerarquía, patrones de tarjeta/chip/nav/modal), siempre que el equipo de BESOUL reimplemente todo con código propio, sin copiar CSS/JS/SVG/imágenes literales.

## 3. Contexto técnico de openGym (solo como referencia)

Monorepo: `frontend/` (React 19 + Zustand + Vite, CSS propio con variables `:root`, sin Tailwind, empaquetado también vía Capacitor como app móvil/PWA), `api/` (Node.js con passkeys/WebAuthn), `website/` (landing estática). Pantallas: Home, Plan, Workout, Stats, Library, Admin, Settings.

## 4. Patrones visuales que merece adoptar BESOUL

- **Rampa de superficies neutras + color reservado solo para acento/estado**: evita el aspecto "genérico" de tarjetas azuladas saturadas; BESOUL ya tiene una base compatible (`slate` + acento por módulo) que puede pulirse en esta dirección.
- **Jerarquía tipográfica por tamaño, no por peso**: usar mayoritariamente un peso regular/semibold y dejar que tamaño y posición comuniquen jerarquía, en vez de abusar de negritas.
- **Separadores hairline insertados tras el icono** (no bordes de card completos): hace que listas largas (agenda, CRM) se lean como un objeto único.
- **Contraste texto-sobre-acento calculado, no adivinado**: relevante porque BESOUL ya usa 6 acentos distintos por módulo (amber, cyan, emerald, pink, orange, purple) — merece verificarse con una fórmula de contraste real, no a ojo.
- **Números tabulares** en cifras que cambian (KPIs de dashboard/finanzas), para que no "salten" al actualizarse.

## 5. Patrones UX que merece adoptar BESOUL

- **Estados vacíos accionables y con tono humano**: no solo "no hay datos", sino un CTA de siguiente paso (aplicable a Agenda sin sesiones, CRM sin leads, Finanzas sin movimientos).
- **Bottom sheets con "grabber"** para acciones móviles — BESOUL ya usa esta idea parcialmente en los modales mobile de `agenda.html`; merece formalizarse y extenderse a CRM/Finanzas.
- **Acción primaria integrada en la navegación** (botón elevado central en la tab bar) en vez de un FAB flotante aparte — aplicable a la acción "estrella" de cada rol (ej. nueva reserva en PT, nuevo movimiento en Finanzas).
- **`prefers-reduced-motion` respetado** y motion sutil/funcional (no decorativo) — hoy BESOUL no lo contempla.

## 6. Qué no aplica a BESOUL

- Todo lo específico del dominio fitness de openGym: mapa muscular corporal, heatmap de "tiempo entrenado", esquema de progresión de cargas, steppers de peso/reps, temporizador de descanso.
- Fondo negro puro `#000000`: es una decisión válida para una app de gimnasio en poca luz, pero BESOUL ya tiene su propio color de marca (`#0B0F17`) y no necesita adoptar negro absoluto.
- Paleta calcada literalmente del sistema de iOS (`#0a84ff`, `#30d158`, etc.): usarla como referencia de *estructura* (superficie neutra + un acento) es válido; copiar los valores exactos sería genérico y poco diferenciado frente a los acentos que BESOUL ya tiene definidos.

## 7. Qué no se debe copiar

- Código fuente (CSS/JS/JSX) literal de ningún archivo del repo.
- Los SVGs/iconos "hand-drawn" propios del proyecto.
- Imágenes de ejercicios y cualquier asset gráfico.
- `body-paths.js` (licencia MIT de terceros, requiere atribución si se usa tal cual — no se usa).

## 8. Aprendizajes útiles

- Un sistema de diseño con variables CSS documentadas (y comentarios explicando el *por qué* de cada decisión) es mucho más mantenible que estilos repetidos por copy-paste, que es el estado actual de BESOUL.
- Reservar el color casi exclusivamente para acento y estado (éxito/aviso/error) da un aspecto más premium que llenar de color las superficies.
- Formalizar un solo patrón de "estado vacío" y reutilizarlo en todas las vistas evita que cada módulo invente el suyo.

## 9. Recomendaciones prácticas

- Aplicar el patrón de lista con hairline tras icono a las filas de CRM y a la lista de leads/clientes.
- Verificar con una fórmula de contraste (no a ojo) los 6 acentos de módulo de BESOUL sobre sus botones primarios.
- Extender el patrón de "tabla → cards en mobile" que ya existe en `agenda.html` a `crm.html` y `finanzas.html`, que hoy fuerzan scroll horizontal en móvil.
- Formalizar un componente de "estado vacío" único y reutilizarlo en Agenda, CRM, Finanzas y Reservas.
- Añadir `prefers-reduced-motion` y foco programático a los modales existentes como mejora de accesibilidad, no como copia de código de openGym.
