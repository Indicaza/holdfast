import { recordEconomicObservationInDatabase } from "../../../Economy/economicObservationRepository.js";

// gathering_loot: one herb node (later ore vein, skinned creature, fishing
// pool…) worked and what came out of it. An event, not character state: it
// never touches the character read model. Every well-formed envelope is
// accepted so the raw record is kept for debugging; the economic observation
// layer decides whether the payload can be analysed.
export const gatheringLootTelemetryHandler = {
  eventType: "gathering_loot",
  validate() {
    return { ok: true };
  },
  canonicalize({ envelope }) {
    return envelope.payload;
  },
  recordEvent(db, event) {
    return recordEconomicObservationInDatabase(db, event);
  },
};
