// Real dungeon maps on the website. Which floors and boss pins exist comes
// from data/sources/journal-maps.json (the add-on's table); the pictures are
// Content Studio media named journal-map-<instance>-<floor>.png with purpose
// "map". No picture, no floor: a dungeon never shows a substitute. An editor
// replaces a floor by uploading a newer image of that name, and a published
// editorial map takes the place of these floors. Spawn positions are another
// projection and are never used here.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAtlas } from "./atlasData.js";
import { createMediaInDatabase, readMediaInDatabase } from "./Editorial/atlasMedia.js";
import { mediaNameOf, normalizeMapName } from "./journalMapPipeline.js";

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "sources", "journal-maps.json");
let metadata = null;

export function loadJournalMaps() {
  if (!metadata) metadata = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : { instances: [] };
  return metadata;
}

const bossKeyOf = (boss) => String(boss.encounterId || boss.npcId || boss.name || "");

// Newest record per floor picture of this instance.
function floorMediaInDatabase(db, instanceId) {
  const rows = db.prepare("SELECT id, original_name FROM atlas_media WHERE purpose = 'map' AND original_name LIKE ? ORDER BY created_at DESC, rowid DESC").all(`journal-map-${instanceId}-%`);
  const byFloor = new Map();
  for (const row of rows) {
    const floor = new RegExp(`^journal-map-${instanceId}-(\\d+)\\.(png|jpe?g|webp)$`, "i").exec(row.original_name)?.[1];
    if (floor && !byFloor.has(Number(floor))) byFloor.set(Number(floor), readMediaInDatabase(db, row.id));
  }
  return byFloor;
}

// { floors, pins } for what is served. Pins are matched by name to the
// imported atlas's bosses (an editor's rename keeps its pin), then to the
// bosses this view shows. Pure.
export function journalMapView(instance, servedAtlas, importedBosses, mediaByFloor) {
  if (!instance) return null;
  const wingFloors = servedAtlas.wing ? new Set((servedAtlas.floors || []).map((floor) => normalizeMapName(floor.name))) : null;
  const served = new Map((servedAtlas.bosses || []).map((boss) => [bossKeyOf(boss), boss]));
  const byName = new Map(importedBosses.map((boss) => [normalizeMapName(boss.name), bossKeyOf(boss)]));
  const matched = instance.pins.map((pin) => ({ pin, bossKey: byName.get(normalizeMapName(pin.name)) })).filter((entry) => entry.bossKey && served.has(entry.bossKey));
  // A wing with no named floors has the floors its own bosses stand on.
  const keep = (floor) => !servedAtlas.wing || (wingFloors.size ? wingFloors.has(normalizeMapName(floor.name)) : matched.some(({ pin }) => pin.floor === floor.index));
  const floors = instance.floors.filter(keep).flatMap((floor) => {
    const media = mediaByFloor.get(floor.index);
    return media ? [{ floorId: floor.floorId, index: floor.index, name: floor.name, wing: floor.wing, imageUrl: media.urls.web, width: media.width, height: media.height,
      attribution: media.attribution || null, license: media.license || null, provenance: media.provenance || null }] : [];
  });
  if (!floors.length) return null;
  const shown = new Map(floors.map((floor) => [floor.index, floor.floorId]));
  const pins = matched.filter(({ pin }) => shown.has(pin.floor)).map(({ pin, bossKey }) => ({ bossKey, name: served.get(bossKey).name, floorId: shown.get(pin.floor), x: pin.x, y: pin.y }));
  return { floors, pins };
}

// The detail with `atlas.journalMap`, unless an editorial map is published.
export function withJournalMap(db, detail, instanceId) {
  if (!detail?.atlas || (detail.atlas.maps || []).some((map) => map?.imageUrl)) return detail;
  const instance = loadJournalMaps().instances.find((entry) => entry.instanceId === Number(instanceId));
  if (!instance) return detail;
  const imported = loadAtlas().byId.get(Number(instanceId))?.bosses || [];
  const journalMap = journalMapView(instance, detail.atlas, imported, floorMediaInDatabase(db, instance.instanceId));
  return journalMap ? { ...detail, atlas: { ...detail.atlas, journalMap } } : detail;
}

// Adds the manifest's floors to the Content Studio's media. A floor that
// already has a picture (the pipeline's or an editor's) is left alone.
export function importJournalMapsInDatabase(db, manifest, directory, { attribution, license, sourceUrl = "", actor = { name: "dungeon-map-pipeline" } }) {
  const result = { imported: 0, kept: 0, failed: [] };
  for (const floor of manifest.floors) {
    const name = mediaNameOf(floor.instanceId, floor.floor);
    if (floorMediaInDatabase(db, floor.instanceId).has(floor.floor)) { result.kept += 1; continue; }
    const provenance = `map ${manifest.mapVersion}; ${manifest.assetSource}; floor ${floor.floorId}; tiles ${floor.sourceTiles.join(",")}; sha256 ${floor.sha256}`;
    const created = createMediaInDatabase(db, readFileSync(path.join(directory, floor.filename)), { name, purpose: "map", attribution, license, sourceUrl, provenance, actor });
    if (created.status === "ok") result.imported += 1;
    else result.failed.push({ floorId: floor.floorId, problems: created.problems });
  }
  return result;
}
