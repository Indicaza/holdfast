import { canonicalInventorySnapshot, isInventorySnapshotPayload } from "../inventoryModel.js";
import { createTelemetryStateHandler } from "./handlerFactory.js";

// inventory_snapshot: carried bags and money, published by the addon's
// inventory module independently of the character snapshot.
export const inventorySnapshotTelemetryHandler = createTelemetryStateHandler({
  eventType: "inventory_snapshot",
  validatePayload: isInventorySnapshotPayload,
  canonicalizePayload: canonicalInventorySnapshot,
});
