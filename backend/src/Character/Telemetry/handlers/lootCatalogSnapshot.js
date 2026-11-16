import { recordLootCatalogSnapshotInDatabase } from "../../../Loot/lootCatalogRepository.js";
import { validLootCatalogSnapshot } from "../../../Loot/lootModel.js";

// loot_catalog_snapshot: the loot the client's Encounter Journal lists for
// one dungeon and difficulty. Public game data: stored without the account
// (a hash of it tells contributors apart), like corpse loot.
export const lootCatalogSnapshotTelemetryHandler = {
  eventType: "loot_catalog_snapshot",
  validate(record) {
    return validLootCatalogSnapshot(record) ? { ok: true } : { ok: false, error: "invalid_loot_catalog_snapshot" };
  },
  canonicalize({ envelope }) {
    return envelope.payload;
  },
  recordEvent: recordLootCatalogSnapshotInDatabase,
};
