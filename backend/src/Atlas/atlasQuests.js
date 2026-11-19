// The dungeon quest catalog (data/quest-catalog.json): per dungeon, every
// quest that has to do with it, what it has to do with it (relevance), who
// may take it, what it needs first and where it starts. Built by
// scripts/importDungeonAtlas.mjs from the AzerothCore quest extract
// (Atlas/atlasQuestSources.js), DungeonPlanner's dungeon quest lists and the
// wing table. Classic reference data: never proof of a Forever quest.
//
// Relevance (one per quest and dungeon):
//   dungeon       DungeonPlanner lists it for this dungeon (its authors'
//                 dungeon quest list, from Wowhead Classic zone pages)
//   optional      not listed, but its objectives or giver are inside this
//                 dungeon (AzerothCore evidence): a side quest, a turn-in
//   prerequisite  a quest that must be done first for one of the above
//   repeatable    repeatable (AzerothCore's SpecialFlags), shown apart
//   zone          only the dungeon's zone (QuestSortID) ties it here:
//                 hidden unless asked for
//   unknown       DungeonPlanner lists it, but no quest record exists to
//                 say anything else
// Nothing is inferred: a prerequisite is AzerothCore's PrevQuestID only, a
// faction its AllowableRaces only, a class its AllowableClasses only.

import { wingsOf } from "./atlasWings.js";

export const QUEST_CATALOG_SCHEMA = 1;
export const QUEST_RELEVANCE = Object.freeze(["dungeon", "optional", "prerequisite", "repeatable", "zone", "unknown"]);
// Shown to players by default; "zone" only on request.
export const DEFAULT_RELEVANCE = Object.freeze(["dungeon", "optional", "prerequisite", "repeatable", "unknown"]);

// AllowableRaces bits (3.3.5 masks include Blood Elf 512 and Draenei 1024).
const RACES = Object.freeze([[1, "Human", "alliance"], [2, "Orc", "horde"], [4, "Dwarf", "alliance"], [8, "NightElf", "alliance"], [16, "Scourge", "horde"],
  [32, "Tauren", "horde"], [64, "Gnome", "alliance"], [128, "Troll", "horde"], [512, "BloodElf", "horde"], [1024, "Draenei", "alliance"]]);
const CLASSES = Object.freeze([[1, "WARRIOR"], [2, "PALADIN"], [4, "HUNTER"], [8, "ROGUE"], [16, "PRIEST"], [64, "SHAMAN"], [128, "MAGE"], [256, "WARLOCK"],
  [1024, "DRUID"]]);
const VANILLA_RACE_MASK = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128;
const ALL_CLASS_MASK = CLASSES.reduce((mask, [bit]) => mask | bit, 0);
const REPEATABLE = 1; // quest_template_addon.SpecialFlags
const DAILY = 0x1000; // quest_template.Flags
const SIDE = Object.freeze({ a: "alliance", h: "horde", b: "both" });

// Who may take it, from AllowableRaces: faction, and races when narrower.
export function raceRule(mask) {
  const vanilla = (mask || 0) & VANILLA_RACE_MASK;
  if (!vanilla || vanilla === VANILLA_RACE_MASK) return { faction: "both", races: null };
  const allowed = RACES.filter(([bit]) => vanilla & bit);
  const factions = new Set(allowed.map(([, , faction]) => faction));
  const faction = factions.size === 1 ? [...factions][0] : "both";
  const full = (side) => RACES.filter(([bit, , f]) => f === side && bit & VANILLA_RACE_MASK).every(([bit]) => vanilla & bit);
  const narrower = faction === "both" ? !(full("alliance") && full("horde")) : !full(faction);
  return { faction, races: narrower ? allowed.map(([, race]) => race) : null };
}

export function classRule(mask) {
  const classes = (mask || 0) & ALL_CLASS_MASK;
  if (!classes || classes === ALL_CLASS_MASK) return null;
  return CLASSES.filter(([bit]) => classes & bit).map(([, token]) => token);
}

const text = (value) => (value === null || value === undefined || value === "" ? null : String(value));

// The objective line, cleaned like the atlas's ($B line breaks, $N names).
function objectiveText(value) {
  const objective = text(value);
  if (!objective) return null;
  return objective.replace(/\$[Bb]/g, " ").replace(/\$[Nn]/g, "<name>").replace(/\$[Cc]/g, "<class>").replace(/\$[Rr]/g, "<race>")
    .replace(/\$[Gg]\s*([^:;]*):([^;]*);/g, "$1/$2").replace(/\s+/g, " ").trim() || null;
}

export function buildQuestCatalog({ atlas, quests: source, planner = null, areaToInstance = new Map(), zonePointOf = () => null, generatedAt = null }) {
  const rows = new Map((source?.tables?.quests || []).map((row) => [row.id, row]));
  const givers = new Map((source?.tables?.givers || []).map(([kind, id, name, map, x, y]) => [`${kind}:${id}`, { kind, id, name, map, x, y }]));
  const plannerRows = new Map();
  for (const row of planner?.tables?.quests || []) {
    const [instanceId, , questId] = row;
    if (!plannerRows.has(instanceId)) plannerRows.set(instanceId, new Map());
    if (!plannerRows.get(instanceId).has(questId)) plannerRows.get(instanceId).set(questId, row);
  }
  const instanceNames = new Map((atlas?.dungeons || []).map((dungeon) => [dungeon.instanceId, dungeon.name]));
  const locationOf = (giver) => {
    if (!giver || giver.map === null || giver.map === undefined) return null;
    if (giver.map === 0 || giver.map === 1) {
      const point = zonePointOf(giver.map, giver.x, giver.y);
      return point ? { zoneName: point.zoneName, mapId: point.mapId, x: point.x, y: point.y } : null;
    }
    return instanceNames.has(giver.map) ? { zoneName: instanceNames.get(giver.map), mapId: null, x: null, y: null } : null;
  };
  const repeatable = (row) => Boolean(row && ((row.special & REPEATABLE) || (row.flags & DAILY)));
  const prerequisitesOf = (row) => {
    if (!row?.prev) return [];
    const questId = Math.abs(row.prev);
    // PrevQuestID > 0: done first; < 0: in the quest log at the same time.
    return [{ questId, name: rows.get(questId)?.title ?? null, mustBeActive: row.prev < 0 || undefined }];
  };
  const questOf = (questId, relevance, { instanceId, wingKeys, evidence = [], plannerRow = null }) => {
    const row = rows.get(questId);
    const { faction, races } = row ? raceRule(row.races) : { faction: SIDE[plannerRow?.[6]] ?? null, races: null };
    const giverKey = row?.givers?.[0] ? `${row.givers[0][0]}:${row.givers[0][1]}` : (plannerRow?.[7] ? `npc:${plannerRow[7]}` : null);
    const giver = giverKey ? givers.get(giverKey) || { kind: "npc", id: Number(giverKey.split(":")[1]), name: null } : null;
    // Wing: the wings of its evidence creatures; one wing only, else shared.
    const evidenceWings = new Set(evidence.map(([, kind, refId]) => (kind === "npc" || kind === "giver" ? wingKeys.get(refId) : null)).filter(Boolean));
    const unattributed = evidence.some(([, kind, refId]) => !((kind === "npc" || kind === "giver") && wingKeys.has(refId)));
    const wing = evidenceWings.size === 1 && !unattributed ? [...evidenceWings][0] : null;
    return {
      questId,
      name: row?.title ?? (plannerRow?.[3] ? String(plannerRow[3]) : null),
      relevance,
      level: row?.level > 0 ? row.level : (plannerRow?.[4] ?? null),
      minLevel: row?.minLevel || (plannerRow?.[5] ?? null),
      maxLevel: row?.maxLevel || null,
      faction, races,
      classes: row ? classRule(row.classes) : null,
      repeatable: repeatable(row),
      prerequisites: prerequisitesOf(row),
      exclusiveGroup: row?.group || null,
      breadcrumbFor: row?.breadcrumbFor || null,
      // A reputation the quest asks for: the readiness model cannot check it.
      requiresReputation: row?.rep ? { factionId: row.rep[0], minValue: row.rep[1] } : null,
      startsFromItem: row?.startItem || null,
      giver: giver ? { kind: giver.kind, id: giver.id, name: giver.name ?? null, location: locationOf(giver) } : null,
      objective: objectiveText(row?.objective),
      rewards: row ? [...row.rewards.map((itemId) => ({ itemId, choice: false })), ...row.choices.map((itemId) => ({ itemId, choice: true }))] : [],
      wing,
      evidence: evidence.filter(([id]) => id === instanceId).map(([, kind, refId]) => ({ kind, id: refId })),
      sources: [...(row ? ["azerothcore"] : []), ...(plannerRow ? ["dungeon-planner"] : [])],
    };
  };

  const dungeons = [];
  for (const dungeon of atlas?.dungeons || []) {
    const id = dungeon.instanceId;
    const wingKeys = new Map();
    for (const wing of wingsOf(dungeon)) for (const creature of [...wing.bosses, ...wing.rares]) wingKeys.set(creature.npcId, wing.dungeonKey);
    const listed = plannerRows.get(id) || new Map();
    const picked = new Map();
    const pick = (questId, relevance, extra = {}) => {
      if (picked.has(questId)) return;
      const row = rows.get(questId);
      const final = relevance !== "zone" && relevance !== "unknown" && repeatable(row) ? "repeatable" : relevance;
      picked.set(questId, questOf(questId, final, { instanceId: id, wingKeys, evidence: row?.evidence || [], plannerRow: listed.get(questId) || null, ...extra }));
    };
    for (const questId of [...listed.keys()].sort((a, b) => a - b)) pick(questId, rows.has(questId) ? "dungeon" : "unknown");
    for (const row of rows.values()) if (row.evidence.some(([instanceId]) => instanceId === id)) pick(row.id, "optional");
    // Prerequisites of what is shown, to the start of each chain; breadcrumbs
    // that lead to it.
    const shownIds = [...picked.keys()];
    for (const questId of shownIds) {
      let prev = Math.abs(rows.get(questId)?.prev || 0);
      const guard = new Set();
      while (prev && rows.has(prev) && !guard.has(prev)) {
        guard.add(prev);
        pick(prev, "prerequisite");
        prev = Math.abs(rows.get(prev).prev || 0);
      }
    }
    for (const row of rows.values()) if (row.breadcrumbFor && picked.has(row.breadcrumbFor)) pick(row.id, "prerequisite");
    for (const row of rows.values()) if (areaToInstance.get(row.sort) === id) pick(row.id, "zone");
    const list = [...picked.values()].sort((a, b) => QUEST_RELEVANCE.indexOf(a.relevance) - QUEST_RELEVANCE.indexOf(b.relevance)
      || (a.minLevel ?? 0) - (b.minLevel ?? 0) || a.questId - b.questId);
    dungeons.push({ instanceId: id, name: dungeon.name, curated: listed.size > 0, quests: list });
  }
  return {
    schemaVersion: QUEST_CATALOG_SCHEMA,
    generatedAt,
    relevance: { values: QUEST_RELEVANCE, shownByDefault: DEFAULT_RELEVANCE },
    sources: [source, planner].filter(Boolean).map((extract) => ({ source: extract.source, revision: extract.revision ?? null, retrievedAt: extract.retrievedAt ?? null,
      url: extract.url ?? null, license: extract.license ?? null })),
    dungeons,
  };
}

// Invariants of the catalog: known relevance, one entry per quest and
// dungeon, prerequisites that name a quest, nothing claiming Forever.
export function questCatalogProblems(catalog, atlas) {
  const problems = [];
  const ids = new Set((atlas?.dungeons || []).map((dungeon) => dungeon.instanceId));
  for (const dungeon of catalog?.dungeons || []) {
    if (!ids.has(dungeon.instanceId)) problems.push(`quests: dungeon ${dungeon.instanceId} not in the atlas`);
    const seen = new Set();
    for (const quest of dungeon.quests) {
      const where = `quests ${dungeon.instanceId}: ${quest.questId}`;
      if (seen.has(quest.questId)) problems.push(`${where} listed twice`);
      seen.add(quest.questId);
      if (!QUEST_RELEVANCE.includes(quest.relevance)) problems.push(`${where} relevance ${quest.relevance}`);
      if (!Number.isSafeInteger(quest.questId) || quest.questId < 1) problems.push(`${where} id`);
      if (quest.faction !== null && !["alliance", "horde", "both"].includes(quest.faction)) problems.push(`${where} faction ${quest.faction}`);
      for (const prerequisite of quest.prerequisites) if (!Number.isSafeInteger(prerequisite.questId)) problems.push(`${where} prerequisite`);
      if (!quest.sources.length) problems.push(`${where} has no source`);
      if ("verifiedForForever" in quest && quest.verifiedForForever) problems.push(`${where} claims Forever`);
    }
  }
  return problems;
}
