import { DatabaseSync } from 'node:sqlite'

// Realm isolation audit of a LOCAL copy of the production database. Opens
// it read only and never modifies it. Run against a restored snapshot,
// never the live file:
//
//   node scripts/realmIsolationAudit.js /path/to/restored/holdfast.sqlite
//
// Finds characters whose own evidence names more than one realm: aliases
// recorded on several realms, raw telemetry or snapshots from another realm
// than the character's, and characters with no realm at all. Prints ids and
// counts only (no names). It repairs nothing: a finding is evidence for an
// administrator, and any repair works from the original envelopes, which
// this never touches.

const [file] = process.argv.slice(2)
if (!file) {
  console.error('Usage: node scripts/realmIsolationAudit.js /path/to/holdfast.sqlite')
  process.exit(2)
}

const db = new DatabaseSync(file, { readOnly: true })
const has = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
const all = (sql) => db.prepare(sql).all()

const report = {}

if (has('guildweaver_character_aliases')) {
  report.aliasesOnSeveralRealms = all(`
    SELECT character_id AS characterId, COUNT(DISTINCT LOWER(TRIM(realm))) AS realms, COUNT(*) AS aliases,
      MIN(first_seen_at) AS firstSeenAt, MAX(last_seen_at) AS lastSeenAt
    FROM guildweaver_character_aliases WHERE TRIM(realm) <> ''
    GROUP BY character_id HAVING COUNT(DISTINCT LOWER(TRIM(realm))) > 1 ORDER BY lastSeenAt DESC`)
  report.aliasesWithoutRealm = db.prepare("SELECT COUNT(*) AS n FROM guildweaver_character_aliases WHERE TRIM(realm) = ''").get().n
}

if (has('guildweaver_telemetry_records') && has('telemetry_characters')) {
  report.telemetryFromAnotherRealm = all(`
    SELECT r.character_id AS characterId, LOWER(TRIM(t.realm)) AS characterRealm, LOWER(TRIM(r.realm)) AS recordRealm,
      COUNT(*) AS records, MIN(r.captured_at) AS firstCapturedAt, MAX(r.captured_at) AS lastCapturedAt
    FROM guildweaver_telemetry_records r JOIN telemetry_characters t ON t.character_id = r.character_id
    WHERE TRIM(r.realm) <> '' AND TRIM(t.realm) <> '' AND LOWER(TRIM(r.realm)) <> LOWER(TRIM(t.realm))
    GROUP BY r.character_id, LOWER(TRIM(r.realm)) ORDER BY lastCapturedAt DESC`)
}

if (has('character_snapshots')) {
  report.snapshotsOnSeveralRealms = all(`
    SELECT character_id AS characterId, COUNT(DISTINCT LOWER(TRIM(json_extract(payload_json, '$.realm')))) AS realms, COUNT(*) AS snapshots,
      MIN(captured_at) AS firstCapturedAt, MAX(captured_at) AS lastCapturedAt
    FROM character_snapshots WHERE json_valid(payload_json) AND TRIM(COALESCE(json_extract(payload_json, '$.realm'), '')) <> ''
    GROUP BY character_id HAVING realms > 1 ORDER BY lastCapturedAt DESC`)
}

if (has('telemetry_characters')) {
  report.charactersWithoutRealm = db.prepare("SELECT COUNT(*) AS n FROM telemetry_characters WHERE TRIM(COALESCE(realm, '')) = ''").get().n
  // Not a fault: the same name on two realms is two characters. Listed so
  // an administrator can see both exist apart.
  report.sameNameOnSeveralRealms = all(`
    SELECT c.member_id AS memberId, COUNT(DISTINCT c.id) AS characters, COUNT(DISTINCT LOWER(TRIM(t.realm))) AS realms
    FROM characters c JOIN telemetry_characters t ON t.character_id = c.id
    WHERE TRIM(t.realm) <> '' GROUP BY c.member_id, LOWER(c.name) HAVING realms > 1`)
}

const contaminated = (report.aliasesOnSeveralRealms?.length || 0) + (report.telemetryFromAnotherRealm?.length || 0) + (report.snapshotsOnSeveralRealms?.length || 0)
report.verdict = contaminated ? `${contaminated} finding(s) where one character holds more than one realm's data` : 'no character holds more than one realm\'s data'
console.log(JSON.stringify(report, null, 2))
db.close()
