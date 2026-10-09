import { withGuildDatabase } from "../Data/database.js";
import { ensureTelemetryRecordSchema } from "./telemetryRecordRepository.js";
import { parseTelemetryJson } from "./Telemetry/telemetryJson.js";

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function latestSnapshotPayload(db, characterId) {
  const projected = db.prepare(`
    SELECT s.payload_json
    FROM telemetry_characters t
    LEFT JOIN character_snapshots s ON s.id = t.latest_snapshot_id
    WHERE t.character_id = ?
    LIMIT 1
  `).get(characterId)?.payload_json;

  if (projected) return parseJson(projected);

  const latest = db.prepare(`
    SELECT payload_json
    FROM character_snapshots
    WHERE character_id = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `).get(characterId)?.payload_json;
  return parseJson(latest);
}

function normalizeEquipmentItem(raw) {
  const itemClass = object(raw?.itemClass);
  const itemSubclass = object(raw?.itemSubclass);
  const tooltip = object(raw?.tooltip);
  const enchantId = number(raw?.enchantId);
  const gemIds = array(raw?.gemItemIds).map((value) => number(value)).filter(Number.isFinite);
  const bonusIds = array(raw?.bonusIds).map((value) => number(value)).filter(Number.isFinite);

  return {
    slot: text(raw?.slot, 64),
    slotId: number(raw?.slotId),
    itemId: number(raw?.itemId),
    itemLink: text(raw?.itemLink, 2000),
    itemString: text(raw?.rawItemString, 2000),
    rawItemString: text(raw?.rawItemString, 2000),
    name: text(raw?.name, 160),
    quality: number(raw?.qualityId),
    qualityId: number(raw?.qualityId),
    itemLevel: number(raw?.itemLevel),
    requiredLevel: number(raw?.requiredLevel),
    iconFileId: number(raw?.iconFileDataId),
    iconFileDataId: number(raw?.iconFileDataId),
    enchantId,
    enchant: enchantId ? { id: enchantId } : null,
    gemIds,
    gemItemIds: gemIds,
    bonusIds,
    suffixId: number(raw?.suffixId),
    linkLevel: number(raw?.linkLevel),
    specializationId: number(raw?.specializationId),
    upgradeTypeId: number(raw?.upgradeTypeId),
    instanceDifficultyId: number(raw?.instanceDifficultyId),
    itemClass,
    itemClassId: number(itemClass.id),
    itemClassName: text(itemClass.name, 120),
    classId: number(itemClass.id),
    class: text(itemClass.name, 120),
    itemSubclass,
    itemSubclassId: number(itemSubclass.id),
    itemSubclassName: text(itemSubclass.name, 120),
    subclassId: number(itemSubclass.id),
    subclass: text(itemSubclass.name, 120),
    equipLocation: text(raw?.equipLocation, 96),
    bindType: number(raw?.bindType),
    expansionId: number(raw?.expansionId),
    setId: number(raw?.setId),
    stackCount: number(raw?.stackCount),
    sellPrice: number(raw?.sellPrice),
    isCraftingReagent: raw?.isCraftingReagent === undefined ? null : Boolean(raw.isCraftingReagent),
    stats: object(raw?.stats),
    durability: object(raw?.durability),
    spell: object(raw?.spell),
    tooltip,
    tooltipLines: array(tooltip.lines).map((line) => ({ ...object(line) })),
  };
}

function normalizeProfession(raw) {
  const id = number(raw?.skillLineId);
  return {
    key: id ? `id:${id}` : `name:${text(raw?.name, 96).toLowerCase()}`,
    id,
    skillLineId: id,
    name: text(raw?.name, 96),
    kind: text(raw?.kind, 48),
    iconFileId: number(raw?.iconFileDataId),
    iconFileDataId: number(raw?.iconFileDataId),
    current: number(raw?.skillLevel, 0),
    max: number(raw?.maxSkillLevel, 0),
    modifier: number(raw?.skillModifier, 0),
    specialization: raw?.specialization ?? null,
  };
}

function normalizeReagents(recipe) {
  const result = [];
  for (const slot of array(recipe?.reagents)) {
    for (const reagent of array(slot?.reagents)) {
      result.push({
        itemId: number(reagent?.itemId),
        currencyId: number(reagent?.currencyId),
        name: text(reagent?.name, 160),
        iconFileId: number(reagent?.iconFileDataId),
        quantity: number(reagent?.quantityRequired ?? slot?.quantityRequired, 0),
        slotIndex: number(slot?.slotIndex),
        required: slot?.required === undefined ? null : Boolean(slot.required),
      });
    }
  }
  return result;
}

function normalizeRecipes(snapshot) {
  const result = [];
  const seen = new Set();

  for (const profession of array(snapshot?.professions)) {
    const professionId = number(profession?.skillLineId);
    const professionName = text(profession?.name, 96);
    for (const recipe of array(profession?.recipes)) {
      const id = number(recipe?.recipeId);
      const key = id ? `id:${id}` : `name:${text(recipe?.name, 160).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        id,
        name: text(recipe?.name, 160),
        iconFileId: number(recipe?.iconFileDataId),
        professionKey: professionId ? `id:${professionId}` : `name:${professionName.toLowerCase()}`,
        professionId: number(recipe?.professionSkillLineId, professionId),
        professionName: text(recipe?.professionName, 96) || professionName,
        known: recipe?.known === undefined ? true : Boolean(recipe.known),
        requiredSkill: number(recipe?.requiredSkill),
        requirements: recipe?.requirements ?? null,
        craftedItemId: number(recipe?.craftedItemId),
        craftedItemName: text(recipe?.craftedItemName, 160),
        reagents: normalizeReagents(recipe),
      });
    }
  }

  return result;
}

function latestTalentDefinitions(db, memberId, treeIds) {
  ensureTelemetryRecordSchema(db);
  const wanted = new Set(treeIds);
  const found = new Map();
  const rows = db.prepare(`
    SELECT envelope_json
    FROM guildweaver_telemetry_records
    WHERE event_type = 'talent_tree_definition' AND member_id = ?
    ORDER BY received_at DESC, id DESC
  `).all(memberId);

  for (const row of rows) {
    const definition = object(parseTelemetryJson(row.envelope_json)?.payload);
    const treeId = number(definition.treeId);
    if (!wanted.has(treeId) || found.has(treeId)) continue;
    found.set(treeId, definition);
    if (found.size === wanted.size) break;
  }

  return treeIds.map((treeId) => found.get(treeId)).filter(Boolean);
}

function normalizeTalentConditions(value) {
  return array(value).map((condition) => ({
    id: number(condition?.id),
    type: condition?.type ?? null,
    isMet: optionalBoolean(condition?.isMet),
    isGate: optionalBoolean(condition?.isGate),
    isSufficient: optionalBoolean(condition?.isSufficient),
    ranksGranted: number(condition?.ranksGranted),
  }));
}

function normalizeTalents(db, armory, snapshot) {
  const state = object(snapshot?.talents);
  const treeIds = array(state.treeIds).map((value) => number(value)).filter(Number.isFinite);
  if (!treeIds.length) return armory.talents;

  const allocations = new Map(
    array(state.allocations)
      .map((allocation) => [number(allocation?.nodeId), allocation])
      .filter(([nodeId]) => Number.isFinite(nodeId)),
  );
  const nodeStates = new Map(
    array(state.nodeStates)
      .map((nodeState) => [number(nodeState?.nodeId), nodeState])
      .filter(([nodeId]) => Number.isFinite(nodeId)),
  );
  const definitions = latestTalentDefinitions(db, armory.character.memberId, treeIds);
  if (!definitions.length) {
    return {
      ...armory.talents,
      configId: number(state.configId),
      treeId: treeIds[0],
      treeIds,
      name: text(state.name, 96),
      pointsSpent: number(state.pointsSpent),
      pointsAvailable: number(state.pointsAvailable),
    };
  }

  const nodes = [];
  const edges = [];
  for (const definition of definitions) {
    const treeId = number(definition.treeId);
    for (const node of array(definition.nodes)) {
      const nodeId = number(node?.nodeId);
      const allocation = allocations.get(nodeId);
      const nodeState = object(nodeStates.get(nodeId));
      const rank = number(allocation?.rank ?? allocation?.ranksPurchased, 0);
      const activeEntryId = number(allocation?.activeEntryId);
      const activeEntryRank = number(allocation?.activeEntryRank, rank);
      const entries = array(node?.entries);
      const entryStates = new Map(
        array(nodeState.entries)
          .map((entryState) => [number(entryState?.entryId), entryState])
          .filter(([entryId]) => Number.isFinite(entryId)),
      );

      nodes.push({
        id: nodeId,
        treeId,
        x: number(node?.position?.x, 0),
        y: number(node?.position?.y, 0),
        type: text(node?.type, 48),
        rank,
        maxRank: number(node?.maxRanks, 0),
        selected: rank > 0,
        isAvailable: optionalBoolean(nodeState.isAvailable),
        isVisible: optionalBoolean(nodeState.isVisible),
        meetsEdgeRequirements: optionalBoolean(nodeState.meetsEdgeRequirements),
        conditions: normalizeTalentConditions(nodeState.conditions),
        entries: entries.map((entry) => {
          const entryId = number(entry?.entryId);
          const entryState = object(entryStates.get(entryId));
          const selected = activeEntryId === entryId || (activeEntryId === null && rank > 0 && entries.length === 1);
          const tooltip = object(entry?.tooltip);
          return {
            id: entryId,
            definitionId: number(entry?.definitionId),
            spellId: number(entry?.spellId),
            name: text(entry?.name, 160),
            iconFileId: number(entry?.iconFileDataId),
            description: text(entry?.description, 4000),
            spellLink: text(entry?.spellLink, 2000),
            tooltip,
            tooltipLines: array(tooltip.lines).map((line) => ({ ...object(line) })),
            isAvailable: optionalBoolean(entryState.isAvailable),
            isActiveEntry: optionalBoolean(entryState.isActiveEntry),
            selected,
            rank: selected ? activeEntryRank : 0,
            maxRank: number(entry?.maxRanks, 0),
          };
        }),
      });
    }

    for (const edge of array(definition.edges)) {
      const from = number(edge?.sourceNodeId);
      const to = number(edge?.targetNodeId);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      const sourceRank = number(allocations.get(from)?.rank ?? allocations.get(from)?.ranksPurchased, 0);
      const targetRank = number(allocations.get(to)?.rank ?? allocations.get(to)?.ranksPurchased, 0);
      const targetAvailable = optionalBoolean(object(nodeStates.get(to)).isAvailable);
      edges.push({
        treeId,
        from,
        to,
        type: edge?.type ?? null,
        visualStyle: edge?.visualStyle ?? null,
        required: true,
        active: sourceRank > 0 && (targetRank > 0 || targetAvailable === true),
      });
    }
  }

  return {
    configId: number(state.configId),
    treeId: treeIds[0],
    treeIds,
    specId: armory.talents?.specId ?? null,
    name: text(state.name, 96),
    pointsSpent: number(state.pointsSpent),
    pointsAvailable: number(state.pointsAvailable),
    nodes,
    edges,
  };
}

export function adaptArmoryV3(armory) {
  if (!armory?.character?.id) return armory;

  return withGuildDatabase((db) => {
    const snapshot = latestSnapshotPayload(db, armory.character.id);
    if (number(snapshot?.schemaVersion, 0) < 3) return armory;

    const equipment = array(snapshot.equipment).map(normalizeEquipmentItem).filter((item) => item.itemId || item.name);
    const professions = array(snapshot.professions).map(normalizeProfession).filter((profession) => profession.name);
    const recipes = normalizeRecipes(snapshot);
    const firstName = text(snapshot.firstName, 40);
    const lastName = text(snapshot.lastName, 40);
    const fullName = text(snapshot.fullName || snapshot.name, 96);

    return {
      ...armory,
      character: {
        ...armory.character,
        name: fullName || armory.character.name,
        firstName,
        lastName,
        fullName,
      },
      stats: Object.keys(object(snapshot.stats)).length ? object(snapshot.stats) : armory.stats,
      equipment: equipment.length ? equipment : armory.equipment,
      talents: normalizeTalents(db, armory, snapshot),
      professions: professions.length ? professions : armory.professions,
      recipes: recipes.length ? recipes : armory.recipes,
    };
  });
}
