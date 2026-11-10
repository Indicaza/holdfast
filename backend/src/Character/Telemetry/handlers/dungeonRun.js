import { validDungeonRun } from "../../../Dungeon/dungeonRunModel.js";
import { recordDungeonRunInDatabase } from "../../../Dungeon/dungeonRunRepository.js";

// dungeon_run: one dungeon or raid run, sent as an open checkpoint at
// /reload or logout and once more when it ends. Personal data: it is stored
// against the uploading account only.
export const dungeonRunTelemetryHandler = {
  eventType: "dungeon_run",
  validate(record) {
    return validDungeonRun(record) ? { ok: true } : { ok: false, error: "invalid_dungeon_run" };
  },
  canonicalize({ envelope }) {
    return envelope.payload;
  },
  recordEvent: recordDungeonRunInDatabase,
};
