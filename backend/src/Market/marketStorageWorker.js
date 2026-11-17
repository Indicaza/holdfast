import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

import { measureMarketStorageInDatabase } from "./marketSeries.js";

// The Auction House storage budget measurement (see marketRefresh.js), in
// a worker thread with its own read-only connection: dbstat reads every
// page of every table it measures.
try {
  const db = new DatabaseSync(workerData.databaseFile, { readOnly: true });
  try {
    parentPort.postMessage({ ok: true, storage: measureMarketStorageInDatabase(db) });
  } finally {
    db.close();
  }
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error.code || error.message).slice(0, 200) });
}
