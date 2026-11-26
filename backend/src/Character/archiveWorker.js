import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { readArchiveBatchInDatabase } from "./archiveRepository.js";
import { archiveResultLimit } from "./archiveLimits.js";

let db;
try {
  db = new DatabaseSync(workerData.databaseFile, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
  db.exec("BEGIN");
  const result = readArchiveBatchInDatabase(db, workerData.query);
  db.exec("COMMIT");
  if (Buffer.byteLength(JSON.stringify(result)) > archiveResultLimit(workerData.query)) throw new Error("Archive result exceeds page budget");
  parentPort.postMessage({ ok: true, result });
} catch {
  parentPort.postMessage({ ok: false });
} finally {
  db?.close();
}
