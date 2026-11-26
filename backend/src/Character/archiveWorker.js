import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { readArchiveBatchInDatabase } from "./archiveRepository.js";

let db;
try {
  db = new DatabaseSync(workerData.databaseFile, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
  const result = readArchiveBatchInDatabase(db, workerData.query);
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error("Archive result exceeds page budget");
  parentPort.postMessage({ ok: true, result });
} catch {
  parentPort.postMessage({ ok: false });
} finally {
  db?.close();
}
