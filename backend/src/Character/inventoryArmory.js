// Adds a character's inventory (the read model's inventory section, the
// canonical inventory_snapshot model) to its armory as \`inventory\`. Slots
// reference items by key, so each item's tooltip is sent once however many
// stacks of it the character carries.

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
