import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { guildDatabaseFile } from "./database.js";
import { runtimeDataDirectory } from "./runtimeData.js";

// Replaces the database with one rebuilt offline (tools/storage/rebuild.mjs)
// when, and only when, an operator staged it and approved it:
//
//   <data>/cutover/holdfast.sqlite   the rebuilt database (tools/storage/upload.mjs)
//   <data>/cutover/manifest.json     { sha256, bytes, schemaVersion } of that file
//   <data>/cutover/APPROVED          created by the operator, last
//
// Runs at startup before anything opens the database. The staged file must
// match its manifest (size and SHA-256) and pass SQLite's quick_check;
// otherwise nothing changes and startup continues on the current database.
// The current database (with its -wal and -shm) is moved, not copied, to
// <data>/cutover/previous-<time>/ so going back is a rename. APPROVED becomes
// DONE-<time>.json (or REFUSED-<time>.json) so a restart never swaps twice.
export const CUTOVER_DIRECTORY = "cutover";

function stamp(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare("PRAGMA quick_check").all().map((row) => Object.values(row)[0]);
    const schemaVersion = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? null;
    return { quickCheck: check.length === 1 && check[0] === "ok" ? "ok" : check.slice(0, 5).join("; "), schemaVersion };
  } finally {
    db.close();
  }
}

export async function applyApprovedCutover({ dataDir = runtimeDataDirectory(), now = new Date(), log = console } = {}) {
  const directory = path.join(dataDir, CUTOVER_DIRECTORY);
  const approval = path.join(directory, "APPROVED");
  if (!existsSync(approval)) return { status: "none" };
  const staged = path.join(directory, "holdfast.sqlite");
  const target = path.join(dataDir, path.basename(guildDatabaseFile()));
  const when = stamp(now);
  const finish = async (status, detail) => {
    const record = { status, at: now.toISOString(), ...detail };
    await writeFile(path.join(directory, `${status === "applied" ? "DONE" : "REFUSED"}-${when}.json`), `${JSON.stringify(record, null, 2)}\n`);
    await rename(approval, path.join(directory, `APPROVED.${status}-${when}`));
    return record;
  };
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    const bytes = (await stat(staged)).size;
    if (bytes !== manifest.bytes) return finish("refused", { reason: `size ${bytes} does not match manifest ${manifest.bytes}` });
    const sha256 = await sha256File(staged);
    if (sha256 !== manifest.sha256) return finish("refused", { reason: "sha256 does not match manifest" });
    const checked = inspect(staged);
    if (checked.quickCheck !== "ok") return finish("refused", { reason: `quick_check: ${checked.quickCheck}` });
    if (manifest.schemaVersion !== undefined && checked.schemaVersion !== manifest.schemaVersion) {
      return finish("refused", { reason: `schema version ${checked.schemaVersion} does not match manifest ${manifest.schemaVersion}` });
    }
    const previous = path.join(directory, `previous-${when}`);
    await mkdir(previous, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(`${target}${suffix}`)) await rename(`${target}${suffix}`, path.join(previous, `${path.basename(target)}${suffix}`));
    }
    await rename(staged, target);
    const record = await finish("applied", { sha256, bytes, schemaVersion: checked.schemaVersion, previous });
    log.warn?.(JSON.stringify({ event: "database_cutover", ...record }));
    return record;
  } catch (error) {
    const record = await finish("refused", { reason: String(error.message || error) }).catch(() => ({ status: "refused", reason: String(error.message || error) }));
    log.error?.(JSON.stringify({ event: "database_cutover", ...record }));
    return record;
  }
}
