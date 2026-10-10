import { withGuildDatabase, withGuildTransaction } from "../../Data/database.js";
import { projectTelemetryStateInDatabase } from "../ReadModel/readModelWriter.js";
import { ensureCharacterReadModelCurrent } from "../ReadModel/rebuildReadModel.js";
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

  // Raw record, latest state, read model and stream head commit together, so
  // a failure part way leaves nothing to reconcile.
  return withGuildTransaction(() => storeTelemetry({ deviceId, memberId, incoming, domainValidation, receivedAt }));
}

function storeTelemetry({ deviceId, memberId, incoming, domainValidation, receivedAt }) {
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
  let canonicalCharacterId = associateTelemetryRecordCharacter({
    recordId: result.record?.id,
    memberId,
    deviceId,
    rawCharacterId,
  });
  let changedSections = [];

  if (incoming.kind === "state" && result.record) {
    const persistedRecord = {
      ...incoming,
      envelope: persistedEnvelope,
      eventType: String(persistedEnvelope.eventType || incoming.eventType),
    };
    const canonicalPayload = canonicalTelemetryPayload(persistedRecord);
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
      payload: canonicalPayload,
    });

    // The character read model the website renders from (ReadModel/).
    ensureCharacterReadModelCurrent();
    const projected = withGuildDatabase((db) => projectTelemetryStateInDatabase(db, {
      memberId,
      deviceId,
      rawCharacterId,
      eventType: persistedRecord.eventType,
      payload: canonicalPayload,
      capturedAt: persistedEnvelope.capturedAt,
      receivedAt,
      recordId: result.record.id,
      revision: incoming.revision,
      installationId: persistedEnvelope.installationId || "",
    }));
    canonicalCharacterId = canonicalCharacterId || projected.characterId;
    changedSections = projected.changed;
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
    changedSections,
    handlerName: domainValidation.handler?.eventType || "opaque",
  };
}
