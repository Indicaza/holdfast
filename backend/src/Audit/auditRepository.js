import { withGuildDatabase } from "../Data/database.js";
import { requireGuildId } from "../Guild/guildScope.js";

export function recordAuditEventInDatabase({
  db,
  guildId,
  actorMemberId = null,
  eventType,
  entityType,
  entityId = null,
  payload = {},
}) {
  const result = db
    .prepare(
      `
        INSERT INTO audit_events (
          guild_id,
          actor_member_id,
          event_type,
          entity_type,
          entity_id,
          created_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      requireGuildId(guildId),
      actorMemberId || null,
      eventType,
      entityType,
      entityId || null,
      new Date().toISOString(),
      JSON.stringify(payload),
    );

  return Number(result.lastInsertRowid);
}

export function readAuditEvents(
  guildId,
  limit = 100,
  { includeSnapshots = false } = {},
) {
  const id = requireGuildId(guildId);
  const safeLimit = Math.min(
    250,
    Math.max(1, Math.trunc(Number(limit) || 100)),
  );

  return withGuildDatabase((db) =>
    db
      .prepare(
        `
          SELECT
            audit_events.*,
            members.display_name AS actor_display_name,
            members.username AS actor_username
          FROM audit_events
          LEFT JOIN members ON members.id = audit_events.actor_member_id
          WHERE audit_events.guild_id = ?
          ORDER BY audit_events.id DESC
          LIMIT ?
        `,
      )
      .all(id, safeLimit)
      .map((row) => {
        const payload = JSON.parse(row.payload_json || "{}");

        if (!includeSnapshots) {
          delete payload.before;
          delete payload.after;
        }

        return {
          id: Number(row.id),
          actorMemberId: row.actor_member_id || null,
          actorName:
            row.actor_display_name || row.actor_username || "Unknown member",
          eventType: row.event_type,
          entityType: row.entity_type,
          entityId: row.entity_id || null,
          createdAt: row.created_at,
          payload,
        };
      }),
  );
}
