import { readLatestTelemetryState } from "./Telemetry/telemetryStateRepository.js";

// Adds the latest inventory_snapshot telemetry to a character's armory as
// `inventory`. Slots reference
// items by key, so each item's tooltip is sent once however many stacks of it
// the character carries.

function latestInventoryState(characterId) {
  const states = readLatestTelemetryState({ characterId, eventType: "inventory_snapshot" });
  return states
    .filter((state) => Array.isArray(state?.payload?.containers))
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))[0] || null;
}

export function applyInventoryTelemetry(armory, state) {
  if (!state?.payload || !Array.isArray(state.payload.containers)) return armory;
  return {
    ...armory,
    inventory: {
      ...state.payload,
      telemetry: {
        eventType: "inventory_snapshot",
        revision: state.revision,
        capturedAt: state.capturedAt,
        receivedAt: state.receivedAt,
      },
    },
  };
}

export function decorateArmoryInventory(armory) {
  const characterId = armory?.character?.id;
  if (!characterId) return armory;
  return applyInventoryTelemetry(armory, latestInventoryState(characterId));
}
