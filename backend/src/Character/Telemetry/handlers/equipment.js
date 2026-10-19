import { arrayOrMissing, createTelemetryStateHandler, withListField } from "./handlerFactory.js";

export const equipmentTelemetryHandler = createTelemetryStateHandler({
  eventType: "equipment",
  validatePayload: (payload) => arrayOrMissing(payload.equipment),
  canonicalizePayload: (payload) => withListField(payload, "equipment"),
});
