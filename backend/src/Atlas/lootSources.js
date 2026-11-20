// Readers for the loot intelligence sources (docs/loot-sources.md):
//
//   * the WoW Forever client's own item tables (ItemSparse, Item, ItemSet),
//     as wago.tools exports them for product "wowf": names, quality, levels,
//     slot, class, icon, binding, restrictions. The Forever format carries no
//     stat, armour or damage values (the client derives them), so those stay
//     unknown here; items the client hides have an Item row (class, slot,
//     sometimes the icon) and no ItemSparse row.
//   * ForeverDB's add-on data files (https://foreverdb.net, GPL-3.0 with an
//     attribution term: "Data from ForeverDB.net"): gear facts (Gear.lua),
//     gear names (GearSources.lua) and per-boss loot with drop rates measured
//     over looted kills (Loot.lua).
//
// Pure functions over the files' text; scripts/fetchLootSources.mjs fetches
// them and writes the extracts under data/sources/.

const int = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
};
const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
};

// ------------------------------------------------------------ Forever client

// The Forever client's facts for the given items. `tables`: ItemSparse, Item
// and ItemSet CSV rows (Atlas/atlasSources.js parseCsv). An item with an Item
// row and no ItemSparse row is one the client hides: only what Item says is
// known (hidden: true). Values the Forever format does not hold are left out,
// never zero.
export function extractForeverClientItems({ tables, itemIds = null }) {
  const wanted = itemIds ? new Set(itemIds) : null;
  const sparse = new Map((tables.ItemSparse || []).map((row) => [int(row.ID), row]));
  const sets = new Map((tables.ItemSet || []).map((row) => [int(row.ID), text(row.Name_lang)]));
  const items = [];
  for (const row of tables.Item || []) {
    const id = int(row.ID);
    if (!id || (wanted && !wanted.has(id))) continue;
    const facts = sparse.get(id);
    const item = {
      id, classId: int(row.ClassID), subclassId: int(row.SubclassID), inventoryType: int(row.InventoryType) ?? 0,
      icon: int(row.IconFileDataID) || null, hidden: !facts,
    };
    if (facts) {
      Object.assign(item, {
        name: text(facts.Display_lang), quality: int(facts.OverallQualityID), itemLevel: int(facts.ItemLevel), requiredLevel: int(facts.RequiredLevel),
        allowableClass: int(facts.AllowableClass), bonding: int(facts.Bonding) || 0, delay: int(facts.ItemDelay) || 0,
        itemSet: int(facts.ItemSet) || 0, setName: sets.get(int(facts.ItemSet)) ?? null, startQuestId: int(facts.StartQuestID) || 0,
        sellPrice: int(facts.SellPrice),
      });
      // ItemSparse's inventory type is the one the tooltip shows.
      if (int(facts.InventoryType) !== null) item.inventoryType = int(facts.InventoryType);
    }
    items.push(item);
  }
  items.sort((a, b) => a.id - b.id);
  return items;
}

// ------------------------------------------------------------ ForeverDB

// The build and data version a ForeverDB file names in its first line.
export function foreverDbBuild(fileText) {
  return /build (\d+\.\d+\.\d+\.\d+)/.exec(String(fileText).slice(0, 400))?.[1] ?? null;
}

// The `[id]="..."` entries of one table assignment (`ns.<name> = {...}`).
function tableEntries(fileText, name) {
  const start = fileText.indexOf(`ns.${name} = {`);
  if (start < 0) return [];
  const entries = [];
  const pattern = /\[(\d+)\]="((?:[^"\\]|\\.)*)"/g;
  let depth = 0;
  let index = fileText.indexOf("{", start);
  // The table ends at its matching brace (strings hold no braces here).
  for (; index < fileText.length; index += 1) {
    const char = fileText[index];
    if (char === "{") depth += 1;
    else if (char === "}") { depth -= 1; if (depth === 0) break; }
  }
  const body = fileText.slice(start, index);
  for (const match of body.matchAll(pattern)) entries.push([Number(match[1]), match[2]]);
  return entries;
}

// Gear.lua's `ns.gear`: "inventoryType;classId;subclassId;requiredLevel;
// stat:value,...;dps x10;armor". The layout is ForeverDB's own and not
// documented in the file; scripts/fetchLootSources.mjs checks the inventory
// type and required level against the Forever client on every item both
// know, and refuses the file if they disagree.
export function parseForeverDbGear(fileText) {
  const rows = [];
  for (const [id, value] of tableEntries(fileText, "gear")) {
    const [inventoryType, classId, subclassId, requiredLevel, stats, dps, armor] = value.split(";");
    const statList = String(stats || "").split(",").filter(Boolean).map((pair) => pair.split(":").map(Number))
      .filter(([stat, amount]) => Number.isInteger(stat) && Number.isFinite(amount));
    rows.push({
      id, inventoryType: int(inventoryType), classId: int(classId), subclassId: int(subclassId), requiredLevel: int(requiredLevel),
      stats: statList, dps: int(dps) ? int(dps) / 10 : null, armor: int(armor) || null,
    });
  }
  return rows.sort((a, b) => a.id - b.id);
}

// GearSources.lua's `ns.gfItemText`: one line per item, "id (base 36)|name|...".
export function parseForeverDbNames(fileText) {
  const start = fileText.indexOf("ns.gfItemText = [==[");
  const end = start < 0 ? -1 : fileText.indexOf("]==]", start);
  if (start < 0 || end < 0) return new Map();
  const names = new Map();
  for (const line of fileText.slice(start + "ns.gfItemText = [==[".length, end).split("\n")) {
    const [key, name] = line.split("|");
    const id = key ? parseInt(key, 36) : NaN;
    if (Number.isSafeInteger(id) && id > 0 && text(name)) names.set(id, text(name));
  }
  return names;
}

// One loot entry: "item:pct:src[:h[:kills[:seen]]]" (Loot.lua's own legend):
// src "f" seen in WoW Forever (pct measured over `kills` looted kills), "c"
// Classic data (CMaNGOS); pct 0 unknown; h 1 hidden by Blizzard, 2 revealed
// by players; seen: how many drops players saw.
export function parseLootEntry(entry) {
  const [itemId, pct, src, hidden, kills, seen] = String(entry).split(":");
  const id = int(itemId);
  if (!id || id <= 0) return null;
  const rate = Number(pct);
  return {
    itemId: id,
    pct: Number.isFinite(rate) && rate > 0 ? rate : null,
    observed: src === "f",
    classic: src === "c",
    hidden: hidden === "1" ? "hidden" : hidden === "2" ? "revealed" : null,
    kills: int(kills),
    seen: int(seen),
  };
}

// Loot.lua's `ns.lootDB`: instances in level order with their bosses' loot
// and their trash's. Read line by line (the generator writes one instance
// header, one boss or one trash list per line).
export function parseForeverDbLoot(fileText) {
  const instances = [];
  let current = null;
  for (const line of String(fileText).split("\n")) {
    const head = /^\s*\{ id = (\d+), name = "((?:[^"\\]|\\.)*)", kind = "(\w+)"/.exec(line);
    if (head) {
      current = { instanceId: Number(head[1]), name: head[2], kind: head[3], forever: /forever = true/.test(line), bosses: [], trash: [] };
      instances.push(current);
      continue;
    }
    if (!current) continue;
    const boss = /^\s*\{ (?:npc = (\d+), )?name = "((?:[^"\\]|\\.)*)", loot = "([^"]*)"/.exec(line);
    if (boss) {
      current.bosses.push({ npcId: boss[1] ? Number(boss[1]) : null, name: boss[2], loot: boss[3].split(";").map(parseLootEntry).filter(Boolean) });
      continue;
    }
    const trash = /^\s*trash = "([^"]*)"/.exec(line);
    if (trash) current.trash = trash[1].split(";").map(parseLootEntry).filter(Boolean);
  }
  return instances;
}
