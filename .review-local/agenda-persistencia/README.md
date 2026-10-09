# Agenda V1 — reproducción E2E del P0 de persistencia (HOTFIX-V1-AGENDA-PERSISTENCIA-P0)

Abre la Agenda real (`agenda.html?emulador=1`) en varias sesiones de navegador a la vez (PT,
otro PT, admin, dos pestañas) contra el Firebase Emulator con datos ficticios. Para cada operación
comprueba por separado:

- lo que muestra la pantalla (estado en memoria de la página);
- lo que queda realmente en Firestore (lectura directa del emulador);
- lo que aparece tras recargar;
- lo que ve otra sesión autorizada.

Nunca toca producción: `lib.cjs` se niega a ejecutarse si las páginas no se sirven desde
`127.0.0.1`/`localhost`, y el proyecto es `demo-besoul-revision`.

## Ejecutar

```
node .review-local/start.cjs                       # emulador + datos + servidor en :5560 (otra terminal)
cd .review-local/agenda-persistencia
npm install --no-save playwright                   # node_modules está en .gitignore
node repro.cjs                                     # todos los escenarios
LAT=150 REP=3 node repro.cjs E8_ E9_               # con 150 ms de latencia de red, 3 repeticiones
```

Usa Microsoft Edge instalado (`BS_NAVEGADOR=<ruta>` para otro navegador basado en Chromium, o
`BS_NAVEGADOR=chromium` para usar el Chromium de Playwright tras `npx playwright install chromium`).
`BASE=http://127.0.0.1:5561` permite apuntar a otra copia servida en local (p.ej. el código anterior
para comparar antes/después).

## Escenarios

| Id | Operación |
|---|---|
| E1 | Crear sesión (línea base) |
| E2 / E3 | Crear / borrar sesión mientras otro PT guarda |
| E4 | Admin y PT editan la misma agenda a la vez (conflicto real) |
| E5 | Dos pestañas de la misma PT (conflicto real) |
| E6 | Dos ediciones seguidas + otro PT |
| E7 | Nota + otro PT guarda |
| E8 | Un único usuario: mover y enseguida crear (`GAP=<ms>` entre ambas) |
| E9 | Un único usuario: crear nada más entrar |
| E10 | Crear y después borrar |
| E11 | Recurrencia semanal mientras otro PT guarda |
| E12 | Habilitar slot fuera de disponibilidad + otro PT |
| E13 | Aceptar solicitud de reserva del portal |
| E14 | Nota + recarga + vista del admin |
| E15–E17 | Navegar / recargar / cerrar la pestaña con un cambio pendiente (a) o un guardado en curso (b) |

En los conflictos reales (E4, E5), el resultado correcto es que el segundo cambio NO pise al
primero, que su autor reciba un aviso visible y que su pantalla vuelva a coincidir con el servidor.

## Sincronización multiusuario (HOTFIX-V1-AGENDA-SYNC-P0)

`sync.cjs` abre la Agenda como PT (Laura Ficticia, en el papel del entrenador del caso real) y como
admin viendo esa misma agenda, en contextos de navegador y sesiones Auth distintos. Comprueba
siempre el estado final leyendo Firestore directamente.

```
node sync.cjs              # S1-S17
node sync.cjs S10 S13      # solo esos prefijos
BASE=http://127.0.0.1:5561 node sync.cjs   # contra otra copia servida (p.ej. la versión anterior)
```

| Id | Qué prueba |
|---|---|
| S1 | El PT bloquea un día y oculta un slot; el admin lo ve sin recargar |
| S2–S5 | Cambios distintos y casi simultáneos de ambos (sesiones, disponibilidad, ráfagas) |
| S6/S7 | Recargar y cerrar/reabrir ambas sesiones |
| S8, S14 | Desconexión corta y larga (más que el plazo de confirmación de 20 s) |
| S9 | El admin alterna entre agendas de distintos PT |
| S10a–c | El bloqueo del PT sobrevive a guardados fallidos, formularios viejos y otras operaciones |
| S11 | Cambio del PT mientras termina un guardado del admin |
| S12 | Ficha abierta desactualizada |
| S13, S16 | Conflictos reales: misma sesión movida por ambos, sesiones nuevas solapadas |
| S15 | Tiempo hasta la confirmación del servidor |
| S17 | El aviso de éxito/WhatsApp solo aparece tras la confirmación |

No ejecutes dos scripts a la vez contra el mismo emulador: ambos reinician el mismo documento.
