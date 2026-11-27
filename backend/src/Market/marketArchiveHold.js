import { randomUUID } from "node:crypto";
import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";

const KEY = "market_archive_hold";
let writers = 0;

export function beginMarketArchiveWriter() {
  writers++;
  let ended = false;
  return () => { if (!ended) { ended = true; writers--; } };
}

export function readMarketArchiveHoldInDatabase(db) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(KEY);
  if (!row) return null;
  const hold = JSON.parse(row.value);
  if (typeof hold.id !== "string" || typeof hold.startedAt !== "string") throw new Error("Invalid archive hold");
  return hold;
}

export function readMarketArchiveHold() {
  return withGuildDatabase(readMarketArchiveHoldInDatabase);
}

export function setMarketArchiveHold(enabled, actor) {
  if (typeof enabled !== "boolean") return { status: "invalid" };
  return withGuildTransaction(db => {
    const existing = readMarketArchiveHoldInDatabase(db);
    if (!enabled) {
      db.prepare("DELETE FROM app_meta WHERE key = ?").run(KEY);
      return { status: "ok", hold: null };
    }
    if (existing) return { status: "ok", hold: existing };
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'market_ingestion_controls'").get();
    let controls;
    try { controls = JSON.parse(row?.value || "null"); } catch {}
    const defaultPaused = !row && process.env.NODE_ENV === "production";
    if (!defaultPaused && (controls?.blizzard !== false || controls?.addon !== false)) return { status: "ingestion_not_paused" };
    if (writers > 0) return { status: "market_busy" };
    const hold = { id: randomUUID(), startedAt: new Date().toISOString(), actor: String(actor || "").slice(0, 160) };
    if (defaultPaused) db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run("market_ingestion_controls", JSON.stringify({ blizzard: false, addon: false, updatedBy: hold.actor }), hold.startedAt);
    db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)").run(KEY, JSON.stringify(hold), hold.startedAt);
    return { status: "ok", hold };
  });
}
