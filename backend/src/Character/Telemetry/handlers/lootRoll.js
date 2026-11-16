import { recordLootRollInDatabase } from "../../../Loot/lootCatalogRepository.js";
import { validLootRoll } from "../../../Loot/lootModel.js";

// loot_roll: a Need/Greed roll the player saw, resent with its outcome when
// that becomes known. Personal: stored against the uploading account. It is
// an offer to the group, not a drop count and not an item received (only a
// "won" outcome, which the game itself reported, says that).
export const lootRollTelemetryHandler = {
  eventType: "loot_roll",
  validate(record) {
    return validLootRoll(record) ? { ok: true } : { ok: false, error: "invalid_loot_roll" };
  },
  canonicalize({ envelope }) {
    return envelope.payload;
  },
  recordEvent: recordLootRollInDatabase,
};
