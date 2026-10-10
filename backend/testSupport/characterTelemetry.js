import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";

// Ingests a character's own `character` stream, which is enough for the
// website to know the character (its other streams then project onto it).
export function ingestCharacterIdentity({
  deviceId,
  memberId,
  characterId,
  name = "Rook",
  realm = "Darkwing",
  region = "US",
  level = 20,
  capturedAt = 1791322400,
}) {
  return ingestTelemetry({
    deviceId,
    memberId,
    idempotencyKey: `gw-character-${deviceId}-${characterId}-${capturedAt}`,
    body: {
      streamKey: `character:${characterId}`,
      kind: "state",
      revision: capturedAt,
      envelope: {
        schemaVersion: 1,
        eventType: "character",
        capturedAt,
        characterId,
        realm,
        region,
        payloadSchemaVersion: 1,
        payload: {
          schemaVersion: 1,
          name,
          realm,
          region,
          level,
          class: { id: 1, name: "Warrior", token: "WARRIOR" },
          race: { id: 4, name: "Night Elf", token: "NightElf" },
        },
      },
    },
    receivedAt: new Date(capturedAt * 1000).toISOString(),
  });
}
