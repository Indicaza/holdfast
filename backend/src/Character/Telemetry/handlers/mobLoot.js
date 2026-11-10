import { validMobLoot } from "../../../GameData/publicGameDataModel.js";
import { recordMobLootInDatabase } from "../../../GameData/publicGameDataProjection.js";
import { linkDungeonRunLootInDatabase } from "../../../Dungeon/dungeonRunRepository.js";

export const mobLootTelemetryHandler = {
  eventType: "mob_loot",
  validate(record) {
    return validMobLoot(record) ? { ok: true } : { ok: false, error: "invalid_mob_loot" };
  },
  canonicalize({ envelope }) { return envelope.payload; },
  recordEvent(db, event) {
    const result = recordMobLootInDatabase(db, event);
    // The public loot fact stays anonymous; the run link is private.
    linkDungeonRunLootInDatabase(db, { ...event, source: "mob_loot", observationId: result?.observationId });
    return result;
  },
};
