# Concurrency Tests — HARDENING-PRE-BASELINE-v3.2.1

`guardarEstadoNubeAgenda()` construye su payload a partir del estado LOCAL en memoria
(`dbClientes[trainerKeyScope]`, etc.), no de una lectura fresca del servidor. Antes de esta fase,
dos sesiones editando el MISMO `trainerKey` casi a la vez (dos pestañas del mismo PT, o un admin
con "ver como PT X" abierto mientras el propio PT X edita) podían pisarse en silencio: la que
guardaba último ganaba, sin aviso, sin conflicto detectado -- ni siquiera releer el servidor justo
antes de escribir (`get(source:'server') + update()`) basta por sí solo, porque el payload en sí
sigue viniendo de la copia local, no de esa lectura fresca.

`guardarEstadoNubeAgenda()` ahora envuelve la escritura en una transacción real de Firestore que
compara, para el `trainerKey` afectado, el estado que el servidor tiene AHORA MISMO contra
`window.bsUltimoServidorConocido` (una instantánea que `aplicarEstadoNubeAgenda()` actualiza cada
vez que llega un snapshot real). Si difieren, significa que otra sesión guardó algo de ese mismo
entrenador que esta pestaña todavía no ha recibido -- el guardado se **cancela** (`{ok:false,
err:{code:'conflict'}}`) en vez de sobrescribir en silencio. Un cambio de OTRO `trainerKey` nunca
cuenta como conflicto. Sin ningún snapshot previo conocido (primer guardado de la sesión), no
bloquea -- mismo comportamiento que antes de esta fase.

Deliberadamente NO intenta fusionar los dos cambios (arriesgado sin conocer con certeza qué cambió
en cada caso) -- solo detecta y avisa, que es el objetivo explícito de esta fase: "cambios
independientes NO se pisan silenciosamente".

## Ejecutar

```
node extract.js && node run_tests.cjs
```
