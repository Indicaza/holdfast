import { existsSync, readFileSync } from "node:fs";

import {
  withGuildDatabase,
  withGuildTransaction,
} from "./database.js";
import { runtimeDataFile } from "./runtimeData.js";
import { importContributionsIntoDatabase } from "../Contribution/contributionRepository.js";
import { importMembersIntoDatabase } from "../Guild/memberRepository.js";
import { importQuestsIntoDatabase } from "../Quest/questRepository.js";

const IMPORT_KEY = "legacy_json_import_v1";

function readJsonFile(filename) {
  const target = runtimeDataFile(filename);

  if (!existsSync(target)) {
    return { exists: false, target, value: null };
  }

  try {
    return {
      exists: true,
      target,
      value: JSON.parse(readFileSync(target, "utf8")),
    };
  } catch (error) {
    throw new Error(
      `Unable to import legacy GuildOS data from ${target}: ${error.message}`,
      { cause: error },
    );
  }
}

function mutableStateCount(db) {
  const members = Number(
    db.prepare("SELECT COUNT(*) AS count FROM members").get().count,
  );
  const quests = Number(
    db.prepare("SELECT COUNT(*) AS count FROM quests").get().count,
  );
  const contributions = Number(
    db
      .prepare("SELECT COUNT(*) AS count FROM contribution_transactions")
      .get().count,
  );

  return members + quests + contributions;
}

function markImport(db, value) {
  db.prepare(
    `
      INSERT INTO app_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
  ).run(IMPORT_KEY, JSON.stringify(value), new Date().toISOString());
}

export function legacyJsonImportStatus() {
  return withGuildDatabase((db) => {
    const row = db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get(IMPORT_KEY);

    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.value);
    } catch {
      return { status: "unknown" };
    }
  });
}

export function importLegacyJsonIfNeeded() {
  return withGuildTransaction((db) => {
    const existingMarker = db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get(IMPORT_KEY);

    if (existingMarker) {
      return { status: "already-checked" };
    }

    if (mutableStateCount(db) > 0) {
      const result = {
        status: "skipped",
        reason: "sqlite-already-has-data",
      };
      markImport(db, result);
      return result;
    }

    const members = readJsonFile("members.json");
    const quests = readJsonFile("quests.json");
    const contributions = readJsonFile("contributions.json");
    const foundLegacyData =
      members.exists || quests.exists || contributions.exists;

    if (!foundLegacyData) {
      const result = {
        status: "clean",
        imported: {
          members: 0,
          quests: 0,
          contributions: 0,
        },
      };
      markImport(db, result);
      return result;
    }

    const importedMembers = members.exists
      ? importMembersIntoDatabase(db, members.value)
      : 0;

    if (quests.exists) {
      importQuestsIntoDatabase(db, quests.value);
    }

    const importedContributions = contributions.exists
      ? importContributionsIntoDatabase(db, contributions.value)
      : 0;

    const questCount = Number(
      db.prepare("SELECT COUNT(*) AS count FROM quests").get().count,
    );

    const result = {
      status: "imported",
      imported: {
        members: importedMembers,
        quests: questCount,
        contributions: importedContributions,
      },
      sources: [members, quests, contributions]
        .filter((entry) => entry.exists)
        .map((entry) => entry.target),
    };

    markImport(db, result);
    return result;
  });
}

export function initializeGuildData() {
  return importLegacyJsonIfNeeded();
}
