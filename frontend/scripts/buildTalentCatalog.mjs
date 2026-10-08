// Builds the static talent layout catalog and art used by the Armory talent tab.
//
//   node scripts/buildTalentCatalog.mjs
//
// Talent node IDs, rows, and columns come from Wowhead's WoW Forever talent
// calculator data, which uses the same trait node IDs the Guildweaver addon
// captures in game. Tab order, names, and header icons match the in-game talent
// frame. Per-rank descriptions feed the tooltip's next-rank text. Background
// art and header icons are copied into public/talent-art so the Armory never
// hotlinks a third-party CDN at runtime.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(root, "src", "Intelligence", "talentCatalog.json");
const ART_DIR = join(root, "public", "talent-art");
const DATA_URL = "https://nether.wowhead.com/forever/data/talents-classic";
const BACKGROUND_URL = "https://wow.zamimg.com/images/wow/talents/backgrounds/classicplus";
const ICON_URL = "https://wow.zamimg.com/images/wow/icons/large";

// In-game tab order per class: [tabId, name, header icon].
const CLASSES = {
  WARRIOR: [[161, "Arms", "ability_warrior_savageblow"], [164, "Fury", "ability_warrior_innerrage"], [163, "Protection", "inv_shield_06"]],
  PALADIN: [[382, "Holy", "spell_holy_holybolt"], [383, "Protection", "spell_holy_devotionaura"], [381, "Retribution", "spell_holy_auraoflight"]],
  HUNTER: [[361, "Beast Mastery", "ability_hunter_beasttaming"], [363, "Marksmanship", "ability_marksmanship"], [362, "Survival", "ability_hunter_swiftstrike"]],
  ROGUE: [[182, "Assassination", "ability_rogue_eviscerate"], [181, "Combat", "ability_backstab"], [183, "Subtlety", "ability_stealth"]],
  PRIEST: [[201, "Discipline", "spell_holy_wordfortitude"], [202, "Holy", "spell_holy_guardianspirit"], [203, "Shadow", "spell_shadow_shadowwordpain"]],
  SHAMAN: [[261, "Elemental", "spell_nature_lightning"], [263, "Enhancement", "spell_nature_lightningshield"], [262, "Restoration", "spell_nature_magicimmunity"]],
  MAGE: [[81, "Arcane", "spell_holy_magicalsentry"], [41, "Fire", "spell_fire_firebolt02"], [61, "Frost", "spell_frost_frostbolt02"]],
  WARLOCK: [[302, "Affliction", "spell_shadow_deathcoil"], [303, "Demonology", "spell_shadow_metamorphosis"], [301, "Destruction", "spell_shadow_rainoffire"]],
  DRUID: [[283, "Balance", "spell_nature_starfall"], [281, "Feral Combat", "ability_racial_bearform"], [282, "Restoration", "spell_nature_healingtouch"]],
};

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

const source = await (await fetch(DATA_URL)).text();
const start = source.indexOf(",") + 1;
const data = JSON.parse(source.slice(start, source.indexOf(");\n", start)));

// Wowhead descriptions carry level-scaling comments, <br />, and color spans.
function plainText(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

const tabs = {};
const nodes = {};
const descriptions = {};
let rows = 0;

for (const [token, classTabs] of Object.entries(CLASSES)) {
  for (const [tabId, name] of classTabs) {
    tabs[tabId] = { name, class: token, talents: {} };
    for (const talent of Object.values(data.talents[tabId] || {})) {
      nodes[talent.id] = [tabId, talent.row, talent.col];
      tabs[tabId].talents[talent.name] = talent.id;
      descriptions[talent.id] = Object.keys(talent.descriptions || {})
        .sort((a, b) => Number(a) - Number(b))
        .map((rank) => plainText(talent.descriptions[rank]));
      rows = Math.max(rows, talent.row + 1);
    }
  }
}

const catalog = {
  source: "Wowhead WoW Forever talent calculator",
  grid: { columns: 4, rows },
  classes: Object.fromEntries(Object.entries(CLASSES).map(([token, classTabs]) => [token, classTabs.map(([tabId]) => tabId)])),
  tabs,
  nodes,
  descriptions,
};

writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog)}\n`);

mkdirSync(join(ART_DIR, "icons"), { recursive: true });
for (const classTabs of Object.values(CLASSES)) {
  for (const [tabId, , icon] of classTabs) {
    await download(`${BACKGROUND_URL}/${tabId}.jpg`, join(ART_DIR, `${tabId}.jpg`));
    await download(`${ICON_URL}/${icon}.jpg`, join(ART_DIR, "icons", `${tabId}.jpg`));
  }
}

console.log(`Wrote ${Object.keys(nodes).length} nodes across ${Object.keys(tabs).length} tabs (${rows} rows).`);
