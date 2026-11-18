// Readers for the Dungeon Atlas's upstream formats. Pure: no network, no
// files. Used by scripts/fetchDungeonAtlasSources.mjs (which trims upstream
// tables into the checked-in extracts) and by the tests.

// The original (1.12) dungeons and raids, by map id (the catalog's
// instanceId). Later additions to the Classic Era client (Season of
// Discovery maps and the like) are left out on purpose.
export const VANILLA_INSTANCE_IDS = Object.freeze([33, 34, 36, 43, 47, 48, 70, 90, 109, 129, 189, 209, 229, 230, 249, 289, 309, 329, 349, 389, 409, 429, 469, 509,
  531, 533]);

// RFC 4180 CSV (wago.tools exports): quoted fields, doubled quotes, CRLF.
export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === "\"" && input[i + 1] === "\"") { field += "\""; i += 1; } else if (ch === "\"") quoted = false; else field += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") { record.push(field); field = ""; } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      record.push(field); field = "";
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }
  const [header = [], ...body] = records;
  return { header, rows: body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""]))) };
}

// The rows of `INSERT INTO table VALUES (...),(...);` statements in a mysqldump
// file, as objects keyed by the columns of its CREATE TABLE. Values stay
// strings (NULL becomes null).
export function parseSqlInserts(sql, table) {
  const text = String(sql || "");
  const create = new RegExp(`CREATE TABLE \`${table}\` \\(([\\s\\S]*?)\\n\\)`, "m").exec(text);
  if (!create) throw new Error(`No CREATE TABLE for ${table}`);
  const columns = [...create[1].matchAll(/^\s*`([^`]+)`/gm)].map((match) => match[1]);
  const rows = [];
  const insert = new RegExp(`INSERT INTO \`${table}\`[^V]*VALUES`, "g");
  let match;
  while ((match = insert.exec(text))) {
    let i = match.index + match[0].length;
    for (;;) {
      while (i < text.length && /[\s,]/.test(text[i])) i += 1;
      if (text[i] !== "(") break;
      i += 1;
      const values = [];
      let value = "";
      let quoted = false;
      let wasQuoted = false;
      for (; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
          if (ch === "\\") { value += text[i + 1]; i += 1; } else if (ch === "'" && text[i + 1] === "'") { value += "'"; i += 1; } else if (ch === "'") quoted = false;
          else value += ch;
        } else if (ch === "'") { quoted = true; wasQuoted = true; } else if (ch === "," || ch === ")") {
          const raw = wasQuoted ? value : value.trim();
          values.push(!wasQuoted && raw === "NULL" ? null : raw);
          value = ""; wasQuoted = false;
          if (ch === ")") { i += 1; break; }
        } else value += ch;
      }
      rows.push(Object.fromEntries(columns.map((name, index) => [name, values[index] ?? null])));
      if (text[i] === ";") break;
    }
    insert.lastIndex = i;
  }
  return rows;
}

// An AzerothCore C++ script file: the creature scripts it registers and the
// spell ids its enums name (`SPELL_FOO = 1234`). Spells are only attributed
// to a script when the file registers exactly one creature script, so adds
// scripted beside a boss never lend it their spells.
export function parseScriptSpells(cpp) {
  const source = String(cpp || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const scripts = new Set();
  // RegisterCreatureAI(x), RegisterMoltenCoreCreatureAI(x) and the like.
  for (const match of source.matchAll(/Register\w*CreatureAI\w*\(\s*(\w+)/g)) scripts.add(match[1]);
  for (const match of source.matchAll(/CreatureScript\(\s*"(\w+)"/g)) scripts.add(match[1]);
  for (const match of source.matchAll(/\bnew\s+((?:boss|npc)_\w+)\s*\(\s*\)/g)) scripts.add(match[1]);
  const spells = [...new Set([...source.matchAll(/\bSPELL_\w+\s*=\s*(\d+)/g)].map((match) => Number(match[1])).filter((id) => id > 0))];
  return { scripts: [...scripts].sort(), spells: spells.sort((a, b) => a - b) };
}
