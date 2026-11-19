// Dungeon identities: a stable `dungeonKey` for every atlas dungeon, and for
// the dungeons whose wings are played as separate dungeons (one game map, one
// numeric instance ID, several entrances), one entry per wing.
//
//   dungeonKey   "scarlet-monastery" (a dungeon), "scarlet-monastery:library" (a wing)
//   parentKey    the dungeon a wing belongs to
//   instanceId   the game's map ID, shared by every wing of the dungeon
//
// The numeric instance ID is never a wing's identity: every wing of Scarlet
// Monastery is instance 189. The atlas dataset (data/atlas.json) stays one
// record per instance; wings are views of it built here from the curated
// assignments below, so re-importing the atlas never loses them.
//
// Nothing is assigned without a source. A boss or rare belongs to a wing only
// when a reference below places it there and none places it elsewhere;
// anything else stays on the parent dungeon as unassigned. Quests, trash and
// chest loot are not attributed to a wing by any source used here: a wing
// shows them as shared, never as its own.

const SOURCES = Object.freeze({
  "dungeon-planner": {
    source: "dungeon-planner", revision: "Data/Bosses (generated 2026-11-16)", confidence: "medium", tier: "community-unverified",
    url: "https://github.com/xdk78/DungeonPlanner",
    note: "Boss roster per wing (DungeonPlanner, MIT; its research cites Wowhead Classic and warcraft.wiki.gg)",
  },
  "instance-journal": {
    source: "instance-journal", revision: "db/dungeons", confidence: "medium", tier: "community-unverified",
    url: null,
    note: "Boss and rare roster and level band per wing (InstanceJournal, public domain)",
  },
  openmap: {
    source: "openmap", revision: "Data/Forever/DungeonMaps.lua", confidence: "medium", tier: "forever-reference",
    url: null,
    note: "Map floor names and their wings, from the client's UiMap tables and the WoW Forever install (OpenMap, MIT); no art is used",
  },
  "wago-classic-era": {
    source: "wago-classic-era", revision: "LFGDungeons", confidence: "high", tier: "classic-reference",
    url: "https://wago.tools/db2/LFGDungeons?product=wow_classic_era",
    note: "Wing name and level band from the Classic Era client's LFGDungeons table",
  },
  "atlas-entrances": {
    source: "atlas-entrances", revision: null, confidence: "high", tier: "classic-reference", url: null,
    note: "Entrances whose area trigger the atlas already names after the wing",
  },
});

// Per wing: the NPC ids of its bosses and rares (matched against the atlas's
// own bosses and rares; ones the atlas does not list are simply absent), its
// level band and where it comes from, the map floor names OpenMap gives it,
// and the area triggers of its entrances. `sources` says which references
// place each boss or rare here.
const MULTI_WING = Object.freeze([
  {
    instanceId: 189, parentKey: "scarlet-monastery",
    wings: [
      { slug: "graveyard", wing: "Graveyard", levels: [30, 37, "instance-journal"], entrances: [45], floors: ["Graveyard"],
        bosses: { 3983: ["dungeon-planner", "instance-journal"], 4543: ["dungeon-planner", "instance-journal"] },
        rares: { 6488: ["instance-journal"], 6489: ["instance-journal"], 6490: ["instance-journal"] } },
      { slug: "library", wing: "Library", levels: [32, 40, "instance-journal"], entrances: [614], floors: ["Library"],
        bosses: { 3974: ["dungeon-planner", "instance-journal"], 6487: ["dungeon-planner", "instance-journal"] } },
      { slug: "armory", wing: "Armory", levels: [34, 42, "instance-journal"], entrances: [612], floors: ["Armory"],
        bosses: { 3975: ["dungeon-planner", "instance-journal"] } },
      { slug: "cathedral", wing: "Cathedral", levels: [35, 45, "instance-journal"], entrances: [610], floors: ["Cathedral"],
        bosses: { 4542: ["dungeon-planner", "instance-journal"], 3977: ["dungeon-planner", "instance-journal"] } },
    ],
  },
  {
    instanceId: 429, parentKey: "dire-maul",
    wings: [
      { slug: "east", wing: "East", levels: [54, 60, "wago-classic-era"], entrances: [3183, 3184, 3185], floors: ["Warpwood Quarter", "The Shrine of Eldretharr"],
        bosses: { 14354: ["dungeon-planner", "instance-journal"], 11490: ["dungeon-planner", "instance-journal"], 13280: ["dungeon-planner", "instance-journal"],
          14327: ["dungeon-planner", "instance-journal"], 11492: ["dungeon-planner", "instance-journal"] } },
      { slug: "west", wing: "West", levels: [56, 60, "wago-classic-era"], entrances: [3186, 3187], floors: ["Capital Gardens", "Court of the Highborne", "Prison of Immol'Thar"],
        bosses: { 11489: ["dungeon-planner", "instance-journal"], 11488: ["dungeon-planner", "instance-journal"], 11487: ["dungeon-planner", "instance-journal"],
          11496: ["dungeon-planner", "instance-journal"], 11486: ["dungeon-planner", "instance-journal"], 11467: ["instance-journal"] } },
      { slug: "north", wing: "North", levels: [56, 60, "wago-classic-era"], entrances: [3189], floors: ["Gordok Commons"],
        bosses: { 14326: ["dungeon-planner", "instance-journal"], 14322: ["dungeon-planner", "instance-journal"], 14321: ["dungeon-planner", "instance-journal"],
          14323: ["dungeon-planner", "instance-journal"], 14325: ["dungeon-planner", "instance-journal"], 14324: ["dungeon-planner"],
          11501: ["dungeon-planner", "instance-journal"] } },
    ],
  },
  {
    // Neither reference gives the two halves their own level band: both keep
    // the dungeon's. Which entrance trigger is which half is not sourced, so
    // both keep every entrance.
    instanceId: 329, parentKey: "stratholme",
    wings: [
      { slug: "live", wing: "Live", fullName: "Stratholme — Live (Main Gate)", levels: null, entrances: null, floors: ["Crusader's Square"],
        bosses: { 10558: ["dungeon-planner"], 10516: ["dungeon-planner"], 10808: ["dungeon-planner"], 11032: ["dungeon-planner"],
          10997: ["dungeon-planner"], 10811: ["dungeon-planner"], 10813: ["dungeon-planner"] } },
      { slug: "undead", wing: "Undead", fullName: "Stratholme — Undead (Service Entrance)", levels: null, entrances: null, floors: ["The Gauntlet"],
        bosses: { 10437: ["dungeon-planner"], 10436: ["dungeon-planner"], 10438: ["dungeon-planner"], 10435: ["dungeon-planner"],
          10439: ["dungeon-planner"], 10440: ["dungeon-planner"], 11143: ["dungeon-planner"] } },
    ],
  },
  {
    // OpenMap tags every Blackrock Spire floor with Lower Blackrock Spire
    // (retail's journal, where Upper is a separate map), which contradicts
    // the bosses on them: no floor is assigned. One entrance serves both.
    instanceId: 229, parentKey: "blackrock-spire",
    wings: [
      { slug: "lower", wing: "Lower", fullName: "Lower Blackrock Spire", levels: [52, 60, "wago-classic-era"], entrances: null, floors: [],
        bosses: { 9237: ["dungeon-planner", "instance-journal"], 9236: ["dungeon-planner", "instance-journal"], 10596: ["dungeon-planner", "instance-journal"],
          9196: ["dungeon-planner", "instance-journal"], 10584: ["dungeon-planner", "instance-journal"], 9736: ["dungeon-planner", "instance-journal"],
          10220: ["dungeon-planner", "instance-journal"], 10268: ["dungeon-planner", "instance-journal"], 9568: ["dungeon-planner", "instance-journal"] },
        rares: { 9219: ["instance-journal"], 9218: ["instance-journal"], 9217: ["instance-journal"], 9596: ["instance-journal"],
          10376: ["instance-journal"], 9718: ["instance-journal"] } },
      { slug: "upper", wing: "Upper", fullName: "Upper Blackrock Spire", levels: [56, 60, "wago-classic-era"], entrances: null, floors: [],
        bosses: { 9816: ["dungeon-planner", "instance-journal"], 10429: ["dungeon-planner", "instance-journal"], 10430: ["dungeon-planner", "instance-journal"],
          10363: ["dungeon-planner", "instance-journal"], 16042: ["instance-journal"] },
        rares: { 10509: ["instance-journal"], 10899: ["instance-journal"] } },
    ],
  },
]);

export const WING_KEY_SEPARATOR = ":";
const byInstance = new Map(MULTI_WING.map((entry) => [entry.instanceId, entry]));

// A dungeon's stable key from its atlas name: lower case, words joined by "-".
export function slugFor(name) {
  return String(name ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parentKeyFor(dungeon) {
  return byInstance.get(Number(dungeon?.instanceId))?.parentKey || slugFor(dungeon?.name) || `instance-${dungeon?.instanceId}`;
}

export const wingKeyOf = (parentKey, slug) => `${parentKey}${WING_KEY_SEPARATOR}${slug}`;
export const isWingKey = (key) => typeof key === "string" && key.includes(WING_KEY_SEPARATOR);
export const hasWings = (instanceId) => byInstance.has(Number(instanceId));
export const wingDefinitions = (instanceId) => byInstance.get(Number(instanceId))?.wings || [];
export const multiWingInstanceIds = () => [...byInstance.keys()];
export const wingSource = (id) => SOURCES[id] || null;

function provenanceOf(ids) {
  return [...new Set(ids)].map((id) => SOURCES[id]).filter(Boolean).map((entry) => ({ ...entry, retrievedAt: null }));
}

// Every wing of a dungeon as one record: identity, level band, the atlas
// bosses and rares it owns (by NPC id), its entrances and floor names. Pure
// and deterministic for a given atlas record.
export function wingsOf(dungeon) {
  const definition = byInstance.get(Number(dungeon?.instanceId));
  if (!definition) return [];
  const parentName = dungeon.name;
  return definition.wings.map((wing) => {
    const bossNpcIds = Object.keys(wing.bosses || {}).map(Number);
    const rareNpcIds = Object.keys(wing.rares || {}).map(Number);
    const bosses = dungeon.bosses.filter((boss) => boss.npcId && bossNpcIds.includes(boss.npcId));
    const rares = dungeon.rares.filter((rare) => rare.npcId && rareNpcIds.includes(rare.npcId));
    const sourceIds = [...Object.values(wing.bosses || {}).flat(), ...Object.values(wing.rares || {}).flat(),
      ...(wing.levels ? [wing.levels[2]] : []), ...(wing.floors.length ? ["openmap"] : []), ...(wing.entrances ? ["atlas-entrances"] : [])];
    const entrances = wing.entrances ? (dungeon.entrances || []).filter((entry) => wing.entrances.includes(entry.areaTriggerId)) : (dungeon.entrances || []);
    const first = entrances[0];
    return {
      dungeonKey: wingKeyOf(definition.parentKey, wing.slug),
      parentKey: definition.parentKey,
      instanceId: dungeon.instanceId,
      slug: wing.slug,
      wing: wing.wing,
      name: wing.fullName || `${parentName} — ${wing.wing}`,
      parentName,
      levelMin: wing.levels ? wing.levels[0] : dungeon.levelMin,
      levelMax: wing.levels ? wing.levels[1] : dungeon.levelMax,
      levelSource: wing.levels ? wing.levels[2] : "parent",
      bosses, rares,
      bossSources: Object.fromEntries(bossNpcIds.map((id) => [id, wing.bosses[id]])),
      rareSources: Object.fromEntries(rareNpcIds.map((id) => [id, wing.rares[id]])),
      entrances,
      entrance: first ? { mapId: first.mapId, x: first.x, y: first.y } : dungeon.entrance,
      entrancesShared: !wing.entrances,
      floors: wing.floors.map((name) => ({ name, source: "openmap" })),
      provenance: provenanceOf(sourceIds),
    };
  });
}

// The bosses and rares of a multi-wing dungeon no wing owns.
export function unassignedOf(dungeon) {
  const wings = wingsOf(dungeon);
  if (!wings.length) return { bosses: [], rares: [] };
  const owned = new Set(wings.flatMap((wing) => [...wing.bosses, ...wing.rares]));
  return { bosses: dungeon.bosses.filter((boss) => !owned.has(boss)), rares: dungeon.rares.filter((rare) => !owned.has(rare)) };
}

// The wing a set of boss kills proves: every kill of a boss some wing owns
// belongs to that one wing. Kills of unassigned bosses say nothing; kills in
// two wings, or none, prove no wing (null). kills: [{ encounterId, name }].
export function wingForKills(dungeon, kills = []) {
  const wings = wingsOf(dungeon);
  if (!wings.length) return null;
  const normal = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const found = new Map();
  for (const kill of kills) {
    for (const wing of wings) {
      const match = wing.bosses.find((boss) => (kill.encounterId && boss.encounterId === Number(kill.encounterId))
        || (kill.name && normal(boss.name) === normal(kill.name)));
      if (match) {
        if (!found.has(wing.dungeonKey)) found.set(wing.dungeonKey, { wing, bosses: [] });
        found.get(wing.dungeonKey).bosses.push(match.name);
      }
    }
  }
  if (found.size !== 1) return null;
  const [{ wing, bosses }] = found.values();
  return { dungeonKey: wing.dungeonKey, wing: wing.wing, name: wing.name, evidence: "boss_kills", bosses: [...new Set(bosses)] };
}
