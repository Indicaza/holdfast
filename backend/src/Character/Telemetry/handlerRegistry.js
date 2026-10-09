import { characterTelemetryHandler } from "./handlers/character.js";
import { equipmentTelemetryHandler } from "./handlers/equipment.js";
import { professionsTelemetryHandler } from "./handlers/professions.js";
import { statsTelemetryHandler } from "./handlers/stats.js";
import { talentsTelemetryHandler } from "./handlers/talents.js";

const handlers = new Map(
  [
    characterTelemetryHandler,
    statsTelemetryHandler,
    equipmentTelemetryHandler,
    professionsTelemetryHandler,
    talentsTelemetryHandler,
  ].map((handler) => [handler.eventType, handler]),
);

export function telemetryHandlerFor(eventType) {
  return handlers.get(String(eventType || "").trim()) || null;
}

export function validateTelemetryDomain(record) {
  const handler = telemetryHandlerFor(record?.eventType);
  if (!handler) return { ok: true, handler: null };
  const result = handler.validate(record);
  return result.ok ? { ok: true, handler } : { ...result, handler };
}

export function canonicalTelemetryPayload(record) {
  const handler = telemetryHandlerFor(record?.eventType);
  return handler ? handler.canonicalize(record) : record?.envelope?.payload;
}

export function knownTelemetryEventTypes() {
  return [...handlers.keys()];
}
