import { createHash } from "node:crypto";
import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { resolveMemberAccess } from "../Auth/permissions.js";
import { readGuildweaverDevices } from "./guildweaverDeviceRepository.js";

const PREFIX = "archive_device:";
const PAGE_SIZE = 200;
const DATASETS = ["market-current", "market-monthly"];

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
  return withGuildDatabase((db) => grantInDatabase(db, device.id));
}

export function archiveStatus(device) {
  const enabled = archiveEnabled(device);
  return {
    deviceId: device.id,
    name: device.name,
    enabled,
    datasets: enabled ? DATASETS : [],
    markets: enabled ? withGuildDatabase((db) => db.prepare("SELECT market_key AS key, name FROM market_markets ORDER BY market_key LIMIT 200").all()) : [],
  };
}

function decodeCursor(raw, dataset, market) {
  if (raw === undefined) return ["", "", ""];
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (value.dataset !== dataset || value.market !== market || !Array.isArray(value.key)
        || value.key.length !== 3 || value.key.some((part) => typeof part !== "string" || part.length > 256)) return null;
    return value.key;
  } catch {
    return null;
  }
}

export function readArchiveBatch({ dataset, market, cursor }) {
  if (!DATASETS.includes(dataset) || typeof market !== "string" || !market || market.length > 256) return null;
  const key = decodeCursor(cursor, dataset, market);
  if (!key) return null;
  return withGuildDatabase((db) => {
    if (!db.prepare("SELECT 1 FROM market_markets WHERE market_key = ?").get(market)) return null;
    const current = dataset === "market-current";
    const rows = current
      ? db.prepare(`SELECT market_key, item_key, item_id, source_type, complete, observed_at,
          min_unit_buyout, typical_unit_buyout, quantity, listings, selection_reason, conflict, change_24h_pct, updated_at
          FROM market_summaries WHERE market_key = ? AND item_key > ?
          ORDER BY item_key LIMIT ?`).all(market, key[0], PAGE_SIZE + 1)
      : db.prepare(`SELECT * FROM market_series_monthly WHERE market_key = ? AND final = 1
          AND (item_key, source_type, month) > (?, ?, ?) ORDER BY item_key, source_type, month LIMIT ?`)
        .all(market, ...key, PAGE_SIZE + 1);
    const more = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    const nextCursor = more ? Buffer.from(JSON.stringify({ dataset, market,
      key: [last.item_key, current ? "" : last.source_type, current ? "" : last.month] })).toString("base64url") : null;
    const batch = { schemaVersion: 1, dataset, market, cursor: cursor ?? null,
      exportedAt: new Date().toISOString(), nextCursor, rows: page };
    return { batch, sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex") };
  });
}
