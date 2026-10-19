import { list, listOrMissing } from "../luaList.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createTelemetryStateHandler({
  eventType,
  payloadSchemaVersions = [1],
  requiresCharacter = true,
  validatePayload = () => true,
  canonicalizePayload = (payload) => payload,
}) {
  const supportedVersions = new Set(payloadSchemaVersions.map(Number));

  return {
    eventType,
    payloadSchemaVersions: supportedVersions,
    validate({ envelope, payloadSchemaVersion }) {
      if (!supportedVersions.has(Number(payloadSchemaVersion))) {
        return { ok: false, error: "unsupported_telemetry_payload_schema" };
      }
      if (requiresCharacter && !String(envelope?.characterId || "").trim()) {
        return { ok: false, error: "telemetry_character_id_required" };
      }
      if (!isObject(envelope?.payload) || !validatePayload(envelope.payload)) {
        return { ok: false, error: "invalid_telemetry_domain_payload" };
      }
      return { ok: true };
    },
    canonicalize({ envelope }) {
      return canonicalizePayload(envelope.payload);
    },
  };
}

export function objectOrMissing(value) {
  return value === undefined || value === null || isObject(value);
}

export function arrayOrMissing(value) {
  return listOrMissing(value);
}

// The payload with `field` as a list: an empty object (an empty Lua table)
// becomes [], anything else is kept as sent.
export function withListField(payload, field) {
  const value = list(payload?.[field]);
  return value && !Array.isArray(payload[field]) ? { ...payload, [field]: value } : payload;
}
