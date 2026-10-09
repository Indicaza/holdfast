import { createTelemetryStateHandler, objectOrMissing } from "./handlerFactory.js";

export const statsTelemetryHandler = createTelemetryStateHandler({
  eventType: "stats",
  validatePayload: (payload) => objectOrMissing(payload.stats),
});
