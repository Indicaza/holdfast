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

// Sources are identified by what players recognise them as: discipline, kind
// and name. One herb has several game object ids (Peacebloom spawns as more
// than one object), and the same creature can be skinned and looted with
// different drop tables, so neither the object id nor the name alone is
// enough. A source the client could not name falls back to its object id.
export function economicSourceKey({ discipline, kind, name, objectId }) {
  const prefix = `${slug(discipline) || "unknown"}:${slug(kind) || "source"}`;
  const named = slug(name);
  if (named) return `${prefix}:${named}`;
  const id = integer(objectId);
  return id && id > 0 ? `${prefix}:object-${id}` : `${prefix}:unknown`;
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
  const sourceObjectId = integer(source.objectId);

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
      sourceKey: economicSourceKey({ discipline, kind: source.kind, name: source.name, objectId: source.objectId }),
      sourceKind: slug(source.kind),
      sourceName: text(source.name),
      sourceObjectId: sourceObjectId && sourceObjectId > 0 ? sourceObjectId : null,
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
      mapId: integer(location.mapId),
      zone: text(location.zone),
      subzone: text(location.subzone),
      x: coordinate(location.x),
      y: coordinate(location.y),
      gameBuild: text(gameBuild.build, 40),
      gameVersion: text(gameBuild.version, 40),
      capturedAt: telemetryTime(envelope.capturedAt, receivedAt),
      receivedAt,
    },
    outputs,
  };
}
