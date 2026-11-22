import assert from "node:assert/strict";
import test from "node:test";

import { createBlizzardIconMediaResolver } from "../src/GameData/blizzardIconMedia.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test("FileDataID media lookup falls through Classic namespaces to standard Blizzard data", async () => {
  const namespaces = [];
  const resolver = createBlizzardIconMediaResolver({
    env: {
      BLIZZARD_CLIENT_ID: "client",
      BLIZZARD_CLIENT_SECRET: "secret",
      BLIZZARD_REGION: "us",
      BLIZZARD_LOCALE: "en_US",
      BLIZZARD_STATIC_NAMESPACES: "static-classic1x-us,static-classic-us",
      BLIZZARD_API_BASE_URL: "https://us.api.blizzard.com",
      BLIZZARD_OAUTH_URL: "https://oauth.battle.net/token",
    },
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("oauth.battle.net")) {
        return jsonResponse({ access_token: "token", expires_in: 3600 });
      }

      const parsed = new URL(value);
      const namespace = parsed.searchParams.get("namespace");
      namespaces.push(namespace);
      assert.equal(parsed.searchParams.get("assets.file_data_id"), "900001");

      if (namespace === "static-us") {
        return jsonResponse({
          results: [{
            data: {
              assets: [{
                key: "talent-background",
                file_data_id: 900001,
                value: "https://render.worldofwarcraft.com/us/talent/background.jpg",
              }],
            },
          }],
        });
      }
      return jsonResponse({ results: [] });
    },
  });

  const result = await resolver.resolve(900001);
  assert.equal(result, "https://render.worldofwarcraft.com/us/talent/background.jpg");
  assert.deepEqual(namespaces, ["static-classic1x-us", "static-classic-us", "static-us"]);
  assert.deepEqual(resolver.status().namespaces, ["static-classic1x-us", "static-classic-us", "static-us"]);
});

const ENV = {
  BLIZZARD_CLIENT_ID: "client",
  BLIZZARD_CLIENT_SECRET: "secret",
  BLIZZARD_REGION: "us",
  BLIZZARD_LOCALE: "en_US",
  BLIZZARD_STATIC_NAMESPACES: "static-classic1x-us",
  BLIZZARD_MEDIA_NAMESPACE: "static-classic1x-us",
  BLIZZARD_API_BASE_URL: "https://us.api.blizzard.com",
  BLIZZARD_OAUTH_URL: "https://oauth.battle.net/token",
};

function itemMediaResolver(assets, itemIds = [100, 200]) {
  const asked = [];
  const resolver = createBlizzardIconMediaResolver({
    env: ENV,
    itemIdsForIcon: () => itemIds,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("oauth.battle.net")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      const { pathname } = new URL(value);
      if (pathname.endsWith("/search/media")) return jsonResponse({ results: [] });
      const itemId = Number(pathname.split("/").pop());
      asked.push(itemId);
      return assets[itemId] ? jsonResponse({ assets: assets[itemId] }) : jsonResponse({}, 404);
    },
  });
  return { resolver, asked };
}

test("a reference icon the media search misses comes from an item using it", async () => {
  const url = "https://render.worldofwarcraft.com/classic-us/icons/56/inv_misc_necklacea8.jpg";
  const { resolver, asked } = itemMediaResolver({ 200: [{ key: "icon", file_data_id: 466975, value: url }] });
  assert.equal(await resolver.resolve(466975), url);
  assert.deepEqual(asked, [100, 200]);
});

test("an item's media is refused when it names a different icon", async () => {
  const { resolver } = itemMediaResolver({ 100: [{ key: "icon", file_data_id: 111111, value: "https://render.worldofwarcraft.com/wrong.jpg" }] });
  assert.equal(await resolver.resolve(466975), "");
});

test("an icon no reference item uses asks for no item media", async () => {
  const { resolver, asked } = itemMediaResolver({}, []);
  assert.equal(await resolver.resolve(999999), "");
  assert.deepEqual(asked, []);
});
