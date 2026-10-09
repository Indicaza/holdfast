// Canonical inventory model for inventory_snapshot telemetry (payload schema
// 1). The raw envelope is preserved separately for debugging; this is the
// stable, bounded shape the website reads. It is kept independent of the
// equipment and profession models, and keeps the parts a later
// snapshot-to-snapshot comparison needs: where each stack sits (containers),
// what each distinct item is (items), and how many of each itemId are carried
// (totals). Unknown or malformed values become null rather than being guessed.

export const INVENTORY_MODEL_VERSION = 1;

const MAX_CONTAINERS = 12;
const MAX_SLOTS_PER_CONTAINER = 64;
const MAX_ITEMS = 600;
const MAX_TOOLTIP_LINES = 40;
const MAX_STATS = 64;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Empty Lua tables arrive as {} (the SavedVariables parser cannot tell an empty
// array from an empty object), so an empty object is an empty list.
function list(value) {
  if (Array.isArray(value)) return value;
  return isObject(value) && Object.keys(value).length === 0 ? [] : null;
}

function array(value) {
  return list(value) || [];
}

function listOrMissing(value) {
  return value === undefined || value === null || list(value) !== null;
}

function text(value, maxLength = 160) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().slice(0, maxLength);
  return normalized || null;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value) {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 ? Math.floor(parsed) : 0;
}

function boolean(value) {
  return typeof value === "boolean" ? value : null;
}

function idName(value) {
  if (!isObject(value)) return null;
  const id = number(value.id);
  const name = text(value.name, 80);
  return id === null && !name ? null : { id, name };
}

function color(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const channel of ["r", "g", "b", "a"]) {
    const parsed = number(value[channel]);
    if (parsed !== null) result[channel] = parsed;
  }
  return Object.keys(result).length ? result : null;
}

function tooltip(value) {
  if (!isObject(value)) return null;
  const lines = array(value.lines)
    .slice(0, MAX_TOOLTIP_LINES)
    .filter(isObject)
    .map((line) => ({
      left: text(line.left, 320),
      right: text(line.right, 320),
      leftColor: color(line.leftColor),
      rightColor: color(line.rightColor),
    }))
    .filter((line) => line.left || line.right);
  return lines.length ? { source: text(value.source, 64), lines } : null;
}

function stats(value) {
  if (!isObject(value)) return null;
  const entries = Object.entries(value)
    .filter(([key, entry]) => key && number(entry) !== null)
    .slice(0, MAX_STATS)
    .map(([key, entry]) => [key.slice(0, 96), number(entry)]);
  return entries.length ? Object.fromEntries(entries) : null;
}

function ids(value) {
  return array(value).map(number).filter((entry) => entry !== null && entry > 0).slice(0, 16);
}

export function inventoryMoney(copperValue) {
  const copper = count(copperValue);
  return {
    copper,
    gold: Math.floor(copper / 10000),
    silver: Math.floor((copper % 10000) / 100),
    copperRemainder: copper % 100,
  };
}

function itemDescription(value) {
  if (!isObject(value)) return null;
  const key = text(value.key, 400);
  const itemId = number(value.itemId);
  if (!key || itemId === null) return null;
  const spell = isObject(value.spell)
    ? { id: number(value.spell.id), name: text(value.spell.name) }
    : null;
  return {
    key,
    itemId,
    itemLink: text(value.itemLink, 2000),
    name: text(value.name),
    iconFileDataId: number(value.iconFileDataId),
    qualityId: number(value.qualityId),
    itemLevel: number(value.itemLevel),
    requiredLevel: number(value.requiredLevel),
    maxStackSize: number(value.maxStackSize),
    sellPrice: number(value.sellPrice),
    bindType: number(value.bindType),
    equipLocation: text(value.equipLocation, 64),
    expansionId: number(value.expansionId),
    setId: number(value.setId),
    isCraftingReagent: boolean(value.isCraftingReagent),
    itemClass: idName(value.itemClass),
    itemSubclass: idName(value.itemSubclass),
    enchantId: number(value.enchantId),
    gemItemIds: ids(value.gemItemIds),
    suffixId: number(value.suffixId),
    bonusIds: ids(value.bonusIds),
    stats: stats(value.stats),
    spell: spell && (spell.id !== null || spell.name) ? spell : null,
    tooltip: tooltip(value.tooltip),
  };
}

function containerItem(value) {
  if (!isObject(value)) return null;
  const itemId = number(value.itemId);
  const name = text(value.name);
  if (itemId === null && !name) return null;
  return {
    itemId,
    name,
    itemLink: text(value.itemLink, 2000),
    iconFileDataId: number(value.iconFileDataId),
    qualityId: number(value.qualityId),
  };
}

function slot(value, slotCount) {
  if (!isObject(value)) return null;
  const index = number(value.slot);
  const itemKey = text(value.itemKey, 400);
  if (index === null || index < 1 || (slotCount && index > slotCount) || !itemKey) return null;
  return {
    slot: Math.floor(index),
    itemKey,
    itemId: number(value.itemId),
    count: Math.max(1, count(value.count)),
    isBound: value.isBound === true,
    isReadable: value.isReadable === true,
    hasLoot: value.hasLoot === true,
  };
}

function container(value) {
  if (!isObject(value)) return null;
  const bagId = number(value.bagId);
  if (bagId === null) return null;
  const slotCount = Math.min(count(value.slotCount), MAX_SLOTS_PER_CONTAINER);
  const seen = new Set();
  const slots = array(value.slots)
    .map((entry) => slot(entry, slotCount))
    .filter((entry) => entry && !seen.has(entry.slot) && seen.add(entry.slot))
    .sort((a, b) => a.slot - b.slot);
  return {
    bagId,
    kind: text(value.kind, 32) || (bagId === 0 ? "backpack" : "bag"),
    name: text(value.name),
    slotCount,
    freeSlots: value.freeSlots === undefined ? Math.max(0, slotCount - slots.length) : count(value.freeSlots),
    bagFamily: number(value.bagFamily),
    iconFileDataId: number(value.iconFileDataId),
    item: containerItem(value.item),
    slots,
  };
}

// Totals are recomputed from the slots so they always agree with them; the
// addon's own totals are only a cross-check for the raw record.
function totalsFrom(containers) {
  const byId = new Map();
  for (const entry of containers) {
    for (const stack of entry.slots) {
      if (stack.itemId === null) continue;
      const total = byId.get(stack.itemId) || { itemId: stack.itemId, count: 0, stacks: 0 };
      total.count += stack.count;
      total.stacks += 1;
      byId.set(stack.itemId, total);
    }
  }
  return [...byId.values()].sort((a, b) => a.itemId - b.itemId);
}

export function isInventorySnapshotPayload(payload) {
  if (!isObject(payload)) return false;
  if (!listOrMissing(payload.containers) || !listOrMissing(payload.items) || !listOrMissing(payload.totals)) return false;
  if (payload.money !== undefined && payload.money !== null && !isObject(payload.money)) return false;
  return array(payload.containers).every((entry) => isObject(entry) && listOrMissing(entry.slots));
}

export function canonicalInventorySnapshot(payload) {
  const source = isObject(payload) ? payload : {};
  const containers = array(source.containers)
    .map(container)
    .filter(Boolean)
    .sort((a, b) => (a.bagId < 0) - (b.bagId < 0) || a.bagId - b.bagId)
    .slice(0, MAX_CONTAINERS);

  const referenced = new Set(containers.flatMap((entry) => entry.slots.map((stack) => stack.itemKey)));
  const items = [];
  const seenItems = new Set();
  for (const value of array(source.items)) {
    const description = itemDescription(value);
    if (!description || seenItems.has(description.key) || !referenced.has(description.key)) continue;
    seenItems.add(description.key);
    items.push(description);
    if (items.length >= MAX_ITEMS) break;
  }

  const slotCount = containers.reduce((sum, entry) => sum + entry.slotCount, 0);
  const freeSlots = containers.reduce((sum, entry) => sum + entry.freeSlots, 0);
  return {
    modelVersion: INVENTORY_MODEL_VERSION,
    scope: text(source.scope, 32) || "carried",
    source: text(source.source, 64),
    money: inventoryMoney(isObject(source.money) ? source.money.copper : 0),
    slotCount,
    freeSlots,
    usedSlots: containers.reduce((sum, entry) => sum + entry.slots.length, 0),
    containers,
    items,
    totals: totalsFrom(containers),
  };
}
