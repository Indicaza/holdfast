// A character's gear wishlist. Personal: every row names its account and
// character, and a character is only accepted when it is that account's.
// Not the Auction House favorites (account-wide, about prices).
//
// What a row says about the item is kept apart from what happened to it:
//   wanted      on the list
//   seen        in a corpse's loot window this account reported
//   offered     in a Need/Greed roll this character saw
//   won         the game told this character it received the item of a roll
//   owned       in the character's bags or equipped, per its last sync
// Only "won" and "owned" mark an item acquired. A roll or a loot window is
// an offer to the group, never the player's item. Acquired items stay on
// the list and can be wanted again (for another copy).

import { createHash } from "node:crypto";

import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";
import { readCharacterSectionsInDatabase } from "../Character/ReadModel/sectionStore.js";
import { lootItemFactsInDatabase, lootSourcesForItemsInDatabase } from "./lootCatalogRepository.js";
import { MAX_NOTE, MAX_SOURCE_DUNGEON, MAX_WISHLIST_ITEMS, PRIORITIES, itemIdOfKey, wishlistItemKey } from "./lootModel.js";

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

// The account's character, or null: another account's character is the
// same answer as one that does not exist.
export function ownedCharacterInDatabase(db, memberId, characterId) {
  const id = text(characterId, 400);
  if (!id) return null;
  const row = db.prepare("SELECT id, name, race, class_name, spec FROM characters WHERE id = ? AND member_id = ?").get(id, text(memberId));
  if (!row) return null;
  const card = tableExists(db, "character_cards")
    ? db.prepare("SELECT name, race, class_name, spec, level, realm, region FROM character_cards WHERE character_id = ?").get(id) : null;
  return { id: row.id, name: card?.name || row.name, race: card?.race || row.race || "", className: card?.class_name || row.class_name || "",
    spec: card?.spec || row.spec || "", level: Number(card?.level) || 0, realm: card?.realm || "", region: card?.region || "" };
}

// The add-on's own ids for a character (one per installation).
export function rawCharacterIdsInDatabase(db, memberId, characterId) {
  const ids = new Set([characterId]);
  if (tableExists(db, "guildweaver_character_aliases")) {
    for (const row of db.prepare("SELECT raw_character_id FROM guildweaver_character_aliases WHERE member_id = ? AND character_id = ?").all(memberId, characterId)) {
      ids.add(row.raw_character_id);
    }
  }
  return [...ids];
}

function bumpRevision(db, memberId, characterId, now) {
  const bump = db.prepare(`INSERT INTO character_wishlist_revisions (member_id, character_id, revision, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(member_id, character_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at`);
  bump.run(memberId, characterId, now);
  bump.run(memberId, "", now);
}

export function wishlistRevisionInDatabase(db, memberId, characterId = "") {
  const row = db.prepare("SELECT revision, updated_at FROM character_wishlist_revisions WHERE member_id = ? AND character_id = ?").get(memberId, characterId);
  return { revision: Number(row?.revision) || 0, updatedAt: Number(row?.updated_at) || 0 };
}

// How many of each item the character carries or wears, from its last
// synced bags and equipment. `known` is false until either has arrived:
// then nothing can be said about owning anything.
export function ownedItemCountsInDatabase(db, characterId) {
  const counts = new Map();
  if (!tableExists(db, "character_sections")) return { known: false, counts };
  const sections = readCharacterSectionsInDatabase(db, characterId);
  const add = (itemId, count) => {
    const id = Number(itemId);
    if (Number.isSafeInteger(id) && id > 0) counts.set(id, (counts.get(id) || 0) + Math.max(1, Number(count) || 1));
  };
  for (const total of Array.isArray(sections.inventory?.payload?.totals) ? sections.inventory.payload.totals : []) add(total?.itemId, total?.count);
  const equipment = sections.equipment?.payload?.equipment;
  for (const slot of Array.isArray(equipment) ? equipment : Array.isArray(equipment?.slots) ? equipment.slots : []) add(slot?.itemId ?? slot?.itemID, 1);
  return { known: Boolean(sections.inventory || sections.equipment), counts };
}

function evidenceInDatabase(db, memberId, rawIds, itemIds) {
  const evidence = new Map(itemIds.map((id) => [id, { seenAt: null, offeredAt: null, wonAt: null }]));
  if (!itemIds.length) return evidence;
  const marks = itemIds.map(() => "?").join(",");
  // Loot observations are stored without the account, under a hash of it.
  const contributor = createHash("sha256").update(JSON.stringify([memberId])).digest("hex");
  for (const row of db.prepare(`SELECT out.item_id, MAX(o.captured_at) AS at FROM game_loot_outputs out JOIN game_loot_observations o ON o.id = out.observation_id
    WHERE out.item_id IN (${marks}) AND o.contributor_key = ? AND o.activity = 'corpse_loot' GROUP BY out.item_id`).all(...itemIds, contributor)) {
    evidence.get(row.item_id).seenAt = Math.floor(Date.parse(row.at) / 1000) || null;
  }
  for (const row of db.prepare(`SELECT item_id, MAX(started_at) AS offered, MAX(CASE WHEN outcome = 'won' THEN started_at END) AS won FROM loot_roll_events
    WHERE member_id = ? AND raw_character_id IN (${rawIds.map(() => "?").join(",")}) AND item_id IN (${marks}) GROUP BY item_id`).all(memberId, ...rawIds, ...itemIds)) {
    evidence.get(row.item_id).offeredAt = row.offered ?? null;
    evidence.get(row.item_id).wonAt = row.won ?? null;
  }
  return evidence;
}

// Marks wanted items acquired when there is proof: the character owns more
// of the item than when it was (last) wanted, or won a roll for it since.
// Returns the evidence it read, for the caller's rows.
function reconcileInDatabase(db, memberId, character, now = nowSeconds()) {
  const rows = db.prepare("SELECT * FROM character_wishlist_items WHERE member_id = ? AND character_id = ? ORDER BY position, id").all(memberId, character.id);
  const itemIds = [...new Set(rows.map((row) => row.item_id))];
  const owned = ownedItemCountsInDatabase(db, character.id);
  const evidence = evidenceInDatabase(db, memberId, rawCharacterIdsInDatabase(db, memberId, character.id), itemIds);
  let changed = false;
  for (const row of rows) {
    if (row.state !== "wanted") continue;
    const count = owned.counts.get(row.item_id) || 0;
    const won = evidence.get(row.item_id).wonAt;
    const basis = owned.known && count > row.owned_baseline ? "owned" : won && won >= row.wanted_since ? "roll_won" : "";
    if (basis) {
      db.prepare("UPDATE character_wishlist_items SET state = 'acquired', acquired_at = ?, acquired_basis = ?, updated_at = ? WHERE id = ?").run(now, basis, now, row.id);
      Object.assign(row, { state: "acquired", acquired_at: now, acquired_basis: basis, updated_at: now });
      changed = true;
    } else if (owned.known && count < row.owned_baseline) {
      // A copy was sold or destroyed: the next one counts again.
      db.prepare("UPDATE character_wishlist_items SET owned_baseline = ? WHERE id = ?").run(count, row.id);
      row.owned_baseline = count;
    }
  }
  if (changed) bumpRevision(db, memberId, character.id, now);
  return { rows, owned, evidence };
}

function itemFromRow(row, { item, sources, owned, evidence }) {
  const seen = evidence.get(row.item_id) || {};
  return {
    id: Number(row.id), itemId: row.item_id, itemKey: row.item_key, variantKey: row.variant_key || null, priority: row.priority, note: row.note,
    sourceDungeon: row.source_dungeon || null, sourceInstanceId: row.source_instance_id ?? null, origin: row.origin,
    state: row.state, acquiredAt: row.acquired_at ?? null, acquiredBasis: row.acquired_basis || null,
    position: Number(row.position), addedAt: Number(row.added_at), updatedAt: Number(row.updated_at),
    item: item(row.item_id), sources: sources.get(row.item_id) || [],
    evidence: { seenInLootWindowAt: seen.seenAt ?? null, offeredInRollAt: seen.offeredAt ?? null, wonAt: seen.wonAt ?? null,
      ownedCount: owned.known ? owned.counts.get(row.item_id) || 0 : null },
  };
}

function readInDatabase(db, memberId, character, now = nowSeconds()) {
  const state = reconcileInDatabase(db, memberId, character, now);
  const itemIds = state.rows.map((row) => row.item_id);
  const view = { item: lootItemFactsInDatabase(db, itemIds), sources: lootSourcesForItemsInDatabase(db, itemIds), owned: state.owned, evidence: state.evidence };
  return { schemaVersion: 1, character, ...wishlistRevisionInDatabase(db, memberId, character.id), limit: MAX_WISHLIST_ITEMS,
    ownershipKnown: state.owned.known, items: state.rows.map((row) => itemFromRow(row, view)) };
}

export function readWishlistInDatabase(db, memberId, characterId, now) {
  const character = ownedCharacterInDatabase(db, text(memberId), characterId);
  return character ? readInDatabase(db, text(memberId), character, now) : null;
}

// Reconciling can mark items acquired, so even a read is one transaction.
export function readWishlist({ memberId, characterId }) {
  return withGuildTransaction((db) => readWishlistInDatabase(db, memberId, characterId));
}

export function wishlistItemKeysInDatabase(db, memberId, characterId) {
  return new Set(db.prepare("SELECT item_key FROM character_wishlist_items WHERE member_id = ? AND character_id = ?").all(text(memberId), text(characterId, 400))
    .map((row) => row.item_key));
}

// What a write may set, cleaned; { error } when something is not valid.
export function cleanWishlistFields(input = {}, { partial = false } = {}) {
  const fields = {};
  if (input.priority !== undefined || !partial) {
    const priority = input.priority === undefined ? "normal" : input.priority;
    if (!PRIORITIES.includes(priority)) return { error: "invalid" };
    fields.priority = priority;
  }
  if (input.note !== undefined || !partial) {
    const note = String(input.note ?? "").trim();
    if (note.length > MAX_NOTE) return { error: "invalid" };
    fields.note = note;
  }
  if (input.sourceDungeon !== undefined || !partial) {
    const dungeon = String(input.sourceDungeon ?? "").trim();
    if (dungeon.length > MAX_SOURCE_DUNGEON) return { error: "invalid" };
    fields.sourceDungeon = dungeon;
  }
  if (input.sourceInstanceId !== undefined || !partial) {
    const id = input.sourceInstanceId === null || input.sourceInstanceId === undefined || input.sourceInstanceId === "" ? null : Number(input.sourceInstanceId);
    if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return { error: "invalid" };
    fields.sourceInstanceId = id;
  }
  return { fields };
}

// Adds an item, or updates the entry that already has the same identity
// (item key). Inside a transaction the caller owns.
export function upsertWishlistItemInDatabase(db, { memberId, character, itemKey, fields, origin = "manual", now = nowSeconds() }) {
  const itemId = itemIdOfKey(itemKey);
  const existing = db.prepare("SELECT * FROM character_wishlist_items WHERE member_id = ? AND character_id = ? AND item_key = ?").get(memberId, character.id, itemKey);
  if (existing) {
    db.prepare(`UPDATE character_wishlist_items SET priority = ?, note = ?, source_dungeon = ?, source_instance_id = ?, updated_at = ? WHERE id = ?`)
      .run(fields.priority ?? existing.priority, fields.note ?? existing.note, fields.sourceDungeon ?? existing.source_dungeon,
        fields.sourceInstanceId === undefined ? existing.source_instance_id : fields.sourceInstanceId, now, existing.id);
    return "updated";
  }
  const count = db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM character_wishlist_items WHERE member_id = ? AND character_id = ?").get(memberId, character.id);
  if (Number(count.n) >= MAX_WISHLIST_ITEMS) return "full";
  db.prepare(`INSERT INTO character_wishlist_items (member_id, character_id, item_id, variant_key, item_key, priority, note, source_dungeon, source_instance_id,
    origin, state, owned_baseline, wanted_since, position, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wanted', 0, ?, ?, ?, ?)`)
    .run(memberId, character.id, itemId, itemKey === `i:${itemId}` ? "" : itemKey, itemKey, fields.priority ?? "normal", fields.note ?? "",
      fields.sourceDungeon ?? "", fields.sourceInstanceId ?? null, origin, now, Number(count.last) + 1, now, now);
  return "created";
}

function write(memberId, characterId, change) {
  const member = text(memberId);
  return withGuildTransaction((db) => {
    const character = ownedCharacterInDatabase(db, member, characterId);
    if (!character) return { status: "not-found" };
    const now = nowSeconds();
    const status = change(db, character, now);
    if (["invalid", "not-found", "full", "unknown-item"].includes(status)) return { status };
    bumpRevision(db, member, character.id, now);
    return { status, ...readInDatabase(db, member, character, now) };
  });
}

// Adds an item to the wishlist (or updates the entry it already has).
// Only items the website knows by name can be wished for: a typo'd id
// would otherwise sit on the list, and in the game, as nothing.
export function putWishlistItem({ memberId, characterId, itemKey, variant, ...input }) {
  const key = wishlistItemKey(itemIdOfKey(itemKey), variant || itemKey);
  const clean = cleanWishlistFields(input, { partial: true });
  if (!key || clean.error) return { status: "invalid" };
  return write(memberId, characterId, (db, character, now) => {
    if (!lootItemFactsInDatabase(db, [itemIdOfKey(key)])(itemIdOfKey(key)).nameKnown) return "unknown-item";
    return upsertWishlistItemInDatabase(db, { memberId: text(memberId), character, itemKey: key, fields: clean.fields, now });
  });
}

// Changes priority, note or source; marks acquired or wanted again; or
// moves the entry up or down.
export function patchWishlistItem({ memberId, characterId, itemKey, state, move, ...input }) {
  const clean = cleanWishlistFields(input, { partial: true });
  if (clean.error || (state !== undefined && !["wanted", "acquired"].includes(state)) || (move !== undefined && !["up", "down"].includes(move))) return { status: "invalid" };
  const member = text(memberId);
  return write(memberId, characterId, (db, character, now) => {
    const row = db.prepare("SELECT * FROM character_wishlist_items WHERE member_id = ? AND character_id = ? AND item_key = ?").get(member, character.id, text(itemKey, 120));
    if (!row) return "not-found";
    if (Object.keys(clean.fields).length) upsertWishlistItemInDatabase(db, { memberId: member, character, itemKey: row.item_key, fields: clean.fields, now });
    if (state === "acquired" && row.state !== "acquired") {
      db.prepare("UPDATE character_wishlist_items SET state = 'acquired', acquired_at = ?, acquired_basis = 'manual', updated_at = ? WHERE id = ?").run(now, now, row.id);
    }
    if (state === "wanted" && row.state !== "wanted") {
      // Wanted again, for another copy: what the character owns now is the
      // starting point, so the copy it already has does not count.
      // And a roll already won is not won again.
      const owned = ownedItemCountsInDatabase(db, character.id).counts.get(row.item_id) || 0;
      const rawIds = rawCharacterIdsInDatabase(db, member, character.id);
      const lastWon = db.prepare(`SELECT MAX(started_at) AS at FROM loot_roll_events WHERE member_id = ? AND item_id = ? AND outcome = 'won'
        AND raw_character_id IN (${rawIds.map(() => "?").join(",")})`).get(member, row.item_id, ...rawIds)?.at || 0;
      db.prepare("UPDATE character_wishlist_items SET state = 'wanted', acquired_at = NULL, acquired_basis = '', owned_baseline = ?, wanted_since = ?, updated_at = ? WHERE id = ?")
        .run(owned, Math.max(now, lastWon + 1), now, row.id);
    }
    if (move) {
      const neighbour = db.prepare(`SELECT id, position FROM character_wishlist_items WHERE member_id = ? AND character_id = ? AND position ${move === "up" ? "<" : ">"} ?
        ORDER BY position ${move === "up" ? "DESC" : "ASC"} LIMIT 1`).get(member, character.id, row.position);
      if (neighbour) {
        db.prepare("UPDATE character_wishlist_items SET position = ?, updated_at = ? WHERE id = ?").run(neighbour.position, now, row.id);
        db.prepare("UPDATE character_wishlist_items SET position = ?, updated_at = ? WHERE id = ?").run(row.position, now, neighbour.id);
      }
    }
    return "updated";
  });
}

export function deleteWishlistItem({ memberId, characterId, itemKey }) {
  const member = text(memberId);
  return write(memberId, characterId, (db, character) => {
    const result = db.prepare("DELETE FROM character_wishlist_items WHERE member_id = ? AND character_id = ? AND item_key = ?").run(member, character.id, text(itemKey, 120));
    return result.changes ? "deleted" : "not-found";
  });
}

// Every wishlist of an account, for the bridge: the items still wanted,
// most wanted first. Reconciles each list first, so an item the character
// now owns stops alerting in the game after the next sync.
export function readWishlistsForBridgeInDatabase(db, memberId, characters, now = nowSeconds()) {
  const rank = { high: 0, normal: 1, low: 2 };
  return characters.map((character) => {
    const { rows } = reconcileInDatabase(db, memberId, character, now);
    const wanted = rows.filter((row) => row.state === "wanted").sort((a, b) => rank[a.priority] - rank[b.priority] || a.position - b.position);
    const item = lootItemFactsInDatabase(db, wanted.map((row) => row.item_id));
    return { character, ...wishlistRevisionInDatabase(db, memberId, character.id), items: wanted.map((row) => {
      const facts = item(row.item_id);
      return { itemId: row.item_id, itemKey: row.item_key, priority: row.priority, note: row.note, name: facts.nameKnown ? facts.name : "",
        qualityId: facts.qualityId, source: row.source_dungeon };
    }) };
  });
}

export function readWishlistSummary({ memberId }) {
  return withGuildDatabase((db) => ({ schemaVersion: 1, ...wishlistRevisionInDatabase(db, text(memberId)),
    characters: db.prepare(`SELECT character_id AS characterId, COUNT(*) AS items, SUM(state = 'wanted') AS wanted FROM character_wishlist_items
      WHERE member_id = ? GROUP BY character_id`).all(text(memberId)).map((row) => ({ ...row, items: Number(row.items), wanted: Number(row.wanted) })) }));
}
