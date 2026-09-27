import assert from "node:assert/strict";
import test from "node:test";

import { discordAuthConfigurationProblems } from "../src/Auth/discordAuth.js";

function validAuthEnvironment(overrides = {}) {
  return {
    FRONTEND_URL: "https://holdfast.example",
    SESSION_SECRET: "a".repeat(32),
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_GUILD_ID: "223456789012345678",
    DISCORD_BOT_TOKEN: "token",
    ...overrides,
  };
}

test("Discord login does not require an optional recruit role", () => {
  assert.deepEqual(
    discordAuthConfigurationProblems(validAuthEnvironment()),
    [],
  );
});

test("Discord login still reports required authentication settings", () => {
  const env = validAuthEnvironment({ DISCORD_CLIENT_SECRET: "" });

  assert.deepEqual(discordAuthConfigurationProblems(env), [
    "DISCORD_CLIENT_SECRET",
  ]);
});

test("Discord login treats whitespace-only settings as missing", () => {
  assert.deepEqual(
    discordAuthConfigurationProblems(
      validAuthEnvironment({
        DISCORD_CLIENT_ID: " ",
        DISCORD_CLIENT_SECRET: "\t",
        DISCORD_GUILD_ID: "\n",
        DISCORD_BOT_TOKEN: "   ",
        SESSION_SECRET: " ",
      }),
    ),
    [
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_GUILD_ID",
      "DISCORD_BOT_TOKEN",
      "SESSION_SECRET",
    ],
  );
});

test("Discord login configuration never requires unrelated settings", () => {
  const env = validAuthEnvironment({
    DISCORD_RECRUIT_ROLE_ID: "",
    GUILD_OWNER_DISCORD_IDS: "",
    DISCORD_REDIRECT_URI: "",
  });

  assert.deepEqual(discordAuthConfigurationProblems(env), []);
});
