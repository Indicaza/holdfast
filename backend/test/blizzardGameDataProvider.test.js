import test from "node:test";
import assert from "node:assert/strict";

import { createBlizzardGameDataProvider } from "../src/GameData/blizzardGameDataProvider.js";
import {
  resolveGameDataBundle,
  upsertGameDataEntityInDatabase,
} from "../src/GameData/gameDataCatalog.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function providerEnv(overrides = {}) {
  return {
    BLIZZARD_CLIENT_ID: "client-id",
    BLIZZARD_CLIENT_SECRET: "client-secret",
    BLIZZARD_REGION: "us",
    BLIZZARD_LOCALE: "en_US",
    BLIZZARD_STATIC_NAMESPACES: "static-classic1x-us,static-classic-us,static-us",
    BLIZZARD_GAME_DATA_TIMEOUT_MS: "1000",
    ...overrides,
  };
}

function createFakeFetch(calls) {
  return async (input, options = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, options });

    if (url === "https://oauth.battle.net/token") {
      return jsonResponse({ access_token: "token-1", expires_in: 3600 });
    }

    const parsed = new URL(url);
    const namespace = parsed.searchParams.get("namespace");
    const path = parsed.pathname;

    if (namespace === "static-classic1x-us") {
      return jsonResponse({ error: "not_found" }, 404);
    }

    if (path === "/data/wow/item/11746") {
      return jsonResponse({
        id: 11746,
        name: "Golem Skull Helm",
        quality: { type: "RARE", name: "Rare" },
        level: 35,
        required_level: 30,
        item_class: { id: 4, name: "Armor" },
        item_subclass: { id: 4, name: "Plate" },
        inventory_type: { type: "HEAD", name: "Head" },
        sell_price: 12345,
      });
    }

    if (path === "/data/wow/media/item/11746") {
      return jsonResponse({
        id: 11746,
        assets: [{
          key: "icon",
          value: "https://render.worldofwarcraft.com/us/icons/56/inv_helmet_25.jpg",
          file_data_id: 132767,
        }],
      });
    }

    if (path === "/data/wow/spell/12975") {
      return jsonResponse({
        id: 12975,
        name: "Last Stand",
        description: "Temporarily grants additional maximum health.",
      });
    }

    if (path === "/data/wow/media/spell/12975") {
      return jsonResponse({
        id: 12975,
        assets: [{
          key: "icon",
          value: "https://render.worldofwarcraft.com/us/icons/56/spell_holy_ashestoashes.jpg",
          file_data_id: 135871,
        }],
      });
    }

    return jsonResponse({ error: "not_found" }, 404);
  };
}

test("Blizzard provider falls back namespaces, caches OAuth, and overrides telemetry metadata", async () => {
  await withHttpApp(async () => {
    withGuildDatabase((db) => {
      upsertGameDataEntityInDatabase(db, {
        type: "item",
        id: 11746,
        gameBuild: "60001",
        locale: "en_US",
        name: "Telemetry Helm",
        iconFileId: 1,
        source: "telemetry",
      });
    });

    const calls = [];
    const provider = createBlizzardGameDataProvider({
      env: providerEnv(),
      fetchImpl: createFakeFetch(calls),
      now: () => Date.parse("2026-10-06T12:00:00.000Z"),
    });

    const first = await provider.hydrateReferences({
      items: [11746],
      spells: [12975],
    }, { gameBuild: "60001" });

    assert.equal(first.configured, true);
    assert.equal(first.attempted, 2);
    assert.equal(first.hydrated, 2);
    assert.equal(first.failed, 0);

    const bundle = resolveGameDataBundle({
      items: [11746],
      spells: [12975],
    }, { gameBuild: "60001", locale: "en_US" });

    assert.equal(bundle.items["11746"].source, "blizzard");
    assert.equal(bundle.items["11746"].name, "Golem Skull Helm");
    assert.equal(bundle.items["11746"].qualityId, 3);
    assert.equal(bundle.items["11746"].iconFileId, 132767);
    assert.equal(bundle.items["11746"].metadata.itemSubclassName, "Plate");
    assert.equal(bundle.items["11746"].metadata.mediaUrl, "https://render.worldofwarcraft.com/us/icons/56/inv_helmet_25.jpg");
    assert.equal(bundle.spells["12975"].name, "Last Stand");
    assert.equal(bundle.spells["12975"].metadata.description, "Temporarily grants additional maximum health.");

    const oauthCalls = calls.filter((call) => call.url === "https://oauth.battle.net/token");
    assert.equal(oauthCalls.length, 1);
    assert.equal(oauthCalls[0].options.headers.Authorization.startsWith("Basic "), true);
    assert.equal(JSON.stringify(provider.status()).includes("client-secret"), false);
    assert.equal(calls.some((call) => call.url.includes("namespace=static-classic1x-us")), true);
    assert.equal(calls.some((call) => call.url.includes("namespace=static-classic-us")), true);

    const callCount = calls.length;
    const second = await provider.hydrateReferences({
      items: [11746],
      spells: [12975],
    }, { gameBuild: "60001" });
    assert.equal(second.attempted, 0);
    assert.equal(calls.length, callCount);
  });
});

test("Blizzard provider throttles repeated misses and is inert without credentials", async () => {
  await withHttpApp(async () => {
    const calls = [];
    const provider = createBlizzardGameDataProvider({
      env: providerEnv({ BLIZZARD_GAME_DATA_FAILURE_TTL_MS: "60000" }),
      fetchImpl: createFakeFetch(calls),
      now: () => Date.parse("2026-10-06T12:00:00.000Z"),
    });

    const first = await provider.hydrateReferences({ items: [999999] }, { gameBuild: "60001" });
    assert.equal(first.attempted, 1);
    assert.equal(first.hydrated, 0);
    assert.equal(first.failed, 1);
    const afterFirst = calls.length;

    const second = await provider.hydrateReferences({ items: [999999] }, { gameBuild: "60001" });
    assert.equal(second.attempted, 1);
    assert.equal(second.hydrated, 0);
    assert.equal(second.failed, 0);
    assert.equal(calls.length, afterFirst);

    let disabledFetches = 0;
    const disabled = createBlizzardGameDataProvider({
      env: {},
      fetchImpl: async () => {
        disabledFetches += 1;
        throw new Error("should not fetch");
      },
    });
    const result = await disabled.hydrateReferences({ items: [11746] }, { gameBuild: "60001" });
    assert.equal(result.configured, false);
    assert.equal(result.attempted, 0);
    assert.equal(disabledFetches, 0);
  });
});
