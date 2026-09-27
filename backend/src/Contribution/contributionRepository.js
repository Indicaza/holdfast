import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureRuntimeDataFile,
  runtimeDataFile,
} from "../Data/runtimeData.js";

const CONTRIBUTIONS_FILE = "contributions.json";

async function readDocument() {
  try {
    const target = await ensureRuntimeDataFile(CONTRIBUTIONS_FILE);
    const raw = await readFile(target, "utf8");
    const parsed = JSON.parse(raw);

    return {
      version: 1,
      transactions: Array.isArray(parsed?.transactions) ? parsed.transactions : [],
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, transactions: [] };
    }

    throw error;
  }
}

async function writeDocument(document) {
  const target = runtimeDataFile(CONTRIBUTIONS_FILE);
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function transactionId(objectiveId, memberId) {
  return `objective:${objectiveId}:member:${memberId}`;
}

export async function awardObjective({ quest, objective, members, awardedBy }) {
  const document = await readDocument();
  const existingIds = new Set(document.transactions.map((transaction) => transaction.id));
  const now = new Date().toISOString();
  const transactions = [];

  for (const member of members) {
    const id = transactionId(objective.id, member.id);

    if (existingIds.has(id)) {
      continue;
    }

    const transaction = {
      id,
      type: "objective_reward",
      memberId: member.id,
      memberName: member.displayName,
      questId: quest.id,
      questTitle: quest.title,
      objectiveId: objective.id,
      objectiveTitle: objective.title,
      rep: objective.reward.rep,
      marks: objective.reward.marks,
      items: objective.reward.items,
      createdAt: now,
      awardedBy: {
        memberId: awardedBy.id,
        username: awardedBy.username,
        displayName:
          awardedBy.guildNickname || awardedBy.globalName || awardedBy.username,
      },
    };

    document.transactions.push(transaction);
    transactions.push(transaction);
    existingIds.add(id);
  }

  if (transactions.length) {
    await writeDocument(document);
  }

  return transactions;
}

export async function readContributionTotals() {
  const document = await readDocument();
  const totals = new Map();

  for (const transaction of document.transactions) {
    const current = totals.get(transaction.memberId) || {
      rep: 0,
      marks: 0,
      completedObjectives: 0,
    };

    current.rep += Number(transaction.rep) || 0;
    current.marks += Number(transaction.marks) || 0;

    if (transaction.type === "objective_reward") {
      current.completedObjectives += 1;
    }

    totals.set(transaction.memberId, current);
  }

  return totals;
}

export async function readMemberContributionHistory(memberId) {
  const document = await readDocument();

  return document.transactions
    .filter((transaction) => transaction.memberId === memberId)
    .sort(
      (left, right) =>
        new Date(right.createdAt || 0).getTime() -
        new Date(left.createdAt || 0).getTime(),
    );
}
