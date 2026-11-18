import assert from "node:assert/strict";
import test from "node:test";

import { adaptContent, classifySpell, extractCreatureContent } from "../src/Atlas/atlasContent.js";
import { zonePoint } from "../src/Atlas/atlasNormalize.js";
import { parseScriptSpells } from "../src/Atlas/atlasSources.js";

// Dungeon Atlas content: spawns, creature spells and the rules that turn
// client spell facts into ability cards. Every input here is a fixture.

const spell = (fields) => ({ id: 1, name: "Spell", description: null, castMs: 0, passive: false, school: 1, interruptFlags: 0, preventionType: 1, dispelType: 0, mechanic: 0,
  effects: [[2, 0, 6, 0, 0]], ...fields });

test("C++ scripts lend their spells only when they register one creature", () => {
  const single = parseScriptSpells(`enum Spells { SPELL_SLAM = 6304, // SPELL_FAKE = 1
    SPELL_STOMP = 6432 };
/* SPELL_GONE = 99 */
void AddSC() { RegisterDeadminesCreatureAI(boss_mr_smite); }`);
  assert.deepEqual(single, { scripts: ["boss_mr_smite"], spells: [6304, 6432] });
  const multi = parseScriptSpells(`SPELL_A = 5; CreatureScript("boss_x"); new npc_add();`);
  assert.deepEqual(multi.scripts, ["boss_x", "npc_add"]);

  const extract = extractCreatureContent({
    spawnRows: [{ id1: "10", map: "36", position_x: "1", position_y: "2", position_z: "3" }, { id1: "11", map: "36", position_x: "5", position_y: "6", position_z: "7" },
      { id1: "12", map: "1", position_x: "0", position_y: "0", position_z: "0" }],
    templateRows: [{ entry: "10", name: "Boss", rank: "3", ScriptName: "boss_x" }, { entry: "11", name: "Add", rank: "1", ScriptName: "npc_add" },
      { entry: "12", name: "Outside", rank: "1" }],
    smartRows: [{ source_type: "0", action_type: "11", entryorguid: "11", action_param1: "77" }, { source_type: "9", action_type: "11", entryorguid: "11", action_param1: "78" }],
    scriptFiles: [{ path: "a.cpp", ...multi }, { path: "b.cpp", scripts: ["boss_x"], spells: [5] }],
  });
  assert.deepEqual(extract.spawns.map((row) => row[0]), [10, 11], "only dungeon spawns");
  assert.deepEqual(extract.creature_spells, [[10, 5, "script:b.cpp"], [11, 77, "smart_scripts"]], "multi-script files and timed-action lists lend nothing");
});

test("spell rules: control, healer danger, interrupts, dispels and the rest", () => {
  assert.equal(classifySpell(spell({ name: "Hammer of Justice", mechanic: 12 })).category, "crowd-control");
  const heal = classifySpell(spell({ name: "Heal", castMs: 3000, interruptFlags: 8, effects: [[10, 0, 21, 0, 0]] }));
  assert.deepEqual([heal.category, heal.priority, heal.interruptible], ["interrupt", "high", true]);
  assert.equal(classifySpell(spell({ name: "Mana Burn", effects: [[62, 0, 6, 0, 0]] })).category, "healer-danger");
  assert.equal(classifySpell(spell({ name: "Curse of Weakness", dispelType: 2, effects: [[6, 18, 6, 0, 0]] })).category, "dispel");
  assert.equal(classifySpell(spell({ name: "Enrage", effects: [[6, 138, 1, 0, 0]] })).category, "tank-danger");
  assert.equal(classifySpell(spell({ name: "Cleave", effects: [[2, 0, 24, 0, 0]] })).category, "positioning");
  assert.equal(classifySpell(spell({ name: "Strike", castMs: 2000, interruptFlags: 0 })).interruptible, false, "a cast the client does not mark interruptible");
  assert.equal(classifySpell(spell({ name: "Strike" })).interruptible, null, "instant: interrupting does not apply");
  for (const junk of [spell({ name: "Cosmetic Visual" }), spell({ name: "Passive", passive: true }), spell({ name: null }), spell({ effects: [] })]) {
    assert.equal(classifySpell(junk), null);
  }
  const described = classifySpell(spell({ name: "Fireball", description: "Hurls a fiery ball that causes $s1 Fire damage." }));
  assert.equal(described.details, null, "descriptions with unresolved numbers stay out");
  assert.deepEqual([described.source, described.verifiedForForever], ["classic-reference", false]);
});

test("content: layout, single-spawn positions, rares and dangerous trash", () => {
  const creatures = { tables: {
    spawns: [[10, 36, 0, 0, 0], [10, 36, 100, 100, 0], [20, 36, 100, 0, 0], [30, 36, 50, 50, 0], [40, 36, 0, 100, 0]],
    creatures: [{ entry: 10, name: "Thug", rank: 1, minlevel: 18, maxlevel: 19 }, { entry: 20, name: "Boss", rank: 3 }, { entry: 30, name: "Rare", rank: 4, minlevel: 20 },
      { entry: 40, name: "Quiet", rank: 1 }],
    creature_spells: [[10, 1, "smart_scripts"], [20, 2, "smart_scripts"]],
    instance_encounters: [{ entry: 5, creditEntry: 20, comment: "Boss" }],
  } };
  const spells = { tables: { spells: [spell({ id: 1, name: "Fear", mechanic: 5 }), spell({ id: 2, name: "Smash" })], dungeonAreas: [] } };
  const place = adaptContent(creatures, spells).instances.get(36);
  assert.equal(place.layout.imageUrl, null);
  assert.ok(place.layout.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
  assert.deepEqual(place.positionOf(20), { x: 0.97, y: 0.03 }, "north (high x) is up, west (high y) is left");
  assert.equal(place.positionOf(10), null, "many spawns: a kind of creature, not a place");
  assert.deepEqual(place.rares.map((rare) => [rare.name, rare.elite, rare.levelMin]), [["Rare", false, 20]]);
  assert.deepEqual(place.trash(new Set([20])).map((row) => [row.name, row.count]), [["Thug", 2]], "elite with a high-priority spell; quiet elites stay out");
  assert.deepEqual(place.encounters, [{ encounterId: 5, npcId: 20, name: "Boss" }]);
});

test("entrances prefer the zone the client files the dungeon under", () => {
  const zones = [{ mapId: 1, name: "Darkshore", continentId: 1, minX: 0, maxX: 100, minY: 0, maxY: 100 },
    { mapId: 2, name: "Ashenvale", continentId: 1, minX: -90, maxX: 90, minY: -40, maxY: 60 }];
  assert.equal(zonePoint(zones, 1, 50, 50).zoneName, "Darkshore");
  assert.equal(zonePoint(zones, 1, 50, 50, "Ashenvale").zoneName, "Ashenvale");
  assert.equal(zonePoint(zones, 1, 50, 50, "Tanaris").zoneName, "Darkshore", "a preferred zone that does not hold the point is ignored");
});
