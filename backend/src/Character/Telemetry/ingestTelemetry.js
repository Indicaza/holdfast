import { associateTelemetryRecordCharacter } from "../telemetryCharacterAssociation.js";
import { recordTelemetry } from "../telemetryRecordRepository.js";
import { canonicalTelemetryPayload, validateTelemetryDomain } from "./handlerRegistry.js";
import { validateTelemetryTransport } from "./envelope.js";
import {
  advanceTelemetryStreamHead,
  pruneRawTelemetryHistory,
  storeLatestTelemetryState,
} from "./telemetryStateRepository.js";

export function ingestTelemetry({
  deviceId,
  memberId,
  body,
  idempotencyKey,
  receivedAt = new Date().toISOString(),
}) {
  const validation = validateTelemetryTransport(body, idempotencyKey);
  if (!validation.ok) {
    return { status: "invalid", error: validation.error };
  }

  const incoming = validation.record;
  const domainValidation = validateTelemetryDomain(incoming);
  if (!domainValidation.ok) {
    return { status: "invalid", error: domainValidation.error };
  }

  const result = recordTelemetry({
    deviceId,
    memberId,
    idempotencyKey: incoming.idempotencyKey,
    streamKey: incoming.streamKey,
    kind: incoming.kind,
    revision: incoming.revision,
    envelope: incoming.envelope,
    receivedAt,
  });

  if (result.status === "invalid") {
    return { status: "invalid", error: "invalid_telemetry_record" };
  }

  const persistedEnvelope = result.record?.envelope || incoming.envelope;
  const rawCharacterId = String(persistedEnvelope?.characterId || "").trim();
  const canonicalCharacterId = associateTelemetryRecordCharacter({
    recordId: result.record?.id,
    memberId,
    deviceId,
    rawCharacterId,
  });

  if (incoming.kind === "state" && result.record) {
    const persistedRecord = {
      ...incoming,
      envelope: persistedEnvelope,
      eventType: String(persistedEnvelope.eventType || incoming.eventType),
    };
    storeLatestTelemetryState({
      memberId,
      deviceId,
      rawCharacterId,
      canonicalCharacterId,
      eventType: persistedRecord.eventType,
      handlerName: domainValidation.handler?.eventType || "opaque",
      streamKey: incoming.streamKey,
      revision: incoming.revision,
      envelopeSchemaVersion: persistedEnvelope.schemaVersion,
      payloadSchemaVersion: incoming.payloadSchemaVersion,
      capturedAt: persistedEnvelope.capturedAt,
      receivedAt,
      recordId: result.record.id,
      envelope: persistedEnvelope,
      payload: canonicalTelemetryPayload(persistedRecord),
    });
  }

  advanceTelemetryStreamHead({
    deviceId,
    streamKey: incoming.streamKey,
    revision: incoming.revision,
    idempotencyKey: incoming.idempotencyKey,
    receivedAt,
  });
  pruneRawTelemetryHistory({ deviceId, streamKey: incoming.streamKey });

  return {
    status: result.status,
    record: result.record,
    canonicalCharacterId,
    rawCharacterId,
    handlerName: domainValidation.handler?.eventType || "opaque",
  };
}
