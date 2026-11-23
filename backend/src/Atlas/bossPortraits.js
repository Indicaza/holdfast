// Real creature portraits on the website: Content Studio media named
// boss-portrait-d<displayId>.png, matched to bosses through the checked-in
// manifest. An editor's portrait for a boss wins; a boss with no captured
// face keeps its fallback.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mediaNameOf } from "./bossPortraitPipeline.js";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "sources", "boss-portraits.json");
let displays = null;

function displayOfNpc() {
  if (!displays) {
    const manifest = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { bosses: [] };
    displays = new Map(manifest.bosses.filter((boss) => boss.status === "captured").map((boss) => [boss.npcId, boss.displayId]));
  }
  return displays;
}

// The detail with portraitUrl on each boss that has a stored face.
export function withBossPortraits(db, detail) {
  const bosses = detail?.atlas?.bosses;
  if (!bosses?.length) return detail;
  const known = displayOfNpc();
  const wanted = [...new Set(bosses.filter((boss) => !boss.portraitUrl && known.has(boss.npcId)).map((boss) => mediaNameOf(known.get(boss.npcId))))];
  if (!wanted.length) return detail;
  const rows = db.prepare(`SELECT id, original_name, variants_json FROM atlas_media WHERE purpose = 'portrait' AND original_name IN (${wanted.map(() => "?").join(",")}) ORDER BY created_at, rowid`).all(...wanted);
  const urls = new Map(rows.map((row) => [row.original_name, `/api/atlas-media/${row.id}/${JSON.parse(row.variants_json).web ? "web" : "original"}`]));
  const next = bosses.map((boss) => {
    const url = !boss.portraitUrl && known.has(boss.npcId) ? urls.get(mediaNameOf(known.get(boss.npcId))) : null;
    return url ? { ...boss, portraitUrl: url } : boss;
  });
  return { ...detail, atlas: { ...detail.atlas, bosses: next } };
}
