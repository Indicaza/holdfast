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

test("Render's external URL supplies the production website origin", () => {
  const env = validEnvironment({
    FRONTEND_URL: "",
    RENDER_EXTERNAL_URL: "https://holdfast.onrender.com",
  });

  assert.deepEqual(productionEnvironmentProblems(env), []);
  assert.doesNotThrow(() => assertProductionEnvironment(env));
});

test("production requires an explicit or platform-provided website origin", () => {
  const env = validEnvironment({ FRONTEND_URL: "", RENDER_EXTERNAL_URL: "" });

  assert.ok(
    productionEnvironmentProblems(env).includes(
      "FRONTEND_URL or RENDER_EXTERNAL_URL is required",
    ),
  );
});

test("production configuration allows an optional recruit role", () => {
  const env = validEnvironment();
  delete env.DISCORD_RECRUIT_ROLE_ID;

  assert.deepEqual(productionEnvironmentProblems(env), []);
  assert.doesNotThrow(() => assertProductionEnvironment(env));
});

test("production configuration reports all actionable problems", () => {
  const problems = productionEnvironmentProblems(
    validEnvironment({
      FRONTEND_URL: "http://holdfast.example/path",
      DISCORD_REDIRECT_URI:
        "https://user:password@other.example/wrong?source=test#fragment",
      SESSION_SECRET: "short",
      DISCORD_GUILD_ID: "not-an-id",
      GUILD_OWNER_DISCORD_IDS: "323456789012345678,invalid",
      DISCORD_SESSION_REVERIFY_SECONDS: "30",
      DISCORD_RANK_RECONCILE_SECONDS: "30",
      PORT: "70000",
    }),
  );

  assert.ok(problems.includes("FRONTEND_URL must use HTTPS"));
  assert.ok(
    problems.includes(
      "FRONTEND_URL must be an origin without a path, query, or hash",
    ),
  );
  assert.ok(
    problems.includes("DISCORD_REDIRECT_URI must use the FRONTEND_URL origin"),
  );
  assert.ok(
    problems.includes(
      "DISCORD_REDIRECT_URI must use the /api/auth/discord/callback path without a query or hash",
    ),
  );
  assert.ok(
    problems.includes("DISCORD_REDIRECT_URI must not contain credentials"),
  );
  assert.ok(problems.includes("SESSION_SECRET must be at least 32 bytes"));
  assert.ok(problems.includes("DISCORD_GUILD_ID must be a Discord snowflake ID"));
  assert.ok(
    problems.includes(
      "GUILD_OWNER_DISCORD_IDS must contain only Discord snowflake IDs",
    ),
  );
  assert.ok(problems.includes("PORT must be an integer between 1 and 65535"));
  assert.ok(
    problems.includes(
      "DISCORD_SESSION_REVERIFY_SECONDS must be an integer from 60 to 2592000",
    ),
  );
  assert.ok(
    problems.includes(
      "DISCORD_RANK_RECONCILE_SECONDS must be an integer from 60 to 3600",
    ),
  );
});

test("production configuration rejects credentials embedded in the public origin", () => {
  const problems = productionEnvironmentProblems(
    validEnvironment({
      FRONTEND_URL: "https://user:password@holdfast.example",
    }),
  );

  assert.ok(problems.includes("FRONTEND_URL must not contain credentials"));
});

test("production configuration accepts bounded Discord revalidation intervals", () => {
  assert.deepEqual(
    productionEnvironmentProblems(
      validEnvironment({ DISCORD_SESSION_REVERIFY_SECONDS: "60" }),
    ),
    [],
  );
  assert.deepEqual(
    productionEnvironmentProblems(
      validEnvironment({ DISCORD_SESSION_REVERIFY_SECONDS: "2592000" }),
    ),
    [],
  );
});


test("production configuration accepts bounded Discord rank reconciliation intervals", () => {
  assert.deepEqual(
    productionEnvironmentProblems(
      validEnvironment({ DISCORD_RANK_RECONCILE_SECONDS: "60" }),
    ),
    [],
  );
  assert.deepEqual(
    productionEnvironmentProblems(
      validEnvironment({ DISCORD_RANK_RECONCILE_SECONDS: "3600" }),
    ),
    [],
  );
});
