import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { createBlizzardGameDataProvider } from "../GameData/blizzardGameDataProvider.js";
import { resolveGameDataBundle } from "../GameData/gameDataCatalog.js";
import { sanitizeArmoryPayload } from "./armorySanitizer.js";
import { searchCraftFinderWithSkill } from "./craftFinderRepository.js";
import { readSyncedIntelligenceSummary } from "./intelligenceSummaryRepository.js";
import {
  readCharacterArmory,
  searchRecipes,
} from "./telemetryProjection.js";

function referenceIds(values) {
  return [...new Set(values.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0).map((value) => Number(value)))];
}

function armoryReferences(armory) {
  const equipment = Array.isArray(armory?.equipment) ? armory.equipment : [];
  const professions = Array.isArray(armory?.professions) ? armory.professions : [];
  const recipes = Array.isArray(armory?.recipes) ? armory.recipes : [];
  const talentNodes = Array.isArray(armory?.talents?.nodes) ? armory.talents.nodes : [];

  return {
    items: referenceIds([
      ...equipment.map((item) => item?.itemId),
      ...recipes.map((recipe) => recipe?.craftedItemId),
      ...recipes.flatMap((recipe) => (Array.isArray(recipe?.reagents) ? recipe.reagents : []).map((reagent) => reagent?.itemId)),
    ]),
    spells: referenceIds(
      talentNodes.flatMap((node) => (Array.isArray(node?.entries) ? node.entries : []).map((entry) => entry?.spellId)),
    ),
    recipes: referenceIds(recipes.map((recipe) => recipe?.id)),
    professions: referenceIds(professions.map((profession) => profession?.id)),
  };
}

function armoryBuildKey(armory) {
  const label = String(armory?.character?.gameBuild || "").trim();
  return label.match(/\bbuild\s+([^·\s]+)/i)?.[1] || label;
}

async function hydrateSafely(provider, references, options) {
  try {
    return await provider.hydrateReferences(references, options);
  } catch (error) {
    console.warn("Unable to hydrate Blizzard game data", error?.message || error);
    return { ...provider.status(), attempted: 0, hydrated: 0, failed: 1 };
  }
}

export function createIntelligenceRouter({ gameDataProvider } = {}) {
  const router = Router();
  const provider = gameDataProvider || createBlizzardGameDataProvider();

  router.get("/", requireAuthenticated, (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(readSyncedIntelligenceSummary());
    } catch (error) {
      console.error("Unable to read guild intelligence", error);
      res.status(500).json({ error: "intelligence_unavailable" });
    }
  });

  router.get("/characters/:characterId", requireAuthenticated, async (req, res) => {
    try {
      const armory = readCharacterArmory(req.params.characterId);
      if (!armory) {
        res.status(404).json({ error: "character_not_found" });
        return;
      }

      const references = armoryReferences(armory);
      const gameBuild = armoryBuildKey(armory);
      const providerStatus = await hydrateSafely(provider, references, { gameBuild });
      const gameData = resolveGameDataBundle(references, { gameBuild });

      res.set("Cache-Control", "no-store");
      res.json(sanitizeArmoryPayload({
        ...armory,
        gameData: { ...gameData, provider: providerStatus },
      }));
    } catch (error) {
      console.error("Unable to read character armory", error);
      res.status(500).json({ error: "character_armory_unavailable" });
    }
  });

  router.get("/game-data/provider", requireAuthenticated, (req, res) => {
    res.set("Cache-Control", "private, max-age=60");
    res.json(provider.status());
  });

  router.post("/game-data/resolve", requireAuthenticated, (req, res) => {
    try {
      const references = req.body?.references && typeof req.body.references === "object"
        ? req.body.references
        : {};
      const gameData = resolveGameDataBundle(references, {
        gameBuild: req.body?.gameBuild,
        locale: req.body?.locale,
      });
      res.set("Cache-Control", "private, max-age=300");
      res.json({ ...gameData, provider: provider.status() });
    } catch (error) {
      console.error("Unable to resolve game data", error);
      res.status(500).json({ error: "game_data_unavailable" });
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
