import { arrayOrMissing, createTelemetryStateHandler, withListField } from "./handlerFactory.js";

export const professionsTelemetryHandler = createTelemetryStateHandler({
  eventType: "professions",
  validatePayload: (payload) => arrayOrMissing(payload.professions),
  canonicalizePayload: (payload) => withListField(payload, "professions"),
});
