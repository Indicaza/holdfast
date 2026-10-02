import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateDiscordManifest } from "../src/Discord/provisioning.js";

const manifestUrl = new URL("../config/discord.manifest.json", import.meta.url);

async function loadManifest() {
  return JSON.parse(await readFile(manifestUrl, "utf8"));
}

test("launch Discord manifest keeps rank sidebar order separate from billets", async () => {
  const manifest = validateDiscordManifest(await loadManifest());
  const expectedRanks = [
    "commander",
    "major",
    "captain",
    "lieutenant",
    "sergeant_major",
    "master_sergeant",
    "sergeant",
    "corporal",
    "private",
    "recruit",
  ];
  const expectedBillets = [
    "steward",
    "quartermaster",
    "raid_leader",
    "pvp_lead",
  ];

  assert.deepEqual(
    manifest.roles.slice(0, expectedRanks.length).map((role) => role.key),
    expectedRanks,
  );
  assert.ok(
    manifest.roles
      .slice(0, expectedRanks.length)
      .every((role) => role.hoist === true),
  );

  assert.deepEqual(
    manifest.roles.slice(expectedRanks.length).map((role) => role.key),
    expectedBillets,
  );
  assert.ok(
    manifest.roles
      .slice(expectedRanks.length)
      .every((role) => role.hoist === false),
  );
});

test("launch Discord manifest gives recruits the rooms needed to start playing", async () => {
  const manifest = validateDiscordManifest(await loadManifest());
  const categories = new Map(
    manifest.categories.map((category) => [category.key, category]),
  );

  for (const key of ["great_hall", "operations"]) {
    assert.ok(categories.get(key).accessRoles.includes("recruit"));
  }

  assert.deepEqual(
    categories.get("great_hall").channels.map((channel) => channel.key),
    [
      "general",
      "looking_for_group",
      "trade_crafting",
      "great_hall_voice",
      "adventure_one",
    ],
  );
});
