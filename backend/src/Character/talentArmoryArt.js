function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maxLength = 256) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function textureDescriptor(value) {
  const source = object(value);
  const path = text(source.path, 320);
  const fileDataId = positiveInteger(source.fileDataId ?? source.fileDataID);
  if (!path && !fileDataId) return null;
  return { path, fileDataId };
}

function backgroundTextures(value) {
  const source = object(value);
  const result = {
    topLeft: textureDescriptor(source.topLeft),
    topRight: textureDescriptor(source.topRight),
    bottomLeft: textureDescriptor(source.bottomLeft),
    bottomRight: textureDescriptor(source.bottomRight),
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function normalizeTalentTab(value) {
  const source = object(value);
  const id = number(source.id);
  const index = number(source.index);
  const name = text(source.name, 96);
  const background = text(source.background, 128);
  if (id === null && index === null && !name && !background) return null;

  return {
    id,
    index,
    name,
    description: text(source.description, 1000),
    iconFileDataId: positiveInteger(source.iconFileDataId ?? source.iconFileID),
    pointsSpent: number(source.pointsSpent),
    previewPointsSpent: number(source.previewPointsSpent),
    isUnlocked: typeof source.isUnlocked === "boolean" ? source.isUnlocked : null,
    background,
    backgroundTextures: backgroundTextures(source.backgroundTextures),
  };
}

function normalizeSpecialization(value) {
  const source = object(value);
  if (!Object.keys(source).length) return null;
  return {
    id: number(source.id),
    index: number(source.index),
    name: text(source.name, 96),
    description: text(source.description, 1000),
    iconFileDataId: positiveInteger(source.iconFileDataId ?? source.iconFileID),
    background: text(source.background, 128),
    role: text(source.role, 48),
    pointsSpent: number(source.pointsSpent),
  };
}

function normalizeTreeArt(value) {
  const source = object(value);
  if (!Object.keys(source).length) return null;
  return {
    treeId: number(source.treeId),
    uiTextureKit: text(source.uiTextureKit, 128),
    titleText: text(source.titleText, 160),
    hideSingleRankNumbers: typeof source.hideSingleRankNumbers === "boolean" ? source.hideSingleRankNumbers : null,
    cannotRefund: typeof source.cannotRefund === "boolean" ? source.cannotRefund : null,
  };
}

export function normalizeTalentDefinitionArt(value) {
  const source = object(value);
  const art = object(source.art);
  const tabs = array(art.talentTabs).slice(0, 12).map(normalizeTalentTab).filter(Boolean);
  const specialization = normalizeSpecialization(art.specialization);
  const tree = normalizeTreeArt(art.tree);
  const treeId = number(source.treeId);
  const treeHash = text(source.treeHash, 128);

  if (treeId === null && !treeHash && !tabs.length && !specialization && !tree) return null;

  return {
    schemaVersion: number(source.schemaVersion),
    treeId,
    treeHash,
    locale: text(source.locale, 24),
    name: text(source.name, 160),
    iconFileDataId: positiveInteger(source.iconFileDataId ?? source.iconFileID),
    metadata: {
      status: text(source.metadata?.status, 32),
      entryCount: number(source.metadata?.entryCount),
      incompleteEntryCount: number(source.metadata?.incompleteEntryCount),
    },
    art: {
      schemaVersion: number(art.schemaVersion),
      specialization,
      talentTabs: tabs,
      tree,
    },
  };
}

// Adds tree art and definitions to an armory's talents from normalized
// definitions (normalizeTalentDefinitionArt).
export function applyTalentArt(armory, definitions) {
  if (!armory?.talents || !definitions?.length) return armory;
  const primary = definitions.find((definition) => definition.art?.talentTabs?.length) || definitions[0];
  return {
    ...armory,
    talents: {
      ...armory.talents,
      treeDefinitions: definitions,
      treeHashes: definitions.map(({ treeId, treeHash }) => ({ treeId, treeHash })).filter((entry) => entry.treeHash),
      art: primary?.art || null,
    },
  };
}

