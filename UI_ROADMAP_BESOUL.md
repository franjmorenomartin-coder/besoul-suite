# Roadmap de rediseño visual BESOUL

Documento de planificación. No implica cambios de código todavía — define el orden y las reglas para cuando se autorice la primera implementación. Se apoya en `UI_AUDIT_OPEN_GYM_TO_BESOUL.md` (inspiración/licencia) y `DESIGN_SYSTEM_BESOUL.md` (tokens y patrones a fijar).

## 1. Orden recomendado de rediseño

1. **Tokens base compartidos** (fondo, tipografía, botón primario) — sin tocar lógica, aplicable a cualquier página.
2. **`valoracion.html`** — piloto: formulario público, sin lógica de CRM/Firestore compleja, menor riesgo si algo sale mal.
3. **`agenda.html`** — ya es el módulo más avanzado visualmente; ajustes menores de consistencia (radios, focus states), no rediseño estructural.
4. **`crm.html`** — extraer `badgeEstado()` a patrón compartido, aplicar hairline-list, extender cards mobile.
5. **`finanzas.html`** — extender cards mobile (patrón agenda), normalizar tablas.
6. **`dashboard.html`** — tiles de KPI, estados vacíos accionables.
7. **`reservas.html`** — última, más pequeña y con menos superficie visual.
8. **Portal cliente futuro** — se construye ya con el sistema formalizado, no requiere migración.

## 2. Primera pantalla a tocar

`valoracion.html`, aplicando únicamente los tokens base (fondo, fuente, botón primario, focus ring) ya definidos en `DESIGN_SYSTEM_BESOUL.md`. Es un formulario público autocontenido: si algo se rompe, el impacto es visual y aislado, no afecta a Agenda/CRM/Finanzas.

## 3. Cambios seguros

- Extraer valores repetidos (`#0B0F17`, `font-family: Inter`, botón primario) a un bloque de variables CSS compartido.
- Normalizar la escala de `rounded-*` a 2–3 valores fijos.
- Añadir `focus-visible`/`focus:ring` donde falta.
- Añadir `aria-modal`, `for` en labels, foco programático en modales — solo atributos, sin tocar lógica JS de apertura/cierre.
- Extraer `badgeEstado()` de crm.html a un patrón documentado y reutilizable (sin cambiar su lógica de mapeo estado→color).

## 4. Cambios con riesgo

- Sustituir tablas por cards en mobile en CRM/Finanzas: toca la estructura del DOM que probablemente tiene JS enganchado (render de filas, sorting, clicks de fila) — requiere revisión cuidadosa de cada listener antes de tocar el markup.
- Añadir bottom-nav a módulos que no lo tienen (Dashboard, CRM, Finanzas, Reservas): cambia la estructura de layout y puede chocar con scroll/z-index existente.
- Cualquier cambio en formularios que interactúan con Firestore (CRM, Reservas, Agenda): separar siempre el cambio visual del cambio de lógica de guardado/validación.

## 5. Tickets propuestos

### Rol PT
| Ticket | Alcance | Rama |
|---|---|---|
| UI-010 | Tokens base + valoracion.html piloto | `UI-010` |
| UI-011 | Agenda — consistencia visual (radios, focus) | `UI-011` |
| UI-012 | Clientes/CRM — hairline-list + badge compartido | `UI-012` |
| UI-013 | Grupos | `UI-013` |
| UI-014 | Reservas — tokens + estados vacíos | `UI-014` |
| UI-015 | Más (menú/perfil PT) | `UI-015` |

### Rol Dirección
| Ticket | Alcance | Rama |
|---|---|---|
| UI-020 | Dashboard — tiles KPI + estados vacíos | `UI-020` |
| UI-021 | Finanzas — cards mobile + tokens | `UI-021` |
| UI-022 | CRM (vista dirección) | `UI-022` |
| UI-023 | Centros | `UI-023` |
| UI-024 | Más (menú/perfil dirección) | `UI-024` |

### Rol Cliente futuro
| Ticket | Alcance | Rama |
|---|---|---|
| UI-030 | Inicio | `UI-030` |
| UI-031 | Reservar | `UI-031` |
| UI-032 | Mis sesiones | `UI-032` |
| UI-033 | Perfil | `UI-033` |

## 6. Checklist de pruebas por ticket

- [ ] La página carga sin errores de consola.
- [ ] Todas las acciones de Firestore (crear/leer/editar/borrar) siguen funcionando igual que antes del cambio.
- [ ] Comprobación visual en desktop y mobile (breakpoints 640px/768px).
- [ ] Modales abren/cierran correctamente, sin romper el flujo existente.
- [ ] Tablas/listas muestran los mismos datos que antes del cambio de estilo.
- [ ] Contraste de texto verificado en los estados nuevos/tocados.
- [ ] No se introdujeron nuevas dependencias externas ni assets de terceros.

## 7. Qué no tocar todavía

- Firebase (config, SDK, auth).
- Firestore Rules (`SECURITY_RULES.md` y reglas desplegadas).
- Lógica de negocio (cálculos de finanzas, progresión de agenda, mapeo de estados CRM).
- Datos existentes (no se migran ni transforman datos por un cambio visual).
- `manifest.json` y `sw.js`.

## 8. Cómo evitar romper Agenda, CRM y Finanzas

- Separar siempre **estilo** (clases CSS/Tailwind, tokens) de **estructura/lógica** (JS de negocio, listeners, llamadas a Firestore) — no tocar los dos en el mismo commit/ticket.
- Antes de cambiar el markup de una tabla o lista, localizar y listar los listeners/JS que dependen de esa estructura (ids, selectors) para no romperlos.
- Probar cada ticket de forma aislada en su propia rama (`UI-0XX`) antes de fusionar, siguiendo el checklist de la sección 6.
- Priorizar los "cambios seguros" (sección 3) antes que los "cambios con riesgo" (sección 4) en cada módulo.

## 9. Primera implementación recomendada (no implementar todavía)

Extraer el fondo `#0B0F17`, la fuente Inter y el estilo de botón primario a un bloque de variables CSS reutilizado, aplicándolo primero en `valoracion.html` (ticket UI-010) como piloto de bajo riesgo antes de tocar Agenda, CRM o Finanzas. Esto queda propuesto para autorización futura — no se ha implementado en esta fase documental.
