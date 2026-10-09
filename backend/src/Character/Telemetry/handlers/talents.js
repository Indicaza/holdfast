import { createTelemetryStateHandler, objectOrMissing } from "./handlerFactory.js";

export const talentsTelemetryHandler = createTelemetryStateHandler({
  eventType: "talents",
  validatePayload: (payload) => objectOrMissing(payload.talents),
});
