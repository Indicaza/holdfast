export function sanitizeArmoryEquipment(items) {
  if (!Array.isArray(items)) return [];

  return items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return Boolean(item.itemId || item.name || item.itemLink);
  });
}

export function sanitizeArmoryPayload(armory) {
  if (!armory || typeof armory !== "object") return armory;
  return {
    ...armory,
    equipment: sanitizeArmoryEquipment(armory.equipment),
  };
}
