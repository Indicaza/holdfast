// Seeds a fake-but-realistic guild roster with Guildweaver character telemetry.
//
// People are invented (dev-roster-* members, made-up character names), but the
// game data is real: Classic item IDs with recorded tooltips and icon
// FileDataIDs (seed/devData/items.json), captured talent tree definitions
// (seed/devData/talentTrees/*.json), recipe books recorded from the client's
// DB2 tables (seed/devData/recipes.json), and stats derived from the equipped
// gear.
// Snapshots go through the same pairing, sync, and telemetry repositories as
// the addon bridge, so projections and the armory adapter run unchanged.
//
// Deterministic: re-running on the same day is a no-op; the next day it adds a
// fresh snapshot per character so "last seen" stays recent.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { initializeGuildData } from "../src/Data/initializeData.js";
import { withGuildTransaction } from "../src/Data/database.js";
import { ensureRuntimeDataDirectory } from "../src/Data/runtimeData.js";
import { syncGuildweaverCharacter } from "../src/Character/characterSyncRepository.js";
import {
  approveGuildweaverPairing,
  exchangeGuildweaverPairing,
  readGuildweaverDevices,
  startGuildweaverPairing,
} from "../src/Character/guildweaverDeviceRepository.js";
import { ingestTelemetry } from "../src/Character/Telemetry/ingestTelemetry.js";
import { recordTelemetry } from "../src/Character/telemetryRecordRepository.js";
import { importMembersIntoDatabase } from "../src/Guild/memberRepository.js";
import { KITS } from "./devData/kits.js";

const seedDir = join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "devData");
const ITEMS = JSON.parse(readFileSync(join(seedDir, "items.json"), "utf8")).items;
const RECIPE_BOOKS = JSON.parse(readFileSync(join(seedDir, "recipes.json"), "utf8")).professions;
const TALENT_TREES = readdirSync(join(seedDir, "talentTrees"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(seedDir, "talentTrees", file), "utf8")));

const REALM = "Classic Beta PvE 2";
const GAME_BUILD = { interface: 16001, buildDate: "Oct  5 2026", version: "1.60.1", build: "70245" };
const ADDON_VERSION = "0.5.0-alpha.1";

const RACES = {
  Human: { id: 1, token: "Human" },
  Dwarf: { id: 3, token: "Dwarf", resist: { frost: 10 } },
  "Night Elf": { id: 4, token: "NightElf", resist: { nature: 10 } },
  Gnome: { id: 7, token: "Gnome", resist: { arcane: 10 } },
};

// base60: strength, agility, stamina, intellect, spirit at level 60 before gear.
const CLASSES = {
  Warrior: { id: 1, token: "WARRIOR", icon: 626008, power: "RAGE", base60: [120, 80, 110, 30, 45], hp: 28, melee: true, parry: true },
  Paladin: { id: 2, token: "PALADIN", icon: 626003, power: "MANA", base60: [105, 65, 100, 65, 70], hp: 24, melee: true, parry: true },
  Hunter: { id: 3, token: "HUNTER", icon: 626000, power: "MANA", base60: [55, 125, 90, 60, 65], hp: 22, ranged: true, parry: true },
  Rogue: { id: 4, token: "ROGUE", icon: 626005, power: "ENERGY", base60: [80, 130, 75, 35, 50], hp: 22, melee: true, parry: true },
  Priest: { id: 5, token: "PRIEST", icon: 626004, power: "MANA", base60: [35, 40, 50, 120, 125], hp: 16, caster: true },
  Mage: { id: 8, token: "MAGE", icon: 626001, power: "MANA", base60: [30, 35, 45, 125, 120], hp: 16, caster: true },
  Warlock: { id: 9, token: "WARLOCK", icon: 626007, power: "MANA", base60: [45, 50, 75, 110, 115], hp: 18, caster: true },
  Druid: { id: 11, token: "DRUID", icon: 625999, power: "MANA", base60: [65, 55, 70, 100, 110], hp: 20, caster: true },
};
const POWER_TYPES = { MANA: 0, RAGE: 1, ENERGY: 3 };

const PROFESSIONS = {
  Alchemy: { id: 171, icon: 136240 },
  Blacksmithing: { id: 164, icon: 136241 },
  Enchanting: { id: 333, icon: 136244 },
  Engineering: { id: 202, icon: 136243 },
  Herbalism: { id: 182, icon: 136065 },
  Leatherworking: { id: 165, icon: 133611 },
  Mining: { id: 186, icon: 136248 },
  Skinning: { id: 393, icon: 134366 },
  Tailoring: { id: 197, icon: 136249 },
  Cooking: { id: 185, icon: 133971, kind: "cooking" },
  "First Aid": { id: 129, icon: 135966, kind: "first_aid" },
  Fishing: { id: 356, icon: 136245, kind: "fishing" },
};

const SLOT_IDS = {
  head: 1, neck: 2, shoulder: 3, shirt: 4, chest: 5, waist: 6, legs: 7, feet: 8, wrist: 9, hands: 10,
  finger_1: 11, finger_2: 12, trinket_1: 13, trinket_2: 14, back: 15, main_hand: 16, off_hand: 17,
  ranged: 18, tabard: 19,
};
const QUALITY_HEX = ["9d9d9d", "ffffff", "1eff00", "0070dd", "a335ee", "ff8000"];

// Hand-tuned Warrior builds for the captured tree; other classes use the generic
// allocator in talentsFor. Both respect tier gates and prerequisite edges.
const TALENT_BUILDS = {
  arms: [
    "Improved Heroic Strike", "Deflection", "Improved Charge", "Improved Tactical Mastery", "Anger Management",
    "Improved Rend", "Deep Wounds", "Two-Handed Weapon Specialization", "Impale", "Weaponmaster", "Sweeping Strikes",
    "Improved Hamstring", "Mortal Strike", "Improved Slam", "Cruelty", "Booming Voice", "Unbridled Wrath",
  ],
  fury: [
    "Cruelty", "Unbridled Wrath", "Booming Voice", "Enrage", "Blood Craze", "Piercing Howl",
    "Dual Wield Specialization", "Improved Execute", "Death Wish", "Flurry", "Bloodthirst",
    "Improved Berserker Rage", "Gore Drinker", "Improved Heroic Strike", "Deflection", "Improved Rend",
  ],
  prot: [
    "Shield Specialization", "Anticipation", "Iron Will", "Improved Bloodrage", "Last Stand", "Defiance",
    "Improved Sunder Armor", "Improved Revenge", "Concussion Blow", "Improved Shield Wall", "Focused Rage",
    "Bastion", "Shield Slam", "Master of Defense", "Improved Heroic Strike", "Deflection",
  ],
};

// WoW Forever characters carry a surname (UnitFullName's second value in that
// client). Give each development character one so name layouts are exercised.
const SURNAMES = {
  Mira: "Ashford", Owen: "Stonehelm", Brannoc: "Ironvein", Stoutmug: "Barrelgut", Seraphine: "Dawnward",
  Kaelthorn: "Moonbrook", Thistlewhip: "Briarwood", Vexis: "Nightshade", Ironhide: "Blackforge",
  Pyrelight: "Cogsworth", Lunara: "Silverleaf", Fizzwick: "Sparkspanner", Gearlock: "Tinkerfuse",
  Aldric: "Brightmantle", Mirelle: "Embervale", Ashvane: "Grimward", Grimbeard: "Deepdelve",
  Sylvaine: "Starwhisper", Torvald: "Greymane", Wrenna: "Mistglade", Hollis: "Copperhearth",
  Nymbleweave: "Fizzlecrank", Corwin: "Hartwell",
};

const ROSTER = [
  { id: "dev-roster-01", name: "Brannoc", rank: "Major", tz: "America/Chicago", characters: [
    ["Brannoc", "Dwarf", "Warrior", 60, "warrior_prot_60", "prot", ["Mining", "Blacksmithing"]],
    ["Stoutmug", "Dwarf", "Priest", 41, "cloth_40", "Holy", ["Herbalism", "Alchemy"]],
  ] },
  { id: "dev-roster-02", name: "Seraphine", rank: "Captain", tz: "America/New_York", characters: [
    ["Seraphine", "Human", "Priest", 60, "priest_60", "Holy", ["Tailoring", "Enchanting"]],
  ] },
  { id: "dev-roster-03", name: "Kaelthorn", rank: "Lieutenant", tz: "America/Denver", characters: [
    ["Kaelthorn", "Night Elf", "Druid", 60, "druid_60", "Restoration", ["Herbalism", "Alchemy"]],
    ["Thistlewhip", "Night Elf", "Hunter", 27, "leather_25", "Beast Mastery", ["Skinning", "Leatherworking"]],
  ] },
  { id: "dev-roster-04", name: "Vexis", rank: "Sergeant Major", tz: "America/Los_Angeles", characters: [
    ["Vexis", "Human", "Rogue", 60, "rogue_60", "Combat", ["Skinning", "Leatherworking"]],
  ] },
  { id: "dev-roster-05", name: "Ironhide", rank: "Master Sergeant", tz: "America/Chicago", characters: [
    ["Ironhide", "Human", "Warrior", 60, "warrior_fury_60", "fury", ["Mining", "Engineering"]],
    ["Pyrelight", "Gnome", "Mage", 38, "cloth_40", "Frost", ["Tailoring", "Enchanting"]],
  ] },
  { id: "dev-roster-06", name: "Lunara", rank: "Sergeant", tz: "Europe/London", characters: [
    ["Lunara", "Night Elf", "Hunter", 60, "hunter_60", "Marksmanship", ["Skinning", "Leatherworking"]],
  ] },
  { id: "dev-roster-07", name: "Fizzwick", rank: "Sergeant", tz: "America/New_York", characters: [
    ["Fizzwick", "Gnome", "Warlock", 60, "warlock_60", "Affliction", ["Tailoring", "Enchanting"]],
    ["Gearlock", "Gnome", "Warrior", 34, "mail_plate_40", "fury", ["Mining", "Engineering"]],
  ] },
  { id: "dev-roster-08", name: "Aldric", rank: "Corporal", tz: "America/Detroit", characters: [
    ["Aldric", "Human", "Paladin", 60, "paladin_60", "Holy", ["Mining", "Blacksmithing"]],
  ] },
  { id: "dev-roster-09", name: "Mirelle", rank: "Corporal", tz: "America/Phoenix", characters: [
    ["Mirelle", "Human", "Mage", 60, "mage_60", "Fire", ["Tailoring", "Alchemy"]],
    ["Ashvane", "Human", "Warlock", 22, "cloth_20", "Destruction", ["Herbalism", "Alchemy"]],
  ] },
  { id: "dev-roster-10", name: "Grimbeard", rank: "Corporal", tz: "America/Chicago", characters: [
    ["Grimbeard", "Dwarf", "Hunter", 52, "hunter_60", "Beast Mastery", ["Mining", "Engineering"]],
  ] },
  { id: "dev-roster-11", name: "Sylvaine", rank: "Private", tz: "America/New_York", characters: [
    ["Sylvaine", "Night Elf", "Rogue", 44, "leather_25", "Assassination", ["Herbalism", "Alchemy"]],
  ] },
  { id: "dev-roster-12", name: "Torvald", rank: "Private", tz: "America/Denver", characters: [
    ["Torvald", "Human", "Warrior", 58, "warrior_arms_60", "arms", ["Mining", "Blacksmithing"]],
  ] },
  { id: "dev-roster-13", name: "Wren", rank: "Private", tz: "America/Los_Angeles", characters: [
    ["Wrenna", "Night Elf", "Priest", 29, "cloth_20", "Shadow", ["Tailoring", "Enchanting"]],
  ] },
  { id: "dev-roster-14", name: "Hollis", rank: "Recruit", tz: "America/Chicago", characters: [
    ["Hollis", "Dwarf", "Paladin", 19, "plate_mail_20", "Retribution", ["Mining", "Blacksmithing"]],
  ] },
  { id: "dev-roster-15", name: "Nym", rank: "Recruit", tz: "Australia/Sydney", characters: [
    ["Nymbleweave", "Gnome", "Mage", 24, "cloth_20", "Arcane", ["Tailoring", "Enchanting"]],
  ] },
  { id: "dev-roster-16", name: "Corwin", rank: "Private", tz: "Europe/Berlin", characters: [
    ["Corwin", "Human", "Warrior", 46, "mail_plate_40", "arms", ["Skinning", "Leatherworking"]],
  ] },
];

// The existing login personas also get characters so "my characters" views have data.
const PERSONA_CHARACTERS = {
  "dev-member": [["Mira", "Human", "Rogue", 31, "leather_25", "Combat", ["Skinning", "Leatherworking"]]],
  "dev-officer": [["Owen", "Dwarf", "Paladin", 60, "paladin_60", "Protection", ["Mining", "Blacksmithing"]]],
  "dev-commander": [
    ["Casey", "Night Elf", "Warrior", 60, "warrior_prot_60", "prot", ["Mining", "Engineering"]],
    ["Caseyheals", "Night Elf", "Druid", 48, "leather_25", "Restoration", ["Herbalism", "Alchemy"]],
  ],
};

const FALLBACK_KITS = {
  Warrior: ["mail_plate_40", "plate_mail_20", "leather_25"],
  Paladin: ["mail_plate_40", "plate_mail_20"],
  Hunter: ["mail_plate_40", "leather_25"],
  Rogue: ["leather_25"],
  Druid: ["leather_25"],
  Priest: ["cloth_40", "cloth_20"],
  Mage: ["cloth_40", "cloth_20"],
  Warlock: ["cloth_40", "cloth_20"],
};

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seededRandom(seed) {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function equipmentFor(className, level, kitName) {
  const slots = new Map();
  for (const name of [kitName, ...FALLBACK_KITS[className]]) {
    for (const [slot, itemId] of Object.entries(KITS[name] || {})) {
      const item = ITEMS[itemId];
      if (!item || slots.has(slot) || (item.requiredLevel || 1) > level) continue;
      // A two-hander leaves the off hand empty.
      if (slot === "off_hand" && slots.get("main_hand")?.equipLocation === "INVTYPE_2HWEAPON") continue;
      slots.set(slot, item);
    }
  }

  return [...slots.entries()]
    .sort(([a], [b]) => SLOT_IDS[a] - SLOT_IDS[b])
    .map(([slot, item]) => {
      const itemString = `item:${item.itemId}::::::::${level}:::::`;
      return {
        slot,
        slotId: SLOT_IDS[slot],
        itemId: item.itemId,
        name: item.name,
        qualityId: item.qualityId,
        itemLevel: item.itemLevel,
        requiredLevel: item.requiredLevel,
        iconFileDataId: item.iconFileDataId,
        gemItemIds: [],
        bonusIds: [],
        linkLevel: level,
        itemClass: item.itemClass,
        itemSubclass: item.itemSubclass,
        equipLocation: item.equipLocation,
        bindType: item.bindType,
        expansionId: item.expansionId,
        setId: item.setId || undefined,
        itemLink: `|cff${QUALITY_HEX[item.qualityId] || "ffffff"}|H${itemString}|h[${item.name}]|h|r`,
        rawItemString: itemString,
        sellPrice: item.sellPrice,
        stats: item.stats,
        durability: item.durability || undefined,
        tooltip: item.tooltip,
      };
    });
}

function equipBonus(equipment, pattern) {
  let total = 0;
  for (const item of equipment) {
    for (const line of item.tooltip?.lines || []) {
      const match = String(line.left || "").match(pattern);
      if (match) total += Number(match[1]);
    }
  }
  return total;
}

function weaponDamage(item, attackPower) {
  const line = item?.tooltip?.lines?.find((entry) => /Damage$/.test(entry.left || "") && /^Speed/.test(entry.right || ""));
  if (!line) return null;
  const [min, max] = line.left.match(/(\d+) - (\d+)/).slice(1).map(Number);
  const speed = Number(line.right.replace("Speed ", ""));
  const bonus = (attackPower / 14) * speed;
  return { min: round(min + bonus), max: round(max + bonus), speed };
}

function statsFor({ className, raceName, level, equipment }) {
  const classInfo = CLASSES[className];
  const scale = (value) => Math.round(20 + ((value - 20) * level) / 60);
  const keys = ["STRENGTH", "AGILITY", "STAMINA", "INTELLECT", "SPIRIT"];
  const names = ["strength", "agility", "stamina", "intellect", "spirit"];
  const gear = Object.fromEntries(keys.map((key) => [key, 0]));
  let armorFromGear = 0;
  const resistances = { arcane: 0, fire: 0, frost: 0, nature: 0, shadow: 0 };
  const resistanceKeys = { RESISTANCE2_NAME: "fire", RESISTANCE3_NAME: "nature", RESISTANCE4_NAME: "frost", RESISTANCE5_NAME: "shadow", RESISTANCE6_NAME: "arcane" };

  for (const item of equipment) {
    for (const [key, value] of Object.entries(item.stats || {})) {
      const stat = key.match(/^ITEM_MOD_(\w+)_SHORT$/)?.[1];
      if (stat in gear) gear[stat] += value;
      if (key === "RESISTANCE0_NAME") armorFromGear += value;
      if (resistanceKeys[key]) resistances[resistanceKeys[key]] += value;
    }
  }
  for (const [school, value] of Object.entries(RACES[raceName].resist || {})) resistances[school] += value;

  const attributes = {};
  names.forEach((name, index) => {
    const base = scale(classInfo.base60[index]);
    const effective = base + gear[keys[index]];
    attributes[name] = { current: effective, effective, positive: gear[keys[index]], negative: 0 };
  });
  const { strength, agility, stamina, intellect, spirit } = Object.fromEntries(
    names.map((name) => [name, attributes[name].effective]),
  );

  const maxHealth = Math.round(level * classInfo.hp + (stamina - 20) * 10 + 20);
  const maxMana = classInfo.power === "MANA" ? Math.round(level * 18 + (intellect - 20) * 15 + 20) : 100;
  const gearAttackPower = equipBonus(equipment, /^Equip: \+(\d+) Attack Power\.$/);
  const baseAttackPower = classInfo.melee && !["Rogue"].includes(className)
    ? level * 3 - 20 + strength * 2
    : className === "Rogue" || className === "Hunter"
      ? level * 2 - 20 + strength + agility
      : strength - 10;
  const rangedAttackPower = className === "Hunter" ? level * 2 - 10 + agility * 2 : level + agility - 10;
  const hit = equipBonus(equipment, /^Equip: Improves your chance to hit by (\d+)%/);
  const crit = equipBonus(equipment, /^Equip: Improves your chance to get a critical strike by (\d+)%/);
  const spellPower = equipBonus(equipment, /^Equip: Increases damage and healing done by magical spells and effects by up to (\d+)\./);
  const healing = equipBonus(equipment, /^Equip: Increases healing done by spells and effects by up to (\d+)\./);
  const spellCrit = equipBonus(equipment, /^Equip: Improves your chance to get a critical strike with spells by (\d+)%/);
  const defenseBonus = equipBonus(equipment, /^Equip: Increased Defense \+(\d+)\./);
  const bySlot = Object.fromEntries(equipment.map((item) => [item.slot, item]));
  const attackPower = baseAttackPower + gearAttackPower;
  const mainHand = weaponDamage(bySlot.main_hand, attackPower);
  const offHand = bySlot.off_hand?.equipLocation === "INVTYPE_SHIELD" ? null : weaponDamage(bySlot.off_hand, attackPower);
  const ranged = weaponDamage(bySlot.ranged, rangedAttackPower);
  const hasShield = bySlot.off_hand?.equipLocation === "INVTYPE_SHIELD";
  const meleeCrit = round(5 + agility / (className === "Rogue" ? 29 : 20) + crit);

  const experience = level < 60
    ? { current: Math.round((hash(`${level}${className}`) % 1000) / 1000 * level * 1400), max: level * 1500, rested: level * 300 }
    : null;
  const equippedItemLevels = equipment.filter((item) => !["shirt", "tabard"].includes(item.slot)).map((item) => item.itemLevel || 0);
  const averageItemLevel = equippedItemLevels.length
    ? round(equippedItemLevels.reduce((sum, value) => sum + value, 0) / 17, 1)
    : 0;

  return {
    schemaVersion: 1,
    resources: {
      health: { current: maxHealth, max: maxHealth },
      power: {
        typeId: POWER_TYPES[classInfo.power],
        token: classInfo.power,
        current: classInfo.power === "RAGE" ? 0 : maxMana,
        max: maxMana,
      },
      powerRegen: classInfo.power === "ENERGY" ? { inactive: 10, active: 10 } : undefined,
      manaRegen: classInfo.power === "MANA" ? { inactive: round(spirit / 5 + 15), active: 0 } : undefined,
    },
    attributes,
    offense: {
      attackPower: { base: baseAttackPower, positive: gearAttackPower, negative: 0, effective: attackPower },
      rangedAttackPower: { base: rangedAttackPower, positive: 0, negative: 0, effective: rangedAttackPower },
      meleeDamage: mainHand ? {
        min: mainHand.min,
        max: mainHand.max,
        offhandMin: offHand?.min,
        offhandMax: offHand?.max,
        positive: 0,
        negative: 0,
        multiplier: 1,
      } : undefined,
      rangedDamage: ranged ? { speed: ranged.speed, min: ranged.min, max: ranged.max, positive: 0, negative: 0, multiplier: 1 } : undefined,
      attackSpeed: mainHand ? { mainHand: mainHand.speed, offHand: offHand?.speed } : undefined,
      crit: { melee: meleeCrit, ranged: meleeCrit },
      hit: { melee: hit, ranged: hit },
      haste: { melee: 0, ranged: 0 },
      armorPenetration: 0,
      spell: classInfo.caster || ["Paladin", "Hunter"].includes(className) ? {
        schools: Object.fromEntries(
          ["holy", "fire", "nature", "frost", "shadow", "arcane"].map((school, index) => [
            school,
            { id: index + 2, damage: spellPower, crit: round(1 + intellect / 60 + spellCrit) },
          ]),
        ),
        healing: spellPower + healing,
        hit: 0,
        penetration: 0,
        haste: 0,
      } : undefined,
      weaponSkills: [mainHand, ranged].some(Boolean)
        ? [bySlot.main_hand, bySlot.ranged]
          .filter(Boolean)
          .map((item) => ({ name: `${item.itemSubclass?.name || "Unarmed"}s`.replace(/ss$/, "s"), current: level * 5, max: level * 5, temporary: 0, modifier: 0 }))
        : undefined,
    },
    defense: {
      armor: { base: armorFromGear + agility * 2, effective: armorFromGear + agility * 2, armor: armorFromGear + agility * 2, positive: 0, negative: 0 },
      defenseSkill: { base: level * 5, modifier: defenseBonus, effective: level * 5 + defenseBonus },
      dodge: round(agility / (className === "Rogue" ? 14.5 : 20) + defenseBonus * 0.04),
      parry: classInfo.parry ? round(5 + defenseBonus * 0.04) : 0,
      block: hasShield ? round(5 + defenseBonus * 0.04) : 0,
      shieldBlock: hasShield ? Math.round(strength / 20 + 30) : 0,
      resistances: Object.fromEntries(
        Object.entries(resistances).map(([school, total]) => [school, { base: 0, total, bonus: total, negative: 0 }]),
      ),
    },
    utility: {
      movement: { currentYardsPerSecond: 0, runYardsPerSecond: 7, flightYardsPerSecond: 7, swimYardsPerSecond: 4.72, bonusPercent: 0 },
      itemLevel: { overall: averageItemLevel, equipped: averageItemLevel, pvp: averageItemLevel },
      experience: experience || undefined,
    },
  };
}

// Tab order matches the Classic TalentTab OrderIndex used by captured and synthetic trees.
const TAB_NAMES = {
  Warrior: ["Arms", "Fury", "Protection"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Rogue: ["Assassination", "Combat", "Subtlety"],
  Priest: ["Discipline", "Holy", "Shadow"],
  Mage: ["Arcane", "Fire", "Frost"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Druid: ["Balance", "Feral Combat", "Restoration"],
};
const NAMED_BUILD_TABS = { arms: 0, fury: 1, prot: 2 };
const HEALER_SPECS = new Set(["Paladin:Holy", "Priest:Discipline", "Priest:Holy", "Druid:Restoration"]);
const TANK_SPECS = new Set(["Warrior:Protection", "Paladin:Protection", "Druid:Feral Combat"]);

function tierOf(node) {
  return Math.round((node.position.y - 2130) / 600) + 1;
}

function tabOf(node) {
  const x = node.position.x;
  return x < 4000 ? 0 : x < 8000 ? 1 : 2;
}

function specName(className, buildName) {
  if (buildName in NAMED_BUILD_TABS) return TAB_NAMES[className][NAMED_BUILD_TABS[buildName]];
  return buildName;
}

function talentsFor(className, level, buildName, definition, random) {
  if (!definition || !buildName) return undefined;

  const nodes = definition.payload.nodes;
  const byName = new Map(nodes.map((node) => [node.entries[0].name, node]));
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const prerequisites = new Map(definition.payload.edges.map((edge) => [edge.targetNodeId, edge.sourceNodeId]));
  const ranks = new Map();
  const spentInTab = [0, 0, 0];
  const totalPoints = Math.max(0, level - 9);
  const primaryTab = Math.max(0, TAB_NAMES[className].indexOf(specName(className, buildName)));
  const otherTabs = [0, 1, 2].filter((tab) => tab !== primaryTab);
  const secondaryTab = otherTabs[Math.floor(random() * otherTabs.length)];
  let points = totalPoints;

  const canTake = (node) => {
    const rank = ranks.get(node.nodeId) || 0;
    if (rank >= node.maxRanks) return false;
    if (spentInTab[tabOf(node)] < (tierOf(node) - 1) * 5) return false;
    const prerequisite = prerequisites.get(node.nodeId);
    if (prerequisite && (ranks.get(prerequisite) || 0) < byId.get(prerequisite).maxRanks) return false;
    return true;
  };
  const take = (node) => {
    ranks.set(node.nodeId, (ranks.get(node.nodeId) || 0) + 1);
    spentInTab[tabOf(node)] += 1;
    points -= 1;
  };
  // Generic builds push the main tree toward its capstone (deepest available tier
  // first, ties broken at random), then spend the rest in one secondary tree.
  const deepest = (tab) => {
    const candidates = nodes.filter((node) => tabOf(node) === tab && canTake(node));
    if (!candidates.length) return null;
    const tier = Math.max(...candidates.map(tierOf));
    const atTier = candidates.filter((node) => tierOf(node) === tier);
    return atTier[Math.floor(random() * atTier.length)];
  };

  // Generic builds target the main tree's capstone, so its prerequisite chain comes first.
  const capstoneChain = [];
  const primaryNodes = nodes.filter((node) => tabOf(node) === primaryTab);
  const capstone = primaryNodes.sort((a, b) => tierOf(b) - tierOf(a))[0];
  for (let node = capstone; node; node = byId.get(prerequisites.get(node.nodeId))) capstoneChain.unshift(node);
  const priorities = TALENT_BUILDS[buildName]
    ? TALENT_BUILDS[buildName].map((name) => byName.get(name)).filter(Boolean)
    : capstoneChain;
  while (points > 0) {
    const next = priorities.find(canTake)
      || (spentInTab[primaryTab] < 31 ? deepest(primaryTab) : null)
      || deepest(secondaryTab)
      || deepest(primaryTab)
      || nodes.find(canTake);
    if (!next) break;
    take(next);
  }

  const allocations = nodes
    .filter((node) => ranks.get(node.nodeId))
    .map((node) => ({
      nodeId: node.nodeId,
      rank: ranks.get(node.nodeId),
      ranksPurchased: ranks.get(node.nodeId),
      activeEntryId: node.entries[0].entryId,
      activeEntryRank: ranks.get(node.nodeId),
    }));
  const nodeStates = nodes.map((node) => {
    const available = canTake(node) || (ranks.get(node.nodeId) || 0) > 0;
    return {
      nodeId: node.nodeId,
      isAvailable: available,
      isVisible: true,
      meetsEdgeRequirements: !prerequisites.has(node.nodeId) || (ranks.get(prerequisites.get(node.nodeId)) || 0) > 0,
      conditions: [],
      entries: node.entries.map((entry) => ({
        entryId: entry.entryId,
        isAvailable: available,
        isActiveEntry: (ranks.get(node.nodeId) || 0) > 0,
      })),
    };
  });
  const spent = totalPoints - points;
  const treeId = definition.payload.treeId;

  return {
    api: definition.payload.sourceApi,
    kind: definition.payload.kind,
    configId: 10000 + (hash(`${className}${level}${buildName}`) % 89999),
    name: specName(className, buildName),
    treeIds: [treeId],
    pointsSpent: spent,
    pointsAvailable: points,
    currencies: [{ treeId, traitCurrencyId: 30000 + treeId, quantity: points, maxQuantity: 51, spent, spentInTree: spent }],
    allocations,
    nodeStates,
    treeHashes: definition.payload.treeHash ? [{ treeId, treeHash: Buffer.from(definition.payload.treeHash).toString("hex") }] : undefined,
  };
}

function professionsFor(names, level, random) {
  const cap = level >= 50 ? 300 : level >= 35 ? 225 : level >= 20 ? 150 : 75;
  const skill = (max) => Math.max(1, Math.min(max, Math.round(level * 5 - random() * 40)));
  const primary = names.map((name) => ({ name, max: cap }));
  const secondary = ["Cooking", "First Aid", "Fishing"]
    .filter(() => random() > 0.35)
    .map((name) => ({ name, max: cap }));

  return [...primary, ...secondary].map(({ name, max }) => {
    const profession = PROFESSIONS[name];
    return {
      skillLineId: profession.id,
      name,
      kind: profession.kind || "secondary",
      iconFileDataId: profession.icon,
      skillLevel: skill(max),
      maxSkillLevel: max,
      skillModifier: 0,
    };
  });
}

function recipeDifficulty(skill, level) {
  if (level < skill.yellow) return "optimal";
  if (level < skill.green) return "medium";
  if (level < skill.grey) return "easy";
  return "trivial";
}

// Guildweaver's profession_snapshot: every profession's skill, plus the whole
// recipe book for crafting professions (C_TradeSkillUI lists unlearned recipes
// too). Most recipes at or below the character's skill are known; the rest
// stand in for drops and vendor patterns nobody bought yet.
function professionSnapshotFor(snapshot) {
  const random = seededRandom(`${snapshot.characterId}:recipes`);
  const capturedAt = snapshot.capturedAt;
  const professions = snapshot.professions.map((profession) => {
    const book = RECIPE_BOOKS[profession.skillLineId];
    if (!book) return profession;
    const recipes = book.map((recipe) => {
      const known = recipe.skill.learn <= profession.skillLevel && random() < 0.85;
      const onCooldown = known && recipe.cooldownSeconds && random() < 0.5;
      return {
        recipeId: recipe.spellId,
        spellId: recipe.spellId,
        name: recipe.name,
        iconFileDataId: recipe.iconFileDataId,
        known,
        difficulty: recipeDifficulty(recipe.skill, profession.skillLevel),
        skillUps: recipe.skillUps,
        maxTrivialLevel: recipe.skill.grey,
        professionSkillLineId: profession.skillLineId,
        description: recipe.description,
        tools: recipe.tools.map((name) => ({ name, available: random() < 0.75 })),
        cooldown: onCooldown
          ? { readyAt: capturedAt + Math.round(random() * recipe.cooldownSeconds), isDayCooldown: recipe.cooldownSeconds >= 86400 }
          : undefined,
        crafted: recipe.crafted,
        reagents: recipe.reagents.map((reagent, index) => ({ ...reagent, required: true, slotIndex: index + 1 })),
      };
    });
    return {
      ...profession,
      recipeBook: {
        source: "C_TradeSkillUI",
        capturedAt,
        recipeCount: recipes.length,
        knownCount: recipes.filter((recipe) => recipe.known).length,
      },
      recipes,
    };
  });

  return {
    schemaVersion: 1,
    eventType: "profession_snapshot",
    capturedAt,
    gameBuild: { version: GAME_BUILD.version, build: GAME_BUILD.build, interface: GAME_BUILD.interface },
    realm: snapshot.realm,
    region: snapshot.region,
    installationId: snapshot.installationId,
    characterId: snapshot.characterId,
    addon: { name: "Guildweaver", version: ADDON_VERSION },
    payloadSchemaVersion: 1,
    payload: { schemaVersion: 1, professions },
  };
}

// This game build reports one class-level specialization (see the Warrior
// capture); the role follows the character's main talent tree.
function specializationFor(className, buildName, definition) {
  const spec = specName(className, buildName);
  const role = HEALER_SPECS.has(`${className}:${spec}`) ? "HEALER" : TANK_SPECS.has(`${className}:${spec}`) ? "TANK" : "DAMAGER";
  const captured = definition?.payload?.specialization;
  if (captured && !definition.synthetic) return captured;
  return { index: 1, name: className, iconFileDataId: CLASSES[className].icon, role };
}

function snapshotFor(member, row, capturedAt) {
  const [name, raceName, className, level, kitName, buildName, professions] = row;
  const random = seededRandom(`${member.id}:${name}`);
  const classInfo = CLASSES[className];
  const race = RACES[raceName];
  const definition = TALENT_TREES.find((tree) => tree.payload?.class?.token === classInfo.token);
  const equipment = equipmentFor(className, level, kitName);
  const sex = random() > 0.5 ? 2 : 3;
  const characterId = `character-dev-${name.toLowerCase()}`;

  return {
    schemaVersion: 3,
    capturedAt,
    addonVersion: ADDON_VERSION,
    installationId: `install-dev-${hash(member.id).toString(16)}`,
    characterKey: `${REALM.toLowerCase()}:${name.toLowerCase()}`,
    characterId,
    name,
    firstName: name,
    lastName: SURNAMES[name] || "",
    fullName: SURNAMES[name] ? `${name} ${SURNAMES[name]}` : name,
    realm: REALM,
    region: "US",
    gameBuild: GAME_BUILD,
    level,
    sex,
    bodyType: sex === 2 ? "male" : "female",
    race: { id: race.id, name: raceName, token: race.token },
    class: { id: classInfo.id, name: className, token: classInfo.token },
    guild: { name: "Holdfast", rankName: member.rank, rankIndex: 9 - (member.rankOrder ?? 1), realm: REALM },
    specialization: specializationFor(className, buildName, definition),
    talents: talentsFor(className, level, buildName, definition, random),
    professions: professionsFor(professions, level, random),
    equipment,
    stats: statsFor({ className, raceName, level, equipment }),
  };
}

function rosterMembers() {
  const rankOrder = ["Recruit", "Private", "Corporal", "Sergeant", "Master Sergeant", "Sergeant Major", "Lieutenant", "Captain", "Major", "Commander"];
  return ROSTER.map((entry) => ({
    id: entry.id,
    username: entry.name.toLowerCase(),
    displayName: entry.name,
    rank: entry.rank,
    rankOrder: rankOrder.indexOf(entry.rank),
    rankManaged: true,
    billetsManaged: true,
    status: "active",
    permissions: [],
    guildJoinedAt: `2026-0${1 + (hash(entry.id) % 9)}-1${hash(entry.name) % 9}T00:00:00.000Z`,
    profile: {
      battleTag: `${entry.name}#${1000 + (hash(entry.id) % 9000)}`,
      timezone: entry.tz,
      timezoneSource: "manual",
      availability: ["Evenings", "Weeknights", "Weekends", "Flexible"][hash(entry.name) % 4],
      bio: "Development fixture roster member.",
      characters: [],
    },
  }));
}

function deviceFor(memberId) {
  const existing = readGuildweaverDevices(memberId).find((device) => !device.revokedAt);
  if (existing) return existing.id;

  const pairing = startGuildweaverPairing({ deviceName: "Development seed bridge" });
  const approved = approveGuildweaverPairing({ userCode: pairing.userCode, memberId });
  if (approved.status !== "approved") throw new Error(`Unable to pair seed device for ${memberId}: ${approved.status}`);
  const exchanged = exchangeGuildweaverPairing(pairing.deviceCode);
  return exchanged.deviceId;
}

export async function seedDevelopmentCharacters({ now = Date.now(), logger = console } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development character data cannot be seeded in production.");
  }

  // Importing rewrites a member's profile and drops their characters, so only
  // create roster members that are missing.
  const members = rosterMembers();
  withGuildTransaction((db) => {
    const missing = members.filter((member) => !db.prepare("SELECT 1 FROM members WHERE id = ?").get(member.id));
    importMembersIntoDatabase(db, missing);
  });

  // Anchor capture times to the start of the current UTC day so re-runs are idempotent.
  const dayStart = Math.floor(now / 86400000) * 86400;
  const receivedAt = new Date(dayStart * 1000).toISOString();
  const rankByMember = new Map(members.map((member) => [member.id, member]));
  const owners = [
    ...ROSTER.map((entry) => [entry.id, entry.characters]),
    ...Object.entries(PERSONA_CHARACTERS),
  ];
  const counts = { created: 0, updated: 0, unchanged: 0, trees: 0, recipeBooks: 0 };

  for (const [memberId, characters] of owners) {
    const exists = withGuildTransaction((db) => Boolean(db.prepare("SELECT 1 FROM members WHERE id = ? AND status = 'active'").get(memberId)));
    if (!exists) {
      logger.log(`Skipping characters for ${memberId}: member not found (run npm run dev:seed to create personas).`);
      continue;
    }
    const member = rankByMember.get(memberId) || { id: memberId, rank: "Private", rankOrder: 1 };
    const deviceId = deviceFor(memberId);

    for (const tree of TALENT_TREES) {
      if (!characters.some((row) => CLASSES[row[2]].token === tree.payload?.class?.token)) continue;
      const treeKey = `talent_tree_definition:${tree.payload.class.token.toLowerCase()}:${tree.gameBuild?.build}:${tree.payload.treeId}`;
      const result = recordTelemetry({
        deviceId,
        memberId,
        idempotencyKey: `dev-seed:${memberId}:${treeKey}`,
        streamKey: treeKey,
        kind: "state",
        revision: 1,
        envelope: { ...tree, installationId: `install-dev-${hash(memberId).toString(16)}` },
        receivedAt,
      });
      if (result.status === "created") counts.trees += 1;
    }

    for (const [index, row] of characters.entries()) {
      // Mains were seen within the last few hours; alts drift back up to a few days.
      const capturedAt = dayStart - (index === 0 ? hash(row[0]) % 7200 : 86400 * (1 + (hash(row[0]) % 4)));
      const snapshot = snapshotFor(member, row, capturedAt);
      const result = await syncGuildweaverCharacter({
        memberId,
        snapshot,
        deviceId,
        bridgeRevision: 1,
        receivedAt,
      });
      if (result.status === "invalid" || result.status === "member-not-found") {
        throw new Error(`Unable to seed ${row[0]} for ${memberId}: ${result.status}`);
      }
      counts[result.status in counts ? result.status : "unchanged"] += 1;

      const professions = ingestTelemetry({
        deviceId,
        memberId,
        idempotencyKey: `dev-seed:${memberId}:profession_snapshot:${snapshot.characterId}:${capturedAt}`,
        body: {
          streamKey: `profession_snapshot:${snapshot.characterId}`,
          kind: "state",
          revision: capturedAt,
          envelope: professionSnapshotFor(snapshot),
        },
        receivedAt,
      });
      if (professions.status === "invalid") {
        throw new Error(`Unable to seed ${row[0]}'s professions: ${professions.error}`);
      }
      if (professions.status === "created") counts.recipeBooks += 1;
    }
  }

  logger.log(
    `Seeded ${members.length} roster members; character snapshots: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged; ${counts.trees} talent trees and ${counts.recipeBooks} profession snapshots recorded.`,
  );
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    await ensureRuntimeDataDirectory();
    initializeGuildData();
    await seedDevelopmentCharacters();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
