import { gameBuildKey } from "./gameDataCatalog.js";

export function gameText(value, limit = 160) {
  if (typeof value !== "string") return "";
  if (/\|H(?!item:|spell:)/.test(value) || /(?:Player|Creature|GameObject)-\d|\b(?:crafted|created|made) by\b/i.test(value)) return "";
  return value.replace(/\|c[0-9a-f]{8}|\|r/gi, "").replace(/\|H(?:item|spell):[^|]*\|h([^|]*)\|h/g, "$1")
    .replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, limit);
}

export function gameInteger(value, min = 0, max = 2147483647) {
  if (value === null || value === undefined || typeof value === "boolean" || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export function gameLocale(value) {
  if (typeof value !== "string") return "und";
  const match = value.match(/^([a-z]{2})_?([A-Z]{2})$/);
  return match ? `${match[1]}_${match[2]}` : "und";
}

export function gameContext(envelope) {
  return { gameBuild: gameBuildKey(envelope?.gameBuild), locale: gameLocale(envelope?.locale) };
}

export function publicItemDefinition(raw = {}, { base = false } = {}) {
  const itemId = gameInteger(raw?.itemId, 1);
  if (!itemId) return null;
  const item = { itemId, name: gameText(raw.name) || `Item ${itemId}`,
    qualityId: gameInteger(raw.qualityId, 0, 8), iconFileDataId: gameInteger(raw.iconFileDataId, 1) };
  if (!base) return item;
  for (const key of ["itemLevel", "requiredLevel", "stackCount", "sellPrice", "bindType", "expansionId", "setId"]) {
    const value = gameInteger(raw[key]);
    if (value !== null) item[key] = value;
  }
  item.equipLocation = gameText(raw.equipLocation, 48);
  for (const key of ["itemClass", "itemSubclass"]) item[key] = { id: gameInteger(raw[key]?.id), name: gameText(raw[key]?.name, 80) };
  item.stats = Object.fromEntries(Object.entries(raw.stats || {}).filter(([key, value]) => /^ITEM_MOD_[A-Z_]+$/.test(key) && Number.isFinite(value)).slice(0, 32));
  item.tooltipLines = (Array.isArray(raw.tooltip?.lines) ? raw.tooltip.lines : Array.isArray(raw.tooltipLines) ? raw.tooltipLines : [])
    .slice(0, 40).map((line) => ({ left: gameText(line?.left ?? line?.leftText, 600), right: gameText(line?.right ?? line?.rightText, 300) }))
    .filter((line) => line.left || line.right);
  item.descriptionBasis = "base_item_id";
  return item;
}

export function validMobLoot({ kind, envelope, payloadSchemaVersion }) {
  const payload = envelope?.payload;
  const source = payload?.source;
  const parts = typeof source?.guid === "string" ? source.guid.split("-") : [];
  return kind === "event" && Number(payloadSchemaVersion ?? payload?.schemaVersion) === 1 && payload?.schemaVersion === 1
    && payload.activity === "corpse_loot" && source?.kind === "creature"
    && typeof source.guid === "string" && source.guid.length <= 128 && /^(Creature|Vehicle)-[0-9]+-[0-9]+-[0-9]+-[0-9]+-[0-9]+-[0-9a-fA-F]+$/.test(source.guid)
    && gameInteger(source.npcId, 1) !== null && Number(parts[5]) === source.npcId
    && Boolean(gameContext(envelope).gameBuild && gameText(envelope.realm, 96) && gameText(envelope.region, 16))
    && payload?.capture?.attribution === "loot_source_pairs" && payload.capture.visibility === "visible_to_observer"
    && payload.capture.yieldBasis === "loot_window" && Array.isArray(payload.outputs) && payload.outputs.length > 0 && payload.outputs.length <= 200
    && new Set(payload.outputs.map((entry) => gameInteger(entry?.itemId, 1))).size === payload.outputs.length
    && payload.outputs.every((output) => gameInteger(output?.itemId, 1) !== null && gameInteger(output.quantity, 1, 100000) !== null);
}

export function validGameItem({ kind, envelope, payloadSchemaVersion }) {
  return kind === "state" && Number(payloadSchemaVersion) === 1 && envelope?.payload?.basis === "base_item_id"
    && envelope.payload.schemaVersion === 1 && Boolean(gameContext(envelope).gameBuild)
    && envelope.payload.reference === `item:${gameInteger(envelope.payload.item?.itemId, 1)}`
    && envelope.payload.item?.itemLink === undefined
    && envelope.payload.item?.tooltip?.source === "GameTooltip" && envelope.payload.item.tooltip.method === "SetHyperlink"
    && envelope.payload.item.tooltip.complete === true && envelope.payload.item.tooltip.rendered === true
    && Boolean(publicItemDefinition(envelope.payload.item)) && Boolean(gameText(envelope.payload.item?.name));
}
