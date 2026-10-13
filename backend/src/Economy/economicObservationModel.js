// Turns an economic telemetry event into one observation and its outputs.
//
// Pure: no database. Every economic event type (gathering_loot today; fishing,
// creature loot, disenchanting and crafting later) shares the same shape —
// a SOURCE that was worked, the OUTPUTS it produced, and the CONTEXT the
// character was in — so they all become the same rows and the same farming
// statistics.

export const ECONOMIC_EVENT_TYPES = Object.freeze(["gathering_loot"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function coordinate(value) {
  if (value == null || (typeof value === "string" && !value.trim()) || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function slug(value) {
  return text(value, 160)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fishingLocationKey(mapId, zone) {
  const map = integer(mapId);
  if (map && map > 0) return `map-${map}`;
  const namedZone = slug(zone);
  return namedZone ? `zone-${namedZone}` : "location-unknown";
}

// Sources are identified by what players recognise them as: discipline, kind
// and name. One herb has several game object ids (Peacebloom spawns as more
// than one object), and the same creature can be skinned and looted with
// different drop tables, so neither the object id nor the name alone is
// enough. Fishing is intentionally location-sensitive: "Open Water" is not a
// global source because its catch table changes by map/zone, and named pools
// stay separated by location for the same reason.
export function economicSourceKey({ discipline, kind, name, objectId, npcId, mapId, zone }) {
  const disciplineKey = slug(discipline) || "unknown";
  const kindKey = slug(kind) || "source";
  const prefix = `${disciplineKey}:${kindKey}`;
  const named = slug(name);
  const object = integer(objectId);

  if (disciplineKey === "fishing") {
    const location = fishingLocationKey(mapId, zone);
    if (kindKey === "fishing-water") return `${prefix}:${location}`;
    if (kindKey === "fishing-pool") {
      if (named && named !== "fishing-pool") return `${prefix}:${named}:${location}`;
      if (object && object > 0) return `${prefix}:object-${object}:${location}`;
      return `${prefix}:${named || "unknown"}:${location}`;
    }
    if (named) return `${prefix}:${named}:${location}`;
    if (object && object > 0) return `${prefix}:object-${object}:${location}`;
    return `${prefix}:unknown:${location}`;
  }

  if (named) return `${prefix}:${named}`;
  const npc = integer(npcId);
  if (npc && npc > 0) return `${prefix}:npc-${npc}`;
  return object && object > 0 ? `${prefix}:object-${object}` : `${prefix}:unknown`;
}

export function economicItemKey({ itemId, name }) {
  const id = integer(itemId);
  if (id && id > 0) return `item:${id}`;
  const named = slug(name);
  return named ? `name:${named}` : "";
}

function telemetryTime(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 100000000000 ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

// Loot windows can list the same item in more than one slot; an observation
// either produced an item or it did not, so slots merge by item.
function normalizedOutputs(outputs) {
  const byKey = new Map();
  for (const output of Array.isArray(outputs) ? outputs : []) {
    if (!isObject(output)) continue;
    const itemKey = economicItemKey(output);
    if (!itemKey) continue;
    const quantity = Math.max(1, integer(output.quantity) || 1);
    const existing = byKey.get(itemKey);
    if (existing) {
      existing.quantity += quantity;
      existing.itemName ||= text(output.name);
      existing.iconFileDataId ??= integer(output.iconFileDataId);
      existing.qualityId ??= integer(output.qualityId);
      continue;
    }
    const itemId = integer(output.itemId);
    byKey.set(itemKey, {
      itemKey,
      itemId: itemId && itemId > 0 ? itemId : null,
      itemName: text(output.name),
      quantity,
      qualityId: integer(output.qualityId),
      iconFileDataId: integer(output.iconFileDataId),
    });
  }
  return [...byKey.values()];
}

export function isEconomicEventType(eventType) {
  return ECONOMIC_EVENT_TYPES.includes(text(eventType, 120));
}

// Returns { observation, outputs } or null when the event cannot be analysed
// (no discipline, no source, or nothing came out of it).
export function economicObservationFromTelemetry({
  eventType,
  envelope,
  memberId = "",
  deviceId = "",
  characterKey = "",
  recordId = null,
  streamKey = "",
  receivedAt = new Date().toISOString(),
}) {
  const payload = envelope?.payload;
  if (!isEconomicEventType(eventType) || !isObject(payload)) return null;

  const discipline = slug(payload.discipline);
  const source = isObject(payload.source) ? payload.source : null;
  const outputs = normalizedOutputs(payload.outputs);
  if (!discipline || !source || !outputs.length) return null;

  const context = isObject(payload.context) ? payload.context : {};
  const profession = isObject(context.profession) ? context.profession : {};
  const bountiful = isObject(context.modifiers?.bountifulHarvest) ? context.modifiers.bountifulHarvest : null;
  const location = isObject(context.location) ? context.location : {};
  const gameBuild = isObject(envelope.gameBuild) ? envelope.gameBuild : {};
  const observationId = text(payload.observationId, 200);
  const sourceEntityId = integer(source.objectId ?? source.npcId);
  const mapId = integer(location.mapId);
  const supportedCoordinates = !location.coordinateSystem || location.coordinateSystem === "ui_map_normalized";
  const x = supportedCoordinates && mapId > 0 ? coordinate(location.x) : null;
  const y = supportedCoordinates && mapId > 0 ? coordinate(location.y) : null;
  const sessionId = text(context.farming?.sessionId, 160);

  return {
    observation: {
      // An observation is counted once, however often the bridge resends it.
      observationKey: observationId
        ? `${text(memberId, 160)}:${text(eventType, 120)}:${observationId}`
        : `stream:${text(deviceId, 160)}:${text(streamKey, 240)}`,
      recordId: integer(recordId),
      eventType: text(eventType, 120),
      activity: slug(payload.activity),
      discipline,
      sourceKey: economicSourceKey({
        discipline,
        kind: source.kind,
        name: source.name,
        objectId: source.objectId,
        npcId: source.npcId,
        mapId: location.mapId,
        zone: location.zone,
      }),
      sourceKind: slug(source.kind),
      sourceName: text(source.name),
      sourceObjectId: sourceEntityId && sourceEntityId > 0 ? sourceEntityId : null,
      memberId: text(memberId, 160),
      deviceId: text(deviceId, 160),
      characterKey: text(characterKey, 240),
      characterLevel: integer(context.characterLevel),
      skillLineId: integer(profession.skillLineId),
      skillLevel: integer(profession.skillLevel),
      maxSkillLevel: integer(profession.maxSkillLevel),
      skillModifier: integer(profession.skillModifier),
      // Missing means the client could not read the talent, not rank 0.
      bountifulHarvestRank: bountiful ? integer(bountiful.rank) : null,
      bountifulHarvestMaxRanks: bountiful ? integer(bountiful.maxRanks) : null,
      mapId: mapId > 0 ? mapId : null,
      zone: text(location.zone),
      subzone: text(location.subzone),
      x: x !== null && y !== null ? x : null,
      y: x !== null && y !== null ? y : null,
      positionKind: text(location.positionKind, 60) || "player_at_cast",
      realm: text(envelope.realm),
      region: text(envelope.region, 40),
      farmingSessionKey: sessionId
        ? JSON.stringify([text(memberId, 160), text(envelope.installationId, 160), sessionId]) : "",
      gameBuild: text(gameBuild.build, 40),
      gameVersion: text(gameBuild.version, 40),
      capturedAt: telemetryTime(envelope.capturedAt, receivedAt),
      receivedAt,
    },
    outputs,
  };
}
