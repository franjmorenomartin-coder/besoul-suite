# BESOUL Data Flows

Companion to `BESOUL-SYSTEM-MAP.md` and `BESOUL-FIRESTORE-MAP.md`. Diagrams reflect the real code as
of `main` commit `72a31ed` (includes the 2026-09-21 save-conflict-race fix).

## Trainer save flow (the SAVE INCIDENT flow)

```mermaid
sequenceDiagram
    participant U as User (browser tab)
    participant A as agenda.html (in-memory dbClientes/dbAgenda/...)
    participant L as onSnapshot listener
    participant F as Firestore (besoulSuite/agenda)

    Note over A,F: Page load
    F-->>L: initial snapshot
    L->>A: aplicarEstadoNubeAgenda(data)
    A->>A: window.bsUltimoServidorConocido = deep copy of data (5 comparable fields)

    Note over U,F: User edits a field
    U->>A: edit (e.g. client note)
    A->>A: programarGuardadoNubeAgenda(scope) -- debounced 350ms
    A->>A: guardarEstadoNubeAgenda(scope)
    A->>A: payload = estadoLocalAgendaParaNube(scope)
    A->>F: runTransaction: tx.get(docRef)
    F-->>A: actual (fresh server state)
    A->>A: compare bsUltimoServidorConocido[campo][scope] vs actual[campo][scope]
    alt no conflict
        A->>F: tx.update(docRef, targeted FieldPath payload)
        F-->>A: commit OK
        A->>A: bsUltimoServidorConocido[campo][scope] = payload's value (THE FIX, 2026-09-21)
        A->>A: publicarReservasPublicas()
        A-->>U: { ok: true }
    else conflict
        A-->>U: { ok:false, err:{code:'conflict', message:'...cambios más recientes...'} }
    end

    Note over F,L: Eventually (network round-trip, not instantaneous)
    F-->>L: listener echo of the committed write
    L->>A: aplicarEstadoNubeAgenda(data) -- re-syncs bsUltimoServidorConocido again, consistently
```

### Why the false conflict happened (before the 2026-09-21 fix)

```mermaid
sequenceDiagram
    participant A as agenda.html (single tab)
    participant F as Firestore

    A->>A: bsUltimoServidorConocido = v0 (from initial listener snapshot)
    Note over A: Edit #1
    A->>F: tx.get() sees v0, compares v0==v0, OK
    A->>F: tx.update() -> server now v1
    Note over A: bsUltimoServidorConocido STILL v0 -- only the listener updates it,<br/>and its echo hasn't arrived yet (real network latency)
    Note over A: Edit #2, seconds later, same tab
    A->>F: tx.get() sees v1 (the server's real current state)
    A->>A: compare bsUltimoServidorConocido (v0) vs actual (v1) -> DIFFERENT
    A-->>A: throw code:'conflict' -- but the only writer was THIS SAME TAB
```

## Admin "ver como PT" flow

```mermaid
flowchart TD
    Admin[Admin logs into agenda.html] --> Selector[Selector: elegir trainerKey a ver]
    Selector --> SetScope[entrenadorVisto = trainerKey elegido]
    SetScope --> Read[Lee besoulSuite/agenda -- documento COMPLETO, igual que un PT<br/>Firestore no tiene lectura parcial]
    Read --> Render[Renderiza SOLO la porción de ese trainerKey en memoria]
    Render --> Edit[Admin edita como si fuera ese PT]
    Edit --> Save[guardarEstadoNubeAgenda(entrenadorVisto)]
    Save --> Rule{Rules: isAdmin bypass}
    Rule -->|allowed, no trainerKey restriction| Write[tx.update -- misma transacción, mismo control de concurrencia que un PT]
```

## Portal booking flow (client-facing, no login)

```mermaid
flowchart TD
    Client[Cliente abre portal-cliente.html?token=...] --> ReadPub[GET besoulPublicClients/token -- público, sin auth]
    ReadPub --> ReadSched[GET besoulPublicSchedule/trainerKey -- público, sin auth]
    ReadSched --> Pick[Cliente elige franja]
    Pick --> CreateResv[CREATE besoulReservas -- Rules validan token/clientId/trainerKey<br/>contra el besoulPublicClients real]
    CreateResv --> Listener[agenda.html: bsReservasUnsub onSnapshot detecta la nueva reserva]
    Listener --> PT[PT/Admin revisa y confirma/gestiona en agenda.html]
```

## CRM lead → client conversion

```mermaid
flowchart TD
    Public[valoracion.html / prueba.html -- formulario público] -->|isPublicTrialLead whitelist| Lead[CREATE besoulLeads]
    Lead --> Read1[agenda.html: PT lee sus propios leads -- 'pruebas' en su Agenda]
    Lead --> Read2[crm.html: Admin gestiona TODOS los leads]
    Read2 --> Convert[Admin convierte lead -> cliente]
    Convert --> Write[WRITE besoulSuite/agenda.clientes.trainerKey -- vía el mismo guardarEstadoNubeAgenda de agenda.html,<br/>o directamente en crm.html]
```

## V1 → V2 (one-time additive copy, not a live sync)

```mermaid
flowchart LR
    subgraph V1["V1 (source of truth, always)"]
      Agenda[besoulSuite/agenda]
      Users[besoulUsers]
      Finanzas[besoulSuite/finanzas]
    end
    subgraph Migrator["scripts/migrate-v1-to-v2.cjs (ran once, 2026-09-18)"]
      M[dry-run -> --apply]
    end
    subgraph V2["V2 (inert copy, unused by any page)"]
      Trainers[trainers/**]
      UsersV2[besoulUsersV2]
      Finance[besoulFinance]
      Quarantine[besoulMigrationQuarantine]
    end
    V1 -->|read-only, once| Migrator
    Migrator -->|additive write, once| V2
    V1 -.->|no ongoing sync -- V1 keeps changing, V2 does not| V2
```

## Layered view (generic, applies to every V1 write path)

```mermaid
flowchart TD
    UI[UI: agenda.html / crm.html / finanzas.html] --> Controller[Controller function: guardarCliente, etc.]
    Controller --> Service[Service/helper: estadoLocalAgendaParaNube, payloadParaUpdateFirestore]
    Service --> Direct[Direct Firestore call -- no DAL in V1]
    Direct --> Doc[besoulSuite/agenda document]
    Doc --> Rules[firestore.rules: match /besoulSuite/docId]
    Rules --> Indexes[No index consulted -- direct doc lookup, never a query]
```

For the equivalent V2 layered view (DAL-mediated, not yet connected to any UI), see
`BESOUL-SYSTEM-MAP.md` §3 and §6.
