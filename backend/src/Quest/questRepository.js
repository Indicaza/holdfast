import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureRuntimeDataFile,
  runtimeDataFile,
} from "../Data/runtimeData.js";
import {
  QuestValidationError,
  normalizeQuestDocument,
} from "./questSchema.js";

const QUESTS_FILE = "quests.json";

export class QuestStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "QuestStorageError";
  }
}

function storedQuestError(target, error) {
  const detail =
    error instanceof SyntaxError
      ? "The file is not valid JSON."
      : error instanceof QuestValidationError
        ? error.message
        : error.message || "Unknown quest data error.";

  return new QuestStorageError(
    `Stored quest data is invalid at ${target}: ${detail}`,
    error,
  );
}

export async function readQuests() {
  const target = await ensureRuntimeDataFile(QUESTS_FILE);

  try {
    const raw = await readFile(target, "utf8");
    return normalizeQuestDocument(JSON.parse(raw));
  } catch (error) {
    if (error instanceof QuestStorageError) {
      throw error;
    }

    throw storedQuestError(target, error);
  }
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
