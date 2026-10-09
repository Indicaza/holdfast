import { readLatestTelemetryState } from "./Telemetry/telemetryStateRepository.js";

// Uses the latest profession_snapshot telemetry for a character's armory
// professions and recipes. Keeps the fields the current profession/recipe UI
// reads and adds the richer recipe data (crafted item, reagents with names and
// icons, difficulty, cooldown, description) for the upcoming modal views.

function latestProfessionState(characterId) {
  const states = readLatestTelemetryState({ characterId, eventType: "profession_snapshot" });
  return states
    .filter((state) => Array.isArray(state?.payload?.professions))
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))[0] || null;
}

function armoryProfession(profession) {
  return {
    key: profession.key,
    id: profession.skillLineId,
    skillLineId: profession.skillLineId,
    name: profession.name,
    skillLineName: profession.skillLineName,
    kind: profession.kind,
    iconFileId: profession.iconFileDataId,
    iconFileDataId: profession.iconFileDataId,
    current: profession.skillLevel ?? 0,
    max: profession.maxSkillLevel ?? 0,
    modifier: profession.skillModifier ?? 0,
    specialization: profession.specialization,
    recipeBook: profession.recipeBook,
  };
}

function armoryRecipe(recipe, profession) {
  return {
    key: recipe.key,
    id: recipe.recipeId,
    recipeId: recipe.recipeId,
    spellId: recipe.spellId,
    name: recipe.name,
    subName: recipe.subName,
    iconFileId: recipe.iconFileDataId,
    recipeLink: recipe.recipeLink,
    spellLink: recipe.spellLink,
    tooltip: recipe.tooltip,
    professionKey: profession.key,
    professionId: recipe.professionSkillLineId ?? profession.skillLineId,
    professionName: profession.name,
    known: recipe.known ?? true,
    craftable: recipe.craftable,
    difficulty: recipe.difficulty,
    skillUps: recipe.skillUps,
    maxTrivialLevel: recipe.maxTrivialLevel,
    unlockedRecipeLevel: recipe.unlockedRecipeLevel,
    trainingPointCost: recipe.trainingPointCost,
    requiredLevel: recipe.requiredLevel,
    requiredSkill: null,
    requirements: null,
    description: recipe.description,
    tools: recipe.tools,
    cooldown: recipe.cooldown,
    crafted: recipe.crafted,
    craftedItemId: recipe.crafted?.itemId ?? null,
    craftedItemName: recipe.crafted?.name ?? "",
    reagents: (Array.isArray(recipe.reagents) ? recipe.reagents : []).map((reagent) => ({
      itemId: reagent.itemId,
      currencyId: reagent.currencyId,
      name: reagent.name || "",
      iconFileId: reagent.iconFileDataId,
      itemLink: reagent.itemLink,
      qualityId: reagent.qualityId,
      quantity: reagent.quantity ?? 0,
      slotIndex: reagent.slotIndex,
      required: reagent.required,
    })),
  };
}

export function applyProfessionTelemetry(armory, state) {
  const professions = Array.isArray(state?.payload?.professions) ? state.payload.professions : [];
  if (!professions.length) return armory;

  const professionsWithBooks = new Set(professions.filter((entry) => entry.recipeBook).map((entry) => entry.key));
  const telemetryRecipes = professions.flatMap((profession) =>
    (Array.isArray(profession.recipes) ? profession.recipes : [])
      .filter((recipe) => recipe?.known !== false)
      .map((recipe) => armoryRecipe(recipe, profession)),
  );
  // Professions whose window has not been opened since this telemetry existed
  // keep any recipes the older character snapshot carried. Unknown recipes are
  // intentionally retained in raw telemetry but omitted from the armory view.
  const legacyRecipes = (Array.isArray(armory.recipes) ? armory.recipes : []).filter(
    (recipe) => recipe?.known !== false && !professionsWithBooks.has(recipe?.professionKey),
  );

  return {
    ...armory,
    professions: professions.map(armoryProfession),
    recipes: [...telemetryRecipes, ...legacyRecipes],
    professionTelemetry: {
      eventType: "profession_snapshot",
      revision: state.revision,
      capturedAt: state.capturedAt,
      receivedAt: state.receivedAt,
      modelVersion: state.payload.modelVersion ?? null,
    },
  };
}

export function decorateArmoryProfessions(armory) {
  const characterId = armory?.character?.id;
  if (!characterId) return armory;
  return applyProfessionTelemetry(armory, latestProfessionState(characterId));
}
