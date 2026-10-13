export const FARMING_MIN_SECONDS = 1200;
export const FARMING_MIN_GATHERS = 10;

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

export function farmingSessionQuality({ status, durationSeconds, expectedGathers, observedGathers }) {
  if (status !== "complete") return "in_progress";
  if (expectedGathers !== observedGathers) return "awaiting_observations";
  if (durationSeconds < FARMING_MIN_SECONDS || observedGathers < FARMING_MIN_GATHERS) return "short_sample";
  return "sustained";
}
