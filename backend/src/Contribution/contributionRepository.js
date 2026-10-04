import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";
import { createNotificationInDatabase } from "../Notification/notificationRepository.js";

function transactionId(objectiveId, memberId) {
  return `objective:${objectiveId}:member:${memberId}`;
}

function awardedByDisplayName(awardedBy) {
  return (
    awardedBy.guildNickname ||
    awardedBy.globalName ||
    awardedBy.displayName ||
    awardedBy.username ||
    ""
  );
}

function parseItems(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function transactionFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    memberId: row.member_id,
    memberName: row.member_name,
    questId: row.quest_id,
    questTitle: row.quest_title,
    objectiveId: row.objective_id,
    objectiveTitle: row.objective_title,
    rep: Number(row.rep) || 0,
    marks: Number(row.marks) || 0,
    items: parseItems(row.items_json),
    createdAt: row.created_at,
    awardedBy: row.awarded_by_member_id
      ? {
          memberId: row.awarded_by_member_id,
          username: row.awarded_by_username || "",
          displayName: row.awarded_by_display_name || "",
        }
      : null,
  };
}

function rewardSummary(transaction) {
  const parts = [];
  if (transaction.rep) parts.push(`${transaction.rep} Rep`);
  if (transaction.marks) parts.push(`${transaction.marks} Marks`);

  for (const item of transaction.items || []) {
    if (item?.name && Number(item.quantity) > 0) {
      parts.push(`${Number(item.quantity)}× ${item.name}`);
    }
  }

  return parts.join(" · ");
}

export function awardObjectiveInDatabase({
  db,
  quest,
  objective,
  members,
  awardedBy,
}) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `
      INSERT INTO contribution_transactions (
        id,
        type,
        member_id,
        member_name,
        quest_id,
        quest_title,
        objective_id,
        objective_title,
        rep,
        marks,
        items_json,
        created_at,
        awarded_by_member_id,
        awarded_by_username,
        awarded_by_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `,
  );
  const transactions = [];

  for (const member of members) {
    const id = transactionId(objective.id, member.id);
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
        displayName: awardedByDisplayName(awardedBy),
      },
    };

    const result = insert.run(
      transaction.id,
      transaction.type,
      transaction.memberId,
      transaction.memberName,
      transaction.questId,
      transaction.questTitle,
      transaction.objectiveId,
      transaction.objectiveTitle,
      transaction.rep,
      transaction.marks,
      JSON.stringify(transaction.items),
      transaction.createdAt,
      transaction.awardedBy.memberId,
      transaction.awardedBy.username,
      transaction.awardedBy.displayName,
    );

    if (Number(result.changes) > 0) {
      transactions.push(transaction);

      const summary = rewardSummary(transaction);
      if (summary) {
        createNotificationInDatabase({
          db,
          recipientMemberId: transaction.memberId,
          type: "reward_issued",
          kind: "update",
          title: "Reward issued",
          message: `“${transaction.objectiveTitle}” paid out: ${summary}.`,
          href: "/members/me",
          entityType: "objective",
          entityId: transaction.objectiveId,
          data: {
            questId: transaction.questId,
            objectiveId: transaction.objectiveId,
            rep: transaction.rep,
            marks: transaction.marks,
            items: transaction.items,
          },
          dedupeKey: `reward:${transaction.objectiveId}:${transaction.memberId}`,
          now,
        });
      }
    }
  }

  return transactions;
}

export function importContributionsIntoDatabase(db, document) {
  const transactions = Array.isArray(document?.transactions)
    ? document.transactions
    : [];
  const insert = db.prepare(
    `
      INSERT INTO contribution_transactions (
        id,
        type,
        member_id,
        member_name,
        quest_id,
        quest_title,
        objective_id,
        objective_title,
        rep,
        marks,
        items_json,
        created_at,
        awarded_by_member_id,
        awarded_by_username,
        awarded_by_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `,
  );
  let imported = 0;

  for (const transaction of transactions) {
    if (!transaction?.id || !transaction?.memberId) {
      continue;
    }

    const awardedBy = transaction.awardedBy || {};
    const result = insert.run(
      String(transaction.id),
      String(transaction.type || "objective_reward"),
      String(transaction.memberId),
      String(transaction.memberName || transaction.memberId),
      String(transaction.questId || ""),
      String(transaction.questTitle || ""),
      String(transaction.objectiveId || ""),
      String(transaction.objectiveTitle || ""),
      Number(transaction.rep) || 0,
      Number(transaction.marks) || 0,
      JSON.stringify(Array.isArray(transaction.items) ? transaction.items : []),
      transaction.createdAt || new Date().toISOString(),
      awardedBy.memberId || null,
      awardedBy.username || "",
      awardedBy.displayName || "",
    );

    imported += Number(result.changes) > 0 ? 1 : 0;
  }

  return imported;
}

export async function awardObjective({ quest, objective, members, awardedBy }) {
  return withGuildTransaction((db) =>
    awardObjectiveInDatabase({
      db,
      quest,
      objective,
      members,
      awardedBy,
    }),
  );
}

export async function readContributionTotals() {
  return withGuildDatabase((db) => {
    const rows = db
      .prepare(
        `
          SELECT
            member_id,
            COALESCE(SUM(rep), 0) AS rep,
            COALESCE(SUM(marks), 0) AS marks,
            COALESCE(SUM(CASE WHEN type = 'objective_reward' THEN 1 ELSE 0 END), 0)
              AS completed_objectives
          FROM contribution_transactions
          GROUP BY member_id
        `,
      )
      .all();
    const totals = new Map();

    for (const row of rows) {
      totals.set(row.member_id, {
        rep: Number(row.rep) || 0,
        marks: Number(row.marks) || 0,
        completedObjectives: Number(row.completed_objectives) || 0,
      });
    }

    return totals;
  });
}

export async function readMemberContributionHistory(memberId) {
  return withGuildDatabase((db) =>
    db
      .prepare(
        `
          SELECT *
          FROM contribution_transactions
          WHERE member_id = ?
          ORDER BY created_at DESC, id DESC
        `,
      )
      .all(memberId)
      .map(transactionFromRow),
  );
}
