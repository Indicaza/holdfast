import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import express from "express";

import {
  createDevelopmentAuthRouter,
  developmentAuthEnabled,
  developmentPersonas,
} from "../src/Development/developmentAuth.js";
import { productionEnvironmentProblems } from "../src/Config/environment.js";

async function withServer(router, callback) {
  const app = express();
  app.use("/api/dev", router);
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("development auth requires the explicit flag and never enables in production", () => {
  assert.equal(
    developmentAuthEnabled({ NODE_ENV: "development", HOLDFAST_DEV_AUTH: "true" }),
    true,
  );
  assert.equal(
    developmentAuthEnabled({ NODE_ENV: "test", HOLDFAST_DEV_AUTH: "TRUE" }),
    true,
  );
  assert.equal(
    developmentAuthEnabled({ NODE_ENV: "development", HOLDFAST_DEV_AUTH: "false" }),
    false,
  );
  assert.equal(
    developmentAuthEnabled({ NODE_ENV: "production", HOLDFAST_DEV_AUTH: "true" }),
    false,
  );

  assert.ok(
    productionEnvironmentProblems({
      NODE_ENV: "production",
      HOLDFAST_DEV_AUTH: "true",
    }).includes("HOLDFAST_DEV_AUTH must be disabled in production"),
  );
});

test("development personas expose the three contributor roles", () => {
  assert.deepEqual(
    developmentPersonas().map(({ key, rank }) => ({ key, rank })),
    [
      { key: "member", rank: "Private" },
      { key: "officer", rank: "Lieutenant" },
      { key: "commander", rank: "Commander" },
    ],
  );
});

test("development router stays hidden when disabled", async () => {
  const router = createDevelopmentAuthRouter({
    env: { NODE_ENV: "development", HOLDFAST_DEV_AUTH: "false" },
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dev`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  });
});

test("development login writes a real session payload and redirects internally", async () => {
  let sessionPayload = null;
  const env = { NODE_ENV: "development", HOLDFAST_DEV_AUTH: "true" };
  const router = createDevelopmentAuthRouter({
    env,
    resolveAuthority(memberId, receivedEnv) {
      assert.equal(memberId, "dev-commander");
      assert.equal(receivedEnv, env);
      return {
        memberRank: "Commander",
        permissions: ["site.admin", "quests.edit"],
      };
    },
    writeSession(res, payload) {
      sessionPayload = payload;
      res.set("X-Development-Session", "written");
    },
  });

  await withServer(router, async (baseUrl) => {
    const index = await fetch(`${baseUrl}/api/dev`);
    assert.equal(index.status, 200);
    assert.equal((await index.json()).personas.length, 3);

    const response = await fetch(
      `${baseUrl}/api/dev/login/commander?returnTo=%2Fquests%3Ffilter%3Dmine`,
      { redirect: "manual" },
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/quests?filter=mine");
    assert.equal(response.headers.get("x-development-session"), "written");
  });

  assert.equal(sessionPayload.user.id, "dev-commander");
  assert.deepEqual(sessionPayload.permissions, ["site.admin", "quests.edit"]);
  assert.ok(Number.isFinite(sessionPayload.verifiedAt));
});

test("development login fails safely for unknown personas or missing seed data", async () => {
  const router = createDevelopmentAuthRouter({
    env: { NODE_ENV: "development", HOLDFAST_DEV_AUTH: "true" },
    resolveAuthority() {
      return { memberRank: "Recruit", permissions: [] };
    },
    writeSession() {
      throw new Error("session should not be written");
    },
  });

  await withServer(router, async (baseUrl) => {
    const unknown = await fetch(`${baseUrl}/api/dev/login/nope`, {
      redirect: "manual",
    });
    assert.equal(unknown.status, 404);

    const unseeded = await fetch(`${baseUrl}/api/dev/login/member`, {
      redirect: "manual",
    });
    assert.equal(unseeded.status, 409);
    assert.equal((await unseeded.json()).error, "development_seed_required");

    const external = await fetch(
      `${baseUrl}/api/dev/login/member?returnTo=https%3A%2F%2Fevil.example`,
      { redirect: "manual" },
    );
    assert.equal(external.status, 409);
  });
});
