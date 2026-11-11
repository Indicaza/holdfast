// Auction House categories and search names. One place maps WoW item
// classes and subclasses (the game's Enum.ItemClass ids, as the add-on's
// GetItemInfo and Blizzard's item API report them) to the category tree the
// Auction House shows. The backend filters with it and sends the tree to the
// website, so no screen keeps its own list.
//
// Pure: no database access.

// Item class ids, as the game numbers them.
export const ITEM_CLASS = Object.freeze({
  consumable: 0, container: 1, weapon: 2, gem: 3, armor: 4, reagent: 5, projectile: 6, tradeGoods: 7, itemEnhancement: 8,
  recipe: 9, quiver: 11, quest: 12, key: 13, miscellaneous: 15, glyph: 16, battlePet: 17, wowToken: 18, profession: 19,
});

// English class and subclass names the game uses, for items whose data
// carries names but no ids (older add-on data). Lower-cased lookups.
const CLASS_NAMES = {
  consumable: 0, consumables: 0, container: 1, containers: 1, bag: 1, weapon: 2, weapons: 2, gem: 3, gems: 3, armor: 4, armour: 4,
  reagent: 5, projectile: 6, "trade goods": 7, tradeskill: 7, tradegoods: 7, "item enhancement": 8, "item enhancements": 8,
  recipe: 9, recipes: 9, quiver: 11, quest: 12, "quest items": 12, key: 13, keys: 13, miscellaneous: 15, misc: 15,
  glyph: 16, glyphs: 16, "battle pets": 17, "battle pet": 17, "wow token": 18, profession: 19,
};

const SUBCLASS_NAMES = {
  0: { consumable: 0, potion: 1, potions: 1, elixir: 2, elixirs: 2, flask: 3, flasks: 3, scroll: 4, scrolls: 4, "food & drink": 5, "food and drink": 5,
    "item enhancement": 6, bandage: 7, bandages: 7, other: 8 },
  1: { bag: 0, "soul bag": 1, "herb bag": 2, "enchanting bag": 3, "engineering bag": 4, "gem bag": 5, "mining bag": 6, "leatherworking bag": 7,
    "inscription bag": 8, "tackle box": 9, "cooking bag": 10 },
  2: { "one-handed axes": 0, "two-handed axes": 1, bows: 2, guns: 3, "one-handed maces": 4, "two-handed maces": 5, polearms: 6,
    "one-handed swords": 7, "two-handed swords": 8, warglaives: 9, staves: 10, "fist weapons": 13, miscellaneous: 14, daggers: 15, thrown: 16,
    spears: 17, crossbows: 18, wands: 19, "fishing poles": 20, "fishing pole": 20 },
  3: { red: 0, blue: 1, yellow: 2, purple: 3, green: 4, orange: 5, meta: 6, simple: 7, prismatic: 8, hydraulic: 9, cogwheel: 10 },
  4: { miscellaneous: 0, cloth: 1, leather: 2, mail: 3, plate: 4, cosmetic: 5, shields: 6, shield: 6, librams: 7, idols: 8, totems: 9, sigils: 10, relic: 11, relics: 11 },
  7: { "trade goods": 0, parts: 1, explosives: 2, devices: 3, jewelcrafting: 4, cloth: 5, leather: 6, "metal & stone": 7, "metal and stone": 7,
    meat: 8, cooking: 8, herb: 9, herbs: 9, elemental: 10, other: 11, enchanting: 12, materials: 13, "item enchantment": 14, inscription: 16 },
  9: { book: 0, books: 0, leatherworking: 1, tailoring: 2, engineering: 3, blacksmithing: 4, cooking: 5, alchemy: 6, "first aid": 7,
    enchanting: 8, fishing: 9, jewelcrafting: 10, inscription: 11 },
  15: { junk: 0, reagent: 1, "companion pets": 2, "companion pet": 2, pet: 2, holiday: 3, other: 4, mount: 5, mounts: 5, "mount equipment": 6 },
  16: { warrior: 1, paladin: 2, hunter: 3, rogue: 4, priest: 5, "death knight": 6, shaman: 7, mage: 8, warlock: 9, monk: 10, druid: 11 },
};

// Equipment slots (the game's Enum.InventoryType), from the add-on's
// GetItemInfo equip location ("INVTYPE_CHEST") or Blizzard's item API
// ("CHEST").
const INVENTORY_TYPES = {
  HEAD: 1, NECK: 2, SHOULDER: 3, BODY: 4, SHIRT: 4, CHEST: 5, WAIST: 6, LEGS: 7, FEET: 8, WRIST: 9, HAND: 10, HANDS: 10,
  FINGER: 11, TRINKET: 12, WEAPON: 13, SHIELD: 14, RANGED: 15, CLOAK: 16, BACK: 16, "2HWEAPON": 17, TWOHWEAPON: 17, BAG: 18,
  TABARD: 19, ROBE: 20, WEAPONMAINHAND: 21, WEAPONOFFHAND: 22, HOLDABLE: 23, AMMO: 24, THROWN: 25, RANGEDRIGHT: 26, QUIVER: 27, RELIC: 28,
};

export function inventoryTypeIndex(value) {
  if (Number.isSafeInteger(value) && value > 0 && value < 64) return value;
  const name = String(value ?? "").trim().toUpperCase().replace(/^INVTYPE_/, "").replace(/[\s_-]+/g, "");
  return INVENTORY_TYPES[name] ?? null;
}

// A rule matches items of one class: every subclass, only `sub`, or every
// subclass but `not`; with `inv`, only those equipment slots. An item with
// a class but no known subclass (or slot) matches only rules that do not
// ask for one.
const all = (classId) => ({ classId });
const only = (classId, ...sub) => ({ classId, sub });
const slot = (classId, sub, ...inv) => ({ classId, sub: [sub], inv });

// A node selects its own rules, or (a named group in the game) the union of
// its children's.
function node(key, label, rules, children = []) {
  return { key, label, rules: rules?.length ? rules : children.flatMap((child) => child.rules), children };
}
const leaf = (key, label, ...rules) => node(key, label, rules);

const ARMOR_SLOTS = [["head", "Head", 1], ["shoulder", "Shoulder", 3], ["chest", "Chest", 5, 20], ["waist", "Waist", 6], ["legs", "Legs", 7],
  ["feet", "Feet", 8], ["wrist", "Wrist", 9], ["hands", "Hands", 10], ["relic", "Relic", 28]];
const armorType = (key, label, subclass) => node(key, label, [only(4, subclass)],
  ARMOR_SLOTS.map(([slotKey, slotLabel, ...inv]) => leaf(slotKey, slotLabel, slot(4, subclass, ...inv))));

// WoW Forever's own auction house categories (Blizzard_AuctionHouseUI,
// Camelot/Blizzard_AuctionData.lua, client 1.60.1), in the game's order.
// Keys are stable (URLs and saved searches use them); labels are the game's.
export const CATEGORY_TREE = Object.freeze([
  node("weapons", "Weapons", null, [
    node("one-handed", "One-Handed", null, [
      leaf("one-handed-axes", "One-Handed Axes", only(2, 0)), leaf("one-handed-maces", "One-Handed Maces", only(2, 4)),
      leaf("one-handed-swords", "One-Handed Swords", only(2, 7)), leaf("daggers", "Daggers", only(2, 15)),
      leaf("fist-weapons", "Fist Weapons", only(2, 13)), leaf("wands", "Wands", only(2, 19)),
    ]),
    node("two-handed", "Two-Handed", null, [
      leaf("two-handed-axes", "Two-Handed Axes", only(2, 1)), leaf("two-handed-maces", "Two-Handed Maces", only(2, 5)),
      leaf("two-handed-swords", "Two-Handed Swords", only(2, 8)), leaf("polearms", "Polearms", only(2, 6)), leaf("staves", "Staves", only(2, 10)),
    ]),
    node("ranged", "Ranged", null, [
      leaf("bows", "Bows", only(2, 2)), leaf("crossbows", "Crossbows", only(2, 18)), leaf("guns", "Guns", only(2, 3)), leaf("thrown", "Thrown", only(2, 16)),
    ]),
    node("miscellaneous", "Miscellaneous", null, [leaf("fishing-poles", "Fishing Poles", only(2, 20)), leaf("other", "Other", only(2, 14))]),
  ]),
  node("armor", "Armor", null, [
    armorType("plate", "Plate", 4), armorType("mail", "Mail", 3), armorType("leather", "Leather", 2), armorType("cloth", "Cloth", 1),
    node("relic", "Relic", null, [leaf("idols", "Idols", only(4, 8)), leaf("librams", "Librams", only(4, 7)), leaf("totems", "Totems", only(4, 9))]),
    node("miscellaneous", "Miscellaneous", null, [
      leaf("neck", "Neck", slot(4, 0, 2)), leaf("cloak", "Cloak", slot(4, 1, 16)), leaf("finger", "Finger", slot(4, 0, 11)),
      leaf("trinket", "Trinket", slot(4, 0, 12)), leaf("off-hand", "Held In Off-hand", slot(4, 0, 23)), leaf("shields", "Shields", only(4, 6)),
      leaf("shirt", "Shirt", slot(4, 0, 4)),
    ]),
  ]),
  node("containers", "Containers", null, [
    node("standard", "Bags", null, [leaf("bags", "Bag", only(1, 0)), leaf("soul-bags", "Soul Bag", only(1, 1))]),
    node("ammo", "Ammo Pouches", null, [leaf("quivers", "Quiver", only(11, 2)), leaf("ammo-pouches", "Ammo Pouch", only(11, 3))]),
    node("reagent", "Profession Bags", null, [
      leaf("herb-bags", "Herb Bag", only(1, 2)), leaf("enchanting-bags", "Enchanting Bag", only(1, 3)), leaf("engineering-bags", "Engineering Bag", only(1, 4)),
      leaf("mining-bags", "Mining Bag", only(1, 6)), leaf("leatherworking-bags", "Leatherworking Bag", only(1, 7)), leaf("tackle-boxes", "Tackle Box", only(1, 9)),
      leaf("cooking-bags", "Cooking Bag", only(1, 10)),
    ]),
  ]),
  node("consumables", "Consumables", [all(0)], [
    leaf("consumable", "Consumable", only(0, 0)), leaf("potions", "Potion", only(0, 1)), leaf("elixirs", "Elixir", only(0, 2)),
    leaf("flasks", "Flask", only(0, 3)), leaf("scrolls", "Scroll", only(0, 4)), leaf("food-drink", "Food & Drink", only(0, 5)),
    leaf("bandages", "Bandage", only(0, 7)), leaf("item-enhancement", "Item Enhancement", only(0, 6)), leaf("other", "Other", only(0, 8)),
  ]),
  node("trade-goods", "Trade Goods", [all(7)], [
    leaf("trade-goods", "Trade Goods", only(7, 0)), leaf("parts", "Parts", only(7, 1)), leaf("explosives", "Explosives", only(7, 2)),
    leaf("devices", "Devices", only(7, 3)), leaf("cloth", "Cloth", only(7, 5)), leaf("leather", "Leather", only(7, 6)),
    leaf("metal-stone", "Metal & Stone", only(7, 7)), leaf("cooking", "Cooking", only(7, 8)), leaf("herbs", "Herb", only(7, 9)),
    leaf("elemental", "Elemental", only(7, 10)), leaf("enchanting", "Enchanting", only(7, 12)), leaf("jewelcrafting", "Jewelcrafting", only(7, 4)),
    leaf("materials", "Materials", only(7, 13)), leaf("other", "Other", only(7, 11)),
  ]),
  node("projectile", "Projectile", [all(6)], [leaf("arrows", "Arrow", only(6, 2)), leaf("bullets", "Bullet", only(6, 3))]),
  node("recipes", "Recipes", [all(9)], [
    leaf("alchemy", "Alchemy", only(9, 6)), leaf("blacksmithing", "Blacksmithing", only(9, 4)), leaf("cooking", "Cooking", only(9, 5)),
    leaf("enchanting", "Enchanting", only(9, 8)), leaf("engineering", "Engineering", only(9, 3)), leaf("first-aid", "First Aid", only(9, 7)),
    leaf("fishing", "Fishing", only(9, 9)), leaf("leatherworking", "Leatherworking", only(9, 1)), leaf("tailoring", "Tailoring", only(9, 2)),
    leaf("books", "Book", only(9, 0)),
  ]),
  leaf("quest-items", "Quest Items", all(12)),
  node("miscellaneous", "Miscellaneous", [all(15)], [
    leaf("junk", "Junk", only(15, 0)), leaf("reagents", "Reagent", only(15, 1)), leaf("pets", "Companion Pets", only(15, 2)),
    leaf("holiday", "Holiday", only(15, 3)), leaf("other", "Other", only(15, 4)), leaf("mounts", "Mount", only(15, 5)),
  ]),
]);

function integerOrNull(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isSafeInteger(number) ? number : null;
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Class and subclass ids for an item, from ids when the data has them,
// else from the English names the game showed.
export function itemClassIds({ classId = null, subclassId = null, className = "", subclassName = "" } = {}) {
  const cls = integerOrNull(classId) ?? CLASS_NAMES[lower(className)] ?? null;
  const sub = integerOrNull(subclassId) ?? (cls !== null ? SUBCLASS_NAMES[cls]?.[lower(subclassName)] ?? null : null);
  return { classId: cls, subclassId: sub };
}

function ruleMatches(rule, classId, subclassId, inventoryType) {
  if (classId !== rule.classId) return false;
  if (rule.sub && (subclassId === null || !rule.sub.includes(subclassId))) return false;
  if (rule.inv && (inventoryType === null || !rule.inv.includes(inventoryType))) return false;
  return true;
}

function matches(entry, classId, subclassId, inventoryType) {
  return entry.rules.some((rule) => ruleMatches(rule, classId, subclassId, inventoryType));
}

// Where an item sits in the tree: the path of keys down to the deepest
// node that takes it (["armor", "mail", "chest"]), or [].
export function categoryPath(classId, subclassId, inventoryType = null) {
  const cls = integerOrNull(classId);
  if (cls === null) return [];
  const sub = integerOrNull(subclassId);
  const inv = integerOrNull(inventoryType);
  const path = [];
  let level = CATEGORY_TREE;
  while (level.length) {
    const found = level.find((entry) => matches(entry, cls, sub, inv));
    if (!found) break;
    path.push(found.key);
    level = found.children;
  }
  return path;
}

// Kept for callers that only need the top two levels.
export function categoryOf(classId, subclassId, inventoryType = null) {
  const path = categoryPath(classId, subclassId, inventoryType);
  return { category: path[0] ?? null, subcategory: path[1] ?? null };
}

// A category from a URL or a saved search: keys down the tree (searches
// saved before the tree existed used labels or the game's class name).
export function resolveCategory(category = "", subcategory = "", slotKey = "") {
  const wanted = [lower(category), lower(subcategory), lower(slotKey)].filter(Boolean);
  if (!wanted.length) return null;
  const byName = CLASS_NAMES[wanted[0]];
  let entry = CATEGORY_TREE.find((candidate) => candidate.key === wanted[0] || lower(candidate.label) === wanted[0])
    || (byName !== undefined ? CATEGORY_TREE.find((candidate) => candidate.rules.some((rule) => rule.classId === byName)) : null);
  if (!entry) return null;
  const path = [entry];
  for (const key of wanted.slice(1)) {
    const next = entry.children.find((candidate) => candidate.key === key || lower(candidate.label) === key);
    if (!next) return { path, node: entry, unknown: true };
    path.push(next);
    entry = next;
  }
  return { path, node: entry, unknown: false, keys: path.map((step) => step.key) };
}

// SQL over market_item_meta columns (alias `m`) selecting a node's items.
// Uses the (item_class_id, item_subclass_id, inventory_type) index.
export function categorySql(resolved, alias = "m") {
  if (!resolved) return null;
  if (resolved.unknown) return { sql: "0", params: [] };
  const parts = [];
  const params = [];
  for (const rule of resolved.node.rules) {
    const clauses = [`${alias}.item_class_id = ?`];
    params.push(rule.classId);
    if (rule.sub) { clauses.push(`${alias}.item_subclass_id IN (${rule.sub.map(() => "?").join(",")})`); params.push(...rule.sub); }
    if (rule.inv) { clauses.push(`${alias}.inventory_type IN (${rule.inv.map(() => "?").join(",")})`); params.push(...rule.inv); }
    parts.push(`(${clauses.join(" AND ")})`);
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

// The tree with listing counts at every level: every category, listed or
// not, so the list never jumps around. `counts` are rows of
// { classId, subclassId, inventoryType, items }.
export function categoryTree(counts = []) {
  const totals = new Map();
  for (const row of counts) {
    const path = categoryPath(row.classId, row.subclassId, row.inventoryType ?? null);
    for (let depth = 1; depth <= path.length; depth += 1) {
      const key = path.slice(0, depth).join("/");
      totals.set(key, (totals.get(key) || 0) + Number(row.items || 0));
    }
  }
  const shape = (entry, prefix) => {
    const key = prefix ? `${prefix}/${entry.key}` : entry.key;
    return { key: entry.key, label: entry.label, name: entry.label, items: totals.get(key) || 0,
      subcategories: entry.children.map((child) => shape(child, key)) };
  };
  return CATEGORY_TREE.map((entry) => shape(entry, ""));
}

// Search text: case, accents, apostrophes and other punctuation ignored, so
// "raiders chestpiece" finds "Raider's Chestpiece" and "Thorium-Bar" finds
// "Thorium Bar".
export function searchKey(value) {
  return String(value ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

export function searchTokens(value) {
  const key = searchKey(value);
  return key ? [...new Set(key.split(" "))].slice(0, 8) : [];
}

export function likePattern(value, { prefix = false } = {}) {
  const escaped = String(value).replace(/[\\%_]/g, "\\$&");
  return prefix ? `${escaped}%` : `%${escaped}%`;
}
