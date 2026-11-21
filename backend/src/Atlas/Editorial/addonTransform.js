// What the add-on gets from published editorial content: the one place the
// rules live. The CMS's add-on preview, the validator's Lua size budget and
// the export bundle (scripts/exportEditorialBundle.mjs) all call this, and
// the add-on's exporter (Indicaza/guildweaver scripts/exportDungeonAtlas.lua
// --editorial) only checks the bundle against the same limits and renders it
// with the same literal syntax (luaLiteral below). Its spec compares its
// rendering with this one byte for byte.
//
// Only edits that win (editorialResolve.js) are exported: imported facts
// already reach the add-on through the atlas export. Art is not here: the
// client cannot load web images (see docs/dungeon-content-studio.md).

export const ADDON_EDITORIAL_SCHEMA = 1;

export const ADDON_LIMITS = Object.freeze({
  name: 80,
  subtitle: 80,
  description: 600,
  longtext: 400,
  listItems: 6,
  listLine: 160,
  mechanics: 10,
  ability: 60,
  instruction: 240,
  dungeonBytes: 6144,
  totalBytes: 49152,
});

const PRIORITY_RANK = { high: 1, medium: 2, low: 3 };

// Text the client can show: control characters dropped (a newline kept),
// whitespace runs folded, cut to `max` characters (code points, never inside
// a UTF-8 sequence) with an ellipsis when cut.
export function addonText(value, max) {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return null;
  const chars = [...clean];
  return chars.length <= max ? clean : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

const permille = (value) => Math.floor(value * 1000 + 0.5);

function list(value) {
  if (!Array.isArray(value)) return null;
  const lines = value.map((line) => addonText(line, ADDON_LIMITS.listLine)).filter(Boolean).slice(0, ADDON_LIMITS.listItems);
  return lines.length ? lines : null;
}

const won = (field) => (field && field.winner === "editorial" ? field.effective : null);

function mechanics(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const rows = value.map((entry, index) => ({ entry, index }))
    .sort((a, b) => (PRIORITY_RANK[a.entry.priority] || 3) - (PRIORITY_RANK[b.entry.priority] || 3) || a.index - b.index)
    .slice(0, ADDON_LIMITS.mechanics)
    .map(({ entry }) => compact({
      a: addonText(entry.ability, ADDON_LIMITS.ability),
      t: entry.type,
      p: entry.priority,
      i: addonText(entry.instruction, ADDON_LIMITS.instruction),
      r: entry.roles?.length ? entry.roles.join(",") : null,
      v: entry.verified === true ? true : null,
    }))
    .filter((row) => row.a);
  return rows.length ? rows : null;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined));
}

// The add-on's editorial entry for one dungeon, or null when nothing
// editorial wins. `resolution` is resolveEditorial()'s; `revision` the
// published revision's id.
export function addonEditorialEntry(instanceId, resolution, revision = null) {
  const d = resolution.dungeon;
  const entrance = won(d.entrance);
  const levelMin = won(d.levelMin);
  const levelMax = won(d.levelMax);
  const bossOrder = won(d.bossOrder);
  const dungeon = compact({
    n: addonText(won(d.name), ADDON_LIMITS.name),
    sub: addonText(won(d.subtitle), ADDON_LIMITS.subtitle),
    desc: addonText(won(d.description), ADDON_LIMITS.description),
    lmin: levelMin, lmax: levelMax,
    ent: entrance ? { m: entrance.mapId, x: permille(entrance.x), y: permille(entrance.y) } : null,
    tips: list(won(d.tips)),
    prep: list(won(d.preparation)),
    warn: list(won(d.warnings)),
    comp: addonText(won(d.groupComposition), ADDON_LIMITS.longtext),
    route: addonText(won(d.routeNotes), ADDON_LIMITS.longtext),
    qnotes: addonText(won(d.questNotes), ADDON_LIMITS.longtext),
    attr: addonText(won(d.attribution), ADDON_LIMITS.longtext),
    order: bossOrder ? resolution.bosses.map((boss) => boss.key) : null,
  });
  const bosses = resolution.bosses.map((boss) => {
    const f = boss.fields;
    const entry = compact({
      n: addonText(won(f.name), ADDON_LIMITS.name),
      desc: addonText(won(f.description), ADDON_LIMITS.longtext),
      strat: addonText(won(f.strategy), ADDON_LIMITS.longtext),
      tank: addonText(won(f.tank), ADDON_LIMITS.longtext),
      heal: addonText(won(f.healer), ADDON_LIMITS.longtext),
      dps: addonText(won(f.dps), ADDON_LIMITS.longtext),
      pos: addonText(won(f.positioning), ADDON_LIMITS.longtext),
      kick: addonText(won(f.interrupts), ADDON_LIMITS.longtext),
      disp: addonText(won(f.dispels), ADDON_LIMITS.longtext),
      mech: mechanics(won(f.mechanics)),
    });
    if (!Object.keys(entry).length) return null;
    const imported = boss.imported || {};
    return compact({ k: boss.key, e: Number.isSafeInteger(imported.encounterId) ? imported.encounterId : null,
      npc: Number.isSafeInteger(imported.npcId) ? imported.npcId : null, ...entry });
  }).filter(Boolean);
  if (!Object.keys(dungeon).length && !bosses.length) return null;
  return compact({ id: instanceId, rev: revision === null || revision === undefined ? null : String(revision), ...dungeon, bosses: bosses.length ? bosses : null });
}

// Lua 5.1 literals, deterministic: keys sorted, identifiers bare, strings
// with only \\ \" \n and decimal escapes. The add-on's exporter has the same
// function (scripts/exportDungeonAtlas.lua Export.literal).
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"]);

function luaString(value) {
  let out = '"';
  for (const byte of Buffer.from(value, "utf8")) {
    if (byte === 0x5c) out += "\\\\";
    else if (byte === 0x22) out += '\\"';
    else if (byte === 0x0a) out += "\\n";
    // Three digits, as the add-on exporter's quote() writes them.
    else if (byte < 0x20 || byte === 0x7f) out += `\\${String(byte).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `${out}"`;
}

export function luaLiteral(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Only integers reach the add-on");
    return String(value);
  }
  if (typeof value === "string") return luaString(value);
  if (Array.isArray(value)) return `{${value.map(luaLiteral).join(",")}}`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${IDENTIFIER.test(key) && !RESERVED.has(key) ? key : `[${luaString(key)}]`}=${luaLiteral(value[key])}`).join(",")}}`;
}

// The bytes the entry adds to the generated Lua (Data/DungeonAtlas.generated.lua):
// the Latin-1 string luaString builds is one character per byte.
export function luaEntryBytes(entry) {
  if (!entry) return 0;
  return `  [${entry.id}]=${luaLiteral(entry)},\n`.length;
}

// The export bundle: every published dungeon's entry, in instance order.
export function addonEditorialBundle(entries, { generatedFrom = null } = {}) {
  const dungeons = entries.filter(Boolean).sort((a, b) => a.id - b.id);
  return { schemaVersion: ADDON_EDITORIAL_SCHEMA, generatedFrom, limits: ADDON_LIMITS, dungeons };
}

