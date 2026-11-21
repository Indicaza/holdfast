// Dungeon Content Studio, milestone 1: the editorial override layer.
// Dungeons are the real imported atlas (data/atlas.json): The Hall of Thanes
// (3065, a WoW Forever dungeon from the client's tables) and Deadmines (36,
// Classic). Every editorial value below is synthetic test content.
import assert from "node:assert/strict";
import test from "node:test";

import { atlasDungeon } from "../src/Atlas/atlasRepository.js";
import { ADDON_LIMITS, addonEditorialEntry, luaEntryBytes, luaLiteral } from "../src/Atlas/Editorial/addonTransform.js";
import { effectiveEditorial, resolveEditorial } from "../src/Atlas/Editorial/editorialResolve.js";
import { parseEditorialDocument } from "../src/Atlas/Editorial/editorialSchema.js";
import { validateEditorial } from "../src/Atlas/Editorial/editorialValidate.js";
import { editorialQuestPlanOf } from "../src/Atlas/editorialQuestPlan.js";

const HALL = 3065;
const FALDRIM = "261306";
const DEADMINES = 36;

const override = (value, verified = false, source = "test") => ({ value, verified, source });
const parsed = (raw, id) => {
  const result = parseEditorialDocument(raw, id);
  assert.deepEqual(result.problems, []);
  return result.document;
};

test("precedence: verified editorial > Forever client data > unverified editorial > Classic fallback", () => {
  const hall = atlasDungeon(HALL);
  assert.equal(hall.origin, "forever");
  const unverified = resolveEditorial(hall, parsed({ dungeon: { name: override("Hall of the Thanes"), description: override("Synthetic lore.") } }, HALL));
  assert.equal(unverified.tier, "forever-client");
  assert.equal(unverified.dungeon.name.effective, "The Hall of Thanes", "client data beats an unverified edit");
  assert.equal(unverified.dungeon.name.conflict, true);
  assert.equal(unverified.conflicts.length, 1);
  assert.equal(unverified.dungeon.description.effective, "Synthetic lore.", "nothing imported: the edit is used");

  const verified = resolveEditorial(hall, parsed({ dungeon: { name: override("Hall of the Thanes", true) } }, HALL));
  assert.equal(verified.dungeon.name.effective, "Hall of the Thanes");
  assert.equal(verified.dungeon.name.winner, "editorial");
  assert.equal(verified.dungeon.name.imported, "The Hall of Thanes", "the imported value is kept beside it");

  const deadmines = resolveEditorial(atlasDungeon(DEADMINES), parsed({ dungeon: { name: override("The Deadmines") } }, DEADMINES));
  assert.equal(deadmines.tier, "classic-fallback");
  assert.equal(deadmines.dungeon.name.effective, "The Deadmines", "an unverified edit beats a Classic fallback");
  assert.equal(deadmines.dungeon.name.conflict, false);
});

test("an import refresh keeps every edit: the override layer never touches imported data", () => {
  const original = atlasDungeon(DEADMINES);
  const snapshot = JSON.stringify(original);
  const firstBoss = String(original.bosses[0].encounterId);
  const document = parsed({
    dungeon: { description: override("Synthetic description."), levelMin: override(17, true) },
    bosses: { [firstBoss]: { strategy: override("Synthetic strategy."), mechanics: override([{ id: "slam", ability: "Rhahk'Zor Slam", type: "tank-danger", priority: "high", instruction: "Synthetic.", roles: ["tank"], verified: false }]) } },
  }, DEADMINES);
  const before = effectiveEditorial(resolveEditorial(original, document));
  assert.equal(JSON.stringify(original), snapshot, "resolving does not mutate the import");

  // A later import: new level band, the first boss renamed, one boss gone, one added.
  const refreshed = structuredClone(original);
  refreshed.levelMin = 16;
  refreshed.levelMax = 26;
  refreshed.bosses[0].name = "Rhahk'Zor the Renamed";
  refreshed.bosses.pop();
  refreshed.bosses.push({ encounterId: 999999, npcId: null, name: "New Boss", abilities: [], provenance: [] });
  const after = resolveEditorial(refreshed, document);
  const effective = effectiveEditorial(after);
  assert.equal(effective.dungeon.description, "Synthetic description.");
  assert.equal(effective.dungeon.levelMin, 17, "the override still wins");
  assert.equal(effective.dungeon.levelMax, 26, "inherited fields follow the new import");
  const boss = effective.bosses.find((entry) => entry.key === firstBoss);
  assert.equal(boss.name, "Rhahk'Zor the Renamed");
  assert.equal(boss.strategy, "Synthetic strategy.");
  assert.equal(boss.mechanics[0].ability, "Rhahk'Zor Slam");
  assert.deepEqual(before.bosses.find((entry) => entry.key === firstBoss).mechanics, boss.mechanics);
  assert.ok(effective.bosses.some((entry) => entry.name === "New Boss"));
  assert.deepEqual(after.orphans, []);

  const gone = structuredClone(original);
  gone.bosses.shift();
  assert.deepEqual(resolveEditorial(gone, document).orphans, [firstBoss], "edits of a boss the import dropped are kept as orphans");
});

test("telemetry, observed drop rates and readiness can never be overridden", () => {
  const { problems } = parseEditorialDocument({
    dungeon: { observedRates: override([]) },
    bosses: { [FALDRIM]: { observedRate: override(0.5), telemetry: override({}) } },
    questPlan: { quests: [{ questId: 1, readiness: "ready" }] },
    evidence: {},
  }, HALL);
  const codes = problems.map((problem) => `${problem.path}:${problem.code}`);
  for (const path of ["dungeon.observedRates", `bosses.${FALDRIM}.observedRate`, `bosses.${FALDRIM}.telemetry`, "questPlan.quests[0].readiness", "evidence"]) {
    assert.ok(codes.includes(`${path}:protected`), `${path} is refused`);
  }
  const unknown = parseEditorialDocument({ dungeon: { colour: override("red") } }, HALL).problems;
  assert.equal(unknown[0].code, "unknown");
});

test("validation: duplicate ids, broken chains, missing assets, coordinates and the Lua budget", () => {
  const hall = atlasDungeon(HALL);
  const raw = {
    dungeon: { bossOrder: override([FALDRIM, FALDRIM]), cardArt: override("m_missing00001") },
    bosses: { [FALDRIM]: { mechanics: override([
      { id: "bolt", ability: "Shadow Bolt", type: "interrupt", priority: "high", instruction: "Interrupt whenever possible.", roles: ["dps", "tank"], verified: true },
      { id: "bolt", ability: "Shadow Bolt 2", type: "interrupt" },
    ]) } },
    questPlan: { quests: [{ questId: 5001, prerequisites: [5002] }, { questId: 5002, prerequisites: [5001] }, { questId: 5001 }, { questId: 5003, prerequisites: [987654321] }] },
  };
  const { document, problems } = parseEditorialDocument(raw, HALL);
  assert.deepEqual(problems, []);
  const result = validateEditorial({ document, problems, imported: hall, knownQuestIds: new Set([5001, 5002, 5003]) });
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.filter((code) => code === "duplicate-id").length >= 3, "boss order, mechanic and quest duplicates");
  assert.ok(codes.includes("broken-chain"), "cycle and unknown prerequisite");
  assert.ok(result.errors.some((error) => error.message.includes("loop")));
  assert.ok(result.errors.some((error) => error.message.includes("987654321")));
  assert.ok(codes.includes("missing-asset"));

  const coordinates = parseEditorialDocument({ dungeon: { entrance: override({ mapId: 0, x: 0.5, y: 0.5 }) },
    questPlan: { entrance: { mapId: 1455, x: 1.2, y: 0.4 }, quests: [{ questId: 1, giver: { name: "X", location: { mapId: -3, x: 0.1, y: 0.1 } } }] } }, HALL).problems;
  assert.equal(coordinates.length, 3);

  // Every field at its longest on every Deadmines boss: over the add-on budget.
  const deadmines = atlasDungeon(DEADMINES);
  const long = "x".repeat(1000);
  const bosses = Object.fromEntries(deadmines.bosses.map((boss) => [String(boss.encounterId || boss.npcId || boss.name),
    Object.fromEntries(["description", "strategy", "tank", "healer", "dps", "positioning", "interrupts", "dispels"].map((key) => [key, override(long)]))]));
  const big = parseEditorialDocument({ bosses }, DEADMINES);
  assert.deepEqual(big.problems, []);
  const budget = validateEditorial({ document: big.document, imported: deadmines });
  assert.ok(budget.luaBytes > ADDON_LIMITS.dungeonBytes);
  assert.ok(budget.errors.some((error) => error.code === "lua-budget"));
});

test("the add-on entry keeps only winning edits, cut by the shared rules, rendered deterministically", () => {
  const hall = atlasDungeon(HALL);
  const document = parsed({
    dungeon: { name: override("Unverified name"), subtitle: override("Synthetic subtitle"), tips: override(["One", "Two"]) },
    bosses: { [FALDRIM]: { mechanics: override([
      { id: "low", ability: "Low thing", type: "positioning", priority: "low", instruction: "Move.", roles: [] },
      { id: "bolt", ability: "Shadow Bolt", type: "interrupt", priority: "high", instruction: "Interrupt whenever possible.", roles: ["dps", "tank"], verified: true },
    ]) } },
  }, HALL);
  const entry = addonEditorialEntry(HALL, resolveEditorial(hall, document), 7);
  assert.equal(entry.n, undefined, "the unverified name lost to client data and is not exported");
  assert.equal(entry.sub, "Synthetic subtitle");
  assert.deepEqual(entry.tips, ["One", "Two"]);
  const faldrim = entry.bosses.find((boss) => boss.k === FALDRIM);
  assert.equal(faldrim.npc, 261306);
  assert.deepEqual(faldrim.mech.map((row) => row.a), ["Shadow Bolt", "Low thing"], "high priority first");
  assert.deepEqual(faldrim.mech[0], { a: "Shadow Bolt", t: "interrupt", p: "high", i: "Interrupt whenever possible.", r: "tank,dps", v: true });
  assert.equal(luaLiteral({ b: 1, a: "x\"\n\\", ["not ok"]: true, end: [1, 2] }), '{a="x\\"\\n\\\\",b=1,["end"]={1,2},["not ok"]=true}');
  assert.equal(luaEntryBytes(entry), `  [3065]=${luaLiteral(entry)},\n`.length);
});

test("the published quest plan has the planner contract's shape (schema 1)", () => {
  const document = parsed({ questPlan: {
    entrance: { mapId: 1436, x: 0.4205, y: 0.7183, zoneName: "Westfall", verified: true, source: "synthetic" },
    instructions: [{ section: "enter", text: "Synthetic: gather at the entrance.", verified: false, source: "test" }],
    quests: [{ questId: 166, relevance: "dungeon", shareable: "no", prerequisites: [155],
      giver: { name: "Gryan Stoutmantle", location: { mapId: 1436, x: 0.5633, y: 0.4752, zoneName: "Westfall" } },
      turnIn: { name: "Gryan Stoutmantle", location: { mapId: 1436, x: 0.5633, y: 0.4752, zoneName: "Westfall" } },
      steps: [{ text: "Synthetic step." }], notes: "Synthetic note.", verified: true, source: "test" }],
  } }, DEADMINES);
  const plan = editorialQuestPlanOf(DEADMINES, document, 12);
  assert.deepEqual(Object.keys(plan), ["schemaVersion", "instanceId", "revision", "entrance", "instructions", "quests"]);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.revision, "12");
  assert.deepEqual(Object.keys(plan.quests[0]).sort(), ["giver", "notes", "prerequisites", "questId", "relevance", "shareable", "source", "steps", "turnIn", "verified"]);
  assert.equal(editorialQuestPlanOf(DEADMINES, parsed({}, DEADMINES), 1), null, "no quest content: null, the planner uses the catalog");
});
