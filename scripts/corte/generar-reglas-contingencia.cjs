// ARQ-V1-MIGRACION-IMPL — genera scripts/corte/firestore.contingencia.rules a partir de las reglas
// definitivas (firestore.rules), para el MODO CONTINGENCIA (ver docs/arquitectura-firestore/
// 07_CORTE_Y_RECUPERACION.md):
//  - las colecciones nuevas quedan en SOLO LECTURA para todos (ninguna escritura -> no divergen);
//  - besoulSuite/agenda (original) sigue congelado: solo lectura admin, ninguna escritura;
//  - besoulSuite/agendaContingencia se rige EXACTAMENTE por las reglas que tenía besoulSuite/agenda
//    antes del corte (aislamiento de escritura por entrenador), para la app anterior.
//   node scripts/corte/generar-reglas-contingencia.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', '..');
let s = fs.readFileSync(path.join(raiz, 'firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`n=${n} :: ${a.slice(0, 80)}`); s = s.replace(a, () => b); };
rep(`    function versionCreacion() {
      return request.resource.data.rev == 1 && request.resource.data.actualizadoEn == request.time;
    }`, `    // MODO CONTINGENCIA: ninguna escritura en las colecciones nuevas.
    function versionCreacion() {
      return false;
    }`);
rep(`    function versionActualizacion() {
      return request.resource.data.rev == resource.data.rev + 1 && request.resource.data.actualizadoEn == request.time;
    }`, `    function versionActualizacion() {
      return false;
    }`);
rep(`      allow read: if isAdmin() && docId == 'agendaContingencia';
`, `      // MODO CONTINGENCIA: mismas reglas que tenía besoulSuite/agenda antes del corte.
      allow read: if isActiveUser() && docId == 'agendaContingencia';
      allow write: if docId == 'agendaContingencia' && (
        isAdmin()
        || (isActiveUser()
            && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['clientes','agenda','disponibilidadReservas','historicoClientes','pruebasCRM','notas','actualizadoEn','ultimaActualizacionLocal'])
            && request.resource.data.clientes.diff(resource.data.clientes).affectedKeys().hasOnly([myTrainerKey()])
            && request.resource.data.agenda.diff(resource.data.agenda).affectedKeys().hasOnly([myTrainerKey()])
            && request.resource.data.disponibilidadReservas.diff(resource.data.disponibilidadReservas).affectedKeys().hasOnly([myTrainerKey()])
            && request.resource.data.historicoClientes.diff(resource.data.historicoClientes).affectedKeys().hasOnly([myTrainerKey()])
            && request.resource.data.pruebasCRM.diff(resource.data.pruebasCRM).affectedKeys().hasOnly([myTrainerKey()])
           )
      );
`);
rep(`    match /besoulAgendaLegado/{docId} {
      // Campos raíz sueltos del documento antiguo, conservados verbatim por el migrador.
      allow read: if isAdmin();
      allow create: if isAdmin();`, `    match /besoulAgendaLegado/{docId} {
      // Campos raíz sueltos del documento antiguo, conservados verbatim por el migrador.
      allow read: if isAdmin();
      allow create: if false;`);
s = `// GENERADO por scripts/corte/generar-reglas-contingencia.cjs — MODO CONTINGENCIA. No editar a mano.\n` + s;
fs.writeFileSync(path.join(__dirname, 'firestore.contingencia.rules'), s);
console.log('scripts/corte/firestore.contingencia.rules generado');
