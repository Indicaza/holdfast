import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { searchCraftFinderWithSkill } from "./craftFinderRepository.js";
import {
  readCharacterArmory,
  readIntelligenceSummary,
  searchRecipes,
} from "./telemetryProjection.js";

export function createIntelligenceRouter() {
  const router = Router();

  router.get("/", requireAuthenticated, (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readIntelligenceSummary());
    } catch (error) {
      console.error("Unable to read guild intelligence", error);
      res.status(500).json({ error: "intelligence_unavailable" });
    }
  });

  router.get("/characters/:characterId", requireAuthenticated, (req, res) => {
    try {
      const armory = readCharacterArmory(req.params.characterId);
      if (!armory) {
        res.status(404).json({ error: "character_not_found" });
        return;
      }
      res.set("Cache-Control", "no-store");
      res.json(armory);
    } catch (error) {
      console.error("Unable to read character armory", error);
      res.status(500).json({ error: "character_armory_unavailable" });
    }
  });

  router.get("/recipes", requireAuthenticated, (req, res) => {
    try {
      const recipes = searchRecipes(req.query?.q || "", { limit: req.query?.limit });
      res.set("Cache-Control", "no-store");
      res.json({ recipes });
    } catch (error) {
      console.error("Unable to search recipes", error);
      res.status(500).json({ error: "recipe_search_unavailable" });
    }
  });

  router.get("/craft-finder", requireAuthenticated, (req, res) => {
    try {
      const results = searchCraftFinderWithSkill(req.query?.q || "");
      res.set("Cache-Control", "no-store");
      res.json({ results });
    } catch (error) {
      console.error("Unable to search craft finder", error);
      res.status(500).json({ error: "craft_finder_unavailable" });
    }
  });

  return router;
}
