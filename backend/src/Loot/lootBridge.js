// What the Guildweaver bridge writes into the add-on for loot alerts: the
// account's character wishlists and a short list of valuable Bind-on-Equip
// items per auction house. One bounded document (contract: schemaVersion 1,
// docs/DUNGEON_LOOT.md):
//
//   revision     the account's wishlist counter: it only moves when a
//                wishlist changes
//   digest       a hash of everything but generatedAt: the bridge rewrites
//                the add-on's file only when this changes, so a wishlist
//                edit reaches the game whether or not quests changed
//   characters   each with the add-on's own ids for it (aliases), so the
//                add-on can tell which list is the logged-in character's
//   boe          per market: item key, estimated value, when it was
//                observed, confidence
//
// Only items still wanted are sent. Everything is capped: a bad day on the
// server can never write an unbounded file into the game folder.

import { createHash } from "node:crypto";

import { withGuildTransaction } from "../Data/database.js";
import { BOE_FLOOR_COPPER, BOE_MAX_AGE_SECONDS, BOE_MAX_MARKETS, boeWatchlistInDatabase, marketForCharacterInDatabase } from "./boeWatchlist.js";
import { MAX_NOTE, MAX_WISHLIST_ITEMS } from "./lootModel.js";
import { ownedCharacterInDatabase, rawCharacterIdsInDatabase, readWishlistsForBridgeInDatabase, wishlistRevisionInDatabase } from "./wishlistRepository.js";

export const LOOT_BRIDGE_SCHEMA_VERSION = 1;
export const MAX_BRIDGE_CHARACTERS = 20;
const MAX_ALIASES = 8;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// The ids the add-on knows the character by. The website's own id is only
// one of them when no alias was ever recorded (characters older than the
// alias ledger, whose website id is the add-on's id).
function addonIds(ids, characterId) {
  const aliases = ids.filter((id) => id !== characterId);
  return (aliases.length ? aliases : [characterId]).slice(0, MAX_ALIASES);
}

export function lootSnapshotDigest({ revision, characters, boe }) {
  return createHash("sha256").update(stable({ revision, characters, boe })).digest("hex").slice(0, 16);
}

export function readLootBridgeSnapshot(memberId, { now = Math.floor(Date.now() / 1000) } = {}) {
  const member = String(memberId ?? "").trim();
  // Reconciling wishlists can mark items acquired: one transaction.
  return withGuildTransaction((db) => {
    // The account's characters, most recently played first.
    const ids = db.prepare(`SELECT c.id FROM characters c ${tableExists(db, "character_cards") ? "LEFT JOIN character_cards k ON k.character_id = c.id" : ""}
      WHERE c.member_id = ? ORDER BY ${tableExists(db, "character_cards") ? "COALESCE(k.last_seen_at, '') DESC," : ""} c.sort_order, c.id LIMIT ?`)
      .all(member, MAX_BRIDGE_CHARACTERS).map((row) => row.id);
    const owned = ids.map((id) => ownedCharacterInDatabase(db, member, id)).filter(Boolean);
    const wishlists = readWishlistsForBridgeInDatabase(db, member, owned, now);
    const markets = {};
    const characters = wishlists.map(({ character, revision, updatedAt, items }) => {
      const market = marketForCharacterInDatabase(db, character);
      if (market && !markets[market.marketKey] && Object.keys(markets).length < BOE_MAX_MARKETS) {
        markets[market.marketKey] = { name: market.name, items: boeWatchlistInDatabase(db, market.marketKey, { now }) };
      }
      return {
        id: character.id, name: character.name, realm: character.realm, region: character.region,
        aliases: addonIds(rawCharacterIdsInDatabase(db, member, character.id), character.id),
        marketKey: market && markets[market.marketKey] ? market.marketKey : null,
        wishlist: { revision, updatedAt, items: items.slice(0, MAX_WISHLIST_ITEMS).map((item) => ({ ...item, note: item.note.slice(0, MAX_NOTE), name: item.name.slice(0, 80), source: item.source.slice(0, 80) })) },
      };
    });
    const body = { revision: wishlistRevisionInDatabase(db, member).revision, characters,
      boe: { floorCopper: BOE_FLOOR_COPPER, maxAgeSeconds: BOE_MAX_AGE_SECONDS, markets } };
    return { schemaVersion: LOOT_BRIDGE_SCHEMA_VERSION, generatedAt: now, digest: lootSnapshotDigest(body), ...body };
  });
}
