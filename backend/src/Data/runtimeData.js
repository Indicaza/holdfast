import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RUNTIME_DIR = fileURLToPath(
  new URL("../../data/", import.meta.url),
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

export async function ensureRuntimeDataDirectory() {
  const directory = configuredRuntimeDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}
