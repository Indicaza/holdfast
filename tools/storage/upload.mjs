#!/usr/bin/env node
// Stages a verified rebuild on the production disk for cutover. Operator only.
//
//   node tools/storage/upload.mjs status  --ssh srv-XXXX@ssh.ohio.render.com
//   node tools/storage/upload.mjs stage   --ssh ... [--rebuild <id>|latest] [--root DIR]
//   node tools/storage/upload.mjs approve --ssh ... [--rebuild <id>|latest]
//
// status   disk space and the files on /data (database, WAL, old startup
//          snapshots, anything staged), read only.
// stage    refuses unless the rebuild's manifest says it was verified and
//          the disk has room for it plus 512 MiB. Streams the file to
//          /data/cutover/holdfast.sqlite.partial, has the server compute
//          its SHA-256, and only on a match renames it and writes
//          manifest.json next to it. Production is not changed: the running
//          website never looks at /data/cutover.
// approve  checks the staged file's SHA-256 on the server again and creates
//          /data/cutover/APPROVED. The next start of the website (a deploy
//          or a restart) swaps it in (backend/src/Data/databaseCutover.js),
//          keeping the old database in /data/cutover/previous-<time>/.
//
// Nothing here deletes anything on the server.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createGzip } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { dataRoot, fileBytes, isMain, parseArgs, remoteNodeCommand, sha256File, sshArgs } from "./lib.mjs";

const REMOTE_DIR = "/data/cutover";
const HEADROOM = 512 * 1024 ** 2;

function run(command, args, { input = null, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`))));
    if (input && typeof input.pipe === "function") input.pipe(child.stdin);
    else child.stdin.end(input ?? "");
  });
}

const STATUS = `
const fs = require("node:fs"); const path = require("node:path");
const list = (dir) => { try { return fs.readdirSync(dir).map((name) => { const s = fs.statSync(path.join(dir, name)); return { name, bytes: s.isDirectory() ? null : s.size, dir: s.isDirectory() }; }); } catch { return []; } };
const s = fs.statfsSync("/data");
console.log(JSON.stringify({ freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize, data: list("/data"), cutover: list("/data/cutover"), deployBackups: list("/data/deploy-backups") }));
`;

const HASH = `
const crypto = require("node:crypto"); const fs = require("node:fs");
const file = process.argv[1]; const hash = crypto.createHash("sha256");
const stream = fs.createReadStream(file); stream.on("data", (c) => hash.update(c));
stream.on("end", () => console.log(JSON.stringify({ sha256: hash.digest("hex"), bytes: fs.statSync(file).size })));
`;

const FINISH = `
const fs = require("node:fs");
const manifest = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
fs.writeFileSync("/data/cutover/manifest.json", JSON.stringify(manifest, null, 2));
fs.renameSync("/data/cutover/holdfast.sqlite.partial", "/data/cutover/holdfast.sqlite");
console.log("staged");
`;

const APPROVE = `
const fs = require("node:fs");
fs.writeFileSync("/data/cutover/APPROVED", JSON.stringify({ approvedAt: new Date().toISOString(), by: "tools/storage/upload.mjs" }) + "\\n");
console.log("approved");
`;

async function rebuildOf(root, which = "latest") {
  const directory = path.join(root, "rebuilds");
  const ids = (await readdir(directory)).sort();
  const id = which === "latest" ? ids.at(-1) : which;
  if (!id || !ids.includes(id)) throw new Error(`No rebuild ${which} in ${directory}`);
  const manifest = JSON.parse(await readFile(path.join(directory, id, "manifest.json"), "utf8"));
  return { id, file: path.join(directory, id, manifest.file), manifest };
}

export async function remoteStatus(ssh, options = {}) {
  return JSON.parse(await run("ssh", sshArgs(ssh, remoteNodeCommand(STATUS)), options));
}

export async function stage({ ssh, root = dataRoot(), rebuild = "latest", spawnImpl = spawn }) {
  const built = await rebuildOf(root, rebuild);
  if (!built.manifest.ok) throw new Error(`Rebuild ${built.id} is not verified; see its report.md`);
  if ((await sha256File(built.file)) !== built.manifest.sha256) throw new Error("The rebuilt file does not match its manifest");
  const bytes = await fileBytes(built.file);
  const status = await remoteStatus(ssh, { spawnImpl });
  if (status.freeBytes < bytes + HEADROOM) {
    throw new Error(`Not enough room on /data: ${Math.round(status.freeBytes / 1024 ** 2)} MiB free, ${Math.round((bytes + HEADROOM) / 1024 ** 2)} MiB needed. See README.md (freeing space).`);
  }
  await run("ssh", sshArgs(ssh, `mkdir -p ${REMOTE_DIR} && gunzip -c > ${REMOTE_DIR}/holdfast.sqlite.partial`), { input: createReadStream(built.file).pipe(createGzip({ level: 6 })), spawnImpl });
  const remote = JSON.parse(await run("ssh", sshArgs(ssh, remoteNodeCommand(HASH, [`${REMOTE_DIR}/holdfast.sqlite.partial`])), { spawnImpl }));
  if (remote.sha256 !== built.manifest.sha256 || remote.bytes !== bytes) throw new Error("The uploaded file does not match: not staged (the .partial file can be removed)");
  const manifest = { sha256: built.manifest.sha256, bytes, schemaVersion: built.manifest.schemaVersion, rebuild: built.id, backup: built.manifest.backup, stagedAt: new Date().toISOString() };
  await run("ssh", sshArgs(ssh, remoteNodeCommand(FINISH, [Buffer.from(JSON.stringify(manifest)).toString("base64")])), { spawnImpl });
  return { staged: `${REMOTE_DIR}/holdfast.sqlite`, ...manifest };
}

export async function approve({ ssh, root = dataRoot(), rebuild = "latest", spawnImpl = spawn }) {
  const built = await rebuildOf(root, rebuild);
  const remote = JSON.parse(await run("ssh", sshArgs(ssh, remoteNodeCommand(HASH, [`${REMOTE_DIR}/holdfast.sqlite`])), { spawnImpl }));
  if (remote.sha256 !== built.manifest.sha256) throw new Error("The staged file is not this rebuild: not approved");
  await run("ssh", sshArgs(ssh, remoteNodeCommand(APPROVE)), { spawnImpl });
  return { approved: true, rebuild: built.id, sha256: remote.sha256, next: "Deploy or restart the service: the database is swapped at startup." };
}

if (isMain(import.meta.url)) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const options = parseArgs(rest, { values: ["ssh", "root", "rebuild"] });
    if (!options.ssh) throw new Error("Give --ssh (the service's SSH address, from the Render dashboard)");
    const root = dataRoot(options.root);
    let result;
    if (command === "status") result = await remoteStatus(options.ssh);
    else if (command === "stage") result = await stage({ ssh: options.ssh, root, rebuild: options.rebuild || "latest" });
    else if (command === "approve") result = await approve({ ssh: options.ssh, root, rebuild: options.rebuild || "latest" });
    else throw new Error("Usage: node tools/storage/upload.mjs status|stage|approve --ssh user@host");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
