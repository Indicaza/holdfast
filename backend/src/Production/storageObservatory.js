import { appendFile, readdir, readFile, stat, statfs, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { listStartupBackups } from '../Data/startupBackup.js'
import { offsiteBackupHealth } from '../Data/offsiteBackup.js'

// Production storage observatory: read-only, bounded reports about disk
// and database usage for administrators (and tools acting for them).
//
// - Light figures (disk, files, page and free-page counts) are read on
//   demand and cached for a minute: a few stat calls and pragmas.
// - Heavy figures (per-table and per-index bytes from dbstat, ingestion
//   counts) are collected every few hours in a worker thread with its own
//   read-only connection, never on the request thread.
// - Each heavy collection appends a growth sample to
//   observatory/samples.jsonl in the data directory (bounded).
//
// Reports contain sizes, counts and timestamps only: no stored values,
// member or Discord identifiers, credentials or arbitrary paths.

export const REPORT_VERSION = 1
const LIGHT_TTL_MS = 60_000
export const HEAVY_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_SAMPLES = 1000
const FIRST_HEAVY_DELAY_MS = 5 * 60 * 1000

// Disk and growth alerts, from the cheap disk figures and the growth
// samples. Pure, so it is tested without a disk.
//   disk_70 / disk_85 / disk_95   share of the disk in use
//   rapid_growth                  last day's growth over 3x the baseline
//                                 (and over 100 MiB/day)
//   full_within_14_days           at the baseline rate
// Growth alerts need a baseline: at least 4 samples over at least 48 hours,
// otherwise growth reports "insufficient_data" and raises nothing.
export const DISK_THRESHOLDS = Object.freeze([95, 85, 70]);
const MIN_BASELINE_SAMPLES = 4;
const MIN_BASELINE_HOURS = 48;
const RAPID_FACTOR = 3;
const RAPID_MIN_BYTES_PER_DAY = 100 * 1024 * 1024;
const FULL_SOON_DAYS = 14;

export function evaluateStorageHealth({ disk, samples = [], now = Date.now() }) {
  const alerts = [];
  const usedPct = disk.capacityBytes > 0 ? Math.round((disk.usedBytes / disk.capacityBytes) * 1000) / 10 : null;
  const threshold = DISK_THRESHOLDS.find((limit) => usedPct !== null && usedPct >= limit);
  if (threshold) alerts.push(`disk_${threshold}`);

  const usable = samples.filter((sample) => Number.isFinite(sample.freeDiskBytes) && Number.isFinite(Date.parse(sample.at)))
    .filter((sample) => Date.parse(sample.at) >= now - 7 * 86400_000)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rate = (from, to) => {
    const days = (Date.parse(to.at) - Date.parse(from.at)) / 86400_000;
    return days > 0 ? (from.freeDiskBytes - to.freeDiskBytes) / days : null;
  };
  let growth = { baseline: "insufficient_data", samples: usable.length };
  let daysUntilFull = null;
  const spanHours = usable.length > 1 ? (Date.parse(usable.at(-1).at) - Date.parse(usable[0].at)) / 3600_000 : 0;
  if (usable.length >= MIN_BASELINE_SAMPLES && spanHours >= MIN_BASELINE_HOURS) {
    const recentStart = usable.find((sample) => Date.parse(sample.at) >= Date.parse(usable.at(-1).at) - 86400_000);
    const before = usable.filter((sample) => Date.parse(sample.at) <= Date.parse(recentStart.at));
    const baselineRate = before.length > 1 ? rate(before[0], before.at(-1)) : rate(usable[0], usable.at(-1));
    const recentRate = recentStart !== usable.at(-1) ? rate(recentStart, usable.at(-1)) : null;
    growth = { baseline: "ok", samples: usable.length, baselineBytesPerDay: Math.round(baselineRate ?? 0), recentBytesPerDay: recentRate === null ? null : Math.round(recentRate) };
    if (recentRate !== null && recentRate > RAPID_MIN_BYTES_PER_DAY && recentRate > RAPID_FACTOR * Math.max(baselineRate ?? 0, 0)) alerts.push("rapid_growth");
    const worst = Math.max(baselineRate ?? 0, recentRate ?? 0);
    if (worst > 0) {
      daysUntilFull = Math.round((disk.freeBytes / worst) * 10) / 10;
      if (daysUntilFull < FULL_SOON_DAYS) alerts.push("full_within_14_days");
    }
  }
  const status = alerts.some((alert) => ["disk_95", "full_within_14_days"].includes(alert)) ? "critical" : alerts.length ? "warning" : "ok";
  return { status, alerts, disk: { usedPct, capacityBytes: disk.capacityBytes, freeBytes: disk.freeBytes }, growth, daysUntilFull };
}

async function bytes(file) {
  try { return (await stat(file)).size } catch { return 0 }
}

// Sizes of everything in the data directory, one level into folders.
async function directoryInventory(directory) {
  const entries = []
  let items = []
  try { items = await readdir(directory, { withFileTypes: true }) } catch { return entries }
  for (const item of items) {
    const full = path.join(directory, item.name)
    if (item.isDirectory()) {
      let total = 0
      let files = 0
      for (const child of await readdir(full, { withFileTypes: true }).catch(() => [])) {
        if (!child.isFile()) continue
        total += await bytes(path.join(full, child.name))
        files += 1
      }
      entries.push({ name: `${item.name}/`, kind: 'directory', files, bytes: total })
    } else if (item.isFile()) {
      entries.push({ name: item.name, kind: classify(item.name), bytes: await bytes(full) })
    }
  }
  return entries.sort((a, b) => b.bytes - a.bytes)
}

function classify(name) {
  if (name === 'holdfast.sqlite') return 'database'
  if (name.endsWith('-wal')) return 'wal'
  if (name.endsWith('-shm')) return 'shm'
  if (name.endsWith('.json')) return 'status'
  return 'other'
}

function sqliteFigures(databaseFile) {
  const db = new DatabaseSync(databaseFile, { readOnly: true })
  try {
    const value = (sql) => Object.values(db.prepare(sql).get() ?? {})[0]
    const pageSize = Number(value('PRAGMA page_size'))
    const pageCount = Number(value('PRAGMA page_count'))
    const freelist = Number(value('PRAGMA freelist_count'))
    return {
      pageSize, pageCount, freelistPages: freelist, freelistBytes: freelist * pageSize,
      journalMode: value('PRAGMA journal_mode'),
      schemaVersion: Number(value('SELECT MAX(version) FROM schema_migrations')) || null,
    }
  } finally {
    db.close()
  }
}

function runWorker({ databaseFile, now }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./storageStatsWorker.js', import.meta.url), { workerData: { databaseFile, now } })
    worker.once('message', (message) => (message.ok ? resolve(message.result) : reject(new Error(message.error))))
    worker.once('error', reject)
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`storage statistics worker exited with ${code}`)) })
  })
}

export function createStorageObservatory({
  dataDir,
  databaseFile = path.join(dataDir, 'holdfast.sqlite'),
  backupStatus = () => offsiteBackupHealth(),
  clock = () => Date.now(),
  statfsImpl = statfs,
  collectHeavy = runWorker,
  log = console,
} = {}) {
  let light = null
  let heavy = null
  let heavyRunning = null
  let lastHeavyError = null
  const samplesFile = path.join(dataDir, 'observatory', 'samples.jsonl')
  const timers = []

  async function lightReport() {
    if (light && clock() - light.at < LIGHT_TTL_MS) return light.value
    const fs = await statfsImpl(dataDir)
    const capacity = Number(fs.blocks) * Number(fs.bsize)
    const free = Number(fs.bavail) * Number(fs.bsize)
    const files = await directoryInventory(dataDir)
    const value = {
      disk: { capacityBytes: capacity, freeBytes: free, usedBytes: capacity - Number(fs.bfree) * Number(fs.bsize) },
      database: { fileBytes: await bytes(databaseFile), walBytes: await bytes(`${databaseFile}-wal`), shmBytes: await bytes(`${databaseFile}-shm`), ...sqliteFigures(databaseFile) },
      files,
    }
    light = { at: clock(), value }
    return value
  }

  async function readSamples() {
    try {
      return (await readFile(samplesFile, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }

  async function appendSample(sample) {
    await mkdir(path.dirname(samplesFile), { recursive: true })
    const samples = await readSamples()
    if (samples.length >= MAX_SAMPLES) {
      await writeFile(samplesFile, `${[...samples.slice(-(MAX_SAMPLES - 1)), sample].map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    } else {
      await appendFile(samplesFile, `${JSON.stringify(sample)}\n`)
    }
  }

  // Collects heavy statistics now (one collection at a time).
  function refresh() {
    heavyRunning ??= (async () => {
      const started = clock()
      try {
        const result = await collectHeavy({ databaseFile, now: Math.floor(clock() / 1000) })
        heavy = { collectedAt: new Date(clock()).toISOString(), ...result }
        lastHeavyError = null
        const overview = await lightReport()
        const domains = {}
        for (const table of result.tables) domains[table.domain] = (domains[table.domain] ?? 0) + table.totalBytes
        await appendSample({ at: heavy.collectedAt, databaseBytes: overview.database.fileBytes, walBytes: overview.database.walBytes,
          freeDiskBytes: overview.disk.freeBytes, freelistBytes: overview.database.freelistBytes, domains })
        log.info?.(JSON.stringify({ event: 'storage_statistics', ms: clock() - started, tables: result.tables.length }))
      } catch (error) {
        lastHeavyError = { at: new Date(clock()).toISOString(), error: String(error.message).slice(0, 200) }
        log.error?.('[storage] statistics collection failed', error.message)
      } finally {
        heavyRunning = null
      }
    })()
    return heavyRunning
  }

  function growth(samples, days) {
    const since = clock() - days * 86400 * 1000
    const window = samples.filter((sample) => Date.parse(sample.at) >= since)
    if (window.length < 2) return null
    const first = window[0]
    const last = window.at(-1)
    const hours = (Date.parse(last.at) - Date.parse(first.at)) / 3600_000
    if (hours <= 0) return null
    const perDay = (value) => Math.round((value / hours) * 24)
    const domains = {}
    for (const name of new Set([...Object.keys(first.domains), ...Object.keys(last.domains)])) {
      domains[name] = perDay((last.domains[name] ?? 0) - (first.domains[name] ?? 0))
    }
    return { from: first.at, to: last.at, samples: window.length, databaseBytesPerDay: perDay(last.databaseBytes - first.databaseBytes), domainsBytesPerDay: domains }
  }

  function envelope(section, body) {
    return { version: REPORT_VERSION, section, generatedAt: new Date(clock()).toISOString(), ...body }
  }

  // Cheap: cached disk figures and the samples file. Safe for readiness.
  let healthCache = null;
  async function health() {
    if (healthCache && clock() - healthCache.at < LIGHT_TTL_MS) return healthCache.value;
    const fs = await statfsImpl(dataDir);
    const capacity = Number(fs.blocks) * Number(fs.bsize);
    const disk = { capacityBytes: capacity, freeBytes: Number(fs.bavail) * Number(fs.bsize), usedBytes: capacity - Number(fs.bfree) * Number(fs.bsize) };
    const value = evaluateStorageHealth({ disk, samples: await readSamples(), now: clock() });
    healthCache = { at: clock(), value };
    return value;
  }

  const sections = {
    async overview() {
      const value = await lightReport()
      const domains = {}
      for (const table of heavy?.tables ?? []) domains[table.domain] = (domains[table.domain] ?? 0) + table.totalBytes
      const largest = Object.entries(domains).sort((a, b) => b[1] - a[1]).map(([domain, total]) => ({ domain, bytes: total }))
      return envelope('overview', { ...value, domains: largest, statisticsCollectedAt: heavy?.collectedAt ?? null, statisticsError: lastHeavyError })
    },
    async tables() {
      if (!heavy) return null
      return envelope('tables', { collectedAt: heavy.collectedAt, durationMs: heavy.durationMs, tables: heavy.tables })
    },
    async backups() {
      const startup = await listStartupBackups()
      return envelope('backups', {
        startup: { count: startup.length, bytes: startup.reduce((sum, entry) => sum + entry.bytes, 0),
          snapshots: startup.map((entry) => ({ name: entry.name, kind: entry.kind, bytes: entry.bytes, createdAt: entry.meta?.createdAt ?? null,
            fromVersion: entry.meta?.fromVersion ?? null, toVersion: entry.meta?.toVersion ?? null })) },
        offsite: await backupStatus(),
      })
    },
    async ingestion() {
      if (!heavy) return null
      return envelope('ingestion', { collectedAt: heavy.collectedAt, sources: heavy.ingestion })
    },
    async growth() {
      const samples = await readSamples()
      return envelope('growth', { samples: samples.length, last24h: growth(samples, 1), last7d: growth(samples, 7), last30d: growth(samples, 30) })
    },
    async health() {
      return envelope('health', await health());
    },
    async maintenance() {
      if (!heavy) return null
      return envelope('maintenance', { collectedAt: heavy.collectedAt, market: heavy.maintenance, statisticsError: lastHeavyError })
    },
  }

  return {
    sections: Object.keys(sections),
    async report(section) {
      const build = sections[section]
      if (!build) return { status: 404 }
      const body = await build()
      if (!body) {
        refresh()
        return { status: 202, body: envelope(section, { status: 'collecting' }) }
      }
      return { status: 200, body }
    },
    refresh,
    health,
    start() {
      const first = setTimeout(refresh, FIRST_HEAVY_DELAY_MS)
      const every = setInterval(refresh, HEAVY_INTERVAL_MS)
      first.unref?.()
      every.unref?.()
      timers.push(first, every)
      return () => timers.forEach((timer) => clearTimeout(timer))
    },
  }
}
