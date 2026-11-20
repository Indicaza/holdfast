// Boss loot relationships and reference drop rates (docs/loot-sources.md):
// for each atlas boss, every item a source places on it, who places it there,
// and each source's own drop rate with how it was measured. Nothing is
// averaged or overwritten: two sources' rates stay two rates.
//
// Sources:
//   reference loot (data/reference-loot.json)   who lists the drop:
//     AzerothCore, DungeonPlanner (no rates)
//   ForeverDB (data/sources/foreverdb-loot.json) per boss: drop % measured
//     over looted kills in WoW Forever (method "observed", with the kill
//     count), or Classic data it falls back on (method "classic", CMaNGOS)
//
// Scope, per boss and item (an item is never a boss's just because it was
// seen in the boss's dungeon):
//   "boss"    a guide or the emulator lists it for this boss, or it is an item
//             WoW Forever added (not in the Classic client) that ForeverDB sees
//             on this boss and on no boss of another instance
//   "dungeon" an item WoW Forever added that ForeverDB sees on two or more
//             bosses of this dungeon (and no other): the dungeon's shared drop
//   "world"   a world drop: the emulator's world-drop list, or ForeverDB sees it
//             on bosses of WORLD_SPREAD or more instances
//   "corpse"  ForeverDB saw it on this boss's corpse in Forever, but nothing
//             says it is the boss's own loot rather than a world drop
// Every scope keeps its rates; only "boss" items are the boss's loot table.

export const LOOT_RELATIONSHIPS_SCHEMA = 1;
export const WORLD_SPREAD = 3;
// Every item of the original game has an id below this; the items WoW
// Forever added are numbered from 250,000 up (Season of Discovery's, in the
// Classic Era client, from about 200,000).
export const ORIGINAL_ITEM_ID_LIMIT = 25000;

const nameKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// A ForeverDB loot row (fetchLootSources.mjs columns) as a rate claim.
function rateOf(row, meta) {
  const [, , , , , pct, src, hidden, kills, seen] = row;
  return {
    source: "foreverdb",
    method: src === "f" ? "observed" : src === "c" ? "classic" : "unknown",
    percent: pct ?? null,
    kills: kills ?? null,
    seen: seen ?? null,
    ...(hidden ? { hidden } : {}),
    revision: meta.revision ?? null,
  };
}

// atlas: atlas.json; reference: reference-loot.json; foreverDb: the
// foreverdb-loot.json extract; worldDrops: item ids the emulator says drop
// in the open world; categoryOf: itemId -> definition category (or null).
export function buildLootRelationships({ atlas, reference, foreverDb, worldDrops = new Set(), categoryOf = () => null, generatedAt = null }) {
  const meta = { revision: foreverDb?.revision ?? null };
  const rows = foreverDb?.tables?.loot || [];
  const fdbNames = new Map((foreverDb?.tables?.instances || []).map(([instanceId, name]) => [instanceId, name]));
  // Instances each item is seen on (bosses only), for the world rule.
  const spread = new Map();
  for (const [instanceId, bossIndex, , , itemId] of rows) {
    if (!bossIndex) continue;
    if (!spread.has(itemId)) spread.set(itemId, new Set());
    spread.get(itemId).add(instanceId);
  }
  const world = (itemId) => worldDrops.has(itemId) || (spread.get(itemId)?.size ?? 0) >= WORLD_SPREAD;
  // Bosses of one instance each item is seen on.
  const bossSpread = new Map();
  for (const [instanceId, bossIndex, , , itemId] of rows) {
    if (!bossIndex) continue;
    const key = `${instanceId}:${itemId}`;
    if (!bossSpread.has(key)) bossSpread.set(key, new Set());
    bossSpread.get(key).add(bossIndex);
  }
  const scopeOf = (itemId, listed, instanceId) => {
    if (listed) return "boss";
    if (world(itemId)) return "world";
    if (itemId < ORIGINAL_ITEM_ID_LIMIT || (spread.get(itemId)?.size ?? 0) !== 1) return "corpse";
    return (bossSpread.get(`${instanceId}:${itemId}`)?.size ?? 0) > 1 ? "dungeon" : "boss";
  };
  const refById = new Map((reference?.dungeons || []).map((dungeon) => [dungeon.instanceId, dungeon]));
  const report = { fdbInstances: 0, fdbBosses: 0, bossesMatched: 0, unmatchedBosses: [], relationships: 0, both: 0, referenceOnly: 0,
    foreverDbOnly: 0, foreverDbCorpse: 0, foreverDbWorld: 0, observedRates: 0, classicRates: 0, ratesWithKills: 0, placementDiscrepancies: [] };
  const dungeons = [];
  for (const dungeon of atlas?.dungeons || []) {
    const id = dungeon.instanceId;
    const ref = refById.get(id);
    const fdbRows = rows.filter((row) => row[0] === id);
    if (!ref && !fdbRows.length) continue;
    if (fdbNames.has(id)) report.fdbInstances += 1;
    // ForeverDB's bosses here, in its order.
    const fdbBosses = new Map();
    for (const row of fdbRows) {
      if (!row[1]) continue;
      if (!fdbBosses.has(row[1])) fdbBosses.set(row[1], { index: row[1], name: row[2], npcId: row[3], rows: [] });
      fdbBosses.get(row[1]).rows.push(row);
    }
    report.fdbBosses += fdbBosses.size;
    const used = new Set();
    const bosses = [];
    for (const boss of dungeon.bosses) {
      const refBoss = ref?.bosses.find((entry) => (boss.encounterId && entry.encounterId === boss.encounterId) || (boss.npcId && entry.npcId === boss.npcId));
      const npcId = boss.npcId || refBoss?.npcId || null;
      // By npc id, else by the exact name (case, spacing, punctuation aside).
      const fdb = [...fdbBosses.values()].find((entry) => !used.has(entry.index) && npcId && entry.npcId === npcId)
        || [...fdbBosses.values()].find((entry) => !used.has(entry.index) && nameKey(entry.name) === nameKey(boss.name));
      if (fdb) { used.add(fdb.index); report.bossesMatched += 1; }
      const listedBy = new Map();
      for (const [source, ids] of Object.entries(refBoss?.sources || {})) for (const itemId of ids) listedBy.set(itemId, [...(listedBy.get(itemId) || []), source]);
      for (const itemId of refBoss?.itemIds || []) if (!listedBy.has(itemId)) listedBy.set(itemId, []);
      const rates = new Map();
      for (const row of fdb?.rows || []) rates.set(row[4], [...(rates.get(row[4]) || []), rateOf(row, meta)]);
      const items = [];
      for (const itemId of [...new Set([...listedBy.keys(), ...rates.keys()])].sort((a, b) => a - b)) {
        const scope = scopeOf(itemId, listedBy.has(itemId), id);
        const entry = { itemId, scope, category: categoryOf(itemId), listedBy: (listedBy.get(itemId) || []).sort() };
        if (rates.has(itemId)) entry.rates = rates.get(itemId);
        items.push(entry);
        report.relationships += 1;
        if (listedBy.has(itemId) && rates.has(itemId)) report.both += 1;
        else if (listedBy.has(itemId)) report.referenceOnly += 1;
        else if (scope === "boss") report.foreverDbOnly += 1;
        else if (scope === "corpse" || scope === "dungeon") report.foreverDbCorpse += 1;
        else report.foreverDbWorld += 1;
        for (const rate of rates.get(itemId) || []) {
          if (rate.method === "observed") report.observedRates += 1;
          if (rate.method === "classic") report.classicRates += 1;
          if (rate.kills) report.ratesWithKills += 1;
        }
      }
      bosses.push({ encounterId: boss.encounterId ?? null, npcId, name: boss.name, ...(fdb ? { foreverDbName: fdb.name } : {}), items });
    }
    for (const entry of fdbBosses.values()) if (!used.has(entry.index)) report.unmatchedBosses.push(`${id}:${entry.name}`);
    // A drop the guides place on one boss and ForeverDB, seeing it in
    // Forever, on another boss of the same dungeon (and not on the first).
    for (const boss of bosses) {
      for (const item of boss.items) {
        if (!item.listedBy.length || item.rates?.some((rate) => rate.method === "observed") || item.scope !== "boss") continue;
        const elsewhere = bosses.filter((other) => other !== boss && other.items.some((candidate) => candidate.itemId === item.itemId
          && candidate.rates?.some((rate) => rate.method === "observed")));
        if (elsewhere.length) report.placementDiscrepancies.push({ instanceId: id, itemId: item.itemId, listedOn: boss.name, seenOn: elsewhere.map((other) => other.name) });
      }
    }
    const trash = fdbRows.filter((row) => !row[1]).map((row) => ({ itemId: row[4], scope: world(row[4]) ? "world" : "corpse", category: categoryOf(row[4]), rates: [rateOf(row, meta)] }))
      .sort((a, b) => a.itemId - b.itemId);
    dungeons.push({ instanceId: id, name: dungeon.name, bosses, ...(trash.length ? { trash } : {}) });
  }
  report.unmatchedBosses.sort();
  return {
    schemaVersion: LOOT_RELATIONSHIPS_SCHEMA, dataset: "loot-relationships", generatedAt,
    sources: foreverDb ? [{ source: foreverDb.source, url: foreverDb.url, revision: foreverDb.revision, retrievedAt: foreverDb.retrievedAt,
      license: foreverDb.license, attribution: foreverDb.attribution }] : [],
    methods: {
      observed: "ForeverDB: drops seen in WoW Forever divided by the boss's looted kills its players' add-ons recorded (`kills`)",
      classic: "ForeverDB: Classic data (CMaNGOS classic-db) where Forever's own is not known; not a Forever measurement",
    },
    worldSpread: WORLD_SPREAD,
    report, dungeons,
  };
}

// The served rates of one boss's items: itemId -> claims.
export function ratesByItem(boss) {
  return new Map((boss?.items || []).filter((item) => item.rates).map((item) => [item.itemId, item.rates]));
}
