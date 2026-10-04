import dotenv from "dotenv";
import { createApp } from "./app.js";
import { assertProductionEnvironment } from "./Config/environment.js";
import { startDiscordRankReconciler } from "./Discord/rankSync.js";
import { startDiscordBilletReconciler } from "./Discord/billetSync.js";
import { ensureRuntimeDataDirectory, runtimeDataDirectory } from "./Data/runtimeData.js";
import { guildDatabaseFile } from "./Data/database.js";
import { initializeGuildData } from "./Data/initializeData.js";
import { backupGuildDatabaseBeforeMigrations } from "./Data/startupBackup.js";

dotenv.config();
assertProductionEnvironment();

await ensureRuntimeDataDirectory();
const startupBackup = await backupGuildDatabaseBeforeMigrations();

if (startupBackup.status === "created") {
  console.log(`Pre-migration SQLite snapshot created at ${startupBackup.file}`);
}

const dataInitialization = initializeGuildData();

if (dataInitialization.status === "imported") {
  console.log("Imported legacy GuildOS JSON into SQLite", dataInitialization.imported);
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

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  stopDiscordRankReconciler();
  stopDiscordBilletReconciler();

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
