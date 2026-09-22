import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeQuestDocument } from "./questSchema.js";

const DEFAULT_DATA_FILE = fileURLToPath(
  new URL("../../data/quests.json", import.meta.url),
);

function dataFile() {
  if (!process.env.GUILD_DATA_DIR) {
    return DEFAULT_DATA_FILE;
  }

  return path.join(path.resolve(process.env.GUILD_DATA_DIR), "quests.json");
}

export async function readQuests() {
  const raw = await readFile(dataFile(), "utf8");
  return normalizeQuestDocument(JSON.parse(raw));
}

export async function writeQuests(document) {
  const normalized = normalizeQuestDocument(document);
  const target = dataFile();
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporary, target);

  return normalized;
}
