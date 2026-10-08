import { withGuildTransaction } from "../Data/database.js";
import {
  ensureGuildweaverCharacterIdentitySchema,
  readGuildweaverCharacterAliasInDatabase,
} from "./characterIdentityRepository.js";

export function associateTelemetryRecordCharacter({
  recordId,
  memberId,
  deviceId = "",
  rawCharacterId = "",
}) {
  if (!recordId || !memberId || !rawCharacterId) return null;

  return withGuildTransaction((db) => {
    ensureGuildweaverCharacterIdentitySchema(db);
    const characterId = readGuildweaverCharacterAliasInDatabase({
      db,
      memberId,
      deviceId,
      rawCharacterId,
    });
    if (!characterId) return null;

    db.prepare(`
      UPDATE guildweaver_telemetry_records
      SET character_id = ?
      WHERE id = ? AND member_id = ?
    `).run(characterId, Number(recordId), String(memberId));

    return characterId;
  });
}
