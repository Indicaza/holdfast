import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureRuntimeDataFile,
  runtimeDataFile,
} from "../Data/runtimeData.js";
import { normalizeQuestDocument } from "./questSchema.js";

const QUESTS_FILE = "quests.json";

export async function readQuests() {
  const target = await ensureRuntimeDataFile(QUESTS_FILE);
  const raw = await readFile(target, "utf8");
  return normalizeQuestDocument(JSON.parse(raw));
}

export async function writeQuests(document) {
  const normalized = normalizeQuestDocument(document);
  const target = runtimeDataFile(QUESTS_FILE);
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporary, target);

  return normalized;
}
