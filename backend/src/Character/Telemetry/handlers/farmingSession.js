import { validFarmingSession } from "../../../Economy/farmingSessionModel.js";
import { recordFarmingSessionInDatabase } from "../../../Economy/farmingSessionRepository.js";

export const farmingSessionTelemetryHandler = {
  eventType: "farming_session",
  validate(record) {
    return validFarmingSession(record) ? { ok: true } : { ok: false, error: "invalid_farming_session" };
  },
  canonicalize({ envelope }) {
    return envelope.payload;
  },
  recordEvent: recordFarmingSessionInDatabase,
};
