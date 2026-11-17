import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrateGuildDatabase } from "../src/Data/database.js";
import { applyApprovedCutover } from "../src/Data/databaseCutover.js";

const quiet = { warn() {}, error() {} };

function database(file, marker) {
  const db = new DatabaseSync(file);
  migrateGuildDatabase(db);
  db.exec("CREATE TABLE IF NOT EXISTS cutover_marker (value TEXT)");
  db.prepare("INSERT INTO cutover_marker VALUES (?)").run(marker);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

const marker = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare("SELECT value FROM cutover_marker").get().value; } finally { db.close(); }
};

async function stage(dataDir, { approve = true, corrupt = false } = {}) {
  const directory = path.join(dataDir, "cutover");
  await mkdir(directory, { recursive: true });
  const staged = path.join(directory, "holdfast.sqlite");
  database(staged, "rebuilt");
  const bytes = await readFile(staged);
  const db = new DatabaseSync(staged, { readOnly: true });
  const schemaVersion = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
  db.close();
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, schemaVersion }));
  if (corrupt) await writeFile(staged, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes.at(-1) ^ 0xff])]));
  if (approve) await writeFile(path.join(directory, "APPROVED"), "operator\n");
}

async function withDataDir(run) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "holdfast-cutover-"));
  try {
    database(path.join(dataDir, "holdfast.sqlite"), "original");
    return await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("nothing staged, or staged but not approved: nothing changes", () => withDataDir(async (dataDir) => {
  assert.equal((await applyApprovedCutover({ dataDir, log: quiet })).status, "none");
  await stage(dataDir, { approve: false });
  assert.equal((await applyApprovedCutover({ dataDir, log: quiet })).status, "none");
  assert.equal(marker(path.join(dataDir, "holdfast.sqlite")), "original");
}));

test("an approved, verified rebuild replaces the database; the old one is kept for going back", () => withDataDir(async (dataDir) => {
  await stage(dataDir);
  const result = await applyApprovedCutover({ dataDir, now: new Date("2026-11-20T04:00:00Z"), log: quiet });
  assert.equal(result.status, "applied");
  assert.equal(marker(path.join(dataDir, "holdfast.sqlite")), "rebuilt");
  assert.equal(marker(path.join(result.previous, "holdfast.sqlite")), "original");
  assert.ok(!existsSync(path.join(dataDir, "cutover", "APPROVED")), "an approval is used once");
  assert.ok((await readdir(path.join(dataDir, "cutover"))).some((name) => name.startsWith("DONE-")));
  assert.equal((await applyApprovedCutover({ dataDir, log: quiet })).status, "none", "a restart does not swap again");
}));

test("a staged file that does not match its manifest is refused and the database is untouched", () => withDataDir(async (dataDir) => {
  await stage(dataDir, { corrupt: true });
  const result = await applyApprovedCutover({ dataDir, log: quiet });
  assert.equal(result.status, "refused");
  assert.match(result.reason, /sha256/);
  assert.equal(marker(path.join(dataDir, "holdfast.sqlite")), "original");
  assert.ok((await readdir(path.join(dataDir, "cutover"))).some((name) => name.startsWith("REFUSED-")));
}));
