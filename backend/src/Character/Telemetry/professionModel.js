// Canonical profession model for profession_snapshot telemetry (payload
// schema 1). The raw envelope is preserved separately for debugging; this is
// the stable, bounded shape the website reads (e.g. the character modal's
// profession views). Unknown or malformed values become null rather than
// being guessed at.

export const PROFESSION_MODEL_VERSION = 1;

const MAX_PROFESSIONS = 16;
const MAX_RECIPES = 800;
const MAX_REAGENTS = 16;
const MAX_TOOLS = 8;
const MAX_TOOLTIP_LINES = 40;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, maxLength = 160) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().slice(0, maxLength);
  return normalized || null;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value) {
  return typeof value === "boolean" ? value : null;
}

function color(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const channel of ["r", "g", "b", "a"]) {
    const parsed = number(value[channel]);
    if (parsed !== null) result[channel] = parsed;
  }
  return Object.keys(result).length ? result : null;
}

function tooltip(value) {
  if (!isObject(value)) return null;
  const lines = array(value.lines)
    .slice(0, MAX_TOOLTIP_LINES)
    .filter(isObject)
    .map((line) => ({
      left: text(line.left, 320),
      right: text(line.right, 320),
      leftColor: color(line.leftColor),
      rightColor: color(line.rightColor),
    }))
    .filter((line) => line.left || line.right);
  return lines.length ? { source: text(value.source, 64), lines } : null;
}

function item(value) {
  if (!isObject(value)) return null;
  const itemId = number(value.itemId);
  const name = text(value.name);
  if (itemId === null && !name) return null;
  return {
    itemId,
    itemLink: text(value.itemLink, 2000),
    name,
    iconFileDataId: number(value.iconFileDataId),
    qualityId: number(value.qualityId),
    itemLevel: number(value.itemLevel),
    requiredLevel: number(value.requiredLevel),
  };
}

function craftedItem(value) {
  const base = item(value);
  if (!base) return null;
  return {
    ...base,
    minQuantity: number(value.minQuantity),
    maxQuantity: number(value.maxQuantity),
    tooltip: tooltip(value.tooltip),
  };
}

function reagent(value) {
  const base = item(value);
  const currencyId = number(value?.currencyId);
  if (!base && currencyId === null) return null;
  return {
    ...(base || { itemId: null, itemLink: null, name: null, iconFileDataId: null, qualityId: null, itemLevel: null, requiredLevel: null }),
    currencyId,
    quantity: number(value.quantity),
    required: boolean(value.required),
    slotIndex: number(value.slotIndex),
  };
}

function cooldown(value) {
  if (!isObject(value)) return null;
  const result = {
    readyAt: number(value.readyAt),
    isDayCooldown: boolean(value.isDayCooldown),
    charges: number(value.charges),
    maxCharges: number(value.maxCharges),
  };
  return Object.values(result).some((entry) => entry !== null) ? result : null;
}

function recipe(value, professionKey) {
  if (!isObject(value)) return null;
  const recipeId = number(value.recipeId);
  const name = text(value.name);
  if (recipeId === null && !name) return null;
  return {
    key: recipeId !== null ? `id:${recipeId}` : `name:${name.toLowerCase()}`,
    professionKey,
    recipeId,
    spellId: number(value.spellId),
    name,
    subName: text(value.subName),
    iconFileDataId: number(value.iconFileDataId),
    recipeLink: text(value.recipeLink, 2000),
    known: value.known === undefined ? null : Boolean(value.known),
    craftable: boolean(value.craftable),
    disabled: boolean(value.disabled),
    difficulty: text(value.difficulty, 24),
    relativeDifficulty: number(value.relativeDifficulty),
    skillUps: number(value.skillUps),
    maxTrivialLevel: number(value.maxTrivialLevel),
    unlockedRecipeLevel: number(value.unlockedRecipeLevel),
    skillLineAbilityId: number(value.skillLineAbilityId),
    professionSkillLineId: number(value.professionSkillLineId),
    categoryId: number(value.categoryId),
    trainingPointCost: number(value.trainingPointCost),
    requiredLevel: number(value.requiredLevel),
    description: text(value.description, 2000),
    tools: array(value.tools)
      .slice(0, MAX_TOOLS)
      .filter(isObject)
      .map((tool) => ({ name: text(tool.name), available: boolean(tool.available) }))
      .filter((tool) => tool.name),
    cooldown: cooldown(value.cooldown),
    crafted: craftedItem(value.crafted),
    reagents: array(value.reagents).slice(0, MAX_REAGENTS).map(reagent).filter(Boolean),
  };
}

function specialization(value) {
  if (!isObject(value)) return null;
  const result = {
    configId: number(value.configId),
    name: text(value.name),
    treeIds: array(value.treeIds).map(number).filter((entry) => entry !== null),
  };
  return result.configId !== null || result.name || result.treeIds.length ? result : null;
}

function profession(value) {
  if (!isObject(value)) return null;
  const skillLineId = number(value.skillLineId);
  const name = text(value.name, 96);
  if (skillLineId === null && !name) return null;
  const key = skillLineId !== null ? `id:${skillLineId}` : `name:${name.toLowerCase()}`;
  const book = isObject(value.recipeBook) ? value.recipeBook : null;
  const recipes = array(value.recipes).slice(0, MAX_RECIPES).map((entry) => recipe(entry, key)).filter(Boolean);
  return {
    key,
    skillLineId,
    name,
    skillLineName: text(value.skillLineName, 96),
    kind: text(value.kind, 32),
    iconFileDataId: number(value.iconFileDataId),
    skillLevel: number(value.skillLevel),
    maxSkillLevel: number(value.maxSkillLevel),
    skillModifier: number(value.skillModifier),
    specializationIndex: number(value.specializationIndex),
    specialization: specialization(value.specialization),
    recipeBook: book
      ? {
          source: text(book.source, 48),
          capturedAt: number(book.capturedAt),
          recipeCount: number(book.recipeCount) ?? recipes.length,
          knownCount: number(book.knownCount) ?? recipes.filter((entry) => entry.known).length,
        }
      : null,
    recipes,
  };
}

export function isProfessionSnapshotPayload(payload) {
  if (!isObject(payload) || !Array.isArray(payload.professions)) return false;
  return payload.professions.every(
    (entry) => isObject(entry) && (entry.recipes === undefined || entry.recipes === null || Array.isArray(entry.recipes)),
  );
}

export function canonicalProfessionSnapshot(payload) {
  const professions = array(payload?.professions).slice(0, MAX_PROFESSIONS).map(profession).filter(Boolean);
  return {
    modelVersion: PROFESSION_MODEL_VERSION,
    payloadSchemaVersion: number(payload?.schemaVersion) ?? 1,
    professions,
  };
}
