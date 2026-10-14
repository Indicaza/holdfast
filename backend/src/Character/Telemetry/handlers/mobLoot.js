import { validMobLoot } from "../../../GameData/publicGameDataModel.js";
import { recordMobLootInDatabase } from "../../../GameData/publicGameDataProjection.js";

export const mobLootTelemetryHandler = {
  eventType: "mob_loot",
  validate(record) {
    return validMobLoot(record) ? { ok: true } : { ok: false, error: "invalid_mob_loot" };
  },
  canonicalize({ envelope }) { return envelope.payload; },
  recordEvent: recordMobLootInDatabase,
};
