import { createHash } from "node:crypto";

import { loadAtlas, loadReferenceData } from "../Atlas/atlasData.js";
import { gameContext } from "../GameData/publicGameDataModel.js";

// Guildweaver's own observed drop rates (docs/loot-sources.md, "Observed
// drop rates"). The evidence is one row per physical corpse of an atlas boss
// or rare that a Guildweaver player looted (loot_opportunities), with the
// items its loot window showed. Rates are computed from those rows on
// request; there is no stored aggregate to drift, and rebuilding is reading.
//
// One corpse is one opportunity, whoever saw it: the key is the corpse's
// GUID on its realm and game build (never the observer's locale or
// account), so several Guildweaver players in one group count one drop
// once. A window is "complete" when every item slot was tied to its corpse
// and nobody could have taken items first (the add-on's
// capture.inspection); only complete windows are a rate's denominator.
// "partial" windows and those from add-on versions that did not say
// ("legacy") are kept as sightings: proof an item drops, no denominator.
// A corpse with nothing to loot never opens a window, so a boss that
// dropped nothing at all is missed: rates lean slightly high.

export const lootObservationMigration = {
  version: 25,
  name: "loot_opportunities",
  up(db) {
    db.exec(`
      CREATE TABLE loot_opportunities (
        id INTEGER PRIMARY KEY,
        opportunity_key TEXT NOT NULL UNIQUE,
        game_build TEXT NOT NULL,
        npc_id INTEGER NOT NULL,
        instance_id INTEGER,
        difficulty_id INTEGER,
        inspection TEXT NOT NULL CHECK(inspection IN ('complete', 'partial', 'legacy')),
        observers INTEGER NOT NULL DEFAULT 1,
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL
      );
      CREATE INDEX loot_opportunities_npc_idx ON loot_opportunities(npc_id, game_build, inspection);
      CREATE TABLE loot_opportunity_items (
        opportunity_id INTEGER NOT NULL REFERENCES loot_opportunities(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        PRIMARY KEY(opportunity_id, item_id)
      );
      CREATE INDEX loot_opportunity_items_item_idx ON loot_opportunity_items(item_id);
      CREATE TABLE loot_opportunity_observers (
        opportunity_id INTEGER NOT NULL REFERENCES loot_opportunities(id) ON DELETE CASCADE,
        contributor_key TEXT NOT NULL,
        PRIMARY KEY(opportunity_id, contributor_key)
      );
    `);
  },
};

const hash = (parts) => createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\u001f")).digest("hex");
const INSPECTIONS = new Set(["complete", "partial"]);
const RANK = { legacy: 0, partial: 1, complete: 2 };

// Atlas bosses and rares by NPC id (the atlas's and the reference loot's).
let creatureCache = null;
export function atlasCreatureIds() {
  if (!creatureCache) {
    const ids = new Set();
    for (const dungeon of loadAtlas().atlas.dungeons) {
      for (const boss of dungeon.bosses) if (boss.npcId) ids.add(boss.npcId);
      for (const rare of dungeon.rares) if (rare.npcId) ids.add(rare.npcId);
    }
    for (const dungeon of loadReferenceData().dungeons) {
      for (const boss of dungeon.bosses) if (boss.npcId) ids.add(boss.npcId);
      for (const rare of dungeon.rares) if (rare.npcId) ids.add(rare.npcId);
    }
    creatureCache = ids;
  }
  return creatureCache;
}

// The same build key the rest of the game data uses ("1.60.1.70959").
const buildOf = (envelope) => gameContext(envelope).gameBuild || "";

// A mob_loot event (already validated) as an opportunity: recorded for atlas
// bosses and rares only. Idempotent: the same corpse from any observer
// merges into one row; the window's items are a union; the inspection only
// ever improves (a complete window seen by anyone makes it complete).
export function recordLootOpportunityInDatabase(db, { envelope, memberId }) {
  const payload = envelope?.payload;
  const npcId = Number(payload?.source?.npcId);
  if (!Number.isSafeInteger(npcId) || !atlasCreatureIds().has(npcId)) return null;
  const build = buildOf(envelope);
  if (!build) return null;
  const inspection = INSPECTIONS.has(payload?.capture?.inspection) ? payload.capture.inspection : "legacy";
  const key = hash(["corpse", build, envelope.region, envelope.realm, payload.source.guid]);
  const at = new Date(Number(envelope.capturedAt) > 1e11 ? Number(envelope.capturedAt) : Number(envelope.capturedAt) * 1000);
  const observedAt = Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString();
  const instance = payload?.context?.instance || {};
  const existing = db.prepare("SELECT id, inspection FROM loot_opportunities WHERE opportunity_key = ?").get(key);
  let id;
  if (existing) {
    id = existing.id;
    const better = RANK[inspection] > RANK[existing.inspection] ? inspection : existing.inspection;
    db.prepare(`UPDATE loot_opportunities SET inspection = ?, first_observed_at = MIN(first_observed_at, ?), last_observed_at = MAX(last_observed_at, ?)
      WHERE id = ?`).run(better, observedAt, observedAt, id);
  } else {
    id = Number(db.prepare(`INSERT INTO loot_opportunities (opportunity_key, game_build, npc_id, instance_id, difficulty_id, inspection, observers,
      first_observed_at, last_observed_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(key, build, npcId, Number.isSafeInteger(Number(instance.instanceId)) ? Number(instance.instanceId) : null,
        Number.isSafeInteger(Number(instance.difficultyId)) ? Number(instance.difficultyId) : null, inspection, observedAt, observedAt).lastInsertRowid);
  }
  const contributor = hash(["observer", memberId]);
  if (db.prepare("INSERT OR IGNORE INTO loot_opportunity_observers (opportunity_id, contributor_key) VALUES (?, ?)").run(id, contributor).changes) {
    db.prepare("UPDATE loot_opportunities SET observers = observers + 1 WHERE id = ?").run(id);
  }
  const insert = db.prepare("INSERT OR IGNORE INTO loot_opportunity_items (opportunity_id, item_id) VALUES (?, ?)");
  for (const output of payload.outputs || []) {
    const itemId = Number(output?.itemId);
    if (Number.isSafeInteger(itemId) && itemId > 0) insert.run(id, itemId);
  }
  return { opportunityId: id, inspection };
}

// The Wilson score interval for `drops` in `trials` (95%: z = 1.96), as
// percentages. Sound for small samples and for zero drops (where the
// observed rate is 0 but the upper bound is not). Null without trials.
export function wilsonInterval(drops, trials, z = 1.96) {
  if (!Number.isInteger(trials) || trials <= 0 || !Number.isInteger(drops) || drops < 0 || drops > trials) return null;
  const p = drops / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  const round = (value) => Math.round(value * 1000) / 10;
  return { low: round(Math.max(0, centre - half)), high: round(Math.min(1, centre + half)) };
}

// Observed drop rates per NPC: for each NPC, the newest game build with any
// complete window is the one rated (rates of one build are never proof for
// another; every build's count is listed). Per item: drops in complete
// windows over complete windows, the Wilson interval, and sightings in
// partial or legacy windows (no denominator). Nothing names a player.
export function observedLootRatesInDatabase(db, npcIds = []) {
  const ids = [...new Set(npcIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => "?").join(", ");
  const builds = db.prepare(`SELECT npc_id AS npcId, game_build AS build, inspection, COUNT(*) AS windows, MAX(last_observed_at) AS lastObservedAt
    FROM loot_opportunities WHERE npc_id IN (${marks}) GROUP BY npc_id, game_build, inspection`).all(...ids);
  for (const npcId of ids) {
    const rows = builds.filter((row) => row.npcId === npcId);
    if (!rows.length) continue;
    const perBuild = new Map();
    for (const row of rows) {
      const entry = perBuild.get(row.build) || { build: row.build, complete: 0, partial: 0, legacy: 0, lastObservedAt: null };
      entry[row.inspection] += row.windows;
      if (!entry.lastObservedAt || row.lastObservedAt > entry.lastObservedAt) entry.lastObservedAt = row.lastObservedAt;
      perBuild.set(row.build, entry);
    }
    const ordered = [...perBuild.values()].sort((a, b) => compareBuilds(b.build, a.build));
    const rated = ordered.find((entry) => entry.complete > 0) || ordered[0];
    const items = db.prepare(`SELECT i.item_id AS itemId,
        SUM(CASE WHEN o.inspection = 'complete' THEN 1 ELSE 0 END) AS drops,
        SUM(CASE WHEN o.inspection != 'complete' THEN 1 ELSE 0 END) AS sightings
      FROM loot_opportunity_items i JOIN loot_opportunities o ON o.id = i.opportunity_id
      WHERE o.npc_id = ? AND o.game_build = ? GROUP BY i.item_id ORDER BY i.item_id`).all(npcId, rated.build);
    out.set(npcId, {
      npcId,
      build: rated.build,
      eligibleKills: rated.complete,
      partialWindows: rated.partial + rated.legacy,
      lastObservedAt: rated.lastObservedAt,
      // For an item never seen in these windows: 0 drops, at most this (95%).
      noDropUpper: wilsonInterval(0, rated.complete)?.high ?? null,
      builds: ordered.map(({ build, complete, partial, legacy }) => ({ build, completeWindows: complete, otherWindows: partial + legacy })),
      items: items.map(({ itemId, drops, sightings }) => {
        const interval = wilsonInterval(drops, rated.complete);
        return {
          itemId, drops, sightings,
          // Never a percentage without its denominator: null when there are no complete windows.
          percent: rated.complete > 0 ? Math.round((drops / rated.complete) * 1000) / 10 : null,
          ...(interval ? { low: interval.low, high: interval.high } : {}),
        };
      }),
    });
  }
  return out;
}

// Dotted builds compared numerically ("1.60.1.70959" > "1.60.1.70888").
function compareBuilds(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}

// A dungeon detail (Loot/lootRouter.js) with each atlas boss's and rare's
// observed rates as `observedLoot` (optional addition), when any player's
// window of it was recorded.
export function withObservedRates(db, detail) {
  const atlas = detail?.atlas;
  if (!atlas) return detail;
  const creatures = [...(atlas.bosses || []), ...(atlas.rares || [])];
  const rates = observedLootRatesInDatabase(db, creatures.map((creature) => Number(creature.npcId)).filter(Boolean));
  if (!rates.size) return detail;
  const attach = (creature) => (rates.has(Number(creature.npcId)) ? { ...creature, observedLoot: rates.get(Number(creature.npcId)) } : creature);
  return { ...detail, atlas: { ...atlas, bosses: (atlas.bosses || []).map(attach), rares: (atlas.rares || []).map(attach) } };
}
