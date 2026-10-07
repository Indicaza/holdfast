import { withGuildDatabase } from "../Data/database.js";
import { ensureTelemetryRecordSchema } from "./telemetryRecordRepository.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function itemNameFromLink(value) {
  return typeof value === "string" ? text(value.match(/\[([^\]]+)\]/)?.[1], 160) : "";
}

function buildToken(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return text(value.build ?? value.version, 64).toLowerCase();
  }
  const raw = text(value, 96);
  return (raw.match(/\bbuild\s+([^·\s]+)/i)?.[1] || raw).toLowerCase();
}

function classToken(value) {
  if (typeof value === "string") return text(value, 64).toLowerCase();
  return text(value?.token ?? value?.name, 64).toLowerCase();
}

function latestSnapshotPayload(db, characterId) {
  const row = db.prepare(`
    SELECT s.payload_json
    FROM telemetry_characters t
    LEFT JOIN character_snapshots s ON s.id = t.latest_snapshot_id
    WHERE t.character_id = ?
    LIMIT 1
  `).get(characterId);

  if (row?.payload_json) return parseJson(row.payload_json);

  return parseJson(
    db.prepare(`
      SELECT payload_json
      FROM character_snapshots
      WHERE character_id = ?
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    `).get(characterId)?.payload_json,
  );
}

function normalizeEquipmentItem(raw) {
  const itemClass = object(raw?.itemClass);
  const itemSubclass = object(raw?.itemSubclass);
  const enchantId = number(raw?.enchantId ?? raw?.enchantID);
  const gemIds = array(raw?.gemItemIds ?? raw?.gemIds ?? raw?.gemIDs)
    .map((value) => number(value))
    .filter((value) => value !== null);
  const bonusIds = array(raw?.bonusIds ?? raw?.bonusIDs)
    .map((value) => number(value))
    .filter((value) => value !== null);
  const tooltip = object(raw?.tooltip);

  return {
    slot: text(raw?.slot, 64),
    slotId: number(raw?.slotId),
    itemId: number(raw?.itemId ?? raw?.itemID ?? raw?.id),
    itemLink: text(raw?.itemLink ?? raw?.link, 2000),
    itemString: text(raw?.rawItemString ?? raw?.itemString, 2000),
    rawItemString: text(raw?.rawItemString ?? raw?.itemString, 2000),
    name: text(raw?.name, 160) || itemNameFromLink(raw?.itemLink),
    quality: number(raw?.qualityId ?? raw?.quality),
    qualityId: number(raw?.qualityId ?? raw?.quality),
    itemLevel: number(raw?.itemLevel ?? raw?.ilevel ?? raw?.level),
    requiredLevel: number(raw?.requiredLevel),
    iconFileId: number(raw?.iconFileDataId ?? raw?.iconFileID ?? raw?.iconFileId ?? raw?.icon),
    iconFileDataId: number(raw?.iconFileDataId ?? raw?.iconFileID ?? raw?.iconFileId ?? raw?.icon),
    enchantId,
    enchant: raw?.enchant ?? (enchantId ? { id: enchantId } : null),
    gemIds,
    gemItemIds: gemIds,
    bonusIds,
    suffixId: number(raw?.suffixId),
    linkLevel: number(raw?.linkLevel),
    specializationId: number(raw?.specializationId),
    upgradeTypeId: number(raw?.upgradeTypeId),
    instanceDifficultyId: number(raw?.instanceDifficultyId),
    itemClass: Object.keys(itemClass).length ? itemClass : null,
    itemClassId: number(itemClass.id ?? raw?.classId),
    itemClassName: text(itemClass.name ?? raw?.class, 120),
    classId: number(itemClass.id ?? raw?.classId),
    class: text(itemClass.name ?? raw?.class, 120),
    itemSubclass: Object.keys(itemSubclass).length ? itemSubclass : null,
    itemSubclassId: number(itemSubclass.id ?? raw?.subclassId),
    itemSubclassName: text(itemSubclass.name ?? raw?.subclass, 120),
    subclassId: number(itemSubclass.id ?? raw?.subclassId),
    subclass: text(itemSubclass.name ?? raw?.subclass, 120),
    equipLocation: text(raw?.equipLocation, 96),
    bindType: number(raw?.bindType),
    expansionId: number(raw?.expansionId),
    setId: number(raw?.setId),
    stackCount: number(raw?.stackCount),
    sellPrice: number(raw?.sellPrice),
    isCraftingReagent: raw?.isCraftingReagent === undefined ? null : Boolean(raw.isCraftingReagent),
    stats: object(raw?.stats),
    durability: Object.keys(object(raw?.durability)).length ? object(raw?.durability) : null,
    spell: Object.keys(object(raw?.spell)).length ? object(raw?.spell) : null,
    tooltip,
    tooltipLines: array(raw?.tooltipLines ?? tooltip.lines).map((line) => ({ ...object(line) })),
  };
}

function professionKey(raw) {
  const id = number(raw?.skillLineId ?? raw?.id ?? raw?.professionId ?? raw?.professionID);
  return id ? `id:${id}` : `name:${text(raw?.name, 96).toLowerCase()}`;
}

function normalizeProfession(raw) {
  const id = number(raw?.skillLineId ?? raw?.id ?? raw?.professionId ?? raw?.professionID);
  return {
    key: professionKey(raw),
    id,
    skillLineId: id,
    name: text(raw?.name ?? raw?.skillLineName, 96) || "Profession",
    kind: text(raw?.kind, 48),
    iconFileId: number(raw?.iconFileDataId ?? raw?.iconFileId ?? raw?.iconFileID ?? raw?.icon),
    iconFileDataId: number(raw?.iconFileDataId ?? raw?.iconFileId ?? raw?.iconFileID ?? raw?.icon),
    current: number(raw?.skillLevel ?? raw?.current ?? raw?.skill ?? raw?.rank, 0) ?? 0,
    max: number(raw?.maxSkillLevel ?? raw?.max ?? raw?.maximum, 0) ?? 0,
    modifier: number(raw?.skillModifier ?? raw?.modifier, 0) ?? 0,
    specialization: raw?.specialization ?? null,
  };
}

function normalizeReagents(raw) {
  const result = [];
  for (const slot of array(raw?.reagents ?? raw?.materials)) {
    if (Array.isArray(slot?.reagents)) {
      for (const reagent of slot.reagents) {
        result.push({
          itemId: number(reagent?.itemId ?? reagent?.itemID),
          currencyId: number(reagent?.currencyId ?? reagent?.currencyID),
          name: text(reagent?.name, 160),
          iconFileId: number(reagent?.iconFileDataId ?? reagent?.iconFileId ?? reagent?.icon),
          quantity: number(reagent?.quantityRequired ?? slot?.quantityRequired ?? reagent?.quantity, 0) ?? 0,
          slotIndex: number(slot?.slotIndex),
          required: slot?.required === undefined ? null : Boolean(slot.required),
        });
      }
      continue;
    }
    result.push({
      itemId: number(slot?.itemId ?? slot?.itemID),
      currencyId: number(slot?.currencyId ?? slot?.currencyID),
      name: text(slot?.name, 160),
      iconFileId: number(slot?.iconFileDataId ?? slot?.iconFileId ?? slot?.icon),
      quantity: number(slot?.quantityRequired ?? slot?.quantity, 0) ?? 0,
      slotIndex: number(slot?.slotIndex),
      required: slot?.required === undefined ? null : Boolean(slot.required),
    });
  }
  return result;
}

function normalizeRecipes(snapshot) {
  const result = [];
  const seen = new Set();

  for (const profession of array(snapshot?.professions)) {
    const professionId = number(profession?.skillLineId ?? profession?.id);
    const professionName = text(profession?.name ?? profession?.skillLineName, 96);
    for (const recipe of array(profession?.recipes)) {
      const id = number(recipe?.recipeId ?? recipe?.id ?? recipe?.recipeID);
      const key = id ? `id:${id}` : `name:${text(recipe?.name, 160).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        id,
        name: text(recipe?.name, 160) || "Unknown recipe",
        iconFileId: number(recipe?.iconFileDataId ?? recipe?.iconFileId ?? recipe?.icon),
        professionKey: professionId ? `id:${professionId}` : professionKey(profession),
        professionId: number(recipe?.professionSkillLineId ?? recipe?.professionId ?? professionId),
        professionName: text(recipe?.professionName, 96) || professionName,
        known: recipe?.known === undefined ? true : Boolean(recipe.known),
        requiredSkill: number(recipe?.requiredSkill),
        requirements: recipe?.requirements ?? null,
        craftedItemId: number(recipe?.craftedItemId ?? recipe?.craftedItemID),
        craftedItemName: text(recipe?.craftedItemName, 160) || itemNameFromLink(recipe?.craftedItemLink),
        reagents: normalizeReagents(recipe),
      });
    }
  }

  return result;
}

function allocationMap(talents) {
  const map = new Map();
  for (const allocation of array(talents?.allocations)) {
    const nodeId = number(allocation?.nodeId ?? allocation?.nodeID);
    if (nodeId !== null) map.set(nodeId, allocation);
  }
  return map;
}

function latestTalentDefinitions(db, memberId, snapshot) {
  ensureTelemetryRecordSchema(db);
  const rawTalents = object(snapshot?.talents);
  const desiredTrees = new Set(array(rawTalents.treeIds ?? rawTalents.treeIDs).map((value) => number(value)).filter((value) => value !== null));
  const wantedClass = classToken(snapshot?.class);
  const wantedBuild = buildToken(snapshot?.gameBuild);
  const definitions = new Map();

  const rows = db.prepare(`
    SELECT envelope_json
    FROM guildweaver_telemetry_records
    WHERE event_type = 'talent_tree_definition' AND member_id = ?
    ORDER BY received_at DESC, id DESC
  `).all(memberId);

  for (const row of rows) {
    const definition = object(parseJson(row.envelope_json)?.payload);
    const treeId = number(definition?.treeId ?? definition?.treeID);
    if (treeId === null || definitions.has(treeId)) continue;
    if (desiredTrees.size && !desiredTrees.has(treeId)) continue;

    const definitionClass = classToken(definition?.class);
    const definitionBuild = buildToken(definition?.gameBuild);
    if (wantedClass && definitionClass && wantedClass !== definitionClass) continue;
    if (wantedBuild && definitionBuild && wantedBuild !== definitionBuild) continue;
    definitions.set(treeId, definition);
  }

  return [...definitions.values()];
}

function normalizeTalents(db, armory, snapshot) {
  const state = object(snapshot?.talents);
  if (!array(state.allocations).length && !array(state.treeIds).length) return armory.talents;

  const allocations = allocationMap(state);
  const definitions = latestTalentDefinitions(db, armory?.character?.memberId, snapshot);
  if (!definitions.length) {
    return {
      ...armory.talents,
      configId: state.configId ?? armory?.talents?.configId ?? null,
      treeId: array(state.treeIds)[0] ?? armory?.talents?.treeId ?? null,
      treeIds: array(state.treeIds),
      name: text(state.name, 96),
      pointsSpent: number(state.pointsSpent),
      pointsAvailable: number(state.pointsAvailable),
    };
  }

  const nodes = [];
  const edges = [];
  for (const definition of definitions) {
    const treeId = number(definition.treeId ?? definition.treeID);
    for (const node of array(definition.nodes)) {
      const nodeId = number(node?.nodeId ?? node?.nodeID ?? node?.id);
      const allocation = allocations.get(nodeId) || {};
      const rank = number(allocation?.rank ?? allocation?.ranksPurchased, 0) ?? 0;
      const activeEntryId = number(allocation?.activeEntryId ?? allocation?.activeEntryID);
      const activeEntryRank = number(allocation?.activeEntryRank, rank) ?? rank;
      nodes.push({
        id: nodeId,
        treeId,
        x: number(node?.position?.x ?? node?.x, 0) ?? 0,
        y: number(node?.position?.y ?? node?.y, 0) ?? 0,
        type: text(node?.type, 48),
        rank,
        maxRank: number(node?.maxRanks ?? node?.maxRank, 0) ?? 0,
        selected: rank > 0,
        entries: array(node?.entries).map((entry) => {
          const entryId = number(entry?.entryId ?? entry?.entryID ?? entry?.id);
          const selected = activeEntryId !== null ? activeEntryId === entryId : rank > 0 && array(node?.entries).length === 1;
          return {
            id: entryId,
            definitionId: number(entry?.definitionId ?? entry?.definitionID),
            spellId: number(entry?.spellId ?? entry?.spellID),
            name: text(entry?.name, 160),
            iconFileId: number(entry?.iconFileDataId ?? entry?.iconFileId ?? entry?.icon),
            selected,
            rank: selected ? activeEntryRank : 0,
            maxRank: number(entry?.maxRanks ?? entry?.maxRank ?? node?.maxRanks, 0) ?? 0,
          };
        }),
      });
    }
    for (const edge of array(definition.edges)) {
      const from = number(edge?.sourceNodeId ?? edge?.sourceNodeID ?? edge?.from);
      const to = number(edge?.targetNodeId ?? edge?.targetNodeID ?? edge?.to);
      if (from === null || to === null) continue;
      edges.push({ treeId, from, to, type: edge?.type ?? null, required: true, active: null });
    }
  }

  return {
    configId: number(state.configId),
    treeId: array(state.treeIds).map((value) => number(value)).find((value) => value !== null) ?? definitions[0]?.treeId ?? null,
    treeIds: array(state.treeIds).map((value) => number(value)).filter((value) => value !== null),
    specId: armory?.talents?.specId ?? null,
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

    const equipment = array(snapshot?.equipment).map(normalizeEquipmentItem).filter((item) => item.itemId || item.name);
    const professions = array(snapshot?.professions).map(normalizeProfession).filter((profession) => profession.name);
    const recipes = normalizeRecipes(snapshot);
    const firstName = text(snapshot?.firstName, 40);
    const lastName = text(snapshot?.lastName, 40);
    const fullName = text(snapshot?.fullName ?? snapshot?.name, 96) || [firstName, lastName].filter(Boolean).join(" ");

    return {
      ...armory,
      character: {
        ...armory.character,
        name: fullName || armory.character.name,
        firstName,
        lastName,
        fullName,
      },
      stats: Object.keys(object(snapshot?.stats)).length ? object(snapshot.stats) : armory.stats,
      equipment: equipment.length ? equipment : armory.equipment,
      talents: normalizeTalents(db, armory, snapshot),
      professions: professions.length ? professions : armory.professions,
      recipes: recipes.length ? recipes : armory.recipes,
    };
  });
}
