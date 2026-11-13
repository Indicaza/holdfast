import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStartupLifecycle, notReadyHandler } from "../src/Production/startupLifecycle.js";

function fakeResponse() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = "") { this.body = body; },
  };
}

const quiet = { info() {}, warn() {} };

test("until ready, only liveness answers 200; everything else is 503 with Retry-After", () => {
  const lifecycle = createStartupLifecycle({ log: quiet });
  lifecycle.bound();
  const handle = notReadyHandler(lifecycle);

  const live = fakeResponse();
  handle({ method: "GET", url: "/api/health/live" }, live);
  assert.equal(live.statusCode, 200);
  assert.deepEqual(JSON.parse(live.body), { status: "ok", ready: false, state: "http_bound", phase: null });

  for (const url of ["/api/health/ready", "/api/health", "/api/members?x=1", "/api/bridge/telemetry"]) {
    const res = fakeResponse();
    handle({ method: "GET", url }, res);
    assert.equal(res.statusCode, 503, url);
    assert.equal(res.headers["retry-after"], "5");
    assert.equal(JSON.parse(res.body).status, "starting");
  }
  const page = fakeResponse();
  handle({ method: "GET", url: "/" }, page);
  assert.equal(page.statusCode, 503);
  assert.match(page.body, /starting/);
});

test("phases are timed in order, failures are recorded, and states never move backwards", async () => {
  let now = 0;
  const lines = [];
  const lifecycle = createStartupLifecycle({ clock: () => now, log: { info: (line) => lines.push(JSON.parse(line)) } });
  lifecycle.bound();
  await lifecycle.phase("pre_migration_backup", () => { now += 120; });
  await lifecycle.phase("migrations", () => { now += 30; }, { state: "migrating" });
  await lifecycle.phase("telemetry_compaction", () => { now += 5; });
  assert.equal(lifecycle.state, "migrating", "initializing after migrating does not move back");
  lifecycle.ready();
  assert.equal(lifecycle.isReady(), true);
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.readyAfterMs, 155);
  assert.deepEqual(snapshot.phases.map((entry) => [entry.name, entry.ms]), [["pre_migration_backup", 120], ["migrations", 30], ["telemetry_compaction", 5]]);
  assert.ok(lines.some((line) => line.ready === true && line.totalMs === 155));

  const failing = createStartupLifecycle({ log: quiet });
  await assert.rejects(() => failing.phase("migrations", () => { throw Object.assign(new Error("boom"), { code: "ERR_SQLITE_ERROR" }); }));
  failing.fail(new Error("boom"));
  failing.ready();
  assert.equal(failing.state, "failed", "a failed start never becomes ready");
  assert.deepEqual(failing.snapshot().phases, [{ name: "migrations", ms: failing.snapshot().phases[0].ms, ok: false }]);
});

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test("the real server binds, reports readiness with phase timings, and shuts down cleanly", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-lifecycle-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, NODE_ENV: "test", GUILD_DATA_DIR: directory, PORT: String(port), BLIZZARD_CLIENT_ID: "", BLIZZARD_CLIENT_SECRET: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    let ready = null;
    for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
        if (response.status === 200) ready = await response.json();
        else assert.equal(response.status, 503);
      } catch {
        // Not listening yet.
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `server never became ready:\n${output}`);
    assert.equal(ready.status, "ok");
    assert.equal(ready.startup.state, "ready");
    assert.deepEqual(ready.startup.phases.map((entry) => entry.name), [
      "runtime_directory", "pre_migration_backup", "migrations", "telemetry_compaction",
      "character_read_model", "recipe_store", "economic_backfill", "public_game_backfill", "application",
    ]);
    assert.ok(ready.startup.phases.every((entry) => entry.ok && Number.isInteger(entry.ms)));
    assert.match(output, /"event":"startup","state":"http_bound"/);
    const live = await fetch(`http://127.0.0.1:${port}/api/health/live`);
    assert.equal(live.status, 200);
  } finally {
    const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    child.kill("SIGTERM");
    assert.equal(await exited, 0, output);
    await rm(directory, { recursive: true, force: true });
  }
});
