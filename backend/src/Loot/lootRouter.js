import { Router } from "express";

import { withAtlasDetail, withAtlasList } from "../Atlas/atlasRepository.js";
import { authenticateGuildweaverDevice } from "../Character/guildweaverDeviceRepository.js";
import { withGuildDatabase } from "../Data/database.js";
import { publishPlayerChanged } from "../Live/playerChangeEvents.js";
import { createRateLimiter } from "../Security/httpSecurity.js";
import { readLootBridgeSnapshot } from "./lootBridge.js";
import { lootCatalogRevisionInDatabase, lootSlotsByInstanceInDatabase, readLootChanges, readLootDungeonInDatabase, readLootDungeons, searchLootItemsInDatabase } from "./lootCatalogRepository.js";
import { importWishlist } from "./wishlistImport.js";
import { readPlanningPrompt } from "./wishlistPrompt.js";
import { deleteWishlistItem, ownedCharacterInDatabase, patchWishlistItem, putWishlistItem, readWishlist, readWishlistSummary, wishlistItemKeysInDatabase } from "./wishlistRepository.js";

const WRITE_CODES = { invalid: 400, "not-found": 404, full: 409, "unknown-item": 422 };

// The dungeon list: the observed loot catalog with the static atlas joined
// in. The catalog and its item slots only enrich the atlas, so when either
// cannot be read the atlas list is still served, the error is logged, and
// `degraded` names what is missing. The atlas itself failing still throws.
export function readDungeonList({ readCatalog = readLootDungeons, readSlots = () => withGuildDatabase((db) => lootSlotsByInstanceInDatabase(db)) } = {}) {
  const degraded = [];
  let catalog = { schemaVersion: 1, revision: 0, dungeons: [] };
  try {
    catalog = readCatalog();
  } catch (error) {
    console.error("Unable to read the loot catalog; serving the dungeon atlas without it", error);
    degraded.push("catalog");
  }
  let slots = new Map();
  try {
    slots = readSlots();
  } catch (error) {
    console.error("Unable to read loot slots; serving the dungeon atlas without them", error);
    degraded.push("lootSlots");
  }
  const list = withAtlasList(catalog, slots);
  return degraded.length ? { ...list, degraded } : list;
}

// Routes of the signed-in player's workspace (mounted inside /api/player,
// after its sign-in check). The catalog is shared and names no one; a
// wishlist is read and written only for a character of the session's own
// account, and anyone else's character answers 404 like a missing one.
export function createPlayerLootRouter() {
  const router = Router();
  const owner = (req) => req.auth.user.id;

  function read(name, fn) {
    return (req, res) => {
      try {
        const result = fn(req);
        if (result === null) {
          res.status(404).json({ error: `${name}_not_found` });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error(`Unable to read ${name}`, error);
        res.status(500).json({ error: `${name}_unavailable` });
      }
    };
  }

  function write(name, fn) {
    return (req, res) => {
      try {
        const result = fn(req);
        const code = WRITE_CODES[result.status];
        if (code) {
          res.status(code).json({ error: `wishlist_${result.status.replace("-", "_")}` });
          return;
        }
        publishPlayerChanged(owner(req), `player.wishlist.${name}`);
        res.json(result);
      } catch (error) {
        console.error(`Unable to ${name} wishlist item`, error);
        res.status(500).json({ error: "wishlist_failed" });
      }
    };
  }

  // The item keys on the wishlist of ?character=, when it is the caller's.
  const wishlisted = (db, req) => {
    const character = req.query?.character ? ownedCharacterInDatabase(db, owner(req), req.query.character) : null;
    return character ? wishlistItemKeysInDatabase(db, owner(req), character.id) : new Set();
  };

  // Each dungeon also carries `atlas` (docs/dungeon-atlas-contract.md).
  router.get("/loot/dungeons", read("loot_dungeons", () => readDungeonList()));
  router.get("/loot/dungeons/:instanceId", read("loot_dungeon", (req) => withGuildDatabase((db) =>
    withAtlasDetail(readLootDungeonInDatabase(db, req.params.instanceId, { wishlisted: wishlisted(db, req) }), req.params.instanceId,
      lootCatalogRevisionInDatabase(db)))));
  router.get("/loot/items", read("loot_items", (req) => withGuildDatabase((db) =>
    searchLootItemsInDatabase(db, { q: String(req.query?.q ?? "").slice(0, 80), wishlisted: wishlisted(db, req) }))));
  router.get("/loot/changes", read("loot_changes", (req) => readLootChanges({ limit: req.query?.limit })));

  router.get("/wishlists", read("wishlists", (req) => readWishlistSummary({ memberId: owner(req) })));
  router.get("/wishlists/:characterId", read("wishlist", (req) => readWishlist({ memberId: owner(req), characterId: req.params.characterId })));
  router.put("/wishlists/:characterId/items/:itemKey", write("add", (req) => putWishlistItem({ memberId: owner(req), characterId: req.params.characterId,
    itemKey: req.params.itemKey, priority: req.body?.priority, note: req.body?.note, sourceDungeon: req.body?.sourceDungeon, sourceInstanceId: req.body?.sourceInstanceId })));
  router.patch("/wishlists/:characterId/items/:itemKey", write("update", (req) => patchWishlistItem({ memberId: owner(req), characterId: req.params.characterId,
    itemKey: req.params.itemKey, priority: req.body?.priority, note: req.body?.note, sourceDungeon: req.body?.sourceDungeon, sourceInstanceId: req.body?.sourceInstanceId,
    state: req.body?.state, move: req.body?.move })));
  router.delete("/wishlists/:characterId/items/:itemKey", write("remove", (req) => deleteWishlistItem({ memberId: owner(req), characterId: req.params.characterId,
    itemKey: req.params.itemKey })));

  // The prompt to paste into an AI. ?dungeons=36,48 narrows the catalog.
  router.get("/wishlists/:characterId/ai-prompt", read("wishlist_prompt", (req) => readPlanningPrompt({ memberId: owner(req), characterId: req.params.characterId,
    instanceIds: String(req.query?.dungeons || "").split(",").filter(Boolean).slice(0, 40) })));

  // Checks pasted JSON (commit: false) or applies it (commit: true). A
  // list with errors answers 422 with every error and a repair prompt, and
  // changes nothing.
  router.post("/wishlists/:characterId/import", (req, res) => {
    try {
      const result = importWishlist({ memberId: owner(req), characterId: req.params.characterId, text: req.body?.text, commit: req.body?.commit === true,
        skipInvalid: req.body?.skipInvalid === true, updateExisting: req.body?.updateExisting === true });
      if (result.status === "not-found") {
        res.status(404).json({ error: "wishlist_not_found" });
        return;
      }
      if (result.status === "imported") publishPlayerChanged(owner(req), "player.wishlist.import");
      res.status(result.status === "rejected" ? 422 : 200).json(result);
    } catch (error) {
      console.error("Unable to import wishlist", error);
      res.status(500).json({ error: "wishlist_import_failed" });
    }
  });

  return router;
}

function bearerToken(req) {
  const match = String(req.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

// Mounted at /api/bridge: the paired device's own account, never a
// parameter. If-None-Match with the last digest answers 304 with no body.
export function createLootBridgeRouter() {
  const router = Router();
  const rateLimit = createRateLimiter({ name: "guildweaver-loot-read", windowMs: 10 * 60 * 1000, max: 600 });
  router.get("/loot/snapshot", rateLimit, (req, res) => {
    let device;
    try {
      device = authenticateGuildweaverDevice(bearerToken(req));
    } catch (error) {
      console.error("Unable to authenticate Guildweaver loot device", error);
      res.status(503).json({ error: "guildweaver_device_auth_unavailable" });
      return;
    }
    if (!device) {
      res.status(401).json({ error: "invalid_device_token" });
      return;
    }
    try {
      const snapshot = readLootBridgeSnapshot(device.memberId);
      const etag = `"${snapshot.digest}"`;
      res.set("Cache-Control", "no-store");
      res.set("ETag", etag);
      if (String(req.get("If-None-Match") || "").trim() === etag) {
        res.status(304).end();
        return;
      }
      res.json(snapshot);
    } catch (error) {
      console.error("Unable to build Guildweaver loot snapshot", error);
      res.status(500).json({ error: "guildweaver_loot_unavailable" });
    }
  });
  return router;
}
