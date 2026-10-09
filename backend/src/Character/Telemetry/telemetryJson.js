import { gunzipSync, gzipSync } from "node:zlib";

// Storage encoding for Guildweaver telemetry JSON columns
// (guildweaver_telemetry_records.envelope_json and
// guildweaver_telemetry_latest_state.envelope_json/payload_json).
//
// Recipe books make profession states close to a megabyte of JSON each, and
// every character keeps a raw record plus a latest state of it. Values over
// COMPRESS_OVER_BYTES are stored as gzip BLOBs (15-18x smaller), which keeps
// the database under the encrypted backup's size limit. Smaller values stay
// plain text, so the inspector's text search keeps working on them.

export const COMPRESS_OVER_BYTES = 32 * 1024;

export function encodeTelemetryJson(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return Buffer.byteLength(text, "utf8") > COMPRESS_OVER_BYTES ? gzipSync(text) : text;
}

export function decodeTelemetryJson(stored) {
  if (stored === null || stored === undefined) return stored;
  if (typeof stored === "string") return stored;
  return gunzipSync(Buffer.from(stored)).toString("utf8");
}

export function parseTelemetryJson(stored, fallback = {}) {
  try {
    const text = decodeTelemetryJson(stored);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

// Compresses large telemetry rows written before values were encoded, then
// rebuilds the database file so the freed pages are actually released (a
// deleted or shrunk row only frees pages inside the file). Returns the number
// of values compressed; safe to run on every start.
export function compactStoredTelemetry(db) {
  const columns = [
    ["guildweaver_telemetry_records", "envelope_json"],
    ["guildweaver_telemetry_latest_state", "envelope_json"],
    ["guildweaver_telemetry_latest_state", "payload_json"],
  ];
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  let compressed = 0;
  for (const [table, column] of columns) {
    if (!tables.has(table)) continue;
    const key = table === "guildweaver_telemetry_records" ? "id" : "state_key";
    const rows = db.prepare(`
      SELECT ${key} AS id, ${column} AS value FROM ${table}
      WHERE typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) > ?
    `).all(COMPRESS_OVER_BYTES);
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
    for (const row of rows) {
      update.run(encodeTelemetryJson(row.value), row.id);
      compressed += 1;
    }
  }
  if (compressed) db.exec("VACUUM");
  return compressed;
}
