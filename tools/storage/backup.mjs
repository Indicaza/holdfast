#!/usr/bin/env node
// Backs up the production database to this PC, verified and restorable.
//
//   node tools/storage/backup.mjs --ssh srv-XXXX@ssh.ohio.render.com
//   node tools/storage/backup.mjs --local path/to/holdfast.sqlite     (any local database)
//
// Options:
//   --root DIR        where backups live (default D:\GuildweaverData, see lib.mjs)
//   --remote-db PATH  database on the server (default /data/holdfast.sqlite)
//   --full            send every table (default: tables unchanged since the
//                     last verified backup are copied from it locally)
//   --keep N          keep only the newest N verified backups afterwards
//
// What happens:
//   1. The server streams a consistent snapshot from one read transaction
//      (remote/dumpDatabase.cjs): no copy and no file on the server, the
//      application keeps running and writing, and the WAL is read as part of
//      that snapshot (never copied as a loose file).
//   2. This PC rebuilds the database from the stream in
//      backups/.partial-<id>/ and checks every table's SHA-256 against what
//      the server read.
//   3. The file gets a full integrity_check, then a restore test: it is
//      restored to a scratch location with the restore tool and verified
//      again, including that this release can open and migrate it.
//   4. Only then is it renamed to backups/<id>/ with manifest.json. An
//      interrupted run leaves only a .partial directory, removed next time;
//      earlier backups are never touched (unless --keep says so).
import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  backupsDirectory,
  buildDatabaseFromSnapshot,
  dataRoot,
  DATABASE_NAME,
  dumpScriptSource,
  fileBytes,
  isMain,
  listBackups,
  parseArgs,
  remoteNodeCommand,
  removeStalePartials,
  sha256File,
  snapshotFrames,
  sshArgs,
  timestampId,
  TOOLS_DIRECTORY,
  verifyDatabase,
  writeJson,
} from "./lib.mjs";
import { restoreBackup } from "./restore.mjs";

// The process that writes the snapshot stream to its stdout.
export function snapshotProcess({ ssh = "", local = "", remoteDb = "/data/holdfast.sqlite", spawnImpl = spawn }) {
  if (local) return spawnImpl(process.execPath, [path.join(TOOLS_DIRECTORY, "remote", "dumpDatabase.cjs"), path.resolve(local)], { stdio: ["pipe", "pipe", "pipe"] });
  if (!ssh) throw new Error("Give --ssh user@host (Render: the service's SSH address) or --local file");
  const command = remoteNodeCommand(`${dumpScriptSource()}\nmain().catch((error) => { process.stderr.write("dump failed: " + error.message + "\\n"); process.exit(1); });`, [remoteDb]);
  return spawnImpl("ssh", sshArgs(ssh, command), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
}

export async function runBackup({ ssh = "", local = "", remoteDb = "/data/holdfast.sqlite", root = dataRoot(), full = false, keep = 0,
  now = new Date(), spawnImpl = spawn, log = console } = {}) {
  await mkdir(backupsDirectory(root), { recursive: true });
  const stale = await removeStalePartials(root);
  if (stale.length) log.warn?.(`Removed unfinished backups: ${stale.join(", ")}`);
  const previous = full ? null : (await listBackups(root)).at(-1) || null;
  const id = timestampId(now);
  const partial = path.join(backupsDirectory(root), `.partial-${id}`);
  await mkdir(partial, { recursive: true });
  const target = path.join(partial, DATABASE_NAME);
  const started = Date.now();

  const child = snapshotProcess({ ssh, local, remoteDb, spawnImpl });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const spawnError = new Promise((_, reject) => child.once("error", reject));
  child.stdin.end(JSON.stringify({ base: previous ? Object.fromEntries(previous.manifest.tables.map((table) => [table.name, table.sha256])) : {} }));
  let compressed = 0;
  child.stdout.on("data", (chunk) => { compressed += chunk.length; });

  let built;
  try {
    built = await Promise.race([buildDatabaseFromSnapshot({ frames: snapshotFrames(child.stdout), target, basePath: previous?.file || null }), spawnError]);
    const { code, signal } = await exited;
    if (code !== 0) throw new Error(`Snapshot process failed (${signal || `exit ${code}`}): ${stderr.trim()}`);
  } catch (error) {
    child.kill?.();
    await rm(partial, { recursive: true, force: true });
    throw new Error(`Backup failed, nothing kept: ${error.message}${stderr ? ` (${stderr.trim().split("\n").at(-1)})` : ""}`);
  }

  // Verify the rebuilt file against what the server read, then restore it
  // somewhere else and verify that too.
  const restoreTest = path.join(partial, "restore-test", DATABASE_NAME);
  let restored;
  try {
    const verified = verifyDatabase(target, { expected: built.tables });
    if (!verified.ok) throw new Error(`verification failed: ${verified.integrity}; ${verified.mismatches.slice(0, 5).join("; ")}`);
    const sha256 = await sha256File(target);
    await writeJson(path.join(partial, "manifest.json"), { id, verified: false, file: DATABASE_NAME, sha256, bytes: await fileBytes(target), tables: verified.tables });
    restored = await restoreBackup({ from: partial, target: restoreTest, log: { info() {} } });
    if (!restored.ok) throw new Error(`restore test failed: ${restored.problems.join("; ")}`);
    const manifest = {
      format: "guildweaver-backup", version: 1, id, verified: true, createdAt: now.toISOString(),
      source: ssh ? { ssh, remoteDb } : { local: path.resolve(local) },
      server: built.header, transfer: { compressedBytes: compressed, sentTables: built.trailer.sent, keptTables: built.trailer.kept, base: previous?.id ?? null, ms: Date.now() - started },
      file: DATABASE_NAME, sha256, bytes: await fileBytes(target), digest: verified.digest, rows: built.trailer.rows,
      schemaVersion: verified.schemaVersion, migrations: verified.migrations, integrity: verified.integrity, foreignKeyViolations: verified.foreignKeyViolations,
      restoreTest: { ok: true, pendingMigrations: restored.pendingMigrations, at: new Date().toISOString() },
      tables: verified.tables,
    };
    await writeJson(path.join(partial, "manifest.json"), manifest);
    await rm(path.dirname(restoreTest), { recursive: true, force: true });
    const final = path.join(backupsDirectory(root), id);
    await rename(partial, final);
    let pruned = [];
    if (keep > 0) {
      const backups = await listBackups(root);
      for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
        await rm(old.directory, { recursive: true, force: true });
        pruned.push(old.id);
      }
    }
    return { id, directory: final, file: path.join(final, DATABASE_NAME), manifest, pruned };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw new Error(`Backup failed, nothing kept: ${error.message}`);
  }
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), { flags: ["full"], values: ["ssh", "local", "remote-db", "root", "keep"] });
    const result = await runBackup({ ssh: options.ssh, local: options.local, remoteDb: options["remote-db"] || undefined, root: dataRoot(options.root),
      full: options.full === true, keep: Number(options.keep) || 0 });
    const { manifest } = result;
    console.log(JSON.stringify({ backup: result.directory, sha256: manifest.sha256, bytes: manifest.bytes, schemaVersion: manifest.schemaVersion,
      integrity: manifest.integrity, restoreTest: manifest.restoreTest.ok, rows: manifest.rows, transfer: manifest.transfer, pruned: result.pruned }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
