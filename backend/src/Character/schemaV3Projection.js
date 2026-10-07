function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function recipeForProjection(recipe, profession) {
  const source = object(recipe);
  return {
    ...source,
    id: source.id ?? source.recipeId,
    recipeId: source.recipeId ?? source.id,
    professionId:
      source.professionId ??
      source.professionSkillLineId ??
      profession?.skillLineId ??
      profession?.id,
    iconFileId: source.iconFileId ?? source.iconFileDataId,
    reagents: array(source.reagents).map((slot) => {
      if (!Array.isArray(slot?.reagents)) return slot;
      return {
        ...slot,
        reagents: slot.reagents.map((reagent) => ({
          ...reagent,
          iconFileId: reagent?.iconFileId ?? reagent?.iconFileDataId,
        })),
      };
    }),
  };
}

function professionForProjection(profession) {
  const source = object(profession);
  const id = source.id ?? source.skillLineId;
  return {
    ...source,
    id,
    professionId: source.professionId ?? id,
    iconFileId: source.iconFileId ?? source.iconFileDataId,
    current: source.current ?? source.skillLevel,
    max: source.max ?? source.maxSkillLevel,
    modifier: source.modifier ?? source.skillModifier,
    recipes: array(source.recipes).map((recipe) => recipeForProjection(recipe, source)),
  };
}

function equipmentForProjection(item) {
  const source = object(item);
  return {
    ...source,
    quality: source.quality ?? source.qualityId,
    iconFileId: source.iconFileId ?? source.iconFileDataId,
    gemIds: source.gemIds ?? source.gemItemIds,
    itemString: source.itemString ?? source.rawItemString,
    classId: source.classId ?? source.itemClass?.id,
    class: source.class ?? source.itemClass?.name,
    subclassId: source.subclassId ?? source.itemSubclass?.id,
    subclass: source.subclass ?? source.itemSubclass?.name,
  };
}

export function projectionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  if (Number(snapshot.schemaVersion) < 3) return snapshot;

  return {
    ...snapshot,
    professions: array(snapshot.professions).map(professionForProjection),
    equipment: array(snapshot.equipment).map(equipmentForProjection),
  };
}
