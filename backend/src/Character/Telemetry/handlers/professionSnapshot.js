import { canonicalProfessionSnapshot, isProfessionSnapshotPayload } from "../professionModel.js";
import { createTelemetryStateHandler } from "./handlerFactory.js";

// profession_snapshot: profession identity and recipe books, published by the
// addon's profession module independently of the character snapshot.
export const professionSnapshotTelemetryHandler = createTelemetryStateHandler({
  eventType: "profession_snapshot",
  validatePayload: isProfessionSnapshotPayload,
  canonicalizePayload: canonicalProfessionSnapshot,
});
