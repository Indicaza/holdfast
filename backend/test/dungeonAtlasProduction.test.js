import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readDungeonList } from "../src/Loot/lootRouter.js";

// Production regression (fix/dungeon-atlas-production): `.dockerignore`'s
// `**/data` left backend/src/Atlas/data/ out of the image, so every
// GET /api/player/loot/dungeons in production answered 500 (ENOENT on
// atlas.json) while every test, which reads the repository, passed.
// scripts/production-artifact-smoke.sh checks the built image itself; this
// checks the build context without Docker.

const REPO = fileURLToPath(new URL("../../", import.meta.url));

// Docker's .dockerignore rules (moby/patternmatcher): a path is left out
// when the last pattern matching it or one of its parent directories is not
// a `!` exception. Supports the syntax the file uses (`*`, `**`, `?`, `!`).
function dockerIgnore(text) {
  const rules = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const exception = line.startsWith("!");
    const pattern = (exception ? line.slice(1) : line).replace(/^\/+|\/+$/g, "");
    const source = pattern.split("/").map((part) => (part === "**" ? "\u0000" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")))
      .join("/").replace(/\u0000\//g, "(?:.*/)?").replace(/\/\u0000/g, "(?:/.*)?").replace(/\u0000/g, ".*");
    return { exception, regex: new RegExp(`^${source}$`) };
  });
  return (path) => {
    const parts = path.split("/");
    const prefixes = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    let excluded = false;
    for (const rule of rules) if (prefixes.some((prefix) => rule.regex.test(prefix))) excluded = !rule.exception;
    return excluded;
  };
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [relative(REPO, join(directory, entry.name)).replaceAll("\\", "/")]);
}

test("the docker build context keeps every server source file, the atlas datasets included", () => {
  const ignored = dockerIgnore(readFileSync(join(REPO, ".dockerignore"), "utf8"));
  // The matcher itself: what the file means to leave out stays out.
  assert.ok(ignored("backend/node_modules/express/index.js"));
  assert.ok(ignored("frontend/dist/index.html"));
  assert.ok(ignored("data/holdfast.sqlite"));
  assert.ok(ignored("backend/data/holdfast.sqlite"));

  const sources = files(join(REPO, "backend/src"));
  for (const path of ["backend/src/Atlas/data/atlas.json", "backend/src/Atlas/data/reference-loot.json"]) {
    assert.ok(sources.includes(path), `${path} exists`);
  }
  assert.deepEqual(sources.filter(ignored), [], "no file the Dockerfile copies from backend/src is left out of the image");
});

test("the dungeon list serves the static atlas when the observed catalog, its slots or the editorial layer cannot be read", () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const broken = () => { throw new Error("no such table: dungeon_loot_entries"); };
    const list = readDungeonList({ readCatalog: broken, readSlots: broken, readEditorial: broken });
    assert.deepEqual(list.degraded, ["catalog", "lootSlots", "editorial"]);
    assert.deepEqual(list.dungeons, []);
    assert.equal(list.atlasDungeons.length, 35, "all 35 atlas dungeons: 26 original, 9 WoW Forever");
    assert.ok(list.atlasDungeons.every((entry) => entry.atlas && entry.atlas.bossCount > 0));
    assert.equal(errors.length, 3, "every failure is logged, not hidden");

    const empty = readDungeonList({ readCatalog: () => ({ schemaVersion: 1, revision: 0, dungeons: [] }), readSlots: () => new Map(), readEditorial: () => new Map() });
    assert.equal(empty.degraded, undefined, "an empty catalog is not a failure");
    assert.equal(empty.atlasDungeons.length, 35);
  } finally {
    console.error = original;
  }
});
