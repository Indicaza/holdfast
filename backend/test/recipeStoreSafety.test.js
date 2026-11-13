import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ensureTelemetryProjectionSchema } from "../src/Character/telemetryProjection.js";
import { closeGuildDatabase, guildDatabaseFile, openGuildDatabase } from "../src/Data/database.js";
import { backupGuildDatabaseBeforeMigrations, listStartupBackups, startupBackupDirectory } from "../src/Data/startupBackup.js";

// The recipe split (PR #284) converts telemetry_recipes into a view outside
// the numbered migrations. These tests cover its recovery point, atomicity
// and the way back for an older release.

const ROOT = new URL("../", import.meta.url);
const LEGACY_COLUMNS = "character_id, recipe_key, recipe_id, name, profession_key, profession_id, profession_name, icon_file_id, known, required_skill, requirements_json, crafted_item_id, crafted_item_name, reagents_json, snapshot_id";

// A fully migrated database with a pre-split recipe table: 40 characters,
// a pool of 400 recipes (some keyed by name, without ids), known and
// unknown recipes, nulls where the addon sends none.
function seedLegacyDatabase() {
  openGuildDatabase().close();
  const db = new DatabaseSync(guildDatabaseFile());
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare("INSERT INTO members (id, username, display_name, initials, rank, status, first_seen_at, updated_at) VALUES ('m1', 'm', 'M', 'M', 'Member', 'active', 'x', 'x')").run();
    db.exec(`CREATE TABLE telemetry_recipes (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE, recipe_key TEXT NOT NULL, recipe_id INTEGER, name TEXT NOT NULL,
      profession_key TEXT NOT NULL DEFAULT '', profession_id INTEGER, profession_name TEXT NOT NULL DEFAULT '', icon_file_id INTEGER,
      known INTEGER NOT NULL DEFAULT 1 CHECK (known IN (0, 1)), required_skill INTEGER, requirements_json TEXT NOT NULL DEFAULT 'null',
      crafted_item_id INTEGER, crafted_item_name TEXT NOT NULL DEFAULT '', reagents_json TEXT NOT NULL DEFAULT '[]',
      snapshot_id INTEGER REFERENCES character_snapshots(id) ON DELETE SET NULL, PRIMARY KEY(character_id, recipe_key));
      CREATE INDEX telemetry_recipes_name_idx ON telemetry_recipes(name COLLATE NOCASE, known, profession_name COLLATE NOCASE);`);
    const character = db.prepare("INSERT INTO characters (id, member_id, name) VALUES (?, 'm1', ?)");
    const recipe = db.prepare(`INSERT INTO telemetry_recipes (${LEGACY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`);
    db.exec("BEGIN");
    for (let c = 0; c < 40; c += 1) {
      character.run(`char-${c}`, `Character ${c}`);
      for (let r = (c * 37) % 400, n = 0; n < 120; r = (r + 7) % 400, n += 1) {
        const named = r % 25 === 0;
        recipe.run(`char-${c}`, named ? `name:tailoring:recipe ${r}` : `id:${1000 + r}`, named ? null : 1000 + r, `Recipe ${r}`, "id:197", 197, "Tailoring",
          r % 3 ? 136249 : null, (r + c) % 5 ? 1 : 0, r % 4 ? r : null, r % 6 ? JSON.stringify({ tool: r }) : "null",
          r % 7 ? 2000 + r : null, r % 7 ? `Item ${r}` : "", JSON.stringify([{ itemId: 3000 + r, quantity: 1 + (r % 4) }]));
      }
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

const rows = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(`SELECT ${LEGACY_COLUMNS} FROM telemetry_recipes ORDER BY character_id, recipe_key`).all();
  } finally {
    db.close();
  }
};
const kind = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare("SELECT type FROM sqlite_master WHERE name = 'telemetry_recipes'").get()?.type; } finally { db.close(); }
};

async function withProductionData(run) {
  const previous = { dir: process.env.GUILD_DATA_DIR, env: process.env.NODE_ENV };
  const directory = await mkdtemp(path.join(os.tmpdir(), "holdfast-recipe-safety-"));
  process.env.GUILD_DATA_DIR = directory;
  process.env.NODE_ENV = "production";
  try {
    return await run(directory);
  } finally {
    closeGuildDatabase();
    for (const [key, value] of [["GUILD_DATA_DIR", previous.dir], ["NODE_ENV", previous.env]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function convert(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    let counts = null;
    ensureTelemetryProjectionSchema(db, { onRecipesConverted: (value) => { counts = value; } });
    db.exec("COMMIT");
    return counts;
  } finally {
    db.close();
  }
}

test("a pending recipe conversion gets a verified pre-conversion snapshot; a converted database does not", () => withProductionData(async () => {
  seedLegacyDatabase();
  const original = rows(guildDatabaseFile());
  assert.equal(original.length, 4800);

  const backup = await backupGuildDatabaseBeforeMigrations({ now: () => new Date("2026-11-13T04:00:00Z") });
  assert.equal(backup.status, "created", "no numbered migration is pending, the conversion is");
  assert.deepEqual(backup.pending, [{ version: null, name: "recipe_store_split" }]);
  const sidecar = JSON.parse(await readFile(backup.file.replace(/\.sqlite$/, ".json"), "utf8"));
  assert.deepEqual(sidecar.pending, ["recipe_store_split"]);
  assert.equal(sidecar.toVersion, sidecar.fromVersion);
  assert.equal(kind(backup.file), "table");
  assert.deepEqual(rows(backup.file), original, "the snapshot holds the old table, row for row");

  assert.deepEqual(convert(guildDatabaseFile()), { pairs: 4800, recipes: 400 });
  assert.equal(kind(guildDatabaseFile()), "view");
  assert.deepEqual(rows(guildDatabaseFile()), original, "every definition and ownership row, through the view");

  const again = await backupGuildDatabaseBeforeMigrations();
  assert.deepEqual(again, { status: "not-needed", pending: [] }, "an already converted database is left alone");
  assert.equal(convert(guildDatabaseFile()), null, "and never converted twice");
  assert.equal((await listStartupBackups(startupBackupDirectory())).filter((entry) => entry.kind === "managed").length, 1);
}));

test("a process killed mid-conversion leaves the old table intact; the restart reuses the snapshot and converts", () => withProductionData(async () => {
  seedLegacyDatabase();
  const original = rows(guildDatabaseFile());
  const first = await backupGuildDatabaseBeforeMigrations({ now: () => new Date("2026-11-13T04:00:00Z") });
  assert.equal(first.status, "created");

  // Convert inside a transaction, then die before COMMIT.
  const killed = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    import { ensureTelemetryProjectionSchema } from ${JSON.stringify(new URL("src/Character/telemetryProjection.js", ROOT).href)};
    const db = new DatabaseSync(${JSON.stringify(guildDatabaseFile())});
    db.exec("BEGIN IMMEDIATE");
    ensureTelemetryProjectionSchema(db);
    process.kill(process.pid, "SIGKILL");
  `], { encoding: "utf8" });
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(kind(guildDatabaseFile()), "table", "nothing committed");
  assert.deepEqual(rows(guildDatabaseFile()), original);

  const second = await backupGuildDatabaseBeforeMigrations({ now: () => new Date("2026-11-13T04:05:00Z") });
  assert.equal(second.status, "reused", "the unchanged database keeps its snapshot");
  assert.equal(second.file, first.file);
  convert(guildDatabaseFile());
  assert.deepEqual(rows(guildDatabaseFile()), original);
}));

test("rolling back to an older release: the restore script brings the table back exactly, and the split can run again", () => withProductionData(async () => {
  seedLegacyDatabase();
  const original = rows(guildDatabaseFile());
  convert(guildDatabaseFile());

  // Old releases fail on the view.
  const db = new DatabaseSync(guildDatabaseFile());
  assert.throws(() => db.exec("CREATE INDEX IF NOT EXISTS telemetry_recipes_item_idx ON telemetry_recipes(crafted_item_id, known)"), /views may not be indexed/);
  db.close();

  // The script runs from stdin, as it would in an older release's image.
  const script = await readFile(new URL("scripts/restoreRecipeTable.js", ROOT), "utf8");
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-", guildDatabaseFile()], { input: script, encoding: "utf8" });
  const restored = run();
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(JSON.parse(restored.stdout), { status: "restored", rows: 4800 });
  assert.equal(kind(guildDatabaseFile()), "table");
  assert.deepEqual(rows(guildDatabaseFile()), original);

  // What an older release does at startup and on every sync now works.
  const old = new DatabaseSync(guildDatabaseFile());
  old.exec(`CREATE TABLE IF NOT EXISTS telemetry_recipes (character_id TEXT);
    CREATE INDEX IF NOT EXISTS telemetry_recipes_item_idx ON telemetry_recipes(crafted_item_id, known);
    DELETE FROM telemetry_recipes WHERE character_id = 'char-0';`);
  old.close();
  assert.deepEqual(JSON.parse(run().stdout), { status: "already_table" }, "running it again changes nothing");

  // Moving forward again re-splits losslessly.
  const remaining = rows(guildDatabaseFile());
  convert(guildDatabaseFile());
  assert.deepEqual(rows(guildDatabaseFile()), remaining);
}));
