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

export function loadReferenceData() {
  if (!referenceCache) referenceCache = JSON.parse(readFileSync(REFERENCE_URL, "utf8"));
  return referenceCache;
}
