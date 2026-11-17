#!/usr/bin/env node
// Restores a verified backup to a new database file and proves it is usable.
//
//   node tools/storage/restore.mjs latest D:\restore\holdfast.sqlite
//   node tools/storage/restore.mjs 20261117T043000Z D:\restore\holdfast.sqlite --root D:\GuildweaverData
//
// The target must not exist. The backup's file must match its manifest's
// SHA-256; it is copied with SQLite's online backup API, then the copy is
// checked: integrity_check, every table's content digest against the
// manifest, and whether this release of the website can open it (which
// migrations it would still apply).
//
// To put a restored database into production, use the cutover path in
// README.md (upload.mjs, then approve): never copy over the live file.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { backendModule, copyDatabase, dataRoot, DATABASE_NAME, findBackup, isMain, parseArgs, sha256File, verifyDatabase } from "./lib.mjs";

async function manifestOf(from, root) {
  if (existsSync(path.join(from, "manifest.json"))) return { directory: path.resolve(from), manifest: JSON.parse(await readFile(path.join(from, "manifest.json"), "utf8")) };
  const found = await findBackup(root, from);
  return { directory: found.directory, manifest: found.manifest };
}

export async function restoreBackup({ from = "latest", target, root = null, log = console } = {}) {
  if (!target) throw new Error("Give the file to restore to");
  const destination = path.resolve(target);
  if (existsSync(destination)) throw new Error(`Refusing to overwrite ${destination}`);
  const { directory, manifest } = await manifestOf(from, root ?? dataRoot());
  const source = path.join(directory, manifest.file || DATABASE_NAME);
  const problems = [];
  if ((await sha256File(source)) !== manifest.sha256) problems.push("the backup file does not match its manifest checksum");
  if (problems.length) return { ok: false, problems };
  await mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  await rm(partial, { force: true });
  await copyDatabase(source, partial);
  const verified = verifyDatabase(partial, { expected: manifest.tables });
  if (verified.integrity !== "ok") problems.push(`integrity: ${verified.integrity}`);
  problems.push(...verified.mismatches);
  // Can this release open it? Read which migrations it would still apply,
  // without applying them to the restored file.
  const { pendingGuildMigrations } = await backendModule("Data/database.js");
  const db = new DatabaseSync(partial, { readOnly: true });
  let pendingMigrations;
  try {
    pendingMigrations = pendingGuildMigrations(db).map((migration) => migration.version);
  } finally {
    db.close();
  }
  if (problems.length) {
    await rm(partial, { force: true });
    return { ok: false, problems };
  }
  await rename(partial, destination);
  for (const suffix of ["-wal", "-shm"]) await rm(`${partial}${suffix}`, { force: true });
  log.info?.(`Restored ${directory} to ${destination}`);
  return { ok: true, problems, target: destination, schemaVersion: verified.schemaVersion, pendingMigrations, digest: verified.digest, integrity: verified.integrity };
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), { values: ["root"] });
    const [from, target] = options._;
    if (!target) throw new Error("Usage: node tools/storage/restore.mjs <backup id|latest|directory> <new database file> [--root DIR]");
    const result = await restoreBackup({ from, target, root: dataRoot(options.root) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
