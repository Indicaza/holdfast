import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RUNTIME_DIR = fileURLToPath(
  new URL("../../data/", import.meta.url),
);

const SEED_DIR = fileURLToPath(
  new URL("../../seed/", import.meta.url),
);

function configuredRuntimeDirectory() {
  const configured = String(process.env.GUILD_DATA_DIR || "").trim();

  if (configured) {
    return path.resolve(configured);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GUILD_DATA_DIR is required in production. Point it at persistent storage.",
    );
  }

  return DEFAULT_RUNTIME_DIR;
}

export function runtimeDataDirectory() {
  return configuredRuntimeDirectory();
}

export function runtimeDataFile(filename) {
  return path.join(configuredRuntimeDirectory(), filename);
}

export function seedDataFile(filename) {
  return path.join(SEED_DIR, filename);
}

export async function ensureRuntimeDataDirectory() {
  const directory = configuredRuntimeDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function ensureRuntimeDataFile(filename) {
  const target = runtimeDataFile(filename);

  try {
    await access(target, constants.F_OK);
    return target;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  await ensureRuntimeDataDirectory();

  try {
    await copyFile(seedDataFile(filename), target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }

  return target;
}
