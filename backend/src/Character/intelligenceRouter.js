import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { createBlizzardGameDataProvider } from "../GameData/blizzardGameDataProvider.js";
import { createBlizzardIconMediaResolver } from "../GameData/blizzardIconMedia.js";
import { resolveGameDataBundle } from "../GameData/gameDataCatalog.js";
import { sanitizeArmoryPayload } from "./armorySanitizer.js";
import { adaptArmoryV3 } from "./armoryV3Adapter.js";
import { decorateArmoryTalentArt } from "./talentArmoryArt.js";
import { searchCraftFinderWithSkill } from "./craftFinderRepository.js";
import { readSyncedIntelligenceSummary } from "./intelligenceSummaryRepository.js";
import {
  readCharacterArmory,
  searchRecipes,
} from "./telemetryProjection.js";

const ARMORY_HYDRATION_BUDGET_MS = 1500;

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

function safeStatus(source) {
  try {
    return source?.status?.() || {};
  } catch {
    return {};
  }
}

function applyArmoryStage(armory, label, transform) {
  try {
    return transform(armory) || armory;
  } catch (error) {
    console.warn(`Unable to ${label}`, error?.message || error);
    return armory;
  }
}

async function hydrateSafely(provider, references, options, deadlineMs = ARMORY_HYDRATION_BUDGET_MS) {
  let timer = null;
  const fallback = (extra = {}) => ({
    ...safeStatus(provider),
    attempted: 0,
    hydrated: 0,
    failed: 0,
    ...extra,
  });

  try {
    const hydration = Promise.resolve().then(() => provider.hydrateReferences(references, options));
    const budget = Math.max(1, Number(deadlineMs) || ARMORY_HYDRATION_BUDGET_MS);
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback({ pending: true })), budget);
    });
    return await Promise.race([hydration, deadline]);
  } catch (error) {
    console.warn("Unable to hydrate Blizzard game data", error?.message || error);
    return fallback({ failed: 1 });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveGameDataSafely(resolver, references, options) {
  try {
    return resolver(references, options) || {};
  } catch (error) {
    console.warn("Unable to resolve cached game data", error?.message || error);
    return {};
  }
}

export async function prepareCharacterArmory(storedArmory, {
  provider,
  icons,
  armoryAdapter = adaptArmoryV3,
  talentArtDecorator = decorateArmoryTalentArt,
  gameDataResolver = resolveGameDataBundle,
  hydrationDeadlineMs = ARMORY_HYDRATION_BUDGET_MS,
} = {}) {
  let armory = applyArmoryStage(storedArmory, "adapt character armory", armoryAdapter);
  armory = applyArmoryStage(armory, "decorate character talents", talentArtDecorator);

  const references = armoryReferences(armory);
  const gameBuild = armoryBuildKey(armory);
  const providerStatus = provider
    ? await hydrateSafely(provider, references, { gameBuild }, hydrationDeadlineMs)
    : {};
  const gameData = resolveGameDataSafely(gameDataResolver, references, { gameBuild });

  return sanitizeArmoryPayload({
    ...armory,
    gameData: {
      ...gameData,
      provider: providerStatus,
      iconMedia: safeStatus(icons),
    },
  });
}

export function createIntelligenceRouter({ gameDataProvider, iconMediaResolver } = {}) {
  const router = Router();
  const provider = gameDataProvider || createBlizzardGameDataProvider();
  const icons = iconMediaResolver || createBlizzardIconMediaResolver();

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
      const storedArmory = readCharacterArmory(req.params.characterId);
      if (!storedArmory) {
        res.status(404).json({ error: "character_not_found" });
        return;
      }

      const armory = await prepareCharacterArmory(storedArmory, { provider, icons });
      res.set("Cache-Control", "no-store");
      res.json(armory);
    } catch (error) {
      console.error("Unable to read character armory", error);
      res.status(500).json({ error: "character_armory_unavailable" });
    }
  });

  router.get("/media/icon/:fileDataId", requireAuthenticated, async (req, res) => {
    try {
      const fileDataId = Number(req.params.fileDataId);
      if (!Number.isInteger(fileDataId) || fileDataId < 1) {
        res.status(400).json({ error: "invalid_icon_file_data_id" });
        return;
      }

      const mediaUrl = await icons.resolve(fileDataId);
      if (!mediaUrl) {
        res.status(404).json({ error: "icon_media_not_found" });
        return;
      }

      res.set("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
      res.redirect(302, mediaUrl);
    } catch (error) {
      console.warn("Unable to resolve Blizzard icon media", error?.message || error);
      res.status(404).json({ error: "icon_media_not_found" });
    }
  });

  router.get("/game-data/provider", requireAuthenticated, (req, res) => {
    res.set("Cache-Control", "private, max-age=60");
    res.json({ ...safeStatus(provider), iconMedia: safeStatus(icons) });
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
      res.json({ ...gameData, provider: safeStatus(provider) });
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
