import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { guildDatabaseFile } from "../Data/database.js";
import { ARCHIVE_PAGE_BYTES, ARCHIVE_BULK_BYTES, archiveResultLimit } from "./archiveLimits.js";

export function runArchiveWorker(query, databaseFile = guildDatabaseFile()) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archiveWorker.js", import.meta.url), { workerData: { query, databaseFile }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
    let value, failure;
    const timer = setTimeout(() => {
      failure = new Error("Archive worker exceeded its deadline");
      void worker.terminate();
    }, 5000);
    worker.once("message", (message) => { value = message; });
    worker.once("error", (error) => { failure = error; });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0 || !value?.ok) reject(failure || new Error("Archive worker failed"));
      else resolve(value.result);
    });
  });
}

export function createArchiveQueue({ run = runArchiveWorker, now = Date.now, capacity = 32, intervalMs = 750, ttlMs = 120000, maxResultBytes = ARCHIVE_PAGE_BYTES, maxBulkResultBytes = ARCHIVE_BULK_BYTES, maxReservedBytes = capacity * maxResultBytes } = {}) {
  const jobs = new Map();
  const reservation = query => archiveResultLimit(query) === ARCHIVE_BULK_BYTES ? maxBulkResultBytes : maxResultBytes;
  const reservedBytes = () => [...jobs.values()].reduce((sum, job) => sum + (job.status === "failed" ? 0 : job.reservedBytes), 0);
  let active = null;
  let timer = null;
  const expire = () => {
    for (const [id, job] of jobs) {
      if (job !== active && (now() - job.touchedAt >= ttlMs || now() - job.createdAt >= 600_000)) jobs.delete(id);
    }
  };
  const position = (job) => [...jobs.values()].filter(entry => entry.status === "queued").indexOf(job) + 1;
  const view = (job) => ({
    ticket: job.id, status: job.status, position: job.status === "queued" ? position(job) : 0,
    retryAfterSeconds: 2,
    ...(job.status === "ready" ? { result: job.result } : {}),
    ...(job.status === "failed" ? { error: job.error } : {}),
  });
  const schedule = () => {
    if (timer || active || ![...jobs.values()].some(job => job.status === "queued")) return;
    timer = setTimeout(async () => {
      timer = null;
      expire();
      const job = [...jobs.values()].find(entry => entry.status === "queued");
      if (!job) return;
      active = job;
      job.status = "running";
      try {
        if (!job.authorized()) throw new Error("Archive authorization expired");
        const result = await run(job.query, job.databaseFile);
        if (!result) { job.status = "failed"; job.error = "invalid_archive_query"; }
        else if (Buffer.byteLength(JSON.stringify(result)) > job.reservedBytes) { job.status = "failed"; job.error = "archive_batch_too_large"; }
        else { job.status = "ready"; job.result = result; }
      } catch {
        job.status = "failed";
        job.error = "archive_unavailable";
      } finally {
        job.touchedAt = now();
        active = null;
        schedule();
      }
    }, intervalMs);
    timer.unref?.();
  };
  return {
    submit({ owner, query, authorized, databaseFile }) {
      expire();
      const key = JSON.stringify(query);
      const existing = [...jobs.values()].find(job => job.owner === owner && job.key === key && job.status !== "failed");
      if (existing) { existing.touchedAt = now(); return view(existing); }
      if ([...jobs.values()].some(job => job.owner === owner && ["queued", "running"].includes(job.status))) return { status: "busy", retryAfterSeconds: 3 };
      // One retained result per owner. A new page supersedes completed pages.
      for (const [id, job] of jobs) if (job.owner === owner && job !== active) jobs.delete(id);
      const bytes = reservation(query);
      if (jobs.size >= capacity || reservedBytes() + bytes > maxReservedBytes) return { status: "full", retryAfterSeconds: 5 };
      const job = { id: randomUUID(), owner, query, key, authorized, databaseFile, reservedBytes: bytes, status: "queued", createdAt: now(), touchedAt: now() };
      jobs.set(job.id, job);
      schedule();
      return view(job);
    },
    poll(owner, ticket) {
      expire();
      const job = jobs.get(ticket);
      if (!job || job.owner !== owner) return null;
      job.touchedAt = now();
      return view(job);
    },
    cancel(owner, ticket) {
      const job = jobs.get(ticket);
      if (!job || job.owner !== owner || job === active) return false;
      jobs.delete(ticket);
      return true;
    },
  };
}
