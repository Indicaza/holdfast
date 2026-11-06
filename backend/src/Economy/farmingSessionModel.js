export const FARMING_MIN_SECONDS = 1200;
export const FARMING_MIN_GATHERS = 10;
export const FARMING_SYNC_GRACE_SECONDS = 900;
export const FARMING_MIN_COVERAGE = 0.9;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validFarmingSession(record) {
  const payload = record?.envelope?.payload;
  if (record?.kind !== "event" || !payload || payload.schemaVersion !== 1) return false;
  if (typeof payload.sessionId !== "string" || !/^[\w:-]{1,160}$/.test(payload.sessionId)) return false;
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) return false;
  if (!["manual", "automatic"].includes(payload.mode) || !["open", "complete"].includes(payload.status)) return false;
  if (!finite(payload.startedAt) || payload.startedAt <= 0) return false;
  if (!finite(payload.durationSeconds) || payload.durationSeconds < 0 || payload.durationSeconds > 604800) return false;
  if (!Number.isSafeInteger(payload.gatheringCount) || payload.gatheringCount < 0 || payload.gatheringCount > 1000000) return false;
  if (payload.yieldBasis !== "loot_window") return false;
  if (payload.afkAvailable === true && (!finite(payload.afkSeconds) || payload.afkSeconds < 0 || payload.afkSeconds > payload.durationSeconds)) return false;
  if (payload.status === "complete" && (!finite(payload.endedAt) || payload.endedAt < payload.startedAt
    || payload.durationSeconds > payload.endedAt - payload.startedAt + 5)) return false;
  return Boolean(record.envelope.characterId && record.envelope.installationId);
}

export function farmingSessionCoverage(expectedGathers, observedGathers) {
  return expectedGathers > 0 ? Math.min(1, observedGathers / expectedGathers) : 1;
}

export function farmingSessionQuality({ status, durationSeconds, expectedGathers, observedGathers, receivedAt, now = Date.now() }) {
  if (status !== "complete") return "in_progress";
  const received = Date.parse(receivedAt);
  if (observedGathers < expectedGathers && Number.isFinite(received) && now - received < FARMING_SYNC_GRACE_SECONDS * 1000) {
    return "awaiting_observations";
  }
  if (farmingSessionCoverage(expectedGathers, observedGathers) < FARMING_MIN_COVERAGE) return "incomplete_sync";
  if (durationSeconds < FARMING_MIN_SECONDS || observedGathers < FARMING_MIN_GATHERS) return "short_sample";
  return "sustained";
}
