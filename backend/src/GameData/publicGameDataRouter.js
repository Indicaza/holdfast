import { withGuildDatabase } from "../Data/database.js";
import { createBlizzardIconMediaResolver } from "./blizzardIconMedia.js";
import express from "express";
import { gameInteger } from "./publicGameDataModel.js";
import { publicGameScopes, readPublicItem, searchPublicItems } from "./publicGameDataRepository.js";

function scope(query) {
  if (typeof query.build !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(query.build)) return null;
  if (typeof query.locale !== "string" || !/^(?:[a-z]{2}_[A-Z]{2}|und)$/.test(query.locale)) return null;
  return { gameBuild: query.build, locale: query.locale };
}

export function createPublicGameDataRouter({ iconMediaResolver } = {}) {
  const icons = iconMediaResolver || createBlizzardIconMediaResolver();
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    next();
  });
  router.get("/icons/:fileDataId", async (req, res) => {
    const id = /^\d+$/.test(req.params.fileDataId) ? gameInteger(req.params.fileDataId, 1) : null;
    if (!id) { res.status(400).json({ error: "invalid_icon_file_data_id" }); return; }
    const observed = withGuildDatabase((db) => db.prepare("SELECT 1 FROM public_game_items WHERE icon_file_id = ? LIMIT 1").get(id));
    if (!observed) { res.status(404).json({ error: "icon_not_observed" }); return; }
    try {
      const url = await icons.resolve(id);
      if (!url) { res.status(404).json({ error: "icon_media_not_found" }); return; }
      res.set("Cache-Control", "public, max-age=3600");
      res.redirect(302, url);
    } catch {
      res.status(404).json({ error: "icon_media_not_found" });
    }
  });
  router.get("/scopes", (req, res) => res.json(publicGameScopes()));
  router.get("/items", (req, res) => {
    const context = scope(req.query);
    const after = req.query.after === undefined ? 0 : gameInteger(req.query.after);
    const limit = req.query.limit === undefined ? 40 : gameInteger(req.query.limit, 1, 100);
    const q = req.query.q === undefined ? "" : req.query.q;
    if (!context || after === null || limit === null || typeof q !== "string" || q.length > 100) {
      res.status(400).json({ error: "invalid_catalog_query" }); return;
    }
    res.json(searchPublicItems({ ...context, after, limit, q: q.trim() }));
  });
  router.get("/items/:itemId", (req, res) => {
    const context = scope(req.query);
    const itemId = /^\d+$/.test(req.params.itemId) ? gameInteger(req.params.itemId, 1) : null;
    if (!context || !itemId) { res.status(400).json({ error: "invalid_catalog_query" }); return; }
    const result = readPublicItem(itemId, context);
    if (!result) { res.status(404).json({ error: "item_not_observed" }); return; }
    res.json(result);
  });
  return router;
}
