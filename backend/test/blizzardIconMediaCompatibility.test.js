import assert from "node:assert/strict";
import test from "node:test";

import { createBlizzardIconMediaProvider } from "../src/GameData/blizzardIconMediaProvider.js";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("icon media search refreshes expired auth and ignores malformed assets", async () => {
  let oauthCalls = 0;
  let searchCalls = 0;
  const provider = createBlizzardIconMediaProvider({
    env: {
      BLIZZARD_CLIENT_ID: "client",
      BLIZZARD_CLIENT_SECRET: "secret",
      BLIZZARD_REGION: "us",
      BLIZZARD_LOCALE: "en_US",
      BLIZZARD_STATIC_NAMESPACES: "static-classic-us,static-us",
      BLIZZARD_GAME_DATA_TIMEOUT_MS: "1000",
    },
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://oauth.battle.net/token") {
        oauthCalls += 1;
        return response({ access_token: `token-${oauthCalls}`, expires_in: 3600 });
      }

      searchCalls += 1;
      const parsed = new URL(url);
      if (searchCalls === 1) return response({ error: "expired" }, 401);
      if (parsed.searchParams.get("namespace") === "static-classic-us") {
        return response({
          results: [{ data: { assets: [{ key: "icon", value: "http://unsafe.example/icon.jpg" }] } }],
        });
      }
      return response({
        results: [{
          assets: [{
            key: "icon",
            value: "https://render.worldofwarcraft.com/us/icons/56/inv_sword_04.jpg",
            fileDataId: "999",
          }],
        }],
      });
    },
  });

  const resolved = await provider.resolve([null, -2, "nope", 999, 999]);
  assert.equal(
    resolved["999"],
    "https://render.worldofwarcraft.com/us/icons/56/inv_sword_04.jpg",
  );
  assert.equal(oauthCalls, 2);
  assert.equal(searchCalls >= 3, true);
});

test("icon media misses fail soft and are negatively cached", async () => {
  let calls = 0;
  const provider = createBlizzardIconMediaProvider({
    env: {
      BLIZZARD_CLIENT_ID: "client",
      BLIZZARD_CLIENT_SECRET: "secret",
      BLIZZARD_REGION: "us",
      BLIZZARD_GAME_DATA_FAILURE_TTL_MS: "60000",
    },
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls += 1;
      if (url === "https://oauth.battle.net/token") {
        return response({ access_token: "token", expires_in: 3600 });
      }
      return response({ results: [] });
    },
  });

  assert.deepEqual(await provider.resolve([555]), {});
  const afterMiss = calls;
  assert.deepEqual(await provider.resolve([555]), {});
  assert.equal(calls, afterMiss);
});
