import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionEnvironment,
  productionEnvironmentProblems,
} from "../src/Config/environment.js";

function validEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    PORT: "3000",
    FRONTEND_URL: "https://holdfast.example",
    GUILD_DATA_DIR: "/data",
    SESSION_SECRET: "a".repeat(32),
    DISCORD_CLIENT_ID: "123456789012345678",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_GUILD_ID: "223456789012345678",
    DISCORD_BOT_TOKEN: "token",
    DISCORD_RECRUIT_ROLE_ID: "423456789012345678",
    GUILD_OWNER_DISCORD_IDS: "323456789012345678",
    ...overrides,
  };
}

test("development does not require production configuration", () => {
  assert.deepEqual(productionEnvironmentProblems({ NODE_ENV: "development" }), []);
});

test("valid production configuration passes", () => {
  assert.deepEqual(productionEnvironmentProblems(validEnvironment()), []);
  assert.doesNotThrow(() => assertProductionEnvironment(validEnvironment()));
});

test("production configuration reports all actionable problems", () => {
  const problems = productionEnvironmentProblems(
    validEnvironment({
      FRONTEND_URL: "http://holdfast.example/path",
      SESSION_SECRET: "short",
      DISCORD_GUILD_ID: "not-an-id",
      GUILD_OWNER_DISCORD_IDS: "323456789012345678,invalid",
      PORT: "70000",
    }),
  );

  assert.ok(problems.includes("FRONTEND_URL must use HTTPS"));
  assert.ok(
    problems.includes(
      "FRONTEND_URL must be an origin without a path, query, or hash",
    ),
  );
  assert.ok(problems.includes("SESSION_SECRET must be at least 32 bytes"));
  assert.ok(problems.includes("DISCORD_GUILD_ID must be a Discord snowflake ID"));
  assert.ok(
    problems.includes(
      "GUILD_OWNER_DISCORD_IDS must contain only Discord snowflake IDs",
    ),
  );
  assert.ok(problems.includes("PORT must be an integer between 1 and 65535"));
});
