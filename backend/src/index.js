import dotenv from "dotenv";
import { createApp } from "./app.js";
import { assertProductionEnvironment } from "./Config/environment.js";
import { startDiscordRankReconciler } from "./Discord/rankSync.js";
import { startDiscordBilletReconciler } from "./Discord/billetSync.js";
import { ensureRuntimeDataDirectory, runtimeDataDirectory } from "./Data/runtimeData.js";
import { guildDatabaseFile, withGuildDatabase } from "./Data/database.js";
import { initializeGuildData } from "./Data/initializeData.js";
import { backupGuildDatabaseBeforeMigrations } from "./Data/startupBackup.js";
import { offsiteBackupConfig, startOffsiteBackupScheduler } from "./Data/offsiteBackup.js";
import { compactStoredTelemetry } from "./Character/Telemetry/telemetryJson.js";
import { ensureCharacterReadModelCurrent } from "./Character/ReadModel/rebuildReadModel.js";

dotenv.config();
assertProductionEnvironment();
offsiteBackupConfig();

await ensureRuntimeDataDirectory();
const startupBackup = await backupGuildDatabaseBeforeMigrations();

if (startupBackup.status === "created") {
  console.log(`Pre-migration SQLite snapshot created at ${startupBackup.file}`);
}

const dataInitialization = initializeGuildData();

if (dataInitialization.status === "imported") {
  console.log("Imported legacy GuildOS JSON into SQLite", dataInitialization.imported);
}

// Telemetry stored before large values were compressed is compressed once,
// keeping the database under the encrypted backup's size limit.
const compactedTelemetry = withGuildDatabase(compactStoredTelemetry);

if (compactedTelemetry) {
  console.log(`Compressed ${compactedTelemetry} stored telemetry values`);
}

// The character read model is rebuilt from stored telemetry when its version
// changes, before the first request reads it.
const readModelRebuild = ensureCharacterReadModelCurrent();

if (readModelRebuild) {
  console.log("Rebuilt the character read model", readModelRebuild);
}

const app = createApp();
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Guild backend running on port ${PORT}`);
  console.log(`Guild runtime data: ${runtimeDataDirectory()}`);
  console.log(`Guild database: ${guildDatabaseFile()}`);
});

const stopDiscordRankReconciler = startDiscordRankReconciler();
const stopDiscordBilletReconciler = startDiscordBilletReconciler();
const stopOffsiteBackupScheduler = startOffsiteBackupScheduler();

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  stopDiscordRankReconciler();
  stopDiscordBilletReconciler();
  stopOffsiteBackupScheduler();

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);

  forceExit.unref();
  server.close((error) => {
    clearTimeout(forceExit);

    if (error) {
      console.error("HTTP server shutdown failed", error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
