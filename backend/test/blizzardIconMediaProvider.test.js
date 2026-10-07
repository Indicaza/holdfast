import test from "node:test";
import assert from "node:assert/strict";

import { createBlizzardIconMediaProvider } from "../src/GameData/blizzardIconMediaProvider.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function env(overrides = {}) {
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

test("FileDataID media resolver uses Blizzard credentials and caches icon URLs", async () => {
  const calls = [];
  const provider = createBlizzardIconMediaProvider({
    env: env(),
    now: () => Date.parse("2026-10-07T03:00:00.000Z"),
    fetchImpl: async (input, options = {}) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, options });
      if (url === "https://oauth.battle.net/token") {
        return jsonResponse({ access_token: "token-1", expires_in: 3600 });
      }

      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/data/wow/search/media");
      assert.equal(parsed.searchParams.get("assets.file_data_id"), "134123");

      if (parsed.searchParams.get("namespace") !== "static-us") {
        return jsonResponse({ results: [] });
      }

      return jsonResponse({
        results: [
          {
            data: {
              assets: [
                {
                  key: "icon",
                  value: "https://render.worldofwarcraft.com/us/icons/56/inv_misc_gem_pearl_05.jpg",
                  file_data_id: 134123,
                },
              ],
            },
          },
        ],
      });
    },
  });

  const first = await provider.resolve([134123]);
  assert.equal(
    first["134123"],
    "https://render.worldofwarcraft.com/us/icons/56/inv_misc_gem_pearl_05.jpg",
  );
  assert.equal(calls.filter((call) => call.url === "https://oauth.battle.net/token").length, 1);
  assert.equal(calls.some((call) => call.url.includes("namespace=static-us")), true);

  const callCount = calls.length;
  const second = await provider.resolve([134123]);
  assert.equal(second["134123"], first["134123"]);
  assert.equal(calls.length, callCount);
});

test("FileDataID resolver is inert when Blizzard credentials are absent", async () => {
  let calls = 0;
  const provider = createBlizzardIconMediaProvider({
    env: {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error("should not fetch");
    },
  });

  assert.deepEqual(await provider.resolve([134123]), {});
  assert.equal(calls, 0);
  assert.equal(provider.status().configured, false);
});
