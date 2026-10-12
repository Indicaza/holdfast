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

function richerTooltip(current, definition) {
  const currentLines = tooltipLines(current);
  const definitionLines = tooltipLines(definition);
  if (currentLines.length >= definitionLines.length && currentLines.length) return current.tooltip;
  if (definitionLines.length) return definition.tooltip;
  return current?.tooltip || definition?.tooltip || null;
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
    name: source.name || described.name || "",
    qualityId: source.qualityId ?? source.quality ?? described.qualityId ?? described.quality ?? null,
    iconFileDataId: source.iconFileDataId ?? source.iconFileId ?? described.iconFileDataId ?? described.iconFileId ?? null,
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
