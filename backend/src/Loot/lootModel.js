// Shapes and limits shared by the dungeon loot catalog, wishlists and the
// bridge. Pure: no database.
//
// Three kinds of evidence are kept apart everywhere, because none of them
// implies the next:
//   loot_window        an item was in a corpse's loot window (offered)
//   group_roll         an item was put up for a Need/Greed roll (offered to
//                      the group; the source creature is usually unknown)
//   encounter_journal  the client's own journal advertises it for a boss
// plus "external" for tables from outside the game, which stay candidates
// until one of the others confirms them. Winning or owning an item is a
// fact about a character, never about the catalog.

import { gameBuildKey } from "../GameData/gameDataCatalog.js";
import { gameInteger, gameText } from "../GameData/publicGameDataModel.js";

export const PROVENANCES = Object.freeze(["loot_window", "group_roll", "encounter_journal", "external"]);
export const DUNGEON_TYPES = Object.freeze(["party", "raid"]);
export const PRIORITIES = Object.freeze(["high", "normal", "low"]);
export const ROLL_OUTCOMES = Object.freeze(["offered", "won", "not_won"]);

export const MAX_WISHLIST_ITEMS = 200;
export const MAX_NOTE = 140;
export const MAX_SOURCE_DUNGEON = 80;
export const MAX_SNAPSHOT_ENCOUNTERS = 40;
export const MAX_SNAPSHOT_ITEMS = 200;

const ROLL_KEY = /^[\w:.-]{1,160}$/;
const VARIANT_KEY = /^i:(\d+)(:s-?\d+)?(:b\d+(\.\d+)*)?$/;

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Lua sends an empty table as {} whether it was a list or a map.
export function listOf(value) {
  if (Array.isArray(value)) return value;
  return isObject(value) && Object.keys(value).length === 0 ? [] : null;
}

// "i:15210" or "i:15210:s-1081" for an item id; null when the key is not a
// key of that item.
export function wishlistItemKey(itemId, variant = "") {
  const id = gameInteger(itemId, 1);
  if (!id) return null;
  const key = String(variant || "").trim();
  if (!key || key === `i:${id}`) return `i:${id}`;
  const match = VARIANT_KEY.exec(key);
  return match && Number(match[1]) === id ? key : null;
}

export function itemIdOfKey(itemKey) {
  const match = VARIANT_KEY.exec(String(itemKey || ""));
  return match ? gameInteger(match[1], 1) : null;
}

export function dungeonInstance(raw) {
  const instanceId = gameInteger(raw?.instanceId, 1);
  const type = String(raw?.type || "");
  if (!instanceId || !DUNGEON_TYPES.includes(type)) return null;
  return { instanceId, type, name: gameText(raw.name, 120), difficultyId: gameInteger(raw.difficultyId) ?? 0 };
}

// loot_roll, payload schema 1: one Need/Greed roll one player saw.
export function validLootRoll({ kind, envelope, payloadSchemaVersion }) {
  const payload = envelope?.payload;
  const item = payload?.item;
  return kind === "event" && Number(payloadSchemaVersion ?? payload?.schemaVersion) === 1 && payload?.schemaVersion === 1
    && typeof payload.rollKey === "string" && ROLL_KEY.test(payload.rollKey)
    && payload.evidence === "group_roll" && ROLL_OUTCOMES.includes(payload.outcome)
    && Boolean(String(envelope.characterId || "").trim())
    && gameInteger(item?.itemId, 1) !== null && wishlistItemKey(item.itemId, item.itemKey) !== null
    && gameInteger(payload.startedAt, 1) !== null
    && (payload.acquired === undefined || payload.acquired === null || (isObject(payload.acquired) && payload.acquired.basis === "chat_loot_self"))
    && (payload.outcome !== "won" || isObject(payload.acquired))
    && (payload.context === undefined || isObject(payload.context));
}

// loot_catalog_snapshot, payload schema 1: the loot the client's Encounter
// Journal lists for the bosses of one dungeon at one difficulty.
export function validLootCatalogSnapshot({ kind, envelope, payloadSchemaVersion }) {
  const payload = envelope?.payload;
  const encounters = listOf(payload?.encounters);
  return kind === "event" && Number(payloadSchemaVersion ?? payload?.schemaVersion) === 1 && payload?.schemaVersion === 1
    && payload.sourceApi === "encounter_journal" && Boolean(gameBuildKey(envelope.gameBuild))
    && dungeonInstance({ ...payload.instance, difficultyId: payload.difficultyId }) !== null
    && typeof payload.complete === "boolean"
    && encounters !== null && encounters.length > 0 && encounters.length <= MAX_SNAPSHOT_ENCOUNTERS
    && encounters.every((encounter) => {
      const items = listOf(encounter?.items);
      return gameInteger(encounter?.journalEncounterId, 1) !== null && typeof encounter.complete === "boolean"
        && items !== null && items.length <= MAX_SNAPSHOT_ITEMS
        && items.every((entry) => gameInteger(isObject(entry) ? entry.itemId : entry, 1) !== null);
    })
    && new Set(encounters.map((encounter) => encounter.journalEncounterId)).size === encounters.length;
}

// Builds compare as their last number (the client build): "1.60.1.70338".
// Null when either has none, so callers never assume an order.
export function compareBuilds(left, right) {
  const number = (value) => {
    const match = /(\d+)\s*$/.exec(String(value || ""));
    return match ? Number(match[1]) : null;
  };
  const a = number(left);
  const b = number(right);
  return a === null || b === null ? null : Math.sign(a - b);
}

// How sure the catalog is that an item comes from a source, from the kinds
// of evidence behind it (rows of one item and source).
//   confirmed   seen in that creature's loot window
//   advertised  the client's journal lists it; nobody has reported seeing it
//   reported    seen in a group roll here; the source is not pinned down
//   candidate   only an outside table says so
//   delisted    the journal stopped listing it and nobody saw it since
export function sourceConfidence(rows = []) {
  const active = (provenance) => rows.find((row) => row.provenance === provenance && row.status === "active");
  const window = active("loot_window");
  const journal = rows.find((row) => row.provenance === "encounter_journal");
  if (journal?.status === "removed" && !(window && window.lastSeenAt > journal.removedAt)) return "delisted";
  if (window) return "confirmed";
  if (journal?.status === "active") return "advertised";
  if (active("group_roll")) return "reported";
  return "candidate";
}

export const CONFIDENCE_ORDER = Object.freeze(["confirmed", "advertised", "reported", "candidate", "delisted"]);

export function bestConfidence(values = []) {
  return CONFIDENCE_ORDER.find((level) => values.includes(level)) || "candidate";
}

// The game's inventory types as slot names (GetItemInfoInstant's order).
const SLOTS = { 1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Shield", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag", 19: "Tabard", 20: "Chest",
  21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Ammo", 25: "Thrown", 26: "Ranged", 28: "Relic" };

export function slotLabel(inventoryType) {
  return SLOTS[Number(inventoryType)] || "";
}

export function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
