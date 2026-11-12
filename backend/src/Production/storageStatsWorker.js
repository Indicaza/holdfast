import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { domainOf } from './storageDomains.js'

// Heavy storage statistics, in a worker thread with its own read-only
// connection: dbstat reads every page of the database, which would block
// the request thread for seconds or minutes on a large file. The worker
// returns only sizes and counts, never stored values.

const INGESTION = [
  // [domain, table, time column] - each time column has an index.
  ['telemetry_transport', 'guildweaver_telemetry_records', 'received_at'],
  ['character_state', 'character_snapshot_ingests', 'received_at'],
  ['economy_loot', 'economic_observations', 'captured_at'],
  ['auction_house', 'market_snapshots', 'observed_at'],
]

function collect({ databaseFile, now }) {
  const db = new DatabaseSync(databaseFile, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON')
    const objects = db.prepare("SELECT name, type, tbl_name AS tableName FROM sqlite_master WHERE type IN ('table', 'index')").all()
    const tableOf = new Map(objects.map((object) => [object.name, object.tableName]))
    const tables = new Map()
    for (const btree of db.prepare('SELECT name, pgsize AS bytes, ncell AS cells FROM dbstat WHERE aggregate = TRUE').all()) {
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
      const count = (since) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} >= ?`).get(iso(since)).count)
      ingestion.push({ domain, source: table, last24h: count(now - 86400), last7d: count(now - 7 * 86400) })
    }
    if (names.has('guildweaver_telemetry_records')) {
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
