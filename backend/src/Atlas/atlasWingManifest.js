// The wing manifest: Atlas/atlasWings.js applied to the checked-in atlas, as
// plain data other programs read (the Guildweaver add-on's exporter) instead
// of keeping a second roster. Deterministic: the same atlas and wing table
// give the same manifest, byte for byte. Written to data/wing-manifest.json
// by scripts/exportWingManifest.mjs; a test fails when it drifts.

import { loadAtlas } from "./atlasData.js";
import { parentKeyFor, unassignedOf, wingSource, wingsOf } from "./atlasWings.js";

export const WING_MANIFEST_SCHEMA = 1;

const person = (entry, sources) => ({
  npcId: entry.npcId ?? null, encounterId: entry.encounterId ?? null, name: entry.name, sources: [...(sources || [])].sort(),
});

export function buildWingManifest(atlas = loadAtlas().atlas) {
  const dungeons = [];
  const sourceIds = new Set();
  for (const dungeon of atlas.dungeons) {
    const wings = wingsOf(dungeon);
    const entry = { instanceId: dungeon.instanceId, dungeonKey: parentKeyFor(dungeon), name: dungeon.name, wings: [] };
    for (const wing of wings) {
      for (const ids of [...Object.values(wing.bossSources), ...Object.values(wing.rareSources)]) for (const id of ids) sourceIds.add(id);
      if (wing.levelSource !== "parent") sourceIds.add(wing.levelSource);
      if (wing.floors.length) sourceIds.add("openmap");
      if (!wing.entrancesShared) sourceIds.add("atlas-entrances");
      entry.wings.push({
        dungeonKey: wing.dungeonKey, parentKey: wing.parentKey, slug: wing.slug, wing: wing.wing, name: wing.name,
        levelMin: wing.levelMin ?? null, levelMax: wing.levelMax ?? null, levelSource: wing.levelSource,
        bosses: wing.bosses.map((boss) => person(boss, wing.bossSources[boss.npcId])),
        rares: wing.rares.map((rare) => person(rare, wing.rareSources[rare.npcId])),
        floors: wing.floors.map((floor) => floor.name),
        entrancesShared: wing.entrancesShared,
        entrances: wing.entrancesShared ? [] : wing.entrances.map((place) => ({ areaTriggerId: place.areaTriggerId, mapId: place.mapId, x: place.x, y: place.y })),
      });
    }
    if (wings.length) {
      const unassigned = unassignedOf(dungeon);
      entry.unassigned = { bosses: unassigned.bosses.map((boss) => person(boss, [])), rares: unassigned.rares.map((rare) => person(rare, [])) };
    }
    dungeons.push(entry);
  }
  return {
    schemaVersion: WING_MANIFEST_SCHEMA,
    note: "Generated from backend/src/Atlas/atlasWings.js and data/atlas.json by scripts/exportWingManifest.mjs. Do not edit.",
    sharing: "Quests, trash and chest loot are never a wing's own: every wing shares them. Bosses and rares not listed in a wing are unassigned.",
    sources: [...sourceIds].sort().map((id) => {
      const source = wingSource(id);
      return { id, tier: source.tier, confidence: source.confidence, note: source.note };
    }),
    dungeons,
  };
}

export function wingManifestText(atlas) {
  return `${JSON.stringify(buildWingManifest(atlas), null, 2)}\n`;
}
