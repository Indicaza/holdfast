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

// A rule matches items of one class: every subclass, only `sub`, or every
// subclass but `not`. An item with a class but no known subclass matches
// class-wide and "not" rules, never a "sub" rule.
const all = (classId) => ({ classId });
const only = (classId, ...sub) => ({ classId, sub });
const except = (classId, ...not) => ({ classId, not });

// The tree, in the game's order. Keys are stable (URLs and saved searches
// use them); labels are what the player reads.
export const CATEGORY_TREE = Object.freeze([
  { key: "weapons", label: "Weapons", rules: [all(2), all(6)], subcategories: [
    { key: "one-handed-axes", label: "One-Handed Axes", rules: [only(2, 0)] },
    { key: "two-handed-axes", label: "Two-Handed Axes", rules: [only(2, 1)] },
    { key: "bows", label: "Bows", rules: [only(2, 2)] },
    { key: "guns", label: "Guns", rules: [only(2, 3)] },
    { key: "one-handed-maces", label: "One-Handed Maces", rules: [only(2, 4)] },
    { key: "two-handed-maces", label: "Two-Handed Maces", rules: [only(2, 5)] },
    { key: "polearms", label: "Polearms", rules: [only(2, 6)] },
    { key: "one-handed-swords", label: "One-Handed Swords", rules: [only(2, 7)] },
    { key: "two-handed-swords", label: "Two-Handed Swords", rules: [only(2, 8)] },
    { key: "staves", label: "Staves", rules: [only(2, 10)] },
    { key: "fist-weapons", label: "Fist Weapons", rules: [only(2, 13)] },
    { key: "daggers", label: "Daggers", rules: [only(2, 15)] },
    { key: "thrown", label: "Thrown", rules: [only(2, 16)] },
    { key: "crossbows", label: "Crossbows", rules: [only(2, 18)] },
    { key: "wands", label: "Wands", rules: [only(2, 19)] },
    { key: "fishing-poles", label: "Fishing Poles", rules: [only(2, 20)] },
    { key: "ammunition", label: "Ammunition", rules: [all(6)] },
    { key: "other", label: "Miscellaneous", rules: [only(2, 9, 11, 12, 14, 17)] },
  ] },
  { key: "armor", label: "Armor", rules: [all(4)], subcategories: [
    { key: "cloth", label: "Cloth", rules: [only(4, 1)] },
    { key: "leather", label: "Leather", rules: [only(4, 2)] },
    { key: "mail", label: "Mail", rules: [only(4, 3)] },
    { key: "plate", label: "Plate", rules: [only(4, 4)] },
    { key: "shields", label: "Shields", rules: [only(4, 6)] },
    { key: "relics", label: "Relics", rules: [only(4, 7, 8, 9, 10, 11)] },
    { key: "cosmetic", label: "Cosmetic", rules: [only(4, 5)] },
    { key: "miscellaneous", label: "Miscellaneous", rules: [only(4, 0)] },
  ] },
  { key: "containers", label: "Containers", rules: [all(1), all(11)], subcategories: [
    { key: "bags", label: "Bags", rules: [only(1, 0)] },
    { key: "soul-bags", label: "Soul Bags", rules: [only(1, 1)] },
    { key: "herb-bags", label: "Herb Bags", rules: [only(1, 2)] },
    { key: "enchanting-bags", label: "Enchanting Bags", rules: [only(1, 3)] },
    { key: "engineering-bags", label: "Engineering Bags", rules: [only(1, 4)] },
    { key: "gem-bags", label: "Gem Bags", rules: [only(1, 5)] },
    { key: "mining-bags", label: "Mining Bags", rules: [only(1, 6)] },
    { key: "leatherworking-bags", label: "Leatherworking Bags", rules: [only(1, 7)] },
    { key: "inscription-bags", label: "Inscription Bags", rules: [only(1, 8)] },
    { key: "tackle-boxes", label: "Tackle Boxes", rules: [only(1, 9)] },
    { key: "cooking-bags", label: "Cooking Bags", rules: [only(1, 10)] },
    { key: "quivers", label: "Quivers & Ammo Pouches", rules: [all(11)] },
  ] },
  { key: "gems", label: "Gems", rules: [all(3)], subcategories: [
    { key: "red", label: "Red", rules: [only(3, 0)] },
    { key: "blue", label: "Blue", rules: [only(3, 1)] },
    { key: "yellow", label: "Yellow", rules: [only(3, 2)] },
    { key: "purple", label: "Purple", rules: [only(3, 3)] },
    { key: "green", label: "Green", rules: [only(3, 4)] },
    { key: "orange", label: "Orange", rules: [only(3, 5)] },
    { key: "meta", label: "Meta", rules: [only(3, 6)] },
    { key: "simple", label: "Simple", rules: [only(3, 7)] },
    { key: "prismatic", label: "Prismatic", rules: [only(3, 8)] },
    { key: "hydraulic", label: "Hydraulic", rules: [only(3, 9)] },
    { key: "cogwheel", label: "Cogwheel", rules: [only(3, 10)] },
  ] },
  // Enhancements live in three places in the game's data: their own class,
  // consumables (subclass 6) and trade goods (subclasses 14 and 15).
  { key: "item-enhancements", label: "Item Enhancements", rules: [all(8), only(0, 6), only(7, 14, 15)], subcategories: [] },
  { key: "consumables", label: "Consumables", rules: [except(0, 6)], subcategories: [
    { key: "potions", label: "Potions", rules: [only(0, 1)] },
    { key: "elixirs", label: "Elixirs", rules: [only(0, 2)] },
    { key: "flasks", label: "Flasks", rules: [only(0, 3)] },
    { key: "scrolls", label: "Scrolls", rules: [only(0, 4)] },
    { key: "food-drink", label: "Food & Drink", rules: [only(0, 5)] },
    { key: "bandages", label: "Bandages", rules: [only(0, 7)] },
    { key: "other", label: "Other", rules: [only(0, 0, 8)] },
  ] },
  { key: "glyphs", label: "Glyphs", rules: [all(16)], subcategories: [
    { key: "warrior", label: "Warrior", rules: [only(16, 1)] },
    { key: "paladin", label: "Paladin", rules: [only(16, 2)] },
    { key: "hunter", label: "Hunter", rules: [only(16, 3)] },
    { key: "rogue", label: "Rogue", rules: [only(16, 4)] },
    { key: "priest", label: "Priest", rules: [only(16, 5)] },
    { key: "death-knight", label: "Death Knight", rules: [only(16, 6)] },
    { key: "shaman", label: "Shaman", rules: [only(16, 7)] },
    { key: "mage", label: "Mage", rules: [only(16, 8)] },
    { key: "warlock", label: "Warlock", rules: [only(16, 9)] },
    { key: "monk", label: "Monk", rules: [only(16, 10)] },
    { key: "druid", label: "Druid", rules: [only(16, 11)] },
  ] },
  { key: "trade-goods", label: "Trade Goods", rules: [except(7, 14, 15)], subcategories: [
    { key: "cloth", label: "Cloth", rules: [only(7, 5)] },
    { key: "leather", label: "Leather", rules: [only(7, 6)] },
    { key: "metal-stone", label: "Metal & Stone", rules: [only(7, 7)] },
    { key: "herbs", label: "Herbs", rules: [only(7, 9)] },
    { key: "enchanting", label: "Enchanting", rules: [only(7, 12)] },
    { key: "jewelcrafting", label: "Jewelcrafting", rules: [only(7, 4)] },
    { key: "parts", label: "Parts", rules: [only(7, 1)] },
    { key: "elemental", label: "Elemental", rules: [only(7, 10)] },
    { key: "cooking", label: "Cooking", rules: [only(7, 8)] },
    { key: "explosives-devices", label: "Explosives & Devices", rules: [only(7, 2, 3)] },
    { key: "inscription", label: "Inscription", rules: [only(7, 16)] },
    { key: "materials", label: "Materials", rules: [only(7, 13)] },
    { key: "other", label: "Other", rules: [only(7, 0, 11)] },
  ] },
  { key: "recipes", label: "Recipes", rules: [all(9)], subcategories: [
    { key: "books", label: "Books", rules: [only(9, 0)] },
    { key: "leatherworking", label: "Leatherworking", rules: [only(9, 1)] },
    { key: "tailoring", label: "Tailoring", rules: [only(9, 2)] },
    { key: "engineering", label: "Engineering", rules: [only(9, 3)] },
    { key: "blacksmithing", label: "Blacksmithing", rules: [only(9, 4)] },
    { key: "cooking", label: "Cooking", rules: [only(9, 5)] },
    { key: "alchemy", label: "Alchemy", rules: [only(9, 6)] },
    { key: "first-aid", label: "First Aid", rules: [only(9, 7)] },
    { key: "enchanting", label: "Enchanting", rules: [only(9, 8)] },
    { key: "fishing", label: "Fishing", rules: [only(9, 9)] },
    { key: "jewelcrafting", label: "Jewelcrafting", rules: [only(9, 10)] },
    { key: "inscription", label: "Inscription", rules: [only(9, 11)] },
  ] },
  { key: "miscellaneous", label: "Miscellaneous", rules: [all(15), all(5), all(12), all(13), all(17), all(18), all(19)], subcategories: [
    { key: "junk", label: "Junk", rules: [only(15, 0)] },
    { key: "reagents", label: "Reagents", rules: [only(15, 1), all(5)] },
    { key: "pets", label: "Companion Pets", rules: [only(15, 2), all(17)] },
    { key: "holiday", label: "Holiday", rules: [only(15, 3)] },
    { key: "mounts", label: "Mounts", rules: [only(15, 5, 6)] },
    { key: "quest", label: "Quest Items", rules: [all(12)] },
    { key: "keys", label: "Keys", rules: [all(13)] },
    { key: "other", label: "Other", rules: [only(15, 4), all(18), all(19)] },
  ] },
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

function ruleMatches(rule, classId, subclassId) {
  if (classId !== rule.classId) return false;
  if (rule.sub) return subclassId !== null && rule.sub.includes(subclassId);
  if (rule.not) return subclassId === null || !rule.not.includes(subclassId);
  return true;
}

// Where an item sits in the tree: { category, subcategory } keys, or nulls.
export function categoryOf(classId, subclassId) {
  const cls = integerOrNull(classId);
  const sub = integerOrNull(subclassId);
  if (cls === null) return { category: null, subcategory: null };
  for (const category of CATEGORY_TREE) {
    if (!category.rules.some((rule) => ruleMatches(rule, cls, sub))) continue;
    const subcategory = category.subcategories.find((entry) => entry.rules.some((rule) => ruleMatches(rule, cls, sub)));
    return { category: category.key, subcategory: subcategory?.key ?? null };
  }
  return { category: null, subcategory: null };
}

// A category from a URL or a saved search: its key, or (searches saved
// before the tree existed) its label or the game's class name.
export function resolveCategory(category = "", subcategory = "") {
  const wanted = lower(category);
  if (!wanted) return null;
  const byName = CLASS_NAMES[wanted];
  const found = CATEGORY_TREE.find((entry) => entry.key === wanted || lower(entry.label) === wanted)
    || (byName !== undefined ? CATEGORY_TREE.find((entry) => entry.rules.some((rule) => rule.classId === byName)) : null);
  if (!found) return null;
  const subWanted = lower(subcategory);
  const sub = subWanted ? found.subcategories.find((entry) => entry.key === subWanted || lower(entry.label) === subWanted) || null : null;
  if (subWanted && !sub) return { category: found, subcategory: null, unknownSubcategory: true };
  return { category: found, subcategory: sub };
}

// SQL over market_item_meta columns (alias `m`) selecting the items of a
// category or subcategory. Uses the (item_class_id, item_subclass_id) index.
export function categorySql(resolved, alias = "m") {
  if (!resolved) return null;
  if (resolved.unknownSubcategory) return { sql: "0", params: [] };
  const rules = (resolved.subcategory || resolved.category).rules;
  const parts = [];
  const params = [];
  for (const rule of rules) {
    if (rule.sub) {
      parts.push(`(${alias}.item_class_id = ? AND ${alias}.item_subclass_id IN (${rule.sub.map(() => "?").join(",")}))`);
      params.push(rule.classId, ...rule.sub);
    } else if (rule.not) {
      parts.push(`(${alias}.item_class_id = ? AND (${alias}.item_subclass_id IS NULL OR ${alias}.item_subclass_id NOT IN (${rule.not.map(() => "?").join(",")})))`);
      params.push(rule.classId, ...rule.not);
    } else {
      parts.push(`${alias}.item_class_id = ?`);
      params.push(rule.classId);
    }
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

// The tree with listing counts: every category, listed or not, so the
// list never jumps around. `counts` are rows of { classId, subclassId, items }.
export function categoryTree(counts = []) {
  const totals = new Map();
  for (const row of counts) {
    const { category, subcategory } = categoryOf(row.classId, row.subclassId);
    if (!category) continue;
    totals.set(category, (totals.get(category) || 0) + Number(row.items || 0));
    if (subcategory) totals.set(`${category}/${subcategory}`, (totals.get(`${category}/${subcategory}`) || 0) + Number(row.items || 0));
  }
  return CATEGORY_TREE.map((category) => ({
    key: category.key, label: category.label, name: category.label, items: totals.get(category.key) || 0,
    subcategories: category.subcategories.map((sub) => ({ key: sub.key, label: sub.label, name: sub.label, items: totals.get(`${category.key}/${sub.key}`) || 0 })),
  }));
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
