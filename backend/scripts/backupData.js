import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { backup } from "node:sqlite";

import dotenv from "dotenv";

import { guildDatabaseFile, openGuildDatabase } from "../src/Data/database.js";
import { runtimeDataDirectory } from "../src/Data/runtimeData.js";

dotenv.config();

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function optionalCopy(source, destination) {
  try {
    await copyFile(source, destination);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function main() {
  const configured = String(process.env.BACKUP_DIR || "").trim();

  if (!configured) {
    throw new Error("BACKUP_DIR is required");
  }

  const sourceDirectory = runtimeDataDirectory();
  const backupRoot = path.resolve(configured);
  const sourceDatabase = guildDatabaseFile();

  if (
    backupRoot === sourceDirectory ||
    backupRoot.startsWith(`${sourceDirectory}${path.sep}`)
  ) {
    throw new Error("BACKUP_DIR must be outside GUILD_DATA_DIR");
  }

  try {
    await access(sourceDatabase);
  } catch {
    throw new Error(`Holdfast database not found at ${sourceDatabase}`);
  }

  const destination = path.join(backupRoot, `holdfast-${timestamp()}`);
  await mkdir(destination, { recursive: true });

  const db = openGuildDatabase();

  try {
    await backup(db, path.join(destination, "holdfast.sqlite"));
  } finally {
    db.close();
  }

  const includedProvisioningState = await optionalCopy(
    path.join(sourceDirectory, "discord-provisioning-state.json"),
    path.join(destination, "discord-provisioning-state.json"),
  );

  await writeFile(
    path.join(destination, "backup.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        includedProvisioningState,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Holdfast backup created at ${destination}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
