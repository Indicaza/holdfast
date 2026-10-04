import { randomUUID } from "node:crypto";

import {
  withGuildDatabase,
  withGuildTransaction,
} from "../Data/database.js";

function jsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function notificationFromRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    recipientMemberId: row.recipient_member_id,
    type: row.event_type,
    kind: row.kind,
    title: row.title,
    message: row.message || "",
    href: row.href || "",
    entityType: row.entity_type || "",
    entityId: row.entity_id || "",
    data: jsonObject(row.data_json),
    readAt: row.read_at || null,
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function assertRecipientExists(db, memberId) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM members WHERE id = ? AND status = 'active'")
      .get(memberId),
  );
}

export function createNotificationInDatabase({
  db,
  recipientMemberId,
  type,
  kind = "update",
  title,
  message = "",
  href = "",
  entityType = "",
  entityId = "",
  data = {},
  dedupeKey = null,
  now = new Date().toISOString(),
}) {
  const memberId = normalizeText(recipientMemberId, 128);
  const eventType = normalizeText(type, 96);
  const notificationKind = kind === "action" ? "action" : "update";
  const notificationTitle = normalizeText(title, 160);
  const notificationMessage = normalizeText(message, 1200);
  const notificationHref = normalizeText(href, 500);
  const normalizedEntityType = normalizeText(entityType, 80);
  const normalizedEntityId = normalizeText(entityId, 160);
  const normalizedDedupeKey = dedupeKey
    ? normalizeText(dedupeKey, 240)
    : null;

  if (!memberId || !eventType || !notificationTitle) {
    throw new Error("Notification recipient, type, and title are required");
  }

  if (!assertRecipientExists(db, memberId)) {
    return null;
  }

  if (normalizedDedupeKey) {
    const existing = db
      .prepare(
        `
          SELECT id
          FROM notifications
          WHERE recipient_member_id = ?
            AND dedupe_key = ?
            AND resolved_at IS NULL
        `,
      )
      .get(memberId, normalizedDedupeKey);

    if (existing) {
      db.prepare(
        `
          UPDATE notifications
          SET
            event_type = ?,
            kind = ?,
            title = ?,
            message = ?,
            href = ?,
            entity_type = ?,
            entity_id = ?,
            data_json = ?,
            read_at = NULL,
            created_at = ?,
            updated_at = ?
          WHERE id = ?
        `,
      ).run(
        eventType,
        notificationKind,
        notificationTitle,
        notificationMessage,
        notificationHref,
        normalizedEntityType,
        normalizedEntityId,
        JSON.stringify(data || {}),
        now,
        now,
        existing.id,
      );

      return notificationFromRow(
        db.prepare("SELECT * FROM notifications WHERE id = ?").get(existing.id),
      );
    }
  }

  const id = `notification-${randomUUID()}`;

  db.prepare(
    `
      INSERT INTO notifications (
        id,
        recipient_member_id,
        event_type,
        kind,
        title,
        message,
        href,
        entity_type,
        entity_id,
        data_json,
        dedupe_key,
        read_at,
        resolved_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `,
  ).run(
    id,
    memberId,
    eventType,
    notificationKind,
    notificationTitle,
    notificationMessage,
    notificationHref,
    normalizedEntityType,
    normalizedEntityId,
    JSON.stringify(data || {}),
    normalizedDedupeKey,
    now,
    now,
  );

  return notificationFromRow(
    db.prepare("SELECT * FROM notifications WHERE id = ?").get(id),
  );
}

export function resolveNotificationsInDatabase(
  db,
  { dedupeKey, recipientMemberId = null, now = new Date().toISOString() },
) {
  const normalizedDedupeKey = normalizeText(dedupeKey, 240);

  if (!normalizedDedupeKey) return 0;

  const result = recipientMemberId
    ? db
        .prepare(
          `
            UPDATE notifications
            SET resolved_at = ?, updated_at = ?
            WHERE dedupe_key = ?
              AND recipient_member_id = ?
              AND resolved_at IS NULL
          `,
        )
        .run(now, now, normalizedDedupeKey, String(recipientMemberId))
    : db
        .prepare(
          `
            UPDATE notifications
            SET resolved_at = ?, updated_at = ?
            WHERE dedupe_key = ?
              AND resolved_at IS NULL
          `,
        )
        .run(now, now, normalizedDedupeKey);

  return Number(result.changes) || 0;
}

export function readMemberNotificationsFromDatabase(
  db,
  memberId,
  { limit = 40 } = {},
) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  const notifications = db
    .prepare(
      `
        SELECT *
        FROM notifications
        WHERE recipient_member_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
    )
    .all(String(memberId), safeLimit)
    .map(notificationFromRow);

  const summary = db
    .prepare(
      `
        SELECT
          SUM(CASE WHEN read_at IS NULL AND resolved_at IS NULL THEN 1 ELSE 0 END) AS unread_count,
          SUM(CASE WHEN kind = 'action' AND resolved_at IS NULL THEN 1 ELSE 0 END) AS action_count
        FROM notifications
        WHERE recipient_member_id = ?
      `,
    )
    .get(String(memberId));

  return {
    notifications,
    unreadCount: Number(summary?.unread_count) || 0,
    actionCount: Number(summary?.action_count) || 0,
  };
}

export function readMemberNotifications(memberId, options = {}) {
  return withGuildDatabase((db) =>
    readMemberNotificationsFromDatabase(db, memberId, options),
  );
}

export function markNotificationRead(memberId, notificationId) {
  return withGuildTransaction((db) => {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `
          UPDATE notifications
          SET read_at = COALESCE(read_at, ?), updated_at = ?
          WHERE id = ? AND recipient_member_id = ?
        `,
      )
      .run(now, now, String(notificationId), String(memberId));

    if (!result.changes) return null;

    return notificationFromRow(
      db
        .prepare("SELECT * FROM notifications WHERE id = ?")
        .get(String(notificationId)),
    );
  });
}

export function markAllNotificationsRead(memberId) {
  return withGuildTransaction((db) => {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `
          UPDATE notifications
          SET read_at = COALESCE(read_at, ?), updated_at = ?
          WHERE recipient_member_id = ? AND read_at IS NULL
        `,
      )
      .run(now, now, String(memberId));

    return Number(result.changes) || 0;
  });
}
