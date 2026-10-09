import { arrayOrMissing, createTelemetryStateHandler } from "./handlerFactory.js";

export const professionsTelemetryHandler = createTelemetryStateHandler({
  eventType: "professions",
  validatePayload: (payload) => arrayOrMissing(payload.professions),
});
