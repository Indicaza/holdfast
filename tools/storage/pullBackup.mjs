#!/usr/bin/env node
// Backs up production to this PC without holding a long read transaction on
// the live database (the scheduled backup uses this).
//
//   node tools/storage/pullBackup.mjs --ssh srv-XXXX@ssh.ohio.render.com [--root DIR] [--keep N]
//
// backup.mjs --ssh streams from one read transaction. While the website keeps
// writing, SQLite cannot checkpoint past that reader, so the WAL grows for
// the whole transfer (hundreds of MB a minute while Auction House ingestion
// runs). This takes the slow part off the live database instead:
//   1. The server pauses writes and runs VACUUM INTO /data/snapshot/
//      (remote/snapshotDatabase.cjs, detached, with a free-space watchdog).
//      Writes resume as soon as the copy is written.
//   2. The static snapshot is downloaded in 64 MiB chunks, each checked
//      against the server's SHA-256; an interrupted chunk is retried and the
//      joined file is checked again as a whole.
//   3. backup.mjs --local verifies it, restore-tests it and registers it in
//      backups/<id>/ exactly like any other backup.
//   4. The snapshot on the server and the downloaded copy are removed.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createGunzip } from "node:zlib";

import { runBackup } from "./backup.mjs";
import { dataRoot, isMain, parseArgs, remoteNodeCommand, sshArgs } from "./lib.mjs";

const TOOLS = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REMOTE_DB = "/data/holdfast.sqlite";
const REMOTE_DIR = "/data/snapshot";
const CHUNK_MIB = 64;
const PARALLEL = 3;

function ssh(target, command, { input = null, onStdout = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", sshArgs(target, command, ["-o", "LogLevel=ERROR"]), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (c) => { err += c; });
    const out = onStdout ? onStdout(child.stdout) : (async () => { let s = ""; for await (const c of child.stdout) s += c; return s; })();
    out.catch?.(() => {});
    child.once("error", reject);
    child.once("close", async (code) => {
      try { const value = await out; code === 0 ? resolve(value) : reject(new Error(`ssh exited ${code}: ${err.trim().slice(-300)}`)); } catch (error) { reject(error); }
    });
    child.stdin.end(input ?? "");
  });
}

const HASHER = `const tick=setInterval(()=>console.log("."),10000);const c=require("node:crypto"),f=require("node:fs");const file=process.argv[1],size=f.statSync(file).size,CH=${CHUNK_MIB}*1048576;const all=c.createHash("sha256");const chunks=[];let cur=c.createHash("sha256"),n=0;const s=f.createReadStream(file,{highWaterMark:1048576});s.on("data",d=>{all.update(d);let o=0;while(o<d.length){const t=Math.min(d.length-o,CH-n);cur.update(d.subarray(o,o+t));n+=t;o+=t;if(n===CH){chunks.push(cur.digest("hex"));cur=c.createHash("sha256");n=0}}});s.on("end",()=>{clearInterval(tick);if(n)chunks.push(cur.digest("hex"));console.log(JSON.stringify({size,sha256:all.digest("hex"),chunks}))});`;

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function remoteSnapshot(target, id, log) {
  const file = `${REMOTE_DIR}/holdfast-${id}.sqlite`;
  const script = await readFile(path.join(TOOLS, "remote", "snapshotDatabase.cjs"));
  await ssh(target, `mkdir -p ${REMOTE_DIR} && cat > ${REMOTE_DIR}/snapshotDatabase.cjs`, { input: script });
  await ssh(target, `cd ${REMOTE_DIR} && nohup node snapshotDatabase.cjs ${REMOTE_DB} ${file} > /dev/null 2>&1 &`);
  for (let waited = 0; waited < 3600; waited += 15) {
    await sleep(15000);
    let lines = [];
    try { lines = (await ssh(target, `cat ${file}.log 2>/dev/null || true`)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (error) { log.warn?.(`snapshot status: ${error.message}`); continue; }
    const last = lines.at(-1);
    if (!last) continue;
    if (last.step === "done") {
      if (last.quickCheck !== "ok") throw new Error(`Server snapshot failed quick_check: ${last.quickCheck}`);
      log.log?.(`server snapshot ${file}: ${last.targetBytes} bytes, schema ${last.schemaVersion}, ${last.seconds}s with writes paused`);
      return file;
    }
    if (["failed", "aborted", "refused"].includes(last.step)) throw new Error(`Server snapshot ${last.step}: ${last.reason || last.error || ""}`);
  }
  throw new Error("Server snapshot did not finish within an hour");
}

async function download(target, remote, directory, log) {
  await mkdir(path.join(directory, "chunks"), { recursive: true });
  const manifest = JSON.parse((await ssh(target, remoteNodeCommand(HASHER, [remote]))).trim().split("\n").at(-1));
  const chunkPath = (i) => path.join(directory, "chunks", `${String(i).padStart(5, "0")}.bin`);
  let next = 0;
  const fetchChunk = async (i) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const tmp = `${chunkPath(i)}.tmp`;
      try {
        await ssh(target, `dd if=${remote} bs=1048576 skip=${i * CHUNK_MIB} count=${CHUNK_MIB} 2>/dev/null | gzip -1`, {
          onStdout: (stdout) => new Promise((res, rej) => { stdout.pipe(createGunzip()).on("error", rej).pipe(createWriteStream(tmp)).on("finish", res).on("error", rej); }),
        });
        if ((await sha256(tmp)) !== manifest.chunks[i]) throw new Error("chunk hash mismatch");
        await rename(tmp, chunkPath(i));
        return;
      } catch (error) {
        log.warn?.(`chunk ${i} attempt ${attempt}: ${error.message.slice(0, 160)}`);
        await rm(tmp, { force: true });
      }
    }
    throw new Error(`chunk ${i} failed 5 times`);
  };
  await Promise.all(Array.from({ length: PARALLEL }, async () => { while (next < manifest.chunks.length) await fetchChunk(next++); }));
  const file = path.join(directory, "holdfast.sqlite");
  const out = createWriteStream(file);
  for (let i = 0; i < manifest.chunks.length; i += 1) {
    await new Promise((res, rej) => createReadStream(chunkPath(i)).on("end", res).on("error", rej).pipe(out, { end: false }));
  }
  await new Promise((res) => out.end(res));
  await rm(path.join(directory, "chunks"), { recursive: true, force: true });
  if ((await stat(file)).size !== manifest.size || (await sha256(file)) !== manifest.sha256) throw new Error("Downloaded snapshot does not match the server's SHA-256");
  await writeFile(path.join(directory, "remote.json"), JSON.stringify({ remote, size: manifest.size, sha256: manifest.sha256 }, null, 2));
  log.log?.(`downloaded ${manifest.size} bytes, sha256 ${manifest.sha256} verified`);
  return file;
}

export async function pullBackup({ target, root = dataRoot(), keep = 0, now = new Date(), log = console }) {
  const id = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const directory = path.join(root, "pulls", id);
  let remote = null;
  try {
    remote = await remoteSnapshot(target, id, log);
    const file = await download(target, remote, directory, log);
    const result = await runBackup({ local: file, root, keep, now, log });
    log.log?.(`backup ${result.id} verified: ${result.file}`);
    return result;
  } finally {
    if (remote) await ssh(target, `rm -f ${remote} ${remote}.log`).catch((error) => log.warn?.(`could not remove ${remote}: ${error.message}`));
    if (existsSync(directory)) await rm(directory, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), { values: ["ssh", "root", "keep"] });
    if (!options.ssh) throw new Error("Give --ssh (the service's SSH address, from the Render dashboard)");
    const result = await pullBackup({ target: options.ssh, root: dataRoot(options.root), keep: Number(options.keep) || 0 });
    console.log(JSON.stringify({ id: result.id, file: result.file, bytes: result.manifest?.bytes, sha256: result.manifest?.sha256 }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
