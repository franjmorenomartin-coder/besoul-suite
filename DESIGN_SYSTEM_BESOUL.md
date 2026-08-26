# Sistema de diseño BESOUL

Documento de referencia. Describe primero el sistema visual **real** ya presente en el código (auditado directamente sobre `index.html`, `dashboard.html`, `agenda.html`, `crm.html`, `finanzas.html`, `reservas.html`, `valoracion.html`) y propone cómo formalizarlo. No implica cambios de código — es la base para el `UI_ROADMAP_BESOUL.md`.

Hoy BESOUL **no tiene un sistema de diseño formal**: no hay variables CSS (`:root`), no hay `.css` compartido, y cada HTML es standalone con Tailwind CDN + un bloque `<style>` propio que repite las mismas reglas. Este documento fija esas convenciones como referencia única.

## 1. Identidad visual

App oscura, tono "premium / app real" (no dashboard genérico). Fondo de marca `#0B0F17` consistente en las 8 páginas y en `manifest.json`/`theme-color`. Un acento primario (ámbar) para la marca y acciones globales, más un acento distinto por módulo para diferenciarlos visualmente.

## 2. Paleta de colores

| Uso | Valor real detectado |
|---|---|
| Fondo base | `#0B0F17` (todas las páginas; `#050814` en agenda.html mobile) |
| Superficies (cards, headers) | `bg-slate-900` |
| Inputs / paneles hundidos | `bg-slate-950` |
| Bordes | `border-slate-800` |
| Texto principal | `text-slate-100` / `text-white` |
| Texto secundario | `text-slate-400` / `text-slate-500` |
| Acento primario (marca) | `amber-500` / `amber-600` |
| Acento Agenda | `amber` |
| Acento CRM | `cyan` |
| Acento Finanzas | `emerald` |
| Acento Reservas | `pink` |
| Acento Valoración | `orange` |
| Acento Dashboard | `purple` |
| Éxito | `emerald` / `green` |
| Error | `red` |
| Alerta / pendiente | `amber` / `orange` |
| Informativo | `cyan` / `blue` / `indigo` / `purple` / `fuchsia` |

**Propuesta de normalización**: mover estos valores a variables CSS (`--bg`, `--surface`, `--surface-2`, `--border`, `--accent`, `--accent-{modulo}`) definidas una sola vez y compartidas, en vez de repetirlas por archivo.

## 3. Tipografías

- **Inter** (Google Fonts, pesos 300–800) como fuente principal en todas las páginas salvo `prueba.html` (stub de redirección, usa Arial — aceptable por ser una página de utilidad).
- `font-mono` para valores numéricos/KPIs.
- Logo "besoul": `font-serif italic font-extrabold/font-black` — tratamiento de marca distintivo frente al resto de la UI en Inter sans-serif. Mantener como firma visual.

## 4. Fondos

Fondo base único `#0B0F17` en body. No introducir negro puro (`#000000`); es un color de marca ya establecido y reconocible, no debe sustituirse.

## 5. Tarjetas

Patrón dominante a mantener como estándar: `bg-slate-900 border border-slate-800 rounded-xl`, padding `p-4`–`p-8`, `shadow-2xl` en contenedores principales (login, hubs) y `shadow-lg` en cards de acceso rápido; cards de KPI internas sin sombra, solo borde.

**Deuda a resolver**: hoy conviven `rounded`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl` sin escala fija. Fijar una escala de 2–3 radios (ej. `rounded-xl` para cards estándar, `rounded-2xl` para contenedores grandes) y aplicarla de forma consistente.

## 6. Botones

- **Primario**: `bg-{acento} hover:bg-{acento}-600 text-slate-950 font-bold py-2.5/4 rounded-lg/xl transition`, texto oscuro sobre fondo de acento saturado.
- **Secundario / ghost**: `bg-slate-950 text-slate-300 border border-slate-800 hover:text-white transition`.
- **Pill translúcido** (acción contextual): `bg-{color}-500/10 text-{color}-300 border border-{color}-500/30 hover:bg-{color}-500/20`.

**Deuda a resolver**: no hay `focus-visible` ni estado `disabled` documentado en ningún botón. Añadir ambos como estándar mínimo de accesibilidad.

## 7. Chips / badges

Patrón: `inline-flex px-2/3 py-0.5/1 rounded-full border text-[9-11px] font-bold` + `bg-{color}-500/10 text-{color}-400 border-{color}-500/30`. Ya existe un mapa de estado formalizado en `badgeEstado()` (crm.html) — usarlo como modelo a extraer y compartir entre módulos en vez de reimplementarlo cada vez.

## 8. Estados visuales

Formalizar como estándar único (hoy no existe un componente compartido):
- **Vacío**: icono + texto + CTA de siguiente paso (no solo "no hay datos").
- **Carga**: indicador simple y consistente entre módulos.
- **Error**: mensaje claro + acción de recuperación (reintentar/recargar).

## 9. Modales

Patrón a mantener: overlay `bg-slate-950/80 backdrop-blur-sm flex items-center justify-center` + panel `bg-slate-900 border border-slate-800 rounded-2xl`, toggle vía clase `hidden`. En mobile, extender el patrón bottom-sheet que ya existe en `agenda.html` (`align-items:flex-end; border-radius:1.5rem 1.5rem 0 0`) al resto de módulos con modales (CRM, Finanzas).

**Deuda a resolver**: sin `aria-modal`, sin foco programático al abrir/cerrar. Añadir como estándar de accesibilidad.

## 10. Formularios

- Input/select: `bg-slate-950 border border-slate-800 rounded-xl p-2.5/3 text-white`.
- Labels encima del campo: `text-slate-400 text-xs`.
- `font-size:16px` forzado en mobile (evita zoom automático de iOS) — mantener.
- **Deuda a resolver**: `focus:ring-2 focus:ring-amber-500` solo existe en `valoracion.html`. Extender a todos los formularios como estándar.

## 11. Tablas

Patrón: `<thead>` con `text-[10px] uppercase text-slate-500 border-b border-slate-800`, filas `hover:bg-slate-950/50`, `divide-y divide-slate-800/70`. Hoy fuerzan `min-width` y scroll horizontal en mobile en CRM/Finanzas/Dashboard. **Extender el patrón ya usado en `agenda.html`** (sustituir tabla por lista de cards en mobile) a CRM y Finanzas.

## 12. Navegación móvil

Único módulo con bottom-nav hoy es `agenda.html` (`bottom-0 inset-x-0 grid-cols-4 bg-slate-950/95 backdrop-blur-xl`, con `env(safe-area-inset-bottom)`). Formalizar este patrón como estándar de navegación móvil y extenderlo al resto de módulos (Dashboard, CRM, Finanzas, Reservas) en vez de mantener solo scroll vertical simple.

## 13–17. Por app

- **Dashboard**: acento `purple`; candidato a incorporar tiles de KPI 2x2 y estados vacíos accionables.
- **Agenda**: referencia interna del sistema — ya tiene bottom-nav, day-tabs, bottom-sheets y cards mobile; extender estos patrones al resto, no rehacerlos aquí.
- **CRM**: acento `cyan`; ya tiene `badgeEstado()` como base de chips de estado — candidato a extraer como patrón compartido y a aplicar hairline-list en la lista de leads.
- **Finanzas**: acento `emerald`; candidato a sustituir tabla por cards en mobile como agenda.
- **Reservas**: acento `pink`; sin modales ni bottom-nav hoy — evaluar si los necesita al extender patrones.

## 18. Portal cliente futuro

Roles propuestos: Inicio, Reservar, Mis sesiones, Perfil. Debe heredar la misma base de tokens (fondo `#0B0F17`, Inter, radios normalizados) y usar bottom-nav de 4 items siguiendo el patrón ya validado en agenda.html, adaptado a las 4 secciones del rol cliente.

## 19. Reglas responsive

- Viewport `width=device-width, initial-scale=1.0` en todas las páginas — mantener.
- `font-size:16px !important` en inputs/selects/textarea en mobile — mantener.
- Tablas → cards en mobile: hoy solo en agenda.html, extender a CRM/Finanzas.
- Media queries en breakpoints `640px`/`767-768px` — mantener como estándar de breakpoints.

## 20. Accesibilidad básica

Área más débil del sistema actual (cero `aria-*` detectados en todo el repo). Checklist mínimo a aplicar progresivamente:
- `aria-modal="true"` y foco programático en la apertura/cierre de modales.
- `<label for="...">` asociado correctamente en todos los formularios (hoy solo en `valoracion.html`).
- `focus-visible` en todos los elementos interactivos (botones, links, inputs).
- Contraste de texto verificado con fórmula, no a ojo, en los 6 acentos de módulo.

## 21. Tono visual premium / app real

Principios a seguir en cualquier rediseño:
- Color reservado casi exclusivamente para acento y estado — las superficies se mantienen neutras (`slate`).
- Jerarquía comunicada por tamaño y posición, no solo por peso de fuente.
- Motion sutil y funcional (transiciones de hover/press), nunca decorativo por sí solo.
- Un único patrón por tipo de componente (card, modal, chip, estado vacío) reutilizado en todos los módulos, no reinventado por página.
