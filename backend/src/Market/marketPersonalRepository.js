import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { positiveInteger } from "./marketModel.js";
import { readPricesInDatabase } from "./marketRepository.js";

// Favorites, shopping lists and saved searches. Every read and write names
// the signed-in account; another account's list answers "not found".
export const MAX_FAVORITES = 500;
export const MAX_LISTS = 50;
export const MAX_LIST_ITEMS = 300;
export const MAX_SAVED_SEARCHES = 50;
const PURPOSES = new Set(["personal", "crafting", "dungeon"]);

function text(value, max = 80) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function names(db, ids) {
  const unique = [...new Set(ids)];
  const map = new Map();
  if (!unique.length) return map;
  for (const row of db.prepare(`SELECT item_id, name, quality_id, icon_file_id FROM public_game_items
    WHERE item_id IN (${unique.map(() => "?").join(",")}) ORDER BY captured_at ASC`).all(...unique)) {
    map.set(row.item_id, { name: row.name, qualityId: row.quality_id, iconFileDataId: row.icon_file_id });
  }
  return map;
}

function item(map, itemId) {
  const known = map.get(itemId);
  return { itemId, name: known?.name || `Item ${itemId}`, qualityId: known?.qualityId ?? null, iconFileDataId: known?.iconFileDataId ?? null };
}

// Favorites ---------------------------------------------------------------------

export function readFavorites({ memberId, marketKey = "" }) {
  return withGuildDatabase((db) => {
    const rows = db.prepare("SELECT item_id, created_at FROM market_favorites WHERE member_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(text(memberId, 160), MAX_FAVORITES);
    const ids = rows.map((row) => row.item_id);
    const itemNames = names(db, ids);
    const prices = readPricesInDatabase(db, { marketKey, itemIds: ids });
    return { marketKey: marketKey || null, favorites: rows.map((row) => ({ item: item(itemNames, row.item_id), addedAt: row.created_at, price: prices.get(row.item_id) || null })) };
  });
}

export function setFavorite({ memberId, itemId, favorite }) {
  const id = positiveInteger(itemId);
  if (!id) return { status: "invalid" };
  return withGuildTransaction((db) => {
    const member = text(memberId, 160);
    if (!favorite) {
      db.prepare("DELETE FROM market_favorites WHERE member_id = ? AND item_id = ?").run(member, id);
      return { status: "removed" };
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM market_favorites WHERE member_id = ?").get(member).n;
    const exists = db.prepare("SELECT 1 FROM market_favorites WHERE member_id = ? AND item_id = ?").get(member, id);
    if (!exists && count >= MAX_FAVORITES) return { status: "limit" };
    db.prepare("INSERT OR IGNORE INTO market_favorites (member_id, item_id, created_at) VALUES (?, ?, ?)").run(member, id, new Date().toISOString());
    return { status: "added" };
  });
}

export function favoriteIds(memberId, itemIds) {
  const ids = (itemIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 500);
  if (!ids.length) return [];
  return withGuildDatabase((db) => db.prepare(`SELECT item_id FROM market_favorites WHERE member_id = ? AND item_id IN (${ids.map(() => "?").join(",")})`)
    .all(text(memberId, 160), ...ids).map((row) => row.item_id));
}

// Shopping lists ----------------------------------------------------------------

function ownedList(db, memberId, listId) {
  const id = positiveInteger(listId);
  return id ? db.prepare("SELECT * FROM market_shopping_lists WHERE id = ? AND member_id = ?").get(id, text(memberId, 160)) : null;
}

function listFromRow(db, row, marketKey) {
  const entries = db.prepare("SELECT * FROM market_shopping_list_items WHERE list_id = ? ORDER BY position, added_at").all(row.id);
  const itemNames = names(db, entries.map((entry) => entry.item_id));
  const prices = readPricesInDatabase(db, { marketKey, itemIds: entries.map((entry) => entry.item_id) });
  let total = 0;
  let missing = 0;
  const items = entries.map((entry) => {
    const price = prices.get(entry.item_id) || null;
    const unit = price ? (price.minUnitBuyout ?? price.typicalUnitBuyout) : null;
    const remaining = Math.max(0, entry.quantity - entry.purchased);
    if (unit === null) { if (remaining) missing += 1; } else total += unit * remaining;
    return { item: item(itemNames, entry.item_id), quantity: entry.quantity, purchased: entry.purchased, note: entry.note,
      price, estimatedCost: unit === null ? null : unit * remaining };
  });
  return { id: row.id, name: row.name, purpose: row.purpose, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at,
    items, estimate: { copper: total, missingPrices: missing, basis: "lowest current asking price × quantity still needed" } };
}

export function readShoppingLists({ memberId, marketKey = "" }) {
  return withGuildDatabase((db) => ({
    marketKey: marketKey || null,
    lists: db.prepare("SELECT * FROM market_shopping_lists WHERE member_id = ? ORDER BY position, id").all(text(memberId, 160))
      .map((row) => listFromRow(db, row, marketKey)),
  }));
}

export function createShoppingList({ memberId, name, purpose = "personal" }) {
  const label = text(name, 60);
  if (!label) return { status: "invalid" };
  return withGuildTransaction((db) => {
    const member = text(memberId, 160);
    const count = db.prepare("SELECT COUNT(*) AS n FROM market_shopping_lists WHERE member_id = ?").get(member).n;
    if (count >= MAX_LISTS) return { status: "limit" };
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO market_shopping_lists (member_id, name, purpose, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(member, label, PURPOSES.has(purpose) ? purpose : "personal", count, now, now);
    return { status: "created", list: listFromRow(db, db.prepare("SELECT * FROM market_shopping_lists WHERE id = ?").get(result.lastInsertRowid), "") };
  });
}

export function updateShoppingList({ memberId, listId, name, purpose, position }) {
  return withGuildTransaction((db) => {
    const list = ownedList(db, memberId, listId);
    if (!list) return { status: "not-found" };
    const label = name === undefined ? list.name : text(name, 60);
    if (!label) return { status: "invalid" };
    db.prepare("UPDATE market_shopping_lists SET name = ?, purpose = ?, position = ?, updated_at = ? WHERE id = ?")
      .run(label, PURPOSES.has(purpose) ? purpose : list.purpose, Number.isSafeInteger(position) ? Math.max(0, Math.min(1000, position)) : list.position,
        new Date().toISOString(), list.id);
    return { status: "updated" };
  });
}

export function deleteShoppingList({ memberId, listId }) {
  return withGuildTransaction((db) => {
    const list = ownedList(db, memberId, listId);
    if (!list) return { status: "not-found" };
    db.prepare("DELETE FROM market_shopping_lists WHERE id = ?").run(list.id);
    return { status: "deleted" };
  });
}

// Adds an item, or sets its quantity, purchased count or note.
export function upsertShoppingListItem({ memberId, listId, itemId, quantity, purchased, note }) {
  const id = positiveInteger(itemId);
  if (!id) return { status: "invalid" };
  return withGuildTransaction((db) => {
    const list = ownedList(db, memberId, listId);
    if (!list) return { status: "not-found" };
    const existing = db.prepare("SELECT * FROM market_shopping_list_items WHERE list_id = ? AND item_id = ?").get(list.id, id);
    const count = db.prepare("SELECT COUNT(*) AS n FROM market_shopping_list_items WHERE list_id = ?").get(list.id).n;
    if (!existing && count >= MAX_LIST_ITEMS) return { status: "limit" };
    const nextQuantity = quantity === undefined ? existing?.quantity ?? 1 : positiveInteger(quantity, 100000);
    if (!nextQuantity) return { status: "invalid" };
    const nextPurchased = purchased === undefined ? existing?.purchased ?? 0 : Math.max(0, Math.min(nextQuantity, Math.trunc(Number(purchased)) || 0));
    db.prepare(`INSERT INTO market_shopping_list_items (list_id, item_id, quantity, purchased, note, position, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_id, item_id) DO UPDATE SET quantity = excluded.quantity, purchased = excluded.purchased, note = excluded.note`)
      .run(list.id, id, nextQuantity, Math.min(nextPurchased, nextQuantity), note === undefined ? existing?.note ?? "" : text(note, 200), existing?.position ?? count, new Date().toISOString());
    db.prepare("UPDATE market_shopping_lists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), list.id);
    return { status: existing ? "updated" : "added" };
  });
}

export function removeShoppingListItem({ memberId, listId, itemId }) {
  return withGuildTransaction((db) => {
    const list = ownedList(db, memberId, listId);
    if (!list) return { status: "not-found" };
    db.prepare("DELETE FROM market_shopping_list_items WHERE list_id = ? AND item_id = ?").run(list.id, positiveInteger(itemId) || 0);
    return { status: "removed" };
  });
}

// Saved searches ----------------------------------------------------------------

const SEARCH_KEYS = ["q", "category", "sort", "direction", "market"];

export function readSavedSearches({ memberId }) {
  return withGuildDatabase((db) => ({
    searches: db.prepare("SELECT * FROM market_saved_searches WHERE member_id = ? ORDER BY created_at DESC LIMIT ?").all(text(memberId, 160), MAX_SAVED_SEARCHES)
      .map((row) => ({ id: row.id, name: row.name, query: JSON.parse(row.query_json), createdAt: row.created_at })),
  }));
}

export function saveSearch({ memberId, name, query = {} }) {
  const label = text(name, 60);
  const clean = Object.fromEntries(SEARCH_KEYS.map((key) => [key, text(query?.[key], 100)]).filter(([, value]) => value));
  if (!label || !Object.keys(clean).length) return { status: "invalid" };
  return withGuildTransaction((db) => {
    const member = text(memberId, 160);
    if (db.prepare("SELECT COUNT(*) AS n FROM market_saved_searches WHERE member_id = ?").get(member).n >= MAX_SAVED_SEARCHES) return { status: "limit" };
    const result = db.prepare("INSERT INTO market_saved_searches (member_id, name, query_json, created_at) VALUES (?, ?, ?, ?)")
      .run(member, label, JSON.stringify(clean), new Date().toISOString());
    return { status: "created", search: { id: Number(result.lastInsertRowid), name: label, query: clean } };
  });
}

export function deleteSavedSearch({ memberId, searchId }) {
  return withGuildDatabase((db) => ({
    status: db.prepare("DELETE FROM market_saved_searches WHERE id = ? AND member_id = ?").run(positiveInteger(searchId) || 0, text(memberId, 160)).changes
      ? "deleted" : "not-found",
  }));
}
