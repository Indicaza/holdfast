// Coverage of the Dungeon Atlas's reference loot (data/reference-loot.json)
// against the atlas and the wing manifest: what each dungeon's bosses and
// rares are known to drop, what has no reference loot (and the reason the
// checked-in extracts give), shared drops and their sources, items without
// facts or icons, items several sources place differently, drops several
// wings share, and the gaps the import recorded. Pure;
// scripts/atlasLootCoverage.mjs prints it.
//
// An empty list never means "drops nothing": it means no source used here
// links an item to that creature.

const WHY = Object.freeze({
  noNpc: "no NPC id: neither the atlas nor DungeonPlanner names one creature for this encounter",
  noLootSource: "no source lists a dungeon-only drop for it (the emulator's table holds only world drops or nothing; DungeonPlanner lists nothing kept)",
  noLinks: "its drops are all filtered out (grey/white items, consumables) or world drops",
});

export function coverageReport({ atlas, reference, loot = null, manifest = null }) {
  const items = reference?.items || {};
  const byDungeon = new Map((reference?.dungeons || []).map((dungeon) => [dungeon.instanceId, dungeon]));
  const lootCreatures = new Map((loot?.tables?.creatures || []).map(([npcId, name, rank, instances]) => [npcId, { npcId, name, rank, instances }]));
  const wingsOf = new Map((manifest?.dungeons || []).map((dungeon) => [dungeon.instanceId, dungeon.wings || []]));
  const dungeons = [];
  const totals = { dungeons: 0, dungeonsWithLoot: 0, bosses: 0, bossesWithLoot: 0, rares: 0, raresWithLoot: 0, sharedItems: 0,
    sharedWithSeveralSources: 0, unattributedItems: 0, distinctItems: Object.keys(items).length, itemsWithoutIcon: 0, itemsWithoutFacts: 0,
    itemsOnSeveralBosses: 0, sourceDisagreements: 0, multiWingItems: 0, wingConflicts: 0, bossItemsBothSources: 0, bossItemsEmulatorOnly: 0,
    bossItemsPlannerOnly: 0, gaps: (reference?.gaps || []).length };
  for (const item of Object.values(items)) {
    if (!item.iconFileDataId) totals.itemsWithoutIcon += 1;
    if (!item.name || (!item.qualityId && item.qualityId !== 0)) totals.itemsWithoutFacts += 1;
  }
  for (const dungeon of atlas?.dungeons || []) {
    const ref = byDungeon.get(dungeon.instanceId) || { bosses: [], rares: [], dungeonLoot: [], itemIds: [] };
    const bossLoot = new Map(ref.bosses.map((boss) => [boss.encounterId, boss]));
    const rareLoot = new Map(ref.rares.map((rare) => [rare.npcId, rare]));
    const reason = (creature, resolvedNpc) => {
      const npcId = creature.npcId ?? resolvedNpc;
      if (!npcId) return WHY.noNpc;
      const known = lootCreatures.get(npcId);
      return known && known.instances.includes(dungeon.instanceId) ? WHY.noLinks : WHY.noLootSource;
    };
    // Which bosses list an item, per source (for disagreements and wings).
    const holders = new Map();
    const hold = (itemId, source, npcId) => {
      if (!holders.has(itemId)) holders.set(itemId, new Map());
      const bySource = holders.get(itemId);
      if (!bySource.has(source)) bySource.set(source, new Set());
      bySource.get(source).add(npcId);
    };
    const bosses = dungeon.bosses.map((boss) => {
      const entry = bossLoot.get(boss.encounterId);
      for (const [source, itemIds] of Object.entries(entry?.sources || {})) for (const itemId of itemIds) hold(itemId, source, entry.npcId);
      if (entry) {
        const emulator = new Set(entry.sources?.azerothcore || []);
        const planner = new Set(entry.sources?.["dungeon-planner"] || []);
        for (const itemId of entry.itemIds) {
          if (emulator.has(itemId) && planner.has(itemId)) totals.bossItemsBothSources += 1;
          else if (emulator.has(itemId)) totals.bossItemsEmulatorOnly += 1;
          else totals.bossItemsPlannerOnly += 1;
        }
      }
      return { encounterId: boss.encounterId, npcId: boss.npcId ?? entry?.npcId ?? null, name: boss.name, items: entry?.itemIds.length || 0,
        missing: entry?.itemIds.length ? null : reason(boss, entry?.npcId) };
    });
    const rares = (dungeon.rares || []).map((rare) => {
      const entry = rareLoot.get(rare.npcId);
      for (const [source, itemIds] of Object.entries(entry?.sources || {})) for (const itemId of itemIds) hold(itemId, source, rare.npcId);
      return { npcId: rare.npcId, name: rare.name, items: entry?.itemIds.length || 0, missing: entry?.itemIds.length ? null : reason(rare) };
    });
    const unattributed = ref.dungeonLoot.filter((entry) => !(entry.sources || []).length && !entry.npcId && !entry.sourceName).map((entry) => entry.itemId);
    // Disagreements: both sources place an item on bosses here, but not on
    // the same ones. Wings: the wings whose bosses hold an item.
    const wingOf = new Map();
    for (const wing of wingsOf.get(dungeon.instanceId) || []) for (const entry of [...wing.bosses, ...wing.rares]) wingOf.set(entry.npcId, wing.dungeonKey);
    const disagreements = [];
    const multiWing = [];
    const conflicts = [];
    for (const [itemId, bySource] of holders) {
      const all = new Set([...bySource.values()].flatMap((set) => [...set]));
      if (all.size > 1) totals.itemsOnSeveralBosses += 1;
      const [a, b] = [bySource.get("azerothcore"), bySource.get("dungeon-planner")];
      const same = (x, y) => x.size === y.size && [...x].every((value) => y.has(value));
      if (a && b && !same(a, b)) disagreements.push({ itemId, azerothcore: [...a].sort((p, q) => p - q), dungeonPlanner: [...b].sort((p, q) => p - q) });
      if (!wingOf.size) continue;
      const wings = new Set([...all].map((npcId) => wingOf.get(npcId)).filter(Boolean));
      if (wings.size < 2) continue;
      // Several wings: by design when each source alone says so (Dire Maul's
      // class books drop from bosses in every wing); a conflict when the
      // sources each put it in a different wing.
      const wingsBy = (set) => new Set([...(set || [])].map((npcId) => wingOf.get(npcId)).filter(Boolean));
      const designed = [a, b].some((set) => set && wingsBy(set).size > 1);
      (designed ? multiWing : conflicts).push({ itemId, wings: [...wings].sort() });
    }
    totals.dungeons += 1;
    if (ref.itemIds.length) totals.dungeonsWithLoot += 1;
    totals.bosses += bosses.length;
    totals.bossesWithLoot += bosses.filter((boss) => boss.items).length;
    totals.rares += rares.length;
    totals.raresWithLoot += rares.filter((rare) => rare.items).length;
    totals.sharedItems += ref.dungeonLoot.length;
    totals.sharedWithSeveralSources += ref.dungeonLoot.filter((entry) => (entry.sources || []).length > 1).length;
    totals.unattributedItems += unattributed.length;
    totals.sourceDisagreements += disagreements.length;
    totals.multiWingItems += multiWing.length;
    totals.wingConflicts += conflicts.length;
    dungeons.push({ instanceId: dungeon.instanceId, name: dungeon.name, items: ref.itemIds.length, bosses, rares, sharedItems: ref.dungeonLoot.length,
      unattributed, disagreements, multiWing, wingConflicts: conflicts });
  }
  const gapsByReason = {};
  for (const gap of reference?.gaps || []) gapsByReason[gap.reason] = (gapsByReason[gap.reason] || 0) + 1;
  return { totals, excluded: reference?.excluded || {}, gapsByReason, dungeons };
}

export function coverageMarkdown(report) {
  const t = report.totals;
  const lines = [
    "| Measure | Value |", "| --- | --- |",
    `| Dungeons with reference loot | ${t.dungeonsWithLoot} / ${t.dungeons} |`,
    `| Bosses with loot | ${t.bossesWithLoot} / ${t.bosses} |`,
    `| Rares with loot | ${t.raresWithLoot} / ${t.rares} |`,
    `| Distinct items | ${t.distinctItems} |`,
    `| Boss drops listed by both sources / emulator only / DungeonPlanner only | ${t.bossItemsBothSources} / ${t.bossItemsEmulatorOnly} / ${t.bossItemsPlannerOnly} |`,
    `| Shared (trash/chest) drops (of them, dropped by several creatures or chests) | ${t.sharedItems} (${t.sharedWithSeveralSources}) |`,
    `| Drops with no source creature or chest | ${t.unattributedItems} |`,
    `| Items on several bosses | ${t.itemsOnSeveralBosses} |`,
    `| Items the sources place on different bosses | ${t.sourceDisagreements} |`,
    `| Items several wings' bosses drop (each source agrees) | ${t.multiWingItems} |`,
    `| Wing attribution conflicts (sources put it in different wings) | ${t.wingConflicts} |`,
    `| Items without an icon / without facts | ${t.itemsWithoutIcon} / ${t.itemsWithoutFacts} |`,
    `| Listed items not kept: no client facts | ${t.gaps} |`,
    `| Listed items left out on purpose | ${Object.entries(report.excluded).map(([key, value]) => `${key} ${value}`).join(", ") || "none"} |`,
    "",
  ];
  for (const dungeon of report.dungeons) {
    const empty = [...dungeon.bosses, ...dungeon.rares].filter((entry) => !entry.items);
    if (!empty.length && !dungeon.unattributed.length && !dungeon.wingConflicts.length && !dungeon.disagreements.length) continue;
    lines.push(`- **${dungeon.name}** (${dungeon.instanceId}):`);
    for (const entry of empty) lines.push(`  - ${entry.name}: no reference loot (${entry.missing})`);
    if (dungeon.unattributed.length) lines.push(`  - no source for items: ${dungeon.unattributed.join(", ")}`);
    if (dungeon.disagreements.length) lines.push(`  - sources disagree on: ${dungeon.disagreements.map((entry) => entry.itemId).join(", ")}`);
    for (const conflict of dungeon.wingConflicts) lines.push(`  - wing conflict: item ${conflict.itemId} in ${conflict.wings.join(" and ")}`);
  }
  return lines.join("\n");
}
