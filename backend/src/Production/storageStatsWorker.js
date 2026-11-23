import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { domainOf } from './storageDomains.js'
import { createPacer } from './storagePacing.js'

// Heavy storage statistics, in a worker thread with its own read-only
// connection: dbstat reads every page of the database, which would block
// the request thread for seconds or minutes on a large file. The worker
// returns only sizes and counts, never stored values. It rests between
// short bursts: threads share the service's CPU quota, so an unpaced scan
// can starve the request thread even from a worker.

const INGESTION = [
  // [domain, table, time column] - each time column has an index.
  ['telemetry_transport', 'guildweaver_telemetry_records', 'received_at'],
  ['character_state', 'character_snapshot_ingests', 'received_at'],
  ['economy_loot', 'economic_observations', 'captured_at'],
  ['auction_house', 'market_snapshots', 'observed_at'],
]

const rest = new Int32Array(new SharedArrayBuffer(4))
const pace = createPacer({ sleep: (ms) => Atomics.wait(rest, 0, 0, ms) })

// dbstat's aggregate form, summed here one page at a time so the scan can rest.
function btreeSizes(db) {
  const sizes = new Map()
  for (const page of db.prepare('SELECT name, pgsize, ncell FROM dbstat').iterate()) {
    const entry = sizes.get(page.name) ?? { name: page.name, bytes: 0, cells: 0 }
    entry.bytes += page.pgsize
    entry.cells += page.ncell
    sizes.set(page.name, entry)
    pace()
  }
  return sizes.values()
}

function collect({ databaseFile, now }) {
  const db = new DatabaseSync(databaseFile, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON')
    const objects = db.prepare("SELECT name, type, tbl_name AS tableName FROM sqlite_master WHERE type IN ('table', 'index')").all()
    const tableOf = new Map(objects.map((object) => [object.name, object.tableName]))
    const tables = new Map()
    for (const btree of btreeSizes(db)) {
      const table = tableOf.get(btree.name) ?? btree.name.replace(/^sqlite_autoindex_(.*)_\d+$/, '$1')
      if (!tables.has(table)) tables.set(table, { table, domain: domainOf(table), dataBytes: 0, indexBytes: 0, indexes: 0, approxRows: 0 })
      const entry = tables.get(table)
      if (btree.name === table) {
        entry.dataBytes = btree.bytes
        entry.approxRows = btree.cells
      } else {
        entry.indexBytes += btree.bytes
        entry.indexes += 1
      }
    }
    const names = new Set(objects.filter((object) => object.type === 'table').map((object) => object.name))
    const ingestion = []
    for (const [domain, table, column] of INGESTION) {
      if (!names.has(table)) continue
      const iso = (seconds) => (column === 'observed_at' ? seconds : new Date(seconds * 1000).toISOString())
      const count = (since) => {
        pace.rest()
        return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} >= ?`).get(iso(since)).count)
      }
      ingestion.push({ domain, source: table, last24h: count(now - 86400), last7d: count(now - 7 * 86400) })
    }
    if (names.has('guildweaver_telemetry_records')) {
      pace.rest()
      const since = new Date((now - 86400) * 1000).toISOString()
      const byDomain = db.prepare(`SELECT domain AS telemetryDomain, COUNT(*) AS records, SUM(length(envelope_json)) AS storedBytes
        FROM guildweaver_telemetry_records WHERE received_at >= ? GROUP BY domain ORDER BY storedBytes DESC`).all(since)
      ingestion.push({ domain: 'telemetry_transport', source: 'guildweaver_telemetry_records.by_domain_24h', breakdown: byDomain })
    }
    const maintenance = names.has('market_maintenance')
      ? db.prepare('SELECT name, ran_at AS ranAt, detail FROM market_maintenance ORDER BY name').all().map((row) => {
        let detail = null
        try { detail = JSON.parse(row.detail) } catch { /* keep null */ }
        return { name: row.name, ranAt: new Date(row.ranAt * 1000).toISOString(), detail }
      })
      : []
    return { tables: [...tables.values()].map((entry) => ({ ...entry, totalBytes: entry.dataBytes + entry.indexBytes })).sort((a, b) => b.totalBytes - a.totalBytes), ingestion, maintenance }
  } finally {
    db.close()
  }
}

try {
  const started = Date.now()
  parentPort.postMessage({ ok: true, result: { ...collect(workerData), durationMs: Date.now() - started } })
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error.code || error.message).slice(0, 200) })
}
