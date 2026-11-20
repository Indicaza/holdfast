// The Dungeon Atlas's checked-in datasets, read once: data/atlas.json and
// data/reference-loot.json (both written by scripts/importDungeonAtlas.mjs).
// No imports from the rest of the site, so both the atlas and the loot
// catalog can read them without depending on each other.

import { readFileSync } from "node:fs";

const ATLAS_URL = new URL("./data/atlas.json", import.meta.url);
const REFERENCE_URL = new URL("./data/reference-loot.json", import.meta.url);
let atlasCache = null;
let referenceCache = null;

export function loadAtlas() {
  if (!atlasCache) {
    const atlas = JSON.parse(readFileSync(ATLAS_URL, "utf8"));
    atlasCache = { atlas, byId: new Map(atlas.dungeons.map((dungeon) => [dungeon.instanceId, dungeon])) };
  }
  return atlasCache;
}

const QUESTS_URL = new URL("./data/quest-catalog.json", import.meta.url);
let questCache = null;

// The dungeon quest catalog (data/quest-catalog.json), by instance ID.
export function loadQuestCatalog() {
  if (!questCache) {
    const catalog = JSON.parse(readFileSync(QUESTS_URL, "utf8"));
    questCache = { catalog, byId: new Map(catalog.dungeons.map((dungeon) => [dungeon.instanceId, dungeon])) };
  }
  return questCache;
}

export function loadReferenceData() {
  if (!referenceCache) referenceCache = JSON.parse(readFileSync(REFERENCE_URL, "utf8"));
  return referenceCache;
}

const RELATIONSHIPS_URL = new URL("./data/loot-relationships.json", import.meta.url);
let relationshipsCache = null;

// Boss loot relationships and reference drop rates (data/loot-relationships.json,
// docs/loot-sources.md), by instance ID; null when the file is absent.
export function loadLootRelationships() {
  if (relationshipsCache === null) {
    try {
      const data = JSON.parse(readFileSync(RELATIONSHIPS_URL, "utf8"));
      relationshipsCache = { data, byId: new Map(data.dungeons.map((dungeon) => [dungeon.instanceId, dungeon])) };
    } catch {
      relationshipsCache = false;
    }
  }
  return relationshipsCache || null;
}
