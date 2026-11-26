import { createHash } from "node:crypto";
import { readMarketArchiveHold, readMarketArchiveHoldInDatabase } from "../Market/marketArchiveHold.js";
import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { resolveMemberAccess } from "../Auth/permissions.js";
import { readGuildweaverDevices } from "./guildweaverDeviceRepository.js";

const PREFIX = "archive_device:";
const PAGE_SIZE = 200;
const HISTORY = Object.freeze({
  "market-hourly": ["market_series_hourly", "hour"],
  "market-daily": ["market_series_daily", "day"],
  "market-weekly": ["market_series_weekly", "week"],
  "market-monthly-all": ["market_series_monthly", "month"],
  "market-monthly": ["market_series_monthly", "month"],
});
const DATASETS = ["market-current", ...Object.keys(HISTORY)];
const EXTENDED = new Set(["market-hourly", "market-daily", "market-weekly", "market-monthly-all"]);
const MAX_BATCH_BYTES = 240 * 1024;

function grantInDatabase(db, deviceId) {
  return Boolean(db.prepare("SELECT 1 FROM app_meta WHERE key = ? AND value = 'enabled'").get(PREFIX + deviceId));
}

export function readArchiveDevices(memberId) {
  const devices = readGuildweaverDevices(memberId).filter((device) => !device.revokedAt);
  return withGuildDatabase((db) => devices.map((device) => ({
    ...device,
    archiveEnabled: grantInDatabase(db, device.id),
  })));
}

export function setArchiveDevice(memberId, deviceId, enabled) {
  if (typeof enabled !== "boolean") return null;
  return withGuildTransaction((db) => {
    const device = db.prepare("SELECT id FROM guildweaver_devices WHERE id = ? AND member_id = ? AND revoked_at IS NULL").get(deviceId, memberId);
    if (!device) return null;
    if (enabled) {
      db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, 'enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(PREFIX + deviceId, new Date().toISOString());
    } else {
      db.prepare("DELETE FROM app_meta WHERE key = ?").run(PREFIX + deviceId);
    }
    return { id: deviceId, archiveEnabled: enabled };
  });
}

export function archiveEnabled(device) {
  if (!resolveMemberAccess(device.memberId).authority.permissions.includes("site.admin")) return false;
  return withGuildDatabase((db) => Boolean(db.prepare("SELECT 1 FROM guildweaver_devices WHERE id = ? AND member_id = ? AND revoked_at IS NULL").get(device.id, device.memberId)) && grantInDatabase(db, device.id));
}

export function archiveStatus(device) {
  const enabled = archiveEnabled(device);
  const markets = enabled ? withGuildDatabase((db) => db.prepare("SELECT market_key AS key, name FROM market_markets ORDER BY market_key LIMIT 201").all()) : [];
  return {
    deviceId: device.id,
    name: device.name,
    enabled,
    datasets: enabled ? DATASETS : [],
    hold: enabled ? readMarketArchiveHold() : null,
    bulkProtocol: enabled ? 1 : 0,
    markets: markets.slice(0, 200),
    marketsTruncated: markets.length > 200,
  };
}

function decodeCursor(raw, dataset, market, holdId) {
  const hourly = dataset === "market-hourly";
  if (raw === undefined) return ["", "", hourly ? -1 : ""];
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (value.dataset !== dataset || value.market !== market || (value.holdId ?? null) !== (holdId ?? null)
        || !Array.isArray(value.key) || value.key.length !== 3
        || value.key.slice(0, 2).some(part => typeof part !== "string" || part.length > 256)
        || (hourly ? !Number.isSafeInteger(value.key[2]) : typeof value.key[2] !== "string" || value.key[2].length > 256)) return null;
    return value.key;
  } catch { return null; }
}

export function normalizeArchiveQuery({ dataset, market, cursor, holdId, bulk }) {
  if (!DATASETS.includes(dataset) || typeof market !== "string" || !market || market.length > 256) return null;
  if (holdId !== undefined && (typeof holdId !== "string" || !/^[a-f0-9-]{36}$/i.test(holdId))) return null;
  if (EXTENDED.has(dataset) && !holdId) return null;
  if (bulk !== undefined && (bulk !== true || !holdId)) return null;
  if (!decodeCursor(cursor, dataset, market, holdId)) return null;
  return { dataset, market, ...(holdId === undefined ? {} : { holdId }), ...(bulk === true ? { bulk: true } : {}), ...(cursor === undefined ? {} : { cursor }) };
}

export function readArchiveBatch(query) {
  return withGuildDatabase((db) => readArchiveBatchInDatabase(db, query));
}

export function readArchiveBatchInDatabase(db, query) {
    const normalized = normalizeArchiveQuery(query);
    if (!normalized) return null;
    const { dataset, market, cursor, holdId, bulk } = normalized;
    if (holdId && readMarketArchiveHoldInDatabase(db)?.id !== holdId) return null;
    const key = decodeCursor(cursor, dataset, market, holdId);
    if (!db.prepare("SELECT 1 FROM market_markets WHERE market_key = ?").get(market)) return null;
    const current = dataset === "market-current";
    const spec = HISTORY[dataset];
    const limit = bulk ? 4000 : holdId ? 1000 : PAGE_SIZE;
    const maxBatchBytes = bulk ? 4 * MAX_BATCH_BYTES : MAX_BATCH_BYTES;
    const rows = current
      ? db.prepare(`SELECT market_key, item_key, item_id, source_type, complete, observed_at,
          min_unit_buyout, typical_unit_buyout, quantity, listings, selection_reason, conflict, change_24h_pct, updated_at
          FROM market_summaries WHERE market_key = ? AND item_key > ?
          ORDER BY item_key LIMIT ?`).all(market, key[0], limit + 1)
      : db.prepare(`SELECT * FROM ${spec[0]} WHERE market_key = ? ${dataset === "market-monthly" ? "AND final = 1" : ""}
          AND (item_key, source_type, ${spec[1]}) > (?, ?, ?) ORDER BY item_key, source_type, ${spec[1]} LIMIT ?`)
        .all(market, ...key, limit + 1);
    const page = [];
    let bytes = 0;
    for (const row of rows.slice(0, limit)) {
      const length = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes + length > maxBatchBytes) {
        if (!page.length) throw new Error("Archive row exceeds page budget");
        break;
      }
      bytes += length;
      page.push(row);
    }
    const last = page.at(-1);
    const nextCursor = rows.length > page.length ? Buffer.from(JSON.stringify({ dataset, market,
      ...(holdId ? { holdId } : {}), key: [last.item_key, current ? "" : last.source_type, current ? "" : last[spec[1]]] })).toString("base64url") : null;
    const batch = { schemaVersion: 1, dataset, market, ...(holdId ? { holdId } : {}), cursor: cursor ?? null,
      exportedAt: new Date().toISOString(), nextCursor, rows: page };
    return { batch, sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex") };
}
