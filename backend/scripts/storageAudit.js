import { createHash } from 'node:crypto'
import { statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'
import { domainOf } from '../src/Production/storageDomains.js'

// Storage audit of a LOCAL copy of the production database. Opens it read
// only and never modifies it. Run against a restored snapshot, never the
// live file:
//
//   node scripts/storageAudit.js /path/to/restored/holdfast.sqlite [report-directory]
//
// Writes storage-audit.json and storage-audit.md: per-table and per-index
// bytes (dbstat), row counts, domains, the largest values of every JSON or
// BLOB column, and duplicate estimates (identical values stored more than
// once). Values themselves are never printed: only sizes, counts and hashes.

const [file, outDir = '.'] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/storageAudit.js /path/to/holdfast.sqlite [report-directory]')
  process.exit(2)
}

const db = new DatabaseSync(file, { readOnly: true })
const pragma = (name) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0]
const sizeOf = (target) => { try { return statSync(target).size } catch { return 0 } }
const started = Date.now()

const pageSize = pragma('page_size')
const pageCount = pragma('page_count')
const freelist = pragma('freelist_count')
const objects = db.prepare("SELECT name, type, tbl_name AS tableName FROM sqlite_master WHERE type IN ('table', 'index')").all()
const tableOf = new Map(objects.map((object) => [object.name, object.tableName]))
for (const object of objects) if (object.name.startsWith('sqlite_autoindex_')) tableOf.set(object.name, object.name.replace(/^sqlite_autoindex_(.*)_\d+$/, '$1'))

// dbstat with aggregate=TRUE: one row per table or index.
const btrees = db.prepare("SELECT name, pgsize AS bytes, ncell AS cells, payload, unused FROM dbstat WHERE aggregate = TRUE").all()
const tables = new Map()
for (const btree of btrees) {
  const table = tableOf.get(btree.name) ?? btree.name
  const isTable = btree.name === table
  if (!tables.has(table)) tables.set(table, { table, domain: domainOf(table), tableBytes: 0, indexBytes: 0, indexes: [], payloadBytes: 0, unusedBytes: 0 })
  const entry = tables.get(table)
  if (isTable) {
    entry.tableBytes = btree.bytes
    entry.payloadBytes = btree.payload
    entry.unusedBytes = btree.unused
  } else {
    entry.indexBytes += btree.bytes
    entry.indexes.push({ name: btree.name, bytes: btree.bytes })
  }
}

const quoted = (name) => `"${name.replaceAll('"', '""')}"`
const userTables = objects.filter((object) => object.type === 'table' && !object.name.startsWith('sqlite_')).map((object) => object.name)
for (const table of userTables) {
  const entry = tables.get(table) ?? { table, domain: domainOf(table), tableBytes: 0, indexBytes: 0, indexes: [] }
  tables.set(table, entry)
  entry.rows = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoted(table)}`).get().count)
}

// Large columns: TEXT or BLOB values over 1 KiB anywhere in a table.
function decoded(value) {
  if (value instanceof Uint8Array && value[0] === 0x1f && value[1] === 0x8b) {
    try { return { gzip: true, bytes: gunzipSync(value).length } } catch { /* not gzip */ }
  }
  return { gzip: false, bytes: value?.length ?? 0 }
}
const columns = []
for (const table of userTables) {
  const names = db.prepare(`PRAGMA table_info(${quoted(table)})`).all().map((column) => column.name)
  for (const column of names) {
    const stats = db.prepare(`SELECT COUNT(*) AS n, SUM(length(${quoted(column)})) AS bytes, MAX(length(${quoted(column)})) AS maxBytes
      FROM ${quoted(table)} WHERE typeof(${quoted(column)}) IN ('text', 'blob') AND length(${quoted(column)}) > 1024`).get()
    if (!stats.n) continue
    // Duplicates: identical stored values in this column, by hash.
    const hashes = new Map()
    let gzipped = 0
    let logicalBytes = 0
    const biggest = []
    for (const row of db.prepare(`SELECT rowid AS id, ${quoted(column)} AS value FROM ${quoted(table)}
      WHERE typeof(${quoted(column)}) IN ('text', 'blob') AND length(${quoted(column)}) > 1024`).iterate()) {
      const raw = typeof row.value === 'string' ? Buffer.from(row.value) : Buffer.from(row.value)
      const digest = createHash('sha256').update(raw).digest('hex')
      hashes.set(digest, (hashes.get(digest) ?? 0) + 1)
      const info = decoded(row.value)
      if (info.gzip) gzipped += 1
      logicalBytes += info.bytes
      biggest.push({ rowid: row.id, bytes: raw.length })
      if (biggest.length > 20) biggest.sort((a, b) => b.bytes - a.bytes).length = 10
    }
    let duplicateRows = 0
    let duplicateBytes = 0
    for (const count of hashes.values()) if (count > 1) duplicateRows += count - 1
    if (duplicateRows) duplicateBytes = Math.round((stats.bytes / stats.n) * duplicateRows)
    columns.push({ table, column, rows: stats.n, storedBytes: stats.bytes, logicalBytes, gzipped, maxBytes: stats.maxBytes, distinct: hashes.size,
      duplicateRows, approxDuplicateBytes: duplicateBytes, largest: biggest.sort((a, b) => b.bytes - a.bytes).slice(0, 5) })
  }
}

const databaseBytes = pageSize * pageCount
const tableList = [...tables.values()].map((entry) => ({ ...entry, totalBytes: entry.tableBytes + entry.indexBytes }))
  .sort((a, b) => b.totalBytes - a.totalBytes)
const domains = {}
for (const entry of tableList) {
  domains[entry.domain] ??= { domain: entry.domain, bytes: 0, tables: 0, rows: 0 }
  domains[entry.domain].bytes += entry.totalBytes
  domains[entry.domain].tables += 1
  domains[entry.domain].rows += entry.rows ?? 0
}
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  file: { databaseBytes: sizeOf(file), walBytes: sizeOf(`${file}-wal`) },
  sqlite: { pageSize, pageCount, freelistPages: freelist, freelistBytes: freelist * pageSize, journalMode: pragma('journal_mode'),
    schemaVersion: db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version ?? null },
  domains: Object.values(domains).sort((a, b) => b.bytes - a.bytes).map((entry) => ({ ...entry, share: entry.bytes / databaseBytes })),
  tables: tableList.map((entry) => ({ ...entry, share: entry.totalBytes / databaseBytes, indexes: entry.indexes.sort((a, b) => b.bytes - a.bytes) })),
  largeColumns: columns.sort((a, b) => b.storedBytes - a.storedBytes),
}
db.close()

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)
const pct = (share) => `${(share * 100).toFixed(1)}%`
const lines = [
  '# Storage audit',
  '',
  `Generated ${report.generatedAt} in ${report.durationMs} ms from a local copy. Database ${mb(report.file.databaseBytes)} MiB, WAL ${mb(report.file.walBytes)} MiB, `
    + `${report.sqlite.pageCount} pages of ${report.sqlite.pageSize} B, free pages ${mb(report.sqlite.freelistBytes)} MiB, schema v${report.sqlite.schemaVersion}.`,
  '',
  '## By domain',
  '',
  '| Domain | MiB | Share | Tables | Rows |',
  '|---|---:|---:|---:|---:|',
  ...report.domains.map((entry) => `| ${entry.domain} | ${mb(entry.bytes)} | ${pct(entry.share)} | ${entry.tables} | ${entry.rows} |`),
  '',
  '## Largest tables (data + indexes)',
  '',
  '| Table | Domain | Rows | Data MiB | Index MiB | Total MiB | Share |',
  '|---|---|---:|---:|---:|---:|---:|',
  ...report.tables.slice(0, 40).map((entry) => `| ${entry.table} | ${entry.domain} | ${entry.rows ?? ''} | ${mb(entry.tableBytes)} | ${mb(entry.indexBytes)} | ${mb(entry.totalBytes)} | ${pct(entry.share)} |`),
  '',
  '## Large values (over 1 KiB) by column',
  '',
  '| Table.column | Rows | Stored MiB | Logical MiB | gzip rows | Max KiB | Distinct | Duplicate rows | ≈ Duplicate MiB |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...report.largeColumns.slice(0, 40).map((entry) => `| ${entry.table}.${entry.column} | ${entry.rows} | ${mb(entry.storedBytes)} | ${mb(entry.logicalBytes)} | ${entry.gzipped} | ${(entry.maxBytes / 1024).toFixed(0)} | ${entry.distinct} | ${entry.duplicateRows} | ${mb(entry.approxDuplicateBytes)} |`),
  '',
]
writeFileSync(path.join(outDir, 'storage-audit.json'), `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(path.join(outDir, 'storage-audit.md'), `${lines.join('\n')}\n`)
console.log(`Wrote ${path.join(outDir, 'storage-audit.md')} and storage-audit.json (${report.durationMs} ms)`)
