#!/usr/bin/env node
/**
 * BESOUL Suite — Firestore backup script (FASE 20).
 *
 * Exports the collections/documents this app actually reads and writes into
 * timestamped local JSON files, so a bad edit, a bug, or a rules mistake can
 * be recovered from without depending on Firestore's own point-in-time
 * recovery (which requires a paid plan and isn't confirmed enabled here).
 *
 * NOT executed or scheduled by Claude — this environment has no Firebase
 * CLI/service-account credentials. Prepared for the project owner to run
 * manually or wire into a scheduled task, same pattern already used for
 * firestore.rules (prepared, not deployed, from this environment).
 *
 * Setup (one time):
 *   1. Firebase Console -> Project settings -> Service accounts ->
 *      "Generate new private key" -> save the JSON somewhere OUTSIDE this
 *      git repo (never commit a service account key).
 *   2. npm install firebase-admin   (run inside this scripts/ folder, or
 *      anywhere and point GOOGLE_APPLICATION_CREDENTIALS at the key).
 *   3. Run:
 *        GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\key.json" node backup-firestore.js
 *      (PowerShell: $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\key.json"; node backup-firestore.js)
 *
 * Output: ./backups/<ISO-timestamp>/<collection>.json (one JSON array of
 * {id, data} per document). Nothing is deleted or modified in Firestore —
 * this script only reads.
 *
 * Suggested retention: keep the last ~30 daily backups locally, plus one
 * per month for a year, and copy the folder somewhere off this machine
 * (cloud drive, external disk) — a local-only backup doesn't protect
 * against this machine failing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// HOTFIX-V1-AGENDA-SYNC-P0 (2026-10-09): respaldo VERIFICABLE antes de desplegar. Cada copia lleva un
// manifest.json con el SHA-256 de cada archivo, el nº de documentos y, para besoulSuite/agenda, un
// resumen por entrenador (fichas, sesiones, días bloqueados, slots ocultos) y su updateTime real.
//   node backup-firestore.js                       -> crea la copia (solo LEE de Firestore)
//   node backup-firestore.js --verificar <carpeta> -> comprueba los SHA-256 (sin credenciales)
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
function escribirConHash(outDir, nombre, contenido, manifest) {
  const buf = Buffer.from(contenido, 'utf8');
  fs.writeFileSync(path.join(outDir, nombre), buf);
  manifest.archivos[nombre] = { sha256: sha256(buf), bytes: buf.length };
}
function resumenAgenda(data) {
  const r = {};
  const trainers = new Set([...Object.keys(data.clientes || {}), ...Object.keys(data.agenda || {}), ...Object.keys(data.disponibilidadReservas || {})]);
  trainers.forEach(t => {
    const disp = (data.disponibilidadReservas || {})[t] || {};
    r[t] = {
      fichas: Array.isArray((data.clientes || {})[t]) ? data.clientes[t].length : 0,
      sesiones: Object.keys((data.agenda || {})[t] || {}).length,
      diasConExcepcion: Object.keys(disp.excepciones || {}).length,
      diasBloqueados: Object.values(disp.excepciones || {}).filter(e => e && e.activo === false).length,
      diasConSlotsOcultos: Object.keys(disp.bloqueos || {}).length,
    };
  });
  return r;
}
if (process.argv[2] === '--verificar') {
  const dir = process.argv[3];
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  let ok = true;
  Object.entries(manifest.archivos).forEach(([nombre, info]) => {
    const bien = sha256(fs.readFileSync(path.join(dir, nombre))) === info.sha256;
    ok = ok && bien;
    console.log(`${bien ? 'OK  ' : 'MAL '} ${nombre}`);
  });
  console.log(ok ? '\nCopia íntegra.' : '\nLA COPIA NO ES ÍNTEGRA.');
  process.exit(ok ? 0 : 1);
}

const admin = require('firebase-admin');

// Every top-level collection this app actually uses (see agenda.html,
// finanzas.html, crm.html's Firestore calls). besoulSuite is a collection
// with two known documents (agenda, finanzas) rather than many docs, so it
// gets its own explicit doc-by-doc export below instead of a blind
// collection dump.
const SIMPLE_COLLECTIONS = [
  'besoulUsers',
  'besoulLeads',
  'besoulPublicConfig',
  'besoulValoracionRegistry',
  'besoulPublicClients',
  'besoulPublicSchedule',
  'besoulReservas',
  'besoulSolicitudesEliminacion',
];

const BESOUL_SUITE_DOCS = ['agenda', 'finanzas'];

async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, 'backups', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  let totalDocs = 0;
  const manifest = { creadoEn: new Date().toISOString(), archivos: {}, documentos: {}, agenda: null };

  for (const name of SIMPLE_COLLECTIONS) {
    const snap = await db.collection(name).get();
    const rows = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    escribirConHash(outDir, `${name}.json`, JSON.stringify(rows, null, 2), manifest);
    manifest.documentos[name] = rows.length;
    totalDocs += rows.length;
    console.log(`${name}: ${rows.length} documento(s)`);
  }

  const suiteRows = [];
  for (const docId of BESOUL_SUITE_DOCS) {
    const snap = await db.collection('besoulSuite').doc(docId).get();
    if (snap.exists) suiteRows.push({ id: docId, data: snap.data() });
    if (snap.exists && docId === 'agenda') {
      manifest.agenda = {
        updateTime: snap.updateTime ? snap.updateTime.toDate().toISOString() : null,
        bytesAprox: Buffer.byteLength(JSON.stringify(snap.data())),
        porEntrenador: resumenAgenda(snap.data()),
      };
    }
  }
  escribirConHash(outDir, 'besoulSuite.json', JSON.stringify(suiteRows, null, 2), manifest);
  manifest.documentos.besoulSuite = suiteRows.length;
  totalDocs += suiteRows.length;
  console.log(`besoulSuite: ${suiteRows.length} documento(s) (agenda/finanzas)`);

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nBackup completo: ${totalDocs} documentos en total.`);
  if (manifest.agenda) console.log('Agenda por entrenador:', JSON.stringify(manifest.agenda.porEntrenador));
  console.log(`Carpeta: ${outDir}`);
  console.log(`Verificar la copia: node backup-firestore.js --verificar "${outDir}"`);
}

main().catch(err => {
  console.error('Backup fallido:', err);
  process.exit(1);
});
