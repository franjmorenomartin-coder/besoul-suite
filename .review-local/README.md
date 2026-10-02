# Revisión local del incidente CRM (emulador, datos ficticios)

Sirve para revisar a mano CRM / Agenda / Dashboard modificados **sin ninguna posibilidad de tocar
producción**.

## Arrancar

Requisitos: Node 18+ y Java 21+ (lo exige el Firebase Emulator).

    node .review-local/start.cjs

La carpeta y `.firebase.review-local.json` empiezan por punto a propósito: GitHub Pages (build
Jekyll) no publica archivos ni carpetas que empiezan por punto, así que esta herramienta local no
forma parte del sitio de producción.

Abre:

- CRM: http://127.0.0.1:5560/crm.html?emulador=1
- Agenda: http://127.0.0.1:5560/agenda.html?emulador=1
- Dashboard: http://127.0.0.1:5560/dashboard.html?emulador=1

Cuentas (contraseña `RevisionLocal2026!`):

- `admin.revision@example.test` (administración)
- `laura.revision@example.test`, `carlos.revision@example.test` (entrenadores)

Ctrl+C para todo. Cada arranque empieza con los mismos datos ficticios (el emulador no guarda nada).

## Por qué no puede tocar producción

`besoul-entorno-local.js` solo activa el modo emulador si se cumplen **las tres** condiciones:

1. el hostname es exactamente `localhost`, `127.0.0.1` o `[::1]`;
2. el protocolo es `http:`;
3. se pide explícitamente con `?emulador=1` (se recuerda en la sesión de ese origen local;
   `?emulador=0` lo apaga).

En `app.besoulfitness.com` la primera comprobación falla y el archivo no hace nada: la página usa
su configuración real exactamente como antes (probado en `crm-incident-tests/entorno_local_tests.cjs`).

Si se activa, la página usa el proyecto ficticio `demo-besoul-revision` (los ids `demo-*` no
existen en Google: aunque fallara la conexión al emulador, nunca podría llegar a `besoul-suite`),
conecta Auth y Firestore a `127.0.0.1` y muestra la franja "REVISIÓN LOCAL" arriba.

El seed (`.review-local/seed.cjs`) solo escribe en `127.0.0.1` y se niega a ejecutarse contra
cualquier proyecto que no empiece por `demo-`. El servidor (`.review-local/serve.cjs`) escucha solo
en `127.0.0.1`. `firebase.json` (despliegue) no se ha tocado; el emulador usa
`.firebase.review-local.json` con las reglas de este repositorio.

## Datos ficticios

| Lead | Para probar |
|---|---|
| Lead Ficticio Septiembre | lead normal de septiembre (sin fecha de alta real: histórico) |
| Lead Ficticio Octubre | lead normal de octubre |
| Señora Ficticia Núñez | alta real 28/09, registrada y convertida el 01/10 (caso de Sandra) |
| Lead Ficticio Agosto | cohorte de agosto convertida el 03/10 (cohorte vs evento) |
| Lead Ficticio Existente (+34 655 444 333) | aviso de duplicado al crear un lead |
| Lead Ficticio Para Convertir (+34611222333) | aviso al convertir: ya existe "Rosa Ficticia" en Agenda |
| Lead Ficticio Conversión Limpia | conversión sin coincidencias |

Agenda: Rosa Ficticia (611 222 333) y Señora Ficticia Núñez (Laura), Tomás Ficticio y Lead
Ficticio Agosto (Carlos). Centros: los del catálogo base del CRM.
