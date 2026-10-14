import { validGameItem } from "../../../GameData/publicGameDataModel.js";

export const gameItemDefinitionTelemetryHandler = {
  eventType: "game_item_definition",
  validate(record) {
    return validGameItem(record) ? { ok: true } : { ok: false, error: "invalid_game_item_definition" };
  },
  canonicalize({ envelope }) { return envelope.payload; },
};
