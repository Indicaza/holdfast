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
