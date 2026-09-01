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

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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

  for (const name of SIMPLE_COLLECTIONS) {
    const snap = await db.collection(name).get();
    const rows = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 2));
    totalDocs += rows.length;
    console.log(`${name}: ${rows.length} documento(s)`);
  }

  const suiteRows = [];
  for (const docId of BESOUL_SUITE_DOCS) {
    const snap = await db.collection('besoulSuite').doc(docId).get();
    if (snap.exists) suiteRows.push({ id: docId, data: snap.data() });
  }
  fs.writeFileSync(path.join(outDir, 'besoulSuite.json'), JSON.stringify(suiteRows, null, 2));
  totalDocs += suiteRows.length;
  console.log(`besoulSuite: ${suiteRows.length} documento(s) (agenda/finanzas)`);

  console.log(`\nBackup completo: ${totalDocs} documentos en total.`);
  console.log(`Carpeta: ${outDir}`);
}

main().catch(err => {
  console.error('Backup fallido:', err);
  process.exit(1);
});
