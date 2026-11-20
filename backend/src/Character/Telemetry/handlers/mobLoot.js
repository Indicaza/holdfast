import { validMobLoot } from "../../../GameData/publicGameDataModel.js";
import { recordMobLootInDatabase } from "../../../GameData/publicGameDataProjection.js";
import { linkDungeonRunLootInDatabase } from "../../../Dungeon/dungeonRunRepository.js";
import { recordLootWindowInDatabase } from "../../../Loot/lootCatalogRepository.js";
import { recordLootOpportunityInDatabase } from "../../../Loot/lootObservationRepository.js";

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
    // Inside a dungeon, the sighting also feeds the dungeon loot catalog.
    recordLootWindowInDatabase(db, { envelope: event.envelope, newItemIds: result?.newItemIds });
    // An atlas boss's or rare's corpse: one loot opportunity, whoever saw it
    // (Loot/lootObservationRepository.js), for observed drop rates.
    recordLootOpportunityInDatabase(db, event);
    return result;
  },
};
