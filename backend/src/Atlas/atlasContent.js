// Dungeon Atlas content: who stands where in each dungeon, what they cast,
// and which of them are rares or dangerous trash. Pure: the extract*
// functions trim upstream tables into the checked-in extracts (run by
// scripts/fetchDungeonAtlasSources.mjs), adaptContent() turns those extracts
// into atlas facts for atlasNormalize.js.
//
// Sources and what each one is trusted for:
// - AzerothCore world DB (GPL-2.0, community-unverified): creature spawns,
//   ranks, which creature casts which spell (SmartAI, creature_template_spell
//   and the spell enums of single-creature C++ scripts) and the encounter
//   list of dungeons the Classic Era client has none for.
// - The Classic Era client's spell tables via wago.tools (classic-reference):
//   spell names, cast times, interrupt flags, dispel types, mechanics and
//   effects. Ability categories are derived from those fields by the rules in
//   classifySpell(); none of it is checked against WoW Forever, so every
//   ability says verifiedForForever: false.
//
// The client has no dungeon floor maps in Classic Era, and Blizzard's map art
// is not ours to ship, so each dungeon gets a "layout": a top-down plot of
// its own spawn positions that the site draws itself. Positions on it are
// 0–1 from the top left; multi-level dungeons overlap (height is ignored).

import { VANILLA_INSTANCE_IDS } from "./atlasSources.js";

const int = (value) => {
  const number = Number(value);
  return value === "" || value === null || value === undefined || !Number.isFinite(number) ? null : Math.trunc(number);
};
const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};
const round1 = (value) => Math.round(value * 10) / 10;
const round3 = (value) => Math.round(value * 1000) / 1000;

const RANK = Object.freeze({ normal: 0, elite: 1, rareElite: 2, boss: 3, rare: 4 });
const SMART_SOURCE_CREATURE = "0";
const SMART_ACTION_CAST = "11";
const SMART_ACTION_INVOKER_CAST = "85";
const SMART_ACTION_SELF_CAST = "134";

// ------------------------------------------------------------- Extraction

// AzerothCore rows for creatures spawned in a vanilla dungeon.
export function extractCreatureContent({ spawnRows = [], templateRows = [], smartRows = [], ctsRows = [], encounterRows = [], scriptFiles = [] }) {
  const instances = new Set(VANILLA_INSTANCE_IDS);
  const spawns = spawnRows.filter((row) => instances.has(int(row.map)))
    .map((row) => [int(row.id1 ?? row.id), int(row.map), round1(Number(row.position_x)), round1(Number(row.position_y)), round1(Number(row.position_z))])
    .filter((row) => row[0] && row.slice(2).every(Number.isFinite))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]);
  const spawned = new Set(spawns.map((row) => row[0]));
  const encounterNpcs = new Set(encounterRows.filter((row) => row.creditType === "0").map((row) => int(row.creditEntry)));
  const creatures = templateRows.filter((row) => spawned.has(int(row.entry)))
    .map((row) => ({ entry: int(row.entry), name: text(row.name), subname: text(row.subname), rank: int(row.rank), minlevel: int(row.minlevel),
      maxlevel: int(row.maxlevel), ScriptName: text(row.ScriptName) }))
    .sort((a, b) => a.entry - b.entry);
  const scriptOf = new Map(creatures.filter((row) => row.ScriptName).map((row) => [row.ScriptName, row.entry]));

  const casts = new Map();
  const add = (npcId, spellId, origin) => {
    if (!spawned.has(npcId) || !(spellId > 0)) return;
    const key = `${npcId}:${spellId}`;
    if (!casts.has(key)) casts.set(key, [npcId, spellId, origin]);
  };
  for (const row of smartRows) {
    if (row.source_type !== SMART_SOURCE_CREATURE || ![SMART_ACTION_CAST, SMART_ACTION_INVOKER_CAST, SMART_ACTION_SELF_CAST].includes(row.action_type)) continue;
    const npcId = int(row.entryorguid);
    if (npcId > 0) add(npcId, int(row.action_param1), "smart_scripts");
  }
  for (const row of ctsRows) add(int(row.CreatureID), int(row.Spell), "creature_template_spell");
  for (const file of scriptFiles) {
    if (file.scripts.length !== 1) continue;
    const npcId = scriptOf.get(file.scripts[0]);
    if (npcId) for (const spellId of file.spells) add(npcId, spellId, `script:${file.path}`);
  }

  const encounters = encounterRows.filter((row) => row.creditType === "0" && spawned.has(int(row.creditEntry)))
    .map((row) => ({ entry: int(row.entry), creditEntry: int(row.creditEntry), comment: text(row.comment) }))
    .sort((a, b) => a.entry - b.entry);
  return {
    spawns,
    creatures: creatures.filter((row) => row.rank !== RANK.normal || encounterNpcs.has(row.entry) || [...casts.values()].some((cast) => cast[0] === row.entry)),
    creature_spells: [...casts.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    instance_encounters: encounters,
  };
}

// The Classic Era client's facts for the given spells, and the continent
// areas named after each dungeon (their parent area is the dungeon's zone).
export function extractSpellContent({ spellIds, tables, dungeonNames = [] }) {
  const wanted = new Set(spellIds);
  const by = (rows, key = "SpellID") => {
    const map = new Map();
    for (const row of rows || []) {
      const id = int(row[key]);
      if (!wanted.has(id) || int(row.DifficultyID ?? 0)) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(row);
    }
    return map;
  };
  const names = by(tables.SpellName, "ID");
  const texts = by(tables.Spell, "ID");
  const misc = by(tables.SpellMisc);
  const interrupts = by(tables.SpellInterrupts);
  const categories = by(tables.SpellCategories);
  const effects = by(tables.SpellEffect);
  const castTimes = new Map((tables.SpellCastTimes || []).map((row) => [int(row.ID), int(row.Base)]));
  const spells = [...wanted].filter((id) => names.has(id)).sort((a, b) => a - b).map((id) => {
    const m = misc.get(id)?.[0] || {};
    const c = categories.get(id)?.[0] || {};
    return {
      id, name: text(names.get(id)[0].Name_lang), description: text(texts.get(id)?.[0]?.Description_lang),
      castMs: castTimes.get(int(m.CastingTimeIndex)) ?? 0, passive: ((int(m.Attributes_0) || 0) & 0x40) !== 0, school: int(m.SchoolMask) || 0,
      interruptFlags: int(interrupts.get(id)?.[0]?.InterruptFlags) || 0, dispelType: int(c.DispelType) || 0, mechanic: int(c.Mechanic) || 0,
      effects: (effects.get(id) || []).sort((a, b) => int(a.EffectIndex) - int(b.EffectIndex))
        .map((row) => [int(row.Effect) || 0, int(row.EffectAura) || 0, int(row.ImplicitTarget_0) || 0, int(row.ImplicitTarget_1) || 0, int(row.EffectMechanic) || 0]),
    };
  });
  const wantedNames = new Set(dungeonNames);
  const areas = tables.AreaTable || [];
  const areaName = new Map(areas.map((row) => [int(row.ID), text(row.AreaName_lang)]));
  const dungeonAreas = areas.filter((row) => ["0", "1"].includes(row.ContinentID) && wantedNames.has(text(row.AreaName_lang)) && int(row.ParentAreaID))
    .map((row) => ({ ID: int(row.ID), name: text(row.AreaName_lang), continentId: int(row.ContinentID), parentId: int(row.ParentAreaID),
      parentName: areaName.get(int(row.ParentAreaID)) ?? null }))
    .sort((a, b) => a.ID - b.ID);
  return { spells, dungeonAreas };
}

// ---------------------------------------------------------- Classification

const DISPEL = Object.freeze({ 1: "Magic", 2: "Curse", 3: "Disease", 4: "Poison" });
// SpellMechanic values that take a player out of control.
const CONTROL = Object.freeze({ 1: "charm", 2: "disorient", 5: "fear", 7: "root", 9: "silence", 10: "sleep", 12: "stun", 13: "freeze", 14: "knockout",
  17: "polymorph", 18: "banish", 24: "horror", 30: "sap" });
const SPELL_INTERRUPT_FLAG_INTERRUPT = 0x08;
// Spell effects (3.3.5 / Classic numbering).
const E = Object.freeze({ schoolDamage: 2, applyAura: 6, powerDrain: 8, heal: 10, weaponNoSchool: 17, summon: 28, weaponPercent: 31, persistentArea: 27,
  areaAuraParty: 35, weaponDamage: 58, powerBurn: 62, knockBack: 98, normalizedWeapon: 121, healthLeech: 9, healPct: 136 });
// Auras.
const A = Object.freeze({ periodicDamage: 3, modCharm: 6, modFear: 7, modStun: 12, modRoot: 26, modSilence: 27, modDamageTakenPct: 87, periodicLeech: 53,
  periodicDamagePct: 89, modHealingPct: 118, modDecreaseSpeed: 33, modResistance: 22, modMeleeHaste: 138, modDamageDonePct: 79 });
// Implicit targets.
const AREA_ENEMY = new Set([15, 16, 22, 24, 28, 53, 54, 104]);
const FRIENDLY = new Set([1, 5, 20, 21, 30, 31]);
const JUNK_NAME = /visual|dummy|\btest\b|\bDND\b|trigger|credit|despawn|cosmetic|\bquest\b|teleport|transform|invisib|\bkill\b|stealth detect|\(old\)|\bunused\b/i;

const damaging = (effect) => [E.schoolDamage, E.weaponNoSchool, E.weaponPercent, E.weaponDamage, E.normalizedWeapon, E.healthLeech].includes(effect[0])
  || (effect[0] === E.applyAura && [A.periodicDamage, A.periodicDamagePct, A.periodicLeech].includes(effect[1]));
const harmful = (effect) => !FRIENDLY.has(effect[2]) || effect[2] === 0;

// One spell as an atlas Ability, or null when it is not worth a player's
// attention (cosmetic, passive, unnamed). Rules, in order:
//   crowd-control  it applies a loss-of-control mechanic to enemies
//   healer-danger  it drains or burns mana, or ticks damage over an area
//   interrupt      a cast with a cast time the client marks interruptible
//   dispel         an enemy aura of a dispellable type, or a purgeable buff
//   tank-danger    enrage/frenzy, healing or armour debuffs, single-target hits
//   positioning    damage or knock-back over an area
//   special-mechanic  anything else (summons, buffs, scripted effects)
export function classifySpell(spell) {
  if (!spell?.name || spell.passive || JUNK_NAME.test(spell.name)) return null;
  const effects = spell.effects || [];
  if (!effects.length) return null;
  const onEnemies = effects.filter(harmful);
  const onArea = effects.some((effect) => AREA_ENEMY.has(effect[2]) || AREA_ENEMY.has(effect[3]) || [E.persistentArea].includes(effect[0]));
  const mechanics = [spell.mechanic, ...effects.map((effect) => effect[4])].filter((value) => CONTROL[value]);
  const controls = [...new Set([...mechanics.map((value) => CONTROL[value]),
    ...onEnemies.filter((effect) => effect[0] === E.applyAura).map((effect) => ({ [A.modStun]: "stun", [A.modFear]: "fear", [A.modCharm]: "charm",
      [A.modRoot]: "root", [A.modSilence]: "silence" })[effect[1]]).filter(Boolean)])];
  const casted = spell.castMs > 0;
  const interruptible = casted ? (spell.interruptFlags & SPELL_INTERRUPT_FLAG_INTERRUPT) !== 0 : null;
  const heals = effects.some((effect) => [E.heal, E.healPct].includes(effect[0]) || (effect[0] === E.applyAura && effect[1] === 8));
  const selfOnly = effects.every((effect) => FRIENDLY.has(effect[2]));
  const dispel = DISPEL[spell.dispelType] || null;
  const drains = effects.some((effect) => [E.powerDrain, E.powerBurn].includes(effect[0]));
  const areaDamage = onArea && onEnemies.some(damaging);
  const areaTicks = onArea && onEnemies.some((effect) => effect[0] === E.applyAura && [A.periodicDamage, A.periodicDamagePct].includes(effect[1]));

  let category;
  let priority;
  if (controls.length && !selfOnly) { category = "crowd-control"; priority = "high"; } else if (drains || areaTicks) { category = "healer-danger"; priority = "high"; } else if (interruptible && (heals || onEnemies.length)) {
    category = "interrupt"; priority = heals || spell.castMs >= 1500 ? "high" : "medium";
  } else if (dispel && !selfOnly && onEnemies.some((effect) => effect[0] === E.applyAura)) { category = "dispel"; priority = "medium"; } else if (dispel === "Magic" && selfOnly && !heals) {
    category = "dispel"; priority = "low";
  } else if (/enrage|frenzy/i.test(spell.name) || onEnemies.some((effect) => effect[0] === E.applyAura && [A.modHealingPct, A.modDamageTakenPct, A.modResistance].includes(effect[1]))) {
    category = "tank-danger"; priority = /enrage|frenzy/i.test(spell.name) ? "high" : "medium";
  } else if (areaDamage || effects.some((effect) => effect[0] === E.knockBack)) { category = "positioning"; priority = "medium"; } else if (onEnemies.some(damaging)) {
    category = "tank-danger"; priority = "low";
  } else { category = "special-mechanic"; priority = "low"; }

  const facts = [];
  facts.push(casted ? `${(spell.castMs / 1000).toFixed(1).replace(/\.0$/, "")}s cast` : "instant");
  if (interruptible === true) facts.push("interruptible");
  if (interruptible === false) facts.push("not interruptible");
  if (controls.length) facts.push(controls.join("/"));
  if (dispel) facts.push(`${dispel} effect`);
  if (onArea) facts.push("area");
  if (heals) facts.push("heals");
  if (drains) facts.push("drains mana");
  return {
    spellId: spell.id, name: spell.name, category, priority, interruptible, summary: facts.join(" · "),
    // Client descriptions with $-tokens need the spell's own numbers; those stay out.
    details: spell.description && !spell.description.includes("$") ? spell.description : null,
    source: "classic-reference", verifiedForForever: false,
  };
}

const PRIORITY = { high: 0, medium: 1, low: 2 };
export function sortAbilities(abilities) {
  return abilities.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.name.localeCompare(b.name) || a.spellId - b.spellId);
}

// ---------------------------------------------------------------- Adapter

// A dungeon's spawn positions as 0–1 layout coordinates (north up), with a
// small margin so markers never sit on the edge.
function layoutFrame(points) {
  const xs = points.map((p) => p[2]);
  const ys = points.map((p) => p[3]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const project = (worldX, worldY) => ({ x: round3(0.03 + 0.94 * ((maxY - worldY) / spanY)), y: round3(0.03 + 0.94 * ((maxX - worldX) / spanX)) });
  return { project, width: Math.round(spanY), height: Math.round(spanX) };
}

export function adaptContent(creatureExtract, spellExtract) {
  const ct = creatureExtract?.tables || {};
  const st = spellExtract?.tables || {};
  const creatures = new Map((ct.creatures || []).map((row) => [row.entry, row]));
  const abilities = new Map();
  for (const spell of st.spells || []) {
    const ability = classifySpell(spell);
    if (ability) abilities.set(spell.id, ability);
  }
  const abilitiesOf = new Map();
  for (const [npcId, spellId] of ct.creature_spells || []) {
    const ability = abilities.get(spellId);
    if (!ability) continue;
    const list = abilitiesOf.get(npcId) || [];
    // Ranks of one spell share a name; keep the first.
    if (!list.some((entry) => entry.name === ability.name)) list.push(ability);
    abilitiesOf.set(npcId, list);
  }
  for (const list of abilitiesOf.values()) sortAbilities(list);

  const byInstance = new Map();
  for (const spawn of ct.spawns || []) {
    if (!byInstance.has(spawn[1])) byInstance.set(spawn[1], []);
    byInstance.get(spawn[1]).push(spawn);
  }
  const encounters = new Map();
  for (const row of ct.instance_encounters || []) {
    const spawn = (ct.spawns || []).find((entry) => entry[0] === row.creditEntry);
    if (!spawn) continue;
    if (!encounters.has(spawn[1])) encounters.set(spawn[1], []);
    encounters.get(spawn[1]).push(row);
  }

  const instances = new Map();
  for (const [instanceId, spawns] of byInstance) {
    const frame = layoutFrame(spawns);
    const cells = new Map();
    for (const spawn of spawns) {
      const point = frame.project(spawn[2], spawn[3]);
      const key = `${Math.round(point.x * 100)}:${Math.round(point.y * 100)}`;
      if (!cells.has(key)) cells.set(key, [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100]);
    }
    const firstSpawn = new Map();
    const counts = new Map();
    for (const spawn of spawns) {
      if (!firstSpawn.has(spawn[0])) firstSpawn.set(spawn[0], spawn);
      counts.set(spawn[0], (counts.get(spawn[0]) || 0) + 1);
    }
    // A creature with one spawn has a position; one with many has none (it
    // is a kind of creature, not a place).
    const positionOf = (npcId) => (counts.get(npcId) === 1 ? frame.project(firstSpawn.get(npcId)[2], firstSpawn.get(npcId)[3]) : null);
    const levels = (row) => (row?.minlevel ? { levelMin: row.minlevel, levelMax: row.maxlevel ?? row.minlevel } : { levelMin: null, levelMax: null });
    const rares = [...counts.keys()].map((npcId) => creatures.get(npcId)).filter((row) => row && [RANK.rare, RANK.rareElite].includes(row.rank))
      .map((row) => ({ npcId: row.entry, name: row.name, ...levels(row), elite: row.rank === RANK.rareElite, floorId: "layout", mapPosition: positionOf(row.entry),
        abilities: abilitiesOf.get(row.entry) || [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    instances.set(instanceId, {
      layout: { floorId: "layout", name: "Spawn layout", kind: "spawn-layout", imageUrl: null, width: frame.width, height: frame.height,
        points: [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]) },
      positionOf, counts, rares,
      encounters: (encounters.get(instanceId) || []).map((row) => ({ encounterId: row.entry, npcId: row.creditEntry,
        name: creatures.get(row.creditEntry)?.name || row.comment })),
      trash: (bossIds) => [...counts.keys()].map((npcId) => creatures.get(npcId))
        .filter((row) => row && row.rank === RANK.elite && !bossIds.has(row.entry) && (abilitiesOf.get(row.entry) || []).some((a) => a.priority === "high"))
        .map((row) => ({ npcId: row.entry, name: row.name, ...levels(row), count: counts.get(row.entry), abilities: abilitiesOf.get(row.entry) }))
        .sort((a, b) => b.abilities.filter((x) => x.priority === "high").length - a.abilities.filter((x) => x.priority === "high").length
          || b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 8),
    });
  }
  const zoneOf = new Map((st.dungeonAreas || []).map((row) => [row.name, row.parentName]));
  return { instances, abilitiesOf, zoneOf };
}
