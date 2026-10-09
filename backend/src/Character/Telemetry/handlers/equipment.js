import { arrayOrMissing, createTelemetryStateHandler } from "./handlerFactory.js";

export const equipmentTelemetryHandler = createTelemetryStateHandler({
  eventType: "equipment",
  validatePayload: (payload) => arrayOrMissing(payload.equipment),
});
