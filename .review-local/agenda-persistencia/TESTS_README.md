# Agenda — persistencia de cambios (HOTFIX-V1-AGENDA-PERSISTENCIA-P0, 2026-10-08)

Pruebas de regresión del P0 «el cambio de la Agenda aparece en pantalla y después desaparece».

Se ejecutan contra el Firebase Emulator real (reglas reales de `firestore.rules`, SDK real, sesiones
PT/admin autenticadas), con las funciones extraídas literalmente de `agenda.html`. El proyecto es
`demo-besoul-suite` y todos los datos son ficticios.

## Ejecutar

Necesita `npm install` hecho en `rules-tests/` (usa sus dependencias) y Java 21+.

```
firebase emulators:exec --only firestore --project demo-besoul-suite "node .review-local/agenda-persistencia/run_tests.cjs"
```

Con un emulador de Firestore ya arrancado en `127.0.0.1:8085` (por ejemplo, `node .review-local/start.cjs`):

```
node .review-local/agenda-persistencia/run_tests.cjs
```

## Qué cubre

1. `publicarReservasPublicas()` ya no sustituye el estado vivo de la Agenda (causa raíz). Además
   comprueba que `publicarReservasPublicasParaTrainer()` sigue teniendo un único `await`, requisito
   de la corrección.
2. Una edición pendiente (espera de 350 ms) sobrevive a un snapshot provocado por el guardado de
   otro PT.
3. La protección de concurrencia sigue intacta (admin y PT editan la misma agenda), y quien pierde
   recibe un aviso visible con la pantalla resincronizada.
4. `avisoPropio`: no se duplican avisos.
5. Dos ediciones seguidas de la misma pestaña, la segunda durante la transacción de la primera:
   ya no hay falso conflicto.
6. Notas: solo se envían las claves tocadas. La nota de otro PT ya no se borra, y el borrado de
   notas funciona con las reglas reales de PT.
7. Antes del primer snapshot no se escribe la caché local antigua.
8. Contrato: `guardarEstadoNubeAgenda()` nunca rechaza su promesa.
9. Hay un temporizador de guardado por trainerKey: el admin puede editar dos agendas en menos de
   350 ms sin perder ninguna.

La reproducción de extremo a extremo con navegador (escenarios E1–E14: pantalla, Firestore,
recarga y otra sesión) está en `.review-local/agenda-persistencia/`.
