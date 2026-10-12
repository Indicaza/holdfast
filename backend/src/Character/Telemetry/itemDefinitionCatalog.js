import { withGuildDatabase } from "../../Data/database.js";
import { parseTelemetryJson } from "./telemetryJson.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function itemKey(item) {
  const id = Number(item?.itemId ?? item?.itemID);
  return Number.isInteger(id) && id > 0 ? `item:${id}` : "";
}

function tooltipLines(value) {
  const tooltip = object(value?.tooltip);
  return Array.isArray(tooltip.lines) ? tooltip.lines : [];
}

export function isFullBlizzardTooltip(value) {
  const tooltip = object(value?.tooltip ?? value);
  const lines = Array.isArray(tooltip.lines) ? tooltip.lines : [];
  if (!lines.length) return false;
  if (tooltip.source !== "GameTooltip") return false;
  // Older Guildweaver snapshots predate the explicit flags but GameTooltip
  // still means the hidden client-rendered scanner, so keep them compatible.
  if (tooltip.complete === undefined && tooltip.rendered === undefined) return true;
  return tooltip.complete === true && tooltip.rendered === true;
}

function inventoryRendered(value) {
  const tooltip = object(value?.tooltip);
  return isFullBlizzardTooltip(value) && tooltip.method === "SetInventoryItem";
}

function richerTooltip(current, definition) {
  const currentFull = isFullBlizzardTooltip(current);
  const definitionFull = isFullBlizzardTooltip(definition);

  // The live equipment-slot render contains per-instance state (durability,
  // enchants, charges, binding) and always beats a generic hyperlink render.
  if (inventoryRendered(current)) return current.tooltip;
  if (inventoryRendered(definition)) return definition.tooltip;
  if (currentFull && !definitionFull) return current.tooltip;
  if (definitionFull && !currentFull) return definition.tooltip;
  if (currentFull && definitionFull) {
    return tooltipLines(current).length >= tooltipLines(definition).length ? current.tooltip : definition.tooltip;
  }

  // Do not let an old provisional C_TooltipInfo catalog entry replace an
  // equipment tooltip. The frontend will show a syncing state until a real
  // GameTooltip capture arrives rather than manufacturing missing lines.
  return current?.tooltip || null;
}

function presentText(primary, fallback = "") {
  const value = String(primary ?? "").trim();
  return value || String(fallback ?? "").trim();
}

function presentNumber(primary, fallback = null) {
  if (primary !== null && primary !== undefined && primary !== "") {
    const parsed = Number(primary);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (fallback !== null && fallback !== undefined && fallback !== "") {
    const parsed = Number(fallback);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readItemDefinitionCatalogInDatabase(db) {
  const catalog = new Map();
  const rows = db.prepare(`
    SELECT payload_json
    FROM guildweaver_telemetry_latest_state
    WHERE event_type = 'item_definition'
    ORDER BY captured_at DESC, received_at DESC
  `).all();

  for (const row of rows) {
    const payload = parseTelemetryJson(row.payload_json, {});
    const key = String(payload?.itemKey || "").trim();
    const item = payload?.item;
    if (!key || !item || typeof item !== "object" || Array.isArray(item) || catalog.has(key)) continue;
    catalog.set(key, item);
  }
  return catalog;
}

export function readItemDefinitionCatalog() {
  return withGuildDatabase((db) => readItemDefinitionCatalogInDatabase(db));
}

export function mergeItemDefinition(item, catalog) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const definition = catalog?.get(itemKey(item));
  if (!definition) return item;

  const source = object(item);
  const described = object(definition);
  const sourceClass = object(source.itemClass);
  const sourceSubclass = object(source.itemSubclass);
  const describedClass = object(described.itemClass);
  const describedSubclass = object(described.itemSubclass);
  const tooltip = richerTooltip(source, described);

  return {
    ...described,
    ...source,
    name: presentText(source.name, described.name),
    itemLink: presentText(source.itemLink, described.itemLink),
    qualityId: presentNumber(source.qualityId ?? source.quality, described.qualityId ?? described.quality),
    iconFileDataId: presentNumber(source.iconFileDataId ?? source.iconFileId, described.iconFileDataId ?? described.iconFileId),
    itemLevel: presentNumber(source.itemLevel, described.itemLevel),
    requiredLevel: presentNumber(source.requiredLevel, described.requiredLevel),
    bindType: presentNumber(source.bindType, described.bindType),
    equipLocation: presentText(source.equipLocation, described.equipLocation),
    sellPrice: presentNumber(source.sellPrice, described.sellPrice),
    stackCount: presentNumber(source.stackCount, described.stackCount),
    description: presentText(source.description, described.description),
    isCraftingReagent: source.isCraftingReagent ?? described.isCraftingReagent ?? null,
    itemClass: Object.keys(sourceClass).length ? sourceClass : describedClass,
    itemSubclass: Object.keys(sourceSubclass).length ? sourceSubclass : describedSubclass,
    stats: { ...object(described.stats), ...object(source.stats) },
    spell: Object.keys(object(source.spell)).length ? source.spell : described.spell,
    tooltip,
    tooltipLines: tooltipLines({ tooltip }).map((line) => ({ ...object(line) })),
  };
}

export function enrichEquipmentWithItemDefinitions(equipment) {
  const list = Array.isArray(equipment) ? equipment : [];
  if (!list.length) return list;
  const catalog = readItemDefinitionCatalog();
  if (!catalog.size) return list;
  return list.map((item) => mergeItemDefinition(item, catalog));
}
