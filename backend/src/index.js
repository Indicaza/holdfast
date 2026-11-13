import http from "node:http";
import { backfillPublicGameData } from "./GameData/backfillPublicGameData.js";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { assertProductionEnvironment } from "./Config/environment.js";
import { startDiscordRankReconciler } from "./Discord/rankSync.js";
import { startDiscordBilletReconciler } from "./Discord/billetSync.js";
import { ensureRuntimeDataDirectory, runtimeDataDirectory } from "./Data/runtimeData.js";
import { closeGuildDatabase, guildDatabaseFile, withGuildDatabase, withGuildTransaction } from "./Data/database.js";
import { initializeGuildData } from "./Data/initializeData.js";
import { backupGuildDatabaseBeforeMigrations, listStartupBackups } from "./Data/startupBackup.js";
import { offsiteBackupConfig, startOffsiteBackupScheduler } from "./Data/offsiteBackup.js";
import { compactReadModelPayloadsInDatabase, compactStoredTelemetry } from "./Character/Telemetry/telemetryJson.js";
import { ensureTelemetryProjectionSchema } from "./Character/telemetryProjection.js";
import { ensureCharacterReadModelCurrent } from "./Character/ReadModel/rebuildReadModel.js";
import { backfillEconomicObservationsInDatabase } from "./Economy/economicObservationRepository.js";
import { createBlizzardAuctionProvider } from "./Market/blizzardAuctionProvider.js";
import { marketItemDataEnv, startMarketRefresher } from "./Market/marketRefresh.js";
import { createBlizzardGameDataProvider } from "./GameData/blizzardGameDataProvider.js";
import { createStartupLifecycle, notReadyHandler, startEventLoopStallMonitor } from "./Production/startupLifecycle.js";
import { createStorageObservatory } from "./Production/storageObservatory.js";

dotenv.config();
// Configuration errors stop the process before it binds a port.
assertProductionEnvironment();
offsiteBackupConfig();

const lifecycle = createStartupLifecycle();
const notReady = notReadyHandler(lifecycle);
const stopStallMonitor = startEventLoopStallMonitor();

// Bind first so the platform sees the port at once. Until the application is
// ready every request except liveness gets 503 (see notReadyHandler): nothing
// can read the database before its migrations have run.
let application = null;
const server = http.createServer((req, res) => (application ? application(req, res) : notReady(req, res)));
const PORT = process.env.PORT || 3000;
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, () => {
    server.off("error", reject);
    resolve();
  });
});
lifecycle.bound();
console.log(`Guild backend listening on port ${PORT} (starting)`);

const stops = [];

// Re-encodes read-model payloads stored before compression, five rows per
// transaction with requests served in between. Starts two minutes after
// the application is ready; logs once when done.
function startReadModelCompaction({ delayMs = 120_000 } = {}) {
  let stopped = false;
  const timer = setTimeout(async () => {
    let total = 0;
    const started = Date.now();
    try {
      for (;;) {
        if (stopped) return;
        const changed = withGuildTransaction((db) => compactReadModelPayloadsInDatabase(db, { limit: 5 }));
        total += changed;
        if (!changed) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (total) console.log(JSON.stringify({ event: "read_model_compaction", rows: total, ms: Date.now() - started }));
    } catch (error) {
      console.error("Read-model compaction failed", error);
    }
  }, delayMs);
  timer.unref?.();
  return () => { stopped = true; clearTimeout(timer); };
}
let shuttingDown = false;

function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down (${lifecycle.state})`);
  for (const stop of stops.reverse()) {
    try { stop(); } catch (error) { console.error("Stopping a background service failed", error); }
  }
  stopStallMonitor();

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);

  forceExit.unref();
  server.close((error) => {
    clearTimeout(forceExit);
    try { closeGuildDatabase(); } catch { /* already closed */ }

    if (error) {
      console.error("HTTP server shutdown failed", error);
      process.exit(1);
    }

    process.exit(code);
  });
  server.closeAllConnections?.();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

try {
  await lifecycle.phase("runtime_directory", () => ensureRuntimeDataDirectory());

  // A pre-migration snapshot only when this release has migrations to apply.
  const startupBackup = await lifecycle.phase("pre_migration_backup", () => backupGuildDatabaseBeforeMigrations());
  if (startupBackup.status === "created") {
    console.log(`Pre-migration SQLite snapshot created at ${startupBackup.file} (${startupBackup.bytes} bytes)`);
    for (const failed of startupBackup.pruned?.failed || []) console.error(`Could not remove old startup snapshot ${failed.name}: ${failed.error}`);
  } else if (startupBackup.status === "reused") {
    console.log(`Reusing unchanged pre-migration snapshot ${startupBackup.file}`);
  } else if (startupBackup.status === "skipped-by-operator") {
    console.warn("MIGRATION_BACKUP=skip: applying migrations without a local pre-migration snapshot");
  }
  if (shuttingDown) await new Promise(() => {});

  const pending = startupBackup.pending?.length || 0;
  // Opening the database applies migrations; the legacy JSON import runs once.
  const dataInitialization = await lifecycle.phase("migrations", () => initializeGuildData(), { state: pending ? "migrating" : "initializing" });
  if (dataInitialization.status === "imported") {
    console.log("Imported legacy GuildOS JSON into SQLite", dataInitialization.imported);
  }

  // Telemetry stored before large values were compressed is compressed once.
  // It never runs VACUUM: rebuilding the file needs as much free disk as the
  // database and blocks every request, so that is an operator task.
  const compactedTelemetry = await lifecycle.phase("telemetry_compaction", () => withGuildDatabase(compactStoredTelemetry));
  if (compactedTelemetry) {
    console.log(`Compressed ${compactedTelemetry} stored telemetry values`);
  }

  // The character read model is rebuilt from stored telemetry when its version
  // changes, before the first request reads it.
  const readModelRebuild = await lifecycle.phase("character_read_model", () => ensureCharacterReadModelCurrent());
  if (readModelRebuild) {
    console.log("Rebuilt the character read model", readModelRebuild);
  }

  // Recipes stored once per recipe (recipeStore.js): converts a database
  // from before the split once, here rather than inside a request.
  // A pending conversion was snapshotted with the migrations above.
  await lifecycle.phase("recipe_store", () => withGuildTransaction((db) => ensureTelemetryProjectionSchema(db, {
    onRecipesConverted: (counts) => console.log(JSON.stringify({ event: "recipe_store_converted", ...counts })),
  })));

  // Economic events whose raw records arrived before they could be analysed
  // become farming observations. Idempotent; bounded by raw retention.
  const economicBackfill = await lifecycle.phase("economic_backfill", () => withGuildTransaction(backfillEconomicObservationsInDatabase));
  if (economicBackfill.created) {
    console.log("Recorded economic observations from stored telemetry", economicBackfill);
  }

  const publicGameBackfill = await lifecycle.phase("public_game_backfill", () => backfillPublicGameData());
  if (publicGameBackfill.observations || publicGameBackfill.states) {
    console.log("Projected public game facts from stored telemetry", publicGameBackfill);
  }

  // Auction data from Blizzard's API, one house per minute at most; without
  // credentials markets fill from in-game scans only.
  const auctionProvider = createBlizzardAuctionProvider();
  // Names for the item ids Blizzard's auction data lists: Forever's static
  // item data first, then the classic namespaces the website already reads.
  const marketItemProvider = createBlizzardGameDataProvider({ env: marketItemDataEnv() });

  // Background services start only after every migration has run. The
  // market refresher's first tick and maintenance wait a minute.
  const marketRefresh = startMarketRefresher({ provider: auctionProvider, itemProvider: marketItemProvider });
  stops.push(() => marketRefresh.stop());
  const storageObservatory = createStorageObservatory({ dataDir: runtimeDataDirectory(), databaseFile: guildDatabaseFile() });
  const app = await lifecycle.phase("application", () => createApp({
    storageObservatory,
    marketRefresher: marketRefresh.refresher,
    marketProviderConfig: { name: auctionProvider.name, ...auctionProvider.config },
    startupStatus: () => lifecycle.snapshot(),
  }));
  if (shuttingDown) await new Promise(() => {});
  application = app;
  lifecycle.ready();
  console.log(`Guild backend running on port ${PORT}`);
  console.log(`Guild runtime data: ${runtimeDataDirectory()}`);
  console.log(`Guild database: ${guildDatabaseFile()}`);

  const backups = await listStartupBackups();
  if (backups.length) {
    const total = backups.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(JSON.stringify({ event: "startup_backups", count: backups.length, bytes: total,
      legacy: backups.filter((entry) => entry.kind === "legacy").length }));
  }

  stops.push(startDiscordRankReconciler());
  stops.push(startDiscordBilletReconciler());
  stops.push(startOffsiteBackupScheduler());
  stops.push(startReadModelCompaction());
  stops.push(storageObservatory.start());
} catch (error) {
  lifecycle.fail(error);
  console.error("Startup failed", error);
  shutdown("startup failure", 1);
}
