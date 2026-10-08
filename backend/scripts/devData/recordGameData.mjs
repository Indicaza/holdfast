// Records real Classic item data for the development character generator.
//
//   node scripts/devData/recordGameData.mjs <community-listfile.csv>
//
// Item details come from Wowhead's public tooltip endpoint; icon FileDataIDs
// come from the wowdev community listfile
// (https://github.com/wowdev/wow-listfile/releases). The output mirrors the
// equipment fields Guildweaver captures in game, so seeded snapshots exercise
// the same code paths as real telemetry. Also writes icons.json (FileDataID ->
// icon name) for the development icon fallback. Re-run when kits.js changes or
// a new talent tree capture is added to seed/devData/talentTrees.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { kitItemIds } from "./kits.js";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outputPath = join(backendRoot, "seed", "devData", "items.json");
const iconOutputPath = join(backendRoot, "seed", "devData", "icons.json");
const talentTreeDir = join(backendRoot, "seed", "devData", "talentTrees");
// Class and profession icons used by the character generator.
const EXTRA_ICON_IDS = [
  625999, 626000, 626001, 626003, 626004, 626005, 626007, 626008,
  133611, 133971, 134366, 135966, 136065, 136240, 136241, 136243, 136244, 136245, 136248, 136249,
];
const TOOLTIP_URL = "https://nether.wowhead.com/classic/tooltip/item/";

const WHITE = { r: 1, g: 1, b: 1 };
const GREEN = { r: 0, g: 1, b: 0 };
const GOLD = { r: 1, g: 0.8235294818878174, b: 0 };
const GREY = { r: 0.501960813999176, g: 0.501960813999176, b: 0.501960813999176 };
const QUALITY_COLORS = {
  0: { r: 0.6156862974166870, g: 0.6156862974166870, b: 0.6156862974166870 },
  1: WHITE,
  2: { r: 0.1176470667123795, g: 1, b: 0 },
  3: { r: 0, g: 0.4392157196998596, b: 0.8666667342185974 },
  4: { r: 0.6392157077789307, g: 0.2078431546688080, b: 0.9333333969116211 },
  5: { r: 1, g: 0.5019608139991760, b: 0 },
};

const STAT_KEYS = {
  3: "ITEM_MOD_AGILITY_SHORT",
  4: "ITEM_MOD_STRENGTH_SHORT",
  5: "ITEM_MOD_INTELLECT_SHORT",
  6: "ITEM_MOD_SPIRIT_SHORT",
  7: "ITEM_MOD_STAMINA_SHORT",
};
const RESISTANCE_KEYS = {
  Holy: "RESISTANCE1_NAME",
  Fire: "RESISTANCE2_NAME",
  Nature: "RESISTANCE3_NAME",
  Frost: "RESISTANCE4_NAME",
  Shadow: "RESISTANCE5_NAME",
  Arcane: "RESISTANCE6_NAME",
};

function equipLocation(slotText, subclass) {
  if (slotText === "Off Hand" && subclass === "Shield") return "INVTYPE_SHIELD";
  if (slotText === "Chest" && subclass === "Cloth" ) return "INVTYPE_ROBE";
  if (slotText === "Ranged" && subclass === "Bow") return "INVTYPE_RANGED";
  return {
    Head: "INVTYPE_HEAD",
    Neck: "INVTYPE_NECK",
    Shoulder: "INVTYPE_SHOULDER",
    Back: "INVTYPE_CLOAK",
    Chest: "INVTYPE_CHEST",
    Shirt: "INVTYPE_BODY",
    Tabard: "INVTYPE_TABARD",
    Wrist: "INVTYPE_WRIST",
    Hands: "INVTYPE_HAND",
    Waist: "INVTYPE_WAIST",
    Legs: "INVTYPE_LEGS",
    Feet: "INVTYPE_FEET",
    Finger: "INVTYPE_FINGER",
    Trinket: "INVTYPE_TRINKET",
    "One-Hand": "INVTYPE_WEAPON",
    "Main Hand": "INVTYPE_WEAPONMAINHAND",
    "Off Hand": "INVTYPE_WEAPONOFFHAND",
    "Two-Hand": "INVTYPE_2HWEAPON",
    "Held In Off-hand": "INVTYPE_HOLDABLE",
    Ranged: "INVTYPE_RANGEDRIGHT",
    Thrown: "INVTYPE_THROWN",
  }[slotText] || null;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function line(left, leftColor = WHITE, right = undefined, rightColor = undefined) {
  const result = { left, leftColor };
  if (right) {
    result.right = right;
    result.rightColor = rightColor || WHITE;
  }
  return result;
}

function loadIconIds(listfilePath) {
  const icons = new Map();
  for (const row of readFileSync(listfilePath, "utf8").split("\n")) {
    const match = row.trim().match(/^(\d+);interface\/icons\/(.+)\.blp$/i);
    if (match) icons.set(match[2].toLowerCase(), Number(match[1]));
  }
  return icons;
}

function talentTreeIconIds() {
  const ids = [];
  for (const file of readdirSync(talentTreeDir).filter((name) => name.endsWith(".json"))) {
    const tree = JSON.parse(readFileSync(join(talentTreeDir, file), "utf8")).payload || {};
    if (tree.specialization?.iconFileDataId) ids.push(tree.specialization.iconFileDataId);
    for (const node of tree.nodes || []) {
      for (const entry of node.entries || []) ids.push(entry.iconFileDataId);
    }
  }
  return ids;
}

export function parseTooltip(itemId, data, iconIds) {
  const html = data.tooltip;
  const quality = Number(data.quality);
  const slotMatch = html.match(/<table width="100%"><tr><td>([^<]+)<\/td>(?:<th>(?:<!--scstart(\d+):(\d+)-->)?(?:<span class="q1">)?([^<]*))?/);
  const scMatch = html.match(/<!--scstart(\d+):(\d+)-->/);
  const slotText = slotMatch?.[1]?.trim() || (html.includes("<br>Neck") ? "Neck" : null);
  const subclass = slotMatch?.[4]?.trim() || null;
  const lines = [line(data.name, QUALITY_COLORS[quality] || WHITE)];
  const stats = {};

  const bind = html.match(/Binds when (picked up|equipped)/)?.[0];
  if (bind) lines.push(line(bind));
  if (/<br>Unique(?!-)/.test(html)) lines.push(line("Unique"));

  // Slots without a subclass (neck, finger, trinket, back) render as plain text.
  const plainSlot = html.match(/<!--ue--><!--ue--><br>(Neck|Finger|Trinket|Back|Shirt|Tabard)/)?.[1]
    || html.match(/<!--ue--><br>(Neck|Finger|Trinket|Back|Shirt|Tabard)/)?.[1];
  const resolvedSlot = slotText || plainSlot || null;
  if (resolvedSlot) lines.push(line(resolvedSlot, WHITE, subclass || undefined));

  const damage = html.match(/<!--dmg-->(\d+) - (\d+) Damage<\/span><\/td>\s*<th>Speed <!--spd-->([\d.]+)/);
  if (damage) lines.push(line(`${damage[1]} - ${damage[2]} Damage`, WHITE, `Speed ${damage[3]}`));
  for (const extra of html.matchAll(/<td colspan="2">([^<]+)<\/td>/g)) lines.push(line(extra[1].trim()));
  const dps = html.match(/<!--dps-->\(([\d.]+) damage per second\)/);
  if (dps) {
    lines.push(line(`(${dps[1]} damage per second)`));
    stats.ITEM_MOD_DAMAGE_PER_SECOND_SHORT = Number(dps[1]);
  }

  const armor = html.match(/<!--amr-->(\d+) Armor/);
  if (armor) {
    lines.push(line(`${armor[1]} Armor`));
    stats.RESISTANCE0_NAME = Number(armor[1]);
  }
  const blockMatch = html.match(/(\d+) Block<\/span>/);
  if (blockMatch) lines.push(line(`${blockMatch[1]} Block`));

  for (const stat of html.matchAll(/<!--stat(\d+)-->([+-]\d+) ([A-Za-z]+)/g)) {
    lines.push(line(`${stat[2]} ${stat[3]}`));
    if (STAT_KEYS[stat[1]]) stats[STAT_KEYS[stat[1]]] = Number(stat[2]);
  }
  for (const resist of html.matchAll(/<br>\+(\d+) (Holy|Fire|Nature|Frost|Shadow|Arcane) Resistance/g)) {
    lines.push(line(`+${resist[1]} ${resist[2]} Resistance`));
    stats[RESISTANCE_KEYS[resist[2]]] = Number(resist[1]);
  }

  const durability = html.match(/Durability (\d+) \/ (\d+)/);
  if (durability) lines.push(line(`Durability ${durability[1]} / ${durability[2]}`));
  const requiredLevel = Number(html.match(/Requires Level <!--rlvl-->(\d+)/)?.[1]) || null;
  if (requiredLevel) lines.push(line(`Requires Level ${requiredLevel}`));
  const classes = html.match(/Classes: (.+?)<\/div>|Classes: (.+?)<br/);
  if (classes) lines.push(line(`Classes: ${stripTags(classes[1] || classes[2])}`));

  for (const effect of html.matchAll(/<span[^>]*class="q2">((?:Equip|Use|Chance on hit):.+?)<\/span>/g)) {
    lines.push(line(stripTags(effect[1]), GREEN));
  }

  const setName = html.match(/item-set=\d+[^"]*" class="q">([^<]+)<\/a> \((\d+)\/(\d+)\)/);
  if (setName) {
    lines.push(line(`${setName[1]} (0/${setName[3]})`, GOLD));
    for (const bonus of html.matchAll(/<span>(\(\d+\) Set : .+?)<\/span>/g)) {
      lines.push(line(stripTags(bonus[1]), GREY));
    }
  }

  const gold = Number(html.match(/moneygold">(\d+)/)?.[1] || 0);
  const silver = Number(html.match(/moneysilver">(\d+)/)?.[1] || 0);
  const copper = Number(html.match(/moneycopper">(\d+)/)?.[1] || 0);
  const sellPrice = gold * 10000 + silver * 100 + copper;

  const classId = scMatch ? Number(scMatch[1]) : 4;
  const subclassId = scMatch ? Number(scMatch[2]) : 0;
  const location = equipLocation(resolvedSlot, subclass);
  const icon = String(data.icon || "").toLowerCase();

  return {
    itemId,
    name: data.name,
    qualityId: quality,
    itemLevel: Number(html.match(/Item Level <!--ilvl-->(\d+)/)?.[1]) || null,
    requiredLevel,
    iconName: icon,
    iconFileDataId: iconIds.get(icon) || null,
    itemClass: { id: classId, name: classId === 2 ? "Weapon" : "Armor" },
    itemSubclass: { id: subclassId, name: subclass || "Miscellaneous" },
    equipLocation: location,
    bindType: bind === "Binds when picked up" ? 1 : bind ? 2 : 0,
    expansionId: 0,
    setId: Number(html.match(/item-set=(\d+)/)?.[1]) || null,
    sellPrice: sellPrice || null,
    stats,
    durability: durability ? { current: Number(durability[1]), max: Number(durability[2]) } : null,
    tooltip: { source: "C_TooltipInfo.GetHyperlink", lines },
  };
}

async function main() {
  const listfilePath = process.argv[2];
  if (!listfilePath) {
    console.error("Usage: node scripts/devData/recordGameData.mjs <community-listfile.csv>");
    process.exitCode = 1;
    return;
  }

  const iconIds = loadIconIds(listfilePath);
  const items = {};
  for (const itemId of kitItemIds()) {
    const response = await fetch(`${TOOLTIP_URL}${itemId}`);
    if (!response.ok) throw new Error(`Item ${itemId}: HTTP ${response.status}`);
    const item = parseTooltip(itemId, await response.json(), iconIds);
    items[itemId] = item;
    console.log(`${itemId}\t${item.equipLocation}\tL${item.requiredLevel}\tq${item.qualityId}\ticon=${item.iconFileDataId}\t${item.name}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  writeFileSync(outputPath, `${JSON.stringify({
    source: "Wowhead Classic tooltips + wowdev community listfile",
    recordedAt: new Date().toISOString().slice(0, 10),
    items,
  }, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(items).length} items to ${outputPath}`);

  // FileDataID -> icon name for the development icon fallback.
  const namesById = new Map([...iconIds].map(([name, id]) => [id, name]));
  const wanted = new Set([
    ...Object.values(items).map((item) => item.iconFileDataId),
    ...talentTreeIconIds(),
    ...EXTRA_ICON_IDS,
  ].filter(Boolean));
  const icons = Object.fromEntries(
    [...wanted].sort((a, b) => a - b).filter((id) => namesById.has(id)).map((id) => [id, namesById.get(id)]),
  );
  writeFileSync(iconOutputPath, `${JSON.stringify({ source: "wowdev community listfile", icons }, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(icons).length} of ${wanted.size} icon names to ${iconOutputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
