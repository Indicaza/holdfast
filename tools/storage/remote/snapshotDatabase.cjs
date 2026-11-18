// Runs ON THE SERVER (uploaded and started detached by ../pullBackup.mjs):
// a consistent snapshot of the database with writes paused.
//   node snapshotDatabase.cjs /data/holdfast.sqlite /data/snapshot/holdfast-<id>.sqlite
// - Connection A takes the write lock (BEGIN IMMEDIATE): the website's
//   writes wait and then fail (busy timeout); reads keep working. Nothing
//   can grow the WAL.
// - Connection B runs VACUUM INTO: one read of the committed database into a
//   new compact file.
// - A watchdog stops everything (removes the partial file, releases the
//   lock) if /data free space drops below 1 GiB.
// Progress and the result go to <target>.log as JSON lines.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Worker, isMainThread, workerData, parentPort } = require("node:worker_threads");

if (!isMainThread) {
  const db = new DatabaseSync(workerData.source, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 60000");
  db.prepare("VACUUM INTO ?").run(workerData.target);
  db.close();
  parentPort.postMessage("done");
  return;
}

const [source, target] = process.argv.slice(2);
if (!source || !target || !source.endsWith("holdfast.sqlite") || path.resolve(source) === path.resolve(target) || fs.existsSync(target)) { console.error("refusing: bad source/target"); process.exit(2); }
const logFile = `${target}.log`;
const log = (event) => fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
const free = () => { const s = fs.statfsSync(path.dirname(target)); return s.bavail * s.bsize; };
const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const MIN_FREE = 1024 ** 3;

fs.mkdirSync(path.dirname(target), { recursive: true });
const needed = size(source);
log({ step: "start", source, sourceBytes: needed, walBytes: size(`${source}-wal`), freeBytes: free() });
if (free() < needed + MIN_FREE) { log({ step: "refused", reason: "not enough free space for a full copy plus 1 GiB" }); process.exit(2); }

const lock = new DatabaseSync(source);
lock.exec("PRAGMA busy_timeout = 120000");
lock.exec("BEGIN IMMEDIATE");
log({ step: "writes_paused" });
const started = Date.now();
const worker = new Worker(__filename, { workerData: { source, target } });
const timer = setInterval(() => {
  const f = free();
  log({ step: "progress", targetBytes: size(target), walBytes: size(`${source}-wal`), freeBytes: f, seconds: Math.round((Date.now() - started) / 1000) });
  if (f < MIN_FREE) {
    log({ step: "aborted", reason: "free space below 1 GiB" });
    worker.terminate().then(() => { fs.rmSync(target, { force: true }); lock.exec("ROLLBACK"); lock.close(); process.exit(3); });
  }
}, 10000);
const finish = (ok, error) => {
  clearInterval(timer);
  lock.exec("ROLLBACK");
  lock.close();
  log({ step: "writes_resumed" });
  if (!ok) { fs.rmSync(target, { force: true }); log({ step: "failed", error: String(error) }); process.exit(1); }
  const check = new DatabaseSync(target, { readOnly: true });
  const quick = check.prepare("PRAGMA quick_check").get();
  const version = check.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
  check.close();
  log({ step: "done", targetBytes: size(target), quickCheck: Object.values(quick)[0], schemaVersion: version, seconds: Math.round((Date.now() - started) / 1000), freeBytes: free() });
};
worker.on("message", () => finish(true));
worker.on("error", (error) => finish(false, error.message));
