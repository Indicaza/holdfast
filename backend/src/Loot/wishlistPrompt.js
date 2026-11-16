// The two prompts a player copies into ChatGPT, Claude or any other AI:
// one to plan a wishlist from what Guildweaver knows, one to repair an
// answer that did not import. Plain text built here; no AI is called and
// no AI service is needed.
//
// Both state the output format the same way (IMPORT_FORMAT), and both tell
// the AI that item ids come from the list it was given and nowhere else.

import { withGuildDatabase } from "../Data/database.js";
import { readCharacterSectionsInDatabase } from "../Character/ReadModel/sectionStore.js";
import { lootCatalogRevisionInDatabase, lootItemFactsInDatabase, readLootDungeonInDatabase } from "./lootCatalogRepository.js";
import { MAX_NOTE, MAX_SOURCE_DUNGEON, MAX_WISHLIST_ITEMS, normalizedName } from "./lootModel.js";
import { ownedCharacterInDatabase, readWishlistInDatabase } from "./wishlistRepository.js";

export const MAX_PROMPT_CANDIDATES = 500;
const LEVEL_HEADROOM = 10;

export function importFormat(characterName, catalogRevision = null) {
  return [
    "{",
    '  "schemaVersion": 1,',
    `  "character": ${JSON.stringify(characterName)},`,
    ...(catalogRevision === null ? [] : [`  "catalogRevision": ${catalogRevision},`]),
    '  "items": [',
    "    {",
    '      "itemId": <number: an item id from the catalog above>,',
    '      "name": "<the item\'s name, exactly as listed>",',
    '      "priority": "high" | "normal" | "low",',
    `      "note": "<why, and the tradeoff, in at most ${MAX_NOTE} characters>",`,
    `      "sourceDungeon": "<the dungeon to run for it, at most ${MAX_SOURCE_DUNGEON} characters>"`,
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

const FORMAT_RULES = [
  "Return valid JSON only: one object, no Markdown, no comments, no text before or after it.",
  "itemId is a number. Use only item ids from the lists in this prompt. Never invent, guess or adjust an id.",
  "If an item you would recommend is not listed, leave it out (you may mention it in another item's note).",
  "Each item at most once. No fields other than the ones shown.",
  `At most ${MAX_WISHLIST_ITEMS} items.`,
];

function itemLine(item) {
  const facts = [item.slot, item.itemSubclass && item.itemSubclass !== item.slot ? item.itemSubclass : null,
    item.itemLevel ? `ilvl ${item.itemLevel}` : null, item.requiredLevel ? `req ${item.requiredLevel}` : null,
    item.classes ? `classes: ${item.classes.join("/")}` : null, item.confidence && item.confidence !== "confirmed" ? item.confidence : null].filter(Boolean);
  return `  - ${item.itemId} | ${item.name}${facts.length ? ` | ${facts.join(", ")}` : ""}`;
}

// Stat lines from a tooltip the game rendered ("+7 Strength", "Equip: ...").
function statLines(lines = []) {
  return lines.map((line) => String(line?.left || "").trim()).filter((left) => /^[+-]\d|^Equip:|^Chance on hit:|^Use:|\bArmor$|\bDamage\b|per second/i.test(left)).slice(0, 8);
}

// The planning prompt. `dungeons` are catalog dungeons with their sources
// and items (readLootDungeonInDatabase's shape); everything else is plain.
export function buildPlanningPrompt({ character, equipment = [], stats = [], dungeons = [], wishlist = [], catalogRevision = null, omitted = 0 }) {
  const lines = [];
  lines.push("You are helping a World of Warcraft: Forever player plan which dungeon gear to chase.",
    "Everything below comes from Guildweaver (the player's own synced character and a catalog of dungeon loot players have observed).",
    "", "BEFORE YOU ANSWER", "Ask me which build or playstyle I want if I have not said (for example: tank, healer, a damage spec, leveling). Then recommend gear for it.", "",
    "CHARACTER",
    `Name: ${character.name}`, `Level: ${character.level || "unknown"}`, `Class: ${character.className || "unknown"}${character.spec && character.spec !== character.className ? ` (${character.spec})` : ""}`,
    `Race: ${character.race || "unknown"}`);
  if (stats.length) lines.push(`Stats: ${stats.join(", ")}`);
  lines.push("", "CURRENTLY EQUIPPED");
  if (equipment.length) {
    for (const slot of equipment) {
      lines.push(`  - ${slot.slot}: ${slot.name || `item ${slot.itemId}`}${slot.itemId ? ` (${slot.itemId})` : ""}${slot.itemLevel ? `, ilvl ${slot.itemLevel}` : ""}${slot.stats?.length ? ` [${slot.stats.join("; ")}]` : ""}`);
    }
  } else {
    lines.push("  (not synced yet: ask me what I am wearing if it matters)");
  }
  lines.push("", "ALREADY ON THE WISHLIST");
  if (wishlist.length) for (const entry of wishlist) lines.push(`  - ${entry.itemId} | ${entry.name} | ${entry.priority}${entry.state === "acquired" ? " | already acquired" : ""}${entry.note ? ` | ${entry.note}` : ""}`);
  else lines.push("  (empty)");
  lines.push("", `DUNGEON LOOT CATALOG${catalogRevision === null ? "" : ` (revision ${catalogRevision})`}`,
    "Format: itemId | name | slot, type, item level, required level. Sources are bosses or creatures players saw the item drop from,",
    'or that the game\'s own journal lists ("advertised": listed, not yet seen; "reported": seen in a group roll, source unknown).',
    "The catalog is incomplete: an item missing here may still exist, but you cannot recommend it because you do not have its id.");
  if (!dungeons.length) lines.push("  (no dungeon loot is known yet)");
  for (const dungeon of dungeons) {
    lines.push("", `${dungeon.name}`);
    for (const source of dungeon.sources) {
      lines.push(` ${source.name || "Source not identified"}${source.boss ? " (boss)" : ""}:`);
      for (const item of source.items) lines.push(itemLine(item));
    }
  }
  if (omitted) lines.push("", `(${omitted} more catalog items were left out to keep this prompt short: items far above this character's level, or beyond the size limit.)`);
  lines.push("", "WHAT TO DO",
    "1. Recommend the upgrades worth chasing for my build, from the catalog above.",
    "2. Consider alternative builds and lateral upgrades (a different stat mix at a similar item level), and say so in the note.",
    "3. Explain each tradeoff in a short note. An item-level increase is not always an upgrade: say when it is not.",
    "4. Respect level: do not recommend items whose required level is far above mine unless I ask for future goals.",
    "5. Do not repeat items already on the wishlist unless you are changing their priority or note.",
    "6. Use high priority sparingly: the few items that matter most.",
    "", "OUTPUT FORMAT", ...FORMAT_RULES, "", importFormat(character.name, catalogRevision));
  return lines.join("\n");
}

function errorLine(error, index) {
  const parts = [`${index + 1}. [${error.code}] at ${error.path}`];
  if (error.received !== undefined) parts.push(`   received: ${JSON.stringify(error.received)}`);
  if (error.expected !== undefined) parts.push(`   expected: ${typeof error.expected === "string" ? error.expected : JSON.stringify(error.expected)}`);
  parts.push(`   problem: ${error.message}`);
  if (error.suggestion) parts.push(`   fix: ${error.suggestion}`);
  if (error.candidates?.length) parts.push(`   candidate ids: ${error.candidates.map((candidate) => `${candidate.itemId} (${candidate.name})`).join(", ")}`);
  return parts.join("\n");
}

// The repair prompt: the attempt, the exact errors, the format, and what
// to do. Errors about missing catalog knowledge are set apart, because the
// fix for those is to drop or replace the item, never to produce an id.
export function buildRepairPrompt({ text, errors, character }) {
  const catalog = errors.filter((error) => error.category === "catalog");
  const format = errors.filter((error) => error.category !== "catalog");
  const lines = ["The wishlist JSON you returned for Guildweaver could not be imported. Correct it and return the full corrected JSON.", ""];
  if (format.length) lines.push("FORMAT ERRORS (the JSON does not follow the required format)", ...format.map(errorLine), "");
  if (catalog.length) {
    lines.push("CATALOG ERRORS (the JSON may be well formed, but Guildweaver does not know these items)",
      "These are not formatting mistakes. Do not fix them by inventing or changing an id until it passes:",
      "use a candidate id when one is listed and it is the item you meant, otherwise remove the item.", ...catalog.map(errorLine), "");
  }
  lines.push("RULES", "Keep every item that had no error exactly as it was.", "Change only what the errors above name.", ...FORMAT_RULES, "",
    "REQUIRED FORMAT", importFormat(character.name), "", "YOUR PREVIOUS ANSWER", text.length > 20_000 ? `${text.slice(0, 20_000)}\n... (cut: the answer was too long; return a shorter list)` : text);
  return lines.join("\n");
}

// The numbers a gear plan needs from the character's synced stats: the
// attributes, health and power, and whichever combat ratings the client
// reported as more than zero. Read as sent; nothing is derived.
const COMBAT_STAT = /(health max|power max|attack ?power|spell ?power|healing|crit|hit|haste|armor|defen[cs]e|dodge|parry|block|resist)/i;

export function statSummary(payload) {
  const out = [];
  const visit = (value, label, depth, always) => {
    if (out.length >= 24 || depth > 4) return;
    if (value && typeof value === "object" && !Array.isArray(value) && (typeof value.effective === "number" || typeof value.value === "number")) value = value.effective ?? value.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      if (always || (value !== 0 && COMBAT_STAT.test(label))) out.push(`${label} ${Math.round(value * 100) / 100}`);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (/schemaVersion|capturedAt|status|source|id$/i.test(key)) continue;
      visit(entry, `${label} ${key}`.trim(), depth + 1, always);
    }
  };
  for (const [key, entry] of Object.entries(payload?.stats || {})) {
    if (key === "schemaVersion") continue;
    // Attributes read as "strength 66"; everything else keeps its path
    // ("health max 1122", "crit melee 7.97") without the group's name.
    visit(entry, "", 1, key === "attributes");
  }
  return out;
}

// Builds the planning prompt for one of the account's characters from its
// read model, its wishlist and the catalog. `instanceIds` narrows the
// catalog to chosen dungeons. Null for a character that is not theirs.
export function readPlanningPrompt({ memberId, characterId, instanceIds = [] }) {
  const member = String(memberId ?? "").trim();
  return withGuildDatabase((db) => {
    const character = ownedCharacterInDatabase(db, member, characterId);
    if (!character) return null;
    const sections = readCharacterSectionsInDatabase(db, character.id);
    const equipped = sections.equipment?.payload?.equipment;
    const slots = (Array.isArray(equipped) ? equipped : Array.isArray(equipped?.slots) ? equipped.slots : [])
      .map((slot) => ({ slot: String(slot?.slot ?? slot?.slotName ?? "").replace(/_/g, " "), itemId: Number(slot?.itemId ?? slot?.itemID) || null,
        name: typeof slot?.name === "string" ? slot.name : null, itemLevel: Number(slot?.itemLevel) || null }))
      .filter((slot) => slot.slot && slot.itemId);
    const equippedFacts = lootItemFactsInDatabase(db, slots.map((slot) => slot.itemId));
    const equipment = slots.map((slot) => {
      const facts = equippedFacts(slot.itemId);
      return { ...slot, name: slot.name || (facts.nameKnown ? facts.name : null), itemLevel: slot.itemLevel || facts.itemLevel, stats: statLines(facts.tooltip.lines) };
    });

    const wanted = new Set(instanceIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
    const instances = db.prepare("SELECT instance_id FROM dungeon_loot_instances ORDER BY name COLLATE NOCASE").all()
      .map((row) => row.instance_id).filter((id) => !wanted.size || wanted.has(id));
    let budget = MAX_PROMPT_CANDIDATES;
    let omitted = 0;
    const dungeons = [];
    const classKey = normalizedName(character.className);
    for (const instanceId of instances) {
      const dungeon = readLootDungeonInDatabase(db, instanceId);
      const sources = [];
      for (const source of dungeon?.sources || []) {
        const items = [];
        for (const item of source.items) {
          // Gear only, that the game does not restrict to another class,
          // within reach of the character's level. Delisted items stay out.
          if (!item.equippable || !item.nameKnown || item.confidence === "delisted") continue;
          if (item.classes && classKey && !item.classes.some((name) => normalizedName(name) === classKey)) continue;
          if (character.level && item.requiredLevel && item.requiredLevel > character.level + LEVEL_HEADROOM) { omitted += 1; continue; }
          if (budget <= 0) { omitted += 1; continue; }
          budget -= 1;
          items.push(item);
        }
        if (items.length) sources.push({ name: source.name, boss: source.boss, items });
      }
      if (sources.length) dungeons.push({ name: dungeon.instance.name, sources });
    }
    const wishlist = (readWishlistInDatabase(db, member, character.id)?.items || []).map((entry) => ({ itemId: entry.itemId, name: entry.item.name, priority: entry.priority, note: entry.note, state: entry.state }));
    const catalogRevision = lootCatalogRevisionInDatabase(db);
    return { schemaVersion: 1, character: { id: character.id, name: character.name }, catalogRevision,
      candidates: MAX_PROMPT_CANDIDATES - budget, omitted,
      prompt: buildPlanningPrompt({ character, equipment, stats: statSummary(sections.stats?.payload), dungeons, wishlist, catalogRevision, omitted }) };
  });
}
