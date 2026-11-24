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

function tooltipColor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const channels = ["r", "g", "b"].map((key) => Number(value[key]));
  if (!channels.every(Number.isFinite)) return null;
  const color = Object.fromEntries(["r", "g", "b"].map((key, index) => [key, Math.max(0, Math.min(1, channels[index]))]));
  if (value.a !== undefined && Number.isFinite(Number(value.a))) color.a = Math.max(0, Math.min(1, Number(value.a)));
  return color;
}

// Only a base-item hyperlink render becomes public item knowledge. Other
// add-ons can decorate that tooltip, so keep game facts but not their footer,
// transmog replacement, vendor estimates or inventory/character listings.
function publicTooltipLines(raw) {
  const source = Array.isArray(raw?.tooltip?.lines) ? raw.tooltip.lines : Array.isArray(raw?.tooltipLines) ? raw.tooltipLines : [];
  const lines = [];
  let skipTransmogName = false;
  for (const line of source.slice(0, 40)) {
    if (!line || typeof line !== "object") continue;
    const left = gameText(line.left ?? line.leftText ?? line.text, 600);
    const right = gameText(line.right ?? line.rightText, 300);
    if (/^transmogrified to:?\s*$/i.test(left)) {
      skipTransmogName = true;
      continue;
    }
    if (skipTransmogName && (left || right)) {
      skipTransmogName = false;
      continue;
    }
    if (/^(?:vendor\s*x\s*\d+|inventory\b|total:\s*\d+)/i.test(left)) break;
    if (line.sellPrice === true || (/^sell price:\s*$/i.test(left) && !right)) {
      lines.push({ sellPrice: true });
      continue;
    }
    if (line.blank === true && !left && !right) {
      lines.push({ blank: true });
      continue;
    }
    if (!left && !right) continue;
    const row = { left, right };
    const leftColor = tooltipColor(line.leftColor ?? line.color);
    const rightColor = tooltipColor(line.rightColor);
    if (leftColor) row.leftColor = leftColor;
    if (rightColor) row.rightColor = rightColor;
    const offset = gameInteger(line.offset ?? line.leftOffset, 1, 64);
    if (offset !== null) row.offset = offset;
    lines.push(row);
  }
  while (lines[0]?.blank) lines.shift();
  while (lines.at(-1)?.blank) lines.pop();
  return lines;
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
  item.tooltipLines = publicTooltipLines(raw);
  item.descriptionBasis = "base_item_id";
  return item;
}

// The add-on's own word on the window (optional; older add-ons send none):
// complete or partial, why partial, and how many slots it had.
function validInspection(capture) {
  if (capture.inspection === undefined) return capture.partialReason === undefined && capture.slotCount === undefined;
  if (!["complete", "partial"].includes(capture.inspection)) return false;
  if (capture.partialReason !== undefined && capture.partialReason !== null
    && !(capture.inspection === "partial" && typeof capture.partialReason === "string" && /^[a-z-]{1,40}$/.test(capture.partialReason))) return false;
  return capture.slotCount === undefined || (Number.isInteger(capture.slotCount) && capture.slotCount >= 0 && capture.slotCount <= 200);
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
    && payload.capture.yieldBasis === "loot_window" && validInspection(payload.capture)
    // No items is a window too, but only when the add-on says it saw the whole of it.
    && Array.isArray(payload.outputs) && (payload.outputs.length > 0 || payload.capture.inspection === "complete") && payload.outputs.length <= 200
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
