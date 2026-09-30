import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const blueprintPath = path.join(repositoryRoot, "render.yaml");
const source = await readFile(blueprintPath, "utf8");
const document = parseDocument(source, {
  maxAliasCount: 0,
  uniqueKeys: true,
});

if (document.errors.length) {
  throw new Error(document.errors.map((error) => error.message).join("\n"));
}

const blueprint = document.toJS();

assert.deepEqual(Object.keys(blueprint).sort(), ["services"]);
assert.equal(blueprint.services.length, 1);

const [service] = blueprint.services;

assert.equal(service.name, "holdfast");
assert.equal(service.type, "web");
assert.equal(service.runtime, "docker");
assert.equal(service.branch, "main");
assert.equal(service.region, "ohio");
assert.equal(service.plan, "0.5c-512mb");
assert.equal(service.numInstances, 1);
assert.equal(service.dockerfilePath, "./Dockerfile");
assert.equal(service.dockerContext, ".");
assert.equal(service.autoDeployTrigger, "checksPass");
assert.equal(service.healthCheckPath, "/api/health/ready");
assert.equal(service.maxShutdownDelaySeconds, 30);
assert.deepEqual(service.disk, {
  name: "holdfast-data",
  mountPath: "/data",
  sizeGB: 5,
});

const environment = new Map();

for (const entry of service.envVars) {
  assert.equal(environment.has(entry.key), false, `Duplicate ${entry.key}`);
  environment.set(entry.key, entry);
}

for (const [key, value] of Object.entries({
  NODE_ENV: "production",
  PORT: "3000",
  GUILD_DATA_DIR: "/data",
  TRUST_PROXY: "1",
  DISCORD_SESSION_REVERIFY_SECONDS: "900",
  DISCORD_PRUNE_MIN_AGE_DAYS: "7",
})) {
  assert.deepEqual(environment.get(key), { key, value });
}

assert.deepEqual(environment.get("SESSION_SECRET"), {
  key: "SESSION_SECRET",
  generateValue: true,
});

for (const key of [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_GUILD_ID",
  "DISCORD_BOT_TOKEN",
  "GUILD_OWNER_DISCORD_IDS",
]) {
  assert.deepEqual(environment.get(key), { key, sync: false });
}

console.log("Render Blueprint is valid for Holdfast production");
