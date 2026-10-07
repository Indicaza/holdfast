import { withGuildDatabase } from "../Data/database.js";
import { readCharacterArmory } from "./telemetryProjection.js";

function text(value, maxLength = 256) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function slotKey(value) {
  const normalized = text(value, 48)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/SLOT$/, "");
  const aliases = {
    FINGER0: "FINGER1",
    FINGER1: "FINGER2",
    TRINKET0: "TRINKET1",
    TRINKET1: "TRINKET2",
    SECONDARYHAND: "OFFHAND",
  };
  return aliases[normalized] || normalized;
}

function tooltipLines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => {
      if (typeof line === "string") {
        return { left: text(line, 500), right: "", type: null };
      }
      if (!line || typeof line !== "object") return null;
      const left = text(line.left ?? line.leftText ?? line.text, 500);
      const right = text(line.right ?? line.rightText, 500);
      if (!left && !right) return null;
      return {
        left,
        right,
        type: integer(line.type),
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function enrichEquipment(normalized, rawEquipment) {
  const rawBySlot = new Map();
  const rawByItem = new Map();

  for (const raw of Array.isArray(rawEquipment) ? rawEquipment : []) {
    if (!raw || typeof raw !== "object") continue;
    const key = slotKey(raw.slot ?? raw.slotName ?? raw.inventorySlot);
    if (key) rawBySlot.set(key, raw);
    const itemId = integer(raw.itemId ?? raw.itemID ?? raw.id);
    if (itemId) rawByItem.set(itemId, raw);
  }

  return (Array.isArray(normalized) ? normalized : []).map((item) => {
    const itemId = integer(item?.itemId ?? item?.itemID);
    const raw =
      rawBySlot.get(slotKey(item?.slot)) ||
      (itemId ? rawByItem.get(itemId) : null) ||
      {};
    const rawIcon = raw.icon;
    const iconFileId = integer(
      item?.iconFileId ??
        raw.iconFileDataId ??
        raw.iconFileDataID ??
        (typeof rawIcon === "number" || /^\d+$/.test(String(rawIcon || ""))
          ? rawIcon
          : null),
    );

    return {
      ...raw,
      ...item,
      itemId: itemId ?? integer(raw.itemId ?? raw.itemID ?? raw.id),
      name: text(item?.name || raw.name || raw.itemName, 160),
      requiredLevel:
        integer(item?.requiredLevel) ?? integer(raw.requiredLevel ?? raw.required_level),
      itemClassName: text(
        item?.itemClassName ?? raw.class ?? raw.itemClass ?? raw.itemClassName,
        96,
      ),
      itemSubclassName: text(
        item?.itemSubclassName ?? raw.subclass ?? raw.itemSubclass ?? raw.itemSubclassName,
        96,
      ),
      equipLocation: text(item?.equipLocation ?? raw.equipLocation, 96),
      bindType: integer(item?.bindType ?? raw.bindType),
      classId: integer(item?.classId ?? raw.classId),
      subclassId: integer(item?.subclassId ?? raw.subclassId),
      setId: integer(item?.setId ?? raw.setId),
      expansionId: integer(item?.expansionId ?? raw.expansionId),
      iconFileId,
      iconTexture: text(
        item?.iconTexture ??
          raw.iconTexture ??
          (typeof rawIcon === "string" && !/^\d+$/.test(rawIcon) ? rawIcon : ""),
        400,
      ),
      tooltipLines: tooltipLines(item?.tooltipLines ?? raw.tooltipLines ?? raw.tooltip),
    };
  });
}

function readRawSnapshot(characterId) {
  return withGuildDatabase((db) => {
    const row = db
      .prepare(
        `
          SELECT payload_json
          FROM character_snapshots
          WHERE character_id = ?
          ORDER BY captured_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(String(characterId));
    return parseJson(row?.payload_json);
  });
}

function identity(payload, fallbackName) {
  const firstName = text(payload?.firstName ?? payload?.name, 32);
  const lastName = text(payload?.lastName ?? payload?.surname, 48);
  const displayName =
    text(payload?.displayName, 96) ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    text(fallbackName, 96);

  return { firstName, lastName, displayName };
}

export function readEnrichedCharacterArmory(characterId) {
  const armory = readCharacterArmory(characterId);
  if (!armory) return null;

  const payload = readRawSnapshot(characterId);
  const names = identity(payload, armory.character?.name);

  return {
    ...armory,
    character: {
      ...armory.character,
      name: names.displayName,
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: names.displayName,
    },
    equipment: enrichEquipment(armory.equipment, payload?.equipment),
  };
}
