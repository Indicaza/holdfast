import { createTelemetryStateHandler, objectOrMissing } from "./handlerFactory.js";

export const characterTelemetryHandler = createTelemetryStateHandler({
  eventType: "character",
  validatePayload: (payload) =>
    typeof payload.name === "string" &&
    objectOrMissing(payload.class) &&
    objectOrMissing(payload.race) &&
    objectOrMissing(payload.guild) &&
    objectOrMissing(payload.specialization),
});
