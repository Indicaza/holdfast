export const TELEMETRY_ENVELOPE_SCHEMA_VERSION = 1;
export const TELEMETRY_KINDS = new Set(["state", "event"]);

function text(value, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  return typeof value === "string" && value.trim().length > 0;
}

export function telemetryPayloadSchemaVersion(envelope) {
  const explicit = Number(envelope?.payloadSchemaVersion);
  if (Number.isInteger(explicit) && explicit >= 1) return explicit;

  const embedded = Number(envelope?.payload?.schemaVersion);
  if (Number.isInteger(embedded) && embedded >= 1) return embedded;
  return 1;
}

export function validateTelemetryTransport(body, idempotencyKey) {
  const streamKey = text(body?.streamKey);
  const kind = body?.kind === "event" ? "event" : body?.kind === "state" || body?.kind == null ? "state" : "";
  const revision = Number(body?.revision);
  const envelope = body?.envelope;
  const normalizedIdempotencyKey = text(idempotencyKey);

  if (!streamKey || !kind || !Number.isInteger(revision) || revision < 1 || !normalizedIdempotencyKey) {
    return { ok: false, error: "invalid_telemetry_record" };
  }
  if (!isObject(envelope)) {
    return { ok: false, error: "invalid_telemetry_envelope" };
  }
  if (Number(envelope.schemaVersion) !== TELEMETRY_ENVELOPE_SCHEMA_VERSION) {
    return { ok: false, error: "unsupported_telemetry_schema" };
  }

  const eventType = text(envelope.eventType, 120);
  if (!eventType) {
    return { ok: false, error: "telemetry_event_type_required" };
  }
  if (!validTimestamp(envelope.capturedAt)) {
    return { ok: false, error: "invalid_telemetry_captured_at" };
  }
  if (!isObject(envelope.payload)) {
    return { ok: false, error: "invalid_telemetry_payload" };
  }

  if (
    envelope.payloadSchemaVersion !== undefined &&
    (!Number.isInteger(Number(envelope.payloadSchemaVersion)) || Number(envelope.payloadSchemaVersion) < 1)
  ) {
    return { ok: false, error: "invalid_telemetry_payload_schema" };
  }

  return {
    ok: true,
    record: {
      streamKey,
      kind,
      revision,
      envelope,
      eventType,
      idempotencyKey: normalizedIdempotencyKey,
      payloadSchemaVersion: telemetryPayloadSchemaVersion(envelope),
    },
  };
}
