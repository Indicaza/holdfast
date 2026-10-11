import assert from "node:assert/strict";
import test from "node:test";

import { readFarmingSource, searchFarmingSources } from "../src/Economy/farmingRepository.js";
import { seedDevelopmentFarming } from "../scripts/seedDevelopmentFarming.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const quiet = { log() {} };

test("development farming seed is idempotent and varied enough to exercise every filter", () =>
  withHttpApp(async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    assert.throws(() => seedDevelopmentFarming({ logger: quiet }), /cannot be seeded in production/);
    process.env.NODE_ENV = "development";
    try {
      const first = seedDevelopmentFarming({ logger: quiet });
      assert.ok(first.created > 20000);
      assert.equal(first.skipped, 0);
      assert.equal(seedDevelopmentFarming({ logger: quiet }).created, 0);
    } finally {
      process.env.NODE_ENV = previous;
    }

    const all = searchFarmingSources();
    assert.deepEqual(all.disciplines.map((entry) => entry.discipline), ["herbalism", "mining"]);
    assert.equal(all.sources[0].name, "Peacebloom");
    assert.equal(all.sources[0].observations, 8143);

    const lichen = searchFarmingSources({ q: "Frilled Lichen" });
    assert.deepEqual(lichen.sources.map((source) => source.name).sort(), ["Briarthorn", "Earthroot", "Kingsblood", "Mageroyal", "Peacebloom", "Silverleaf"]);
    assert.equal(lichen.sources.find((source) => source.name === "Kingsblood").matches[0].confidence, "low", "a 14-gather source stays tentative");
    assert.deepEqual(searchFarmingSources({ q: "copper" }).sources.map((source) => source.name), ["Copper Vein"]);

    const peacebloom = readFarmingSource("herbalism:herb-node:peacebloom");
    assert.equal(peacebloom.summary.zones, 6);
    assert.deepEqual(peacebloom.source.objectIds, [1618, 3724]);
    const rate = (detail) => detail.outputs.find((output) => output.name === "Frilled Lichen").rate;
    const lowRank = readFarmingSource("herbalism:herb-node:peacebloom", { filters: { rank: "0" } });
    const highRank = readFarmingSource("herbalism:herb-node:peacebloom", { filters: { rank: "4" } });
    assert.ok(rate(highRank) > rate(lowRank), "Bountiful Harvest rank visibly changes the rate");
    const ranks = peacebloom.byBountifulHarvest.map((row) => row.rank);
    assert.deepEqual(ranks, [0, 1, 2, 3, 4, 5, "unknown"]);
    assert.ok(peacebloom.bySkill.length >= 6);
    assert.ok(readFarmingSource("herbalism:herb-node:peacebloom", { filters: { build: "70245" } }).summary.observations < peacebloom.summary.observations);
  }));
