# scripts/

Herramientas operativas para el proyecto que **no** son parte de la app servida (no se despliegan, no se referencian desde ningún `.html`).

## backup-firestore.js — FASE 20 del roadmap de baseline

Exporta a JSON local todas las colecciones/documentos que la app usa realmente: `besoulUsers`, `besoulLeads`, `besoulPublicConfig`, `besoulValoracionRegistry`, `besoulPublicClients`, `besoulPublicSchedule`, `besoulReservas`, `besoulSolicitudesEliminacion`, y `besoulSuite/agenda` + `besoulSuite/finanzas`.

**No se ha ejecutado nunca desde el entorno de Claude Code** — no hay credenciales de servicio de Firebase disponibles aquí. Está preparado para que el responsable del proyecto lo ejecute manualmente o lo programe.

### Uso

```bash
cd scripts
npm install firebase-admin
# Windows PowerShell:
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\a\tu-clave-de-servicio.json"
node backup-firestore.js
```

La clave de servicio se descarga desde Firebase Console → Configuración del proyecto → Cuentas de servicio → "Generar nueva clave privada". **Nunca la subas a este repositorio** — guárdala fuera de `besoul-suite/` (por ejemplo en `BESOUL_BACKUPS` u otra carpeta no versionada) y añade su ruta a tu `.gitignore` si alguna vez la copias dentro por error.

Cada ejecución crea `scripts/backups/<timestamp>/` con un `.json` por colección. El script solo lee — no borra ni modifica nada en Firestore.

### Recomendación de frecuencia/retención

- Diario mientras la app esté en uso activo por PT/clientes reales.
- Conservar ~30 backups diarios + 1 mensual durante un año.
- Copiar la carpeta `backups/` fuera de esta máquina (nube, disco externo) — un backup que vive solo en el mismo equipo no protege contra un fallo de ese equipo.

### Alternativa más robusta (no implementada aquí)

Firestore permite exports gestionados por Google Cloud (`gcloud firestore export`) a un bucket de Cloud Storage, o una Cloud Function programada (Cloud Scheduler) que haga lo mismo sin depender de que alguien ejecute un script a mano. Ambas opciones requieren activar facturación/servicios de Google Cloud — fuera de lo que se puede preparar sin autorización explícita de gasto (uno de los motivos de STOP del proyecto). Este script es la opción sin coste adicional, a cambio de depender de que se ejecute manualmente o se programe con el Programador de tareas de Windows / cron.
