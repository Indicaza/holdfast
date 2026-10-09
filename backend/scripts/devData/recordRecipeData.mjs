// Records real Classic recipe books for the development character generator.
//
//   node scripts/devData/recordRecipeData.mjs <db2-csv-dir> <community-listfile.csv>
//
// <db2-csv-dir> holds CSV exports of these wow_classic_era DB2 tables from
// https://wago.tools/db2/<Table>/csv?product=wow_classic_era : SkillLineAbility,
// SpellName, Spell, SpellMisc, SpellEffect, SpellReagents, SpellTotems,
// SpellCooldowns, SpellCastingRequirements, SpellFocusObject, Item,
// ItemSparse. Icon names come from the wowdev community listfile
// (https://github.com/wowdev/wow-listfile/releases), as in recordGameData.mjs.
//
// Writes seed/devData/recipes.json (recipes per profession skill line, shaped
// close to what Guildweaver's profession capture reports) and adds the recipe,
// reagent and crafted item icons to seed/devData/icons.json.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outputPath = join(backendRoot, "seed", "devData", "recipes.json");
const iconOutputPath = join(backendRoot, "seed", "devData", "icons.json");

// Profession skill lines whose recipe books the generator can fill.
const SKILL_LINES = {
  171: "Alchemy",
  164: "Blacksmithing",
  333: "Enchanting",
  202: "Engineering",
  165: "Leatherworking",
  186: "Mining",
  197: "Tailoring",
  185: "Cooking",
  129: "First Aid",
};
// Original Classic content only: later seasons add recipes with higher IDs.
const MAX_SPELL_ID = 30000;
const MAX_ITEM_ID = 25000;
const CREATE_ITEM_EFFECT = 24;
const ENCHANT_ITEM_EFFECT = 53;

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((entry) => entry.length === header.length)
    .map((entry) => Object.fromEntries(header.map((name, index) => [name, entry[index]])));
}

function table(dir, name) {
  return parseCsv(readFileSync(join(dir, `${name}.csv`), "utf8"));
}

function indexBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

function loadIconNames(listfilePath) {
  const names = new Map();
  for (const row of readFileSync(listfilePath, "utf8").split("\n")) {
    const match = row.trim().match(/^(\d+);interface\/icons\/(.+)\.blp$/i);
    if (match) names.set(Number(match[1]), match[2].toLowerCase());
  }
  return names;
}

function cleanDescription(value) {
  const text = String(value || "").replace(/\$[a-z]?\d*[a-z]\d?/gi, "").replace(/\s+/g, " ").trim();
  // Descriptions with unresolved spell tokens read badly; leave those out.
  return text && !/[$]/.test(text) ? text : null;
}

function main() {
  const [dbDir, listfilePath] = process.argv.slice(2);
  if (!dbDir || !listfilePath) {
    console.error("Usage: node scripts/devData/recordRecipeData.mjs <db2-csv-dir> <community-listfile.csv>");
    process.exitCode = 1;
    return;
  }

  const spellNames = indexBy(table(dbDir, "SpellName"), "ID");
  const spellText = indexBy(table(dbDir, "Spell"), "ID");
  const spellMisc = indexBy(table(dbDir, "SpellMisc").filter((row) => row.DifficultyID === "0"), "SpellID");
  const effects = groupBy(table(dbDir, "SpellEffect").filter((row) => row.DifficultyID === "0"), "SpellID");
  const reagents = indexBy(table(dbDir, "SpellReagents"), "SpellID");
  const totems = indexBy(table(dbDir, "SpellTotems"), "SpellID");
  const cooldowns = indexBy(table(dbDir, "SpellCooldowns").filter((row) => row.DifficultyID === "0"), "SpellID");
  const casting = indexBy(table(dbDir, "SpellCastingRequirements"), "SpellID");
  const focusObjects = indexBy(table(dbDir, "SpellFocusObject"), "ID");
  const items = indexBy(table(dbDir, "Item"), "ID");
  const itemText = indexBy(table(dbDir, "ItemSparse"), "ID");
  const iconNames = loadIconNames(listfilePath);

  function item(itemId) {
    const id = String(itemId);
    const base = items.get(id);
    const sparse = itemText.get(id);
    if (!base || !sparse?.Display_lang) return null;
    return {
      itemId: Number(id),
      name: sparse.Display_lang,
      iconFileDataId: Number(base.IconFileDataID) || null,
      qualityId: Number(sparse.OverallQualityID ?? 1),
    };
  }

  const professions = {};
  const seen = new Set();
  for (const row of table(dbDir, "SkillLineAbility")) {
    const skillLineId = Number(row.SkillLine);
    const spellId = Number(row.Spell);
    if (!SKILL_LINES[skillLineId] || spellId >= MAX_SPELL_ID || seen.has(spellId)) continue;
    const reagentRow = reagents.get(row.Spell);
    const name = spellNames.get(row.Spell)?.Name_lang;
    if (!reagentRow || !name) continue;

    const spellEffects = effects.get(row.Spell) || [];
    const create = spellEffects.find((effect) => Number(effect.Effect) === CREATE_ITEM_EFFECT && Number(effect.EffectItemType));
    const enchants = spellEffects.some((effect) => Number(effect.Effect) === ENCHANT_ITEM_EFFECT);
    if (!create && !enchants) continue;
    if (create && Number(create.EffectItemType) >= MAX_ITEM_ID) continue;
    const createdItem = create ? item(create.EffectItemType) : null;
    if (create && !createdItem) continue;

    const recipeReagents = [];
    for (let slot = 0; slot < 8; slot += 1) {
      const reagentId = Number(reagentRow[`Reagent_${slot}`]);
      const quantity = Number(reagentRow[`ReagentCount_${slot}`]);
      if (!reagentId || quantity <= 0) continue;
      const reagent = item(reagentId);
      if (reagent) recipeReagents.push({ ...reagent, quantity });
    }
    if (!recipeReagents.length) continue;

    const tools = [];
    const focus = focusObjects.get(casting.get(row.Spell)?.RequiresSpellFocus || "");
    if (focus?.Name_lang) tools.push(focus.Name_lang);
    for (const slot of [0, 1]) {
      const tool = item(totems.get(row.Spell)?.[`Totem_${slot}`] || 0);
      if (tool) tools.push(tool.name);
    }

    const cooldown = cooldowns.get(row.Spell);
    const cooldownMs = Math.max(Number(cooldown?.RecoveryTime) || 0, Number(cooldown?.CategoryRecoveryTime) || 0);
    const yellow = Number(row.TrivialSkillLineRankLow) || 0;
    const grey = Number(row.TrivialSkillLineRankHigh) || 0;
    // Created count is BasePoints plus a 1..DieSides roll, at least one.
    const basePoints = Number(create?.EffectBasePoints) || 0;
    const dieSides = Number(create?.EffectDieSides) || 0;
    const minQuantity = Math.max(1, basePoints + Math.min(dieSides, 1));
    seen.add(spellId);
    (professions[skillLineId] ||= []).push({
      spellId,
      name,
      iconFileDataId: createdItem?.iconFileDataId || Number(spellMisc.get(row.Spell)?.SpellIconFileDataID) || null,
      description: cleanDescription(spellText.get(row.Spell)?.Description_lang),
      // Orange until yellow, yellow until green, green until grey. The learn
      // rank is not in the client data; trainers teach about 25 points early.
      skill: {
        learn: Math.max(1, Number(row.MinSkillLineRank) || 1, yellow - 25),
        yellow,
        green: Math.round((yellow + grey) / 2),
        grey,
      },
      skillUps: Number(row.NumSkillUps) || 1,
      cooldownSeconds: cooldownMs ? cooldownMs / 1000 : null,
      tools,
      crafted: createdItem
        ? {
            ...createdItem,
            minQuantity,
            maxQuantity: Math.max(minQuantity, basePoints + dieSides),
          }
        : null,
      reagents: recipeReagents,
    });
  }

  for (const recipes of Object.values(professions)) {
    recipes.sort((left, right) => left.skill.learn - right.skill.learn || left.name.localeCompare(right.name));
  }

  // One recipe per line keeps the file small and its diffs readable.
  const books = Object.entries(professions)
    .map(([id, recipes]) => `    "${id}": [\n${recipes.map((recipe) => `      ${JSON.stringify(recipe)}`).join(",\n")}\n    ]`)
    .join(",\n");
  writeFileSync(
    outputPath,
    `{\n  "source": "wago.tools wow_classic_era DB2 tables",\n  "recordedAt": "${new Date().toISOString().slice(0, 10)}",\n  "professions": {\n${books}\n  }\n}\n`,
  );
  const counts = Object.entries(professions).map(([id, recipes]) => `${SKILL_LINES[id]} ${recipes.length}`);
  console.log(`Wrote recipes to ${outputPath}: ${counts.join(", ")}`);

  const iconFile = JSON.parse(readFileSync(iconOutputPath, "utf8"));
  // INV_Misc_Book_11, the Professions pane's overview tab.
  const wanted = new Set([133743]);
  for (const recipes of Object.values(professions)) {
    for (const recipe of recipes) {
      wanted.add(recipe.iconFileDataId);
      if (recipe.crafted) wanted.add(recipe.crafted.iconFileDataId);
      for (const reagent of recipe.reagents) wanted.add(reagent.iconFileDataId);
    }
  }
  let added = 0;
  for (const id of wanted) {
    const name = iconNames.get(id);
    if (name && !iconFile.icons[id]) {
      iconFile.icons[id] = name;
      added += 1;
    }
  }
  iconFile.icons = Object.fromEntries(Object.entries(iconFile.icons).sort(([left], [right]) => Number(left) - Number(right)));
  writeFileSync(iconOutputPath, `${JSON.stringify(iconFile, null, 2)}\n`);
  console.log(`Added ${added} icon names to ${iconOutputPath}`);
}

main();
