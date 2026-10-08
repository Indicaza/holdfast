// Builds synthetic talent_tree_definition envelopes for classes without a real
// Guildweaver capture in seed/devData/talentTrees.
//
//   node scripts/devData/buildSyntheticTalentTrees.mjs
//
// Structure (tiers, columns, ranks, prerequisites) comes from Blizzard's Classic
// Era Talent/TalentTab tables (wago.tools); names, icons, and rendered tooltip
// text come from Wowhead Classic. The result uses the same envelope and node
// layout as a real traits capture, so the armory renders it unchanged. Node,
// entry, and tree IDs are invented and every envelope is marked synthetic.
// Captured trees for this game build differ from Classic Era; replace a
// synthetic file with a real capture when one is available.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const treeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "seed", "devData", "talentTrees");
const WAGO = "https://wago.tools/db2";
const TOOLTIP_URL = "https://nether.wowhead.com/classic/tooltip/spell/";
const GAME_BUILD = { interface: 16001, buildDate: "Oct  5 2026", version: "1.60.1", build: "70245" };

const WHITE = { b: 1, g: 1, r: 1 };
const GREY = { b: 0.501960813999176, g: 0.501960813999176, r: 0.501960813999176 };
const GOLD = { b: 0, g: 0.8235294818878174, r: 1 };

// Matches the captured Warrior layout: three trees side by side on a 600-unit grid.
const TAB_X = [1020, 5020, 9080];
const ROW_Y = 2130;
const GRID = 600;

const CLASSES = [
  { id: 1, name: "Warrior", token: "WARRIOR", mask: 1, icon: 626008 },
  { id: 2, name: "Paladin", token: "PALADIN", mask: 2, icon: 626003 },
  { id: 3, name: "Hunter", token: "HUNTER", mask: 4, icon: 626000 },
  { id: 4, name: "Rogue", token: "ROGUE", mask: 8, icon: 626005 },
  { id: 5, name: "Priest", token: "PRIEST", mask: 16, icon: 626004 },
  { id: 7, name: "Shaman", token: "SHAMAN", mask: 64, icon: 626006 },
  { id: 8, name: "Mage", token: "MAGE", mask: 128, icon: 626001 },
  { id: 9, name: "Warlock", token: "WARLOCK", mask: 256, icon: 626007 },
  { id: 11, name: "Druid", token: "DRUID", mask: 1024, icon: 625999 },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") { field += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((value) => value.length > 1);
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

async function wagoTable(name) {
  const response = await fetch(`${WAGO}/${name}/csv?product=wow_classic_era`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return parseCsv(await response.text());
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Converts a Wowhead spell tooltip into the in-game C_TooltipInfo line shape:
// name, cost/range and cast/cooldown rows (or "Passive"), requirements, description.
function tooltipFromWowhead(data) {
  const html = data.tooltip || "";
  const lines = [{ leftColor: WHITE, left: data.name, rightColor: GREY }];
  const headerStart = html.indexOf("<div class=\"q0\">Talent</div>");
  const headerEnd = html.indexOf("<div class=\"wowhead-tooltip-requirements\">");
  const header = headerStart >= 0 && headerEnd > headerStart
    ? html.slice(headerStart + "<div class=\"q0\">Talent</div>".length, headerEnd)
    : "";

  const headerLines = [];
  for (const part of header.split(/(<table width="100%">[\s\S]*?<\/table>)/)) {
    const row = part.match(/<td>([\s\S]*?)<\/td><th>([\s\S]*?)<\/th>/);
    if (row) {
      const line = { leftColor: WHITE, left: stripTags(row[1]), rightColor: WHITE };
      if (stripTags(row[2])) line.right = stripTags(row[2]);
      headerLines.push(line);
    } else if (stripTags(part)) {
      headerLines.push({ leftColor: WHITE, left: stripTags(part), rightColor: WHITE });
    }
  }
  lines.push(...(headerLines.length ? headerLines : [{ leftColor: WHITE, left: "Passive" }]));

  const body = html.slice(headerEnd >= 0 ? headerEnd : 0);
  const requirement = body.match(/<span class="wowhead-tooltip-requirements">([\s\S]*?)<\/span>/);
  if (requirement) lines.push({ leftColor: WHITE, left: stripTags(requirement[1]) });

  // Wowhead annotates Season of Discovery changes as "[SoD text / original text]"
  // and wraps variant-only fragments in <!--spN:0-->...<!--spN-->. Keep Classic Era
  // text; keep a variant fragment only when it is the whole description.
  const classicText = (body.match(/<div class="q">([\s\S]*?)<\/div>/)?.[1] || "")
    .replace(/\[<span class='q2'>S0\d[^<]*<\/span>: <span class='q9'>[\s\S]*?<\/span> \/ ([\s\S]*?)\]/g, "$1")
    .replace(/\s*\[<span class='q2'>S0\d[\s\S]*$/, "");
  const withoutVariants = stripTags(classicText.replace(/<!--sp(\d+):0-->[\s\S]*?<!--sp\1-->/g, ""));
  const description = (withoutVariants || stripTags(classicText)).replace(/\s+/g, " ");
  if (description) lines.push({ leftColor: GOLD, left: description });
  return { lines, description };
}

async function spellTooltip(spellId) {
  const response = await fetch(`${TOOLTIP_URL}${spellId}`);
  if (!response.ok) throw new Error(`Spell ${spellId}: HTTP ${response.status}`);
  return response.json();
}

function iconIdsByName() {
  const path = join(treeDir, "..", "icons.json");
  const icons = JSON.parse(readFileSync(path, "utf8")).icons;
  return new Map(Object.entries(icons).map(([id, name]) => [name, Number(id)]));
}

function capturedClassTokens() {
  return new Set(
    readdirSync(treeDir)
      .filter((file) => file.endsWith(".json") && !file.startsWith("synthetic-"))
      .map((file) => JSON.parse(readFileSync(join(treeDir, file), "utf8")).payload?.class?.token)
      .filter(Boolean),
  );
}

async function buildClass(classInfo, tabs, talents, iconLookup) {
  const classTabs = tabs
    .filter((tab) => Number(tab.ClassMask) === classInfo.mask)
    .sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex));
  const tabIndex = new Map(classTabs.map((tab, index) => [tab.ID, index]));
  const classTalents = talents
    .filter((talent) => tabIndex.has(talent.TabID))
    .sort((a, b) => tabIndex.get(a.TabID) - tabIndex.get(b.TabID) || Number(a.TierID) - Number(b.TierID) || Number(a.ColumnIndex) - Number(b.ColumnIndex));

  const treeId = 9000 + classInfo.id;
  const nodeId = (talent) => 900000 + Number(talent.ID);
  const nodes = [];
  const edges = [];
  const missingIcons = [];

  for (const talent of classTalents) {
    const ranks = Array.from({ length: 9 }, (_, index) => Number(talent[`SpellRank_${index}`])).filter(Boolean);
    const data = await spellTooltip(ranks[0]);
    const { lines, description } = tooltipFromWowhead(data);
    const iconName = String(data.icon || "").toLowerCase();
    const iconFileDataId = iconLookup(iconName);
    if (!iconFileDataId) missingIcons.push(iconName);

    nodes.push({
      nodeId: nodeId(talent),
      conditionIds: [],
      position: {
        y: ROW_Y + Number(talent.TierID) * GRID,
        x: TAB_X[tabIndex.get(talent.TabID)] + Number(talent.ColumnIndex) * GRID,
      },
      type: 0,
      maxRanks: ranks.length,
      entries: [{
        iconFileDataId,
        definitionId: 980000 + Number(talent.ID),
        tooltip: { source: "C_TooltipInfo.GetSpellByID", lines },
        maxRanks: ranks.length,
        spellLink: `|cff71d5ff|Hspell:${ranks[0]}:0|h[${data.name}]|h|r`,
        name: data.name,
        entryId: 950000 + Number(talent.ID),
        description,
        spellId: ranks[0],
      }],
    });

    const prerequisite = Number(talent.PrereqTalent_0);
    if (prerequisite) {
      edges.push({ sourceNodeId: 900000 + prerequisite, targetNodeId: nodeId(talent), type: 2, visualStyle: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const treeHash = [...createHash("md5").update(`synthetic:${classInfo.token}:${treeId}`).digest()];
  return {
    envelope: {
      schemaVersion: 1,
      eventType: "talent_tree_definition",
      synthetic: true,
      syntheticSource: "Classic Era Talent/TalentTab via wago.tools; tooltips via Wowhead Classic",
      capturedAt: 1791430710,
      gameBuild: GAME_BUILD,
      realm: "Classic Beta PvE 2",
      region: null,
      installationId: "install-dev-synthetic",
      characterId: null,
      guildId: null,
      payload: {
        treeHash,
        class: { id: classInfo.id, name: classInfo.name, token: classInfo.token },
        schemaVersion: 3,
        specialization: { role: "DAMAGER", index: 1, iconFileDataId: classInfo.icon, name: classInfo.name },
        locale: "enUS",
        edges,
        treeId,
        nodes,
        sourceApi: "traits",
        kind: "combat",
        gameBuild: GAME_BUILD,
      },
    },
    tabs: classTabs.map((tab) => tab.Name_lang),
    missingIcons,
  };
}

async function main() {
  const iconNames = iconIdsByName();
  const extraIcons = new Map();
  const iconLookup = (name) => {
    for (const candidate of [name, name.replace(/^classic_/, "")]) {
      const id = iconNames.get(candidate) || extraIcons.get(candidate);
      if (id) return id;
    }
    return null;
  };

  // Talent icons are not all in icons.json yet; resolve them from the listfile if provided.
  const listfilePath = process.argv[2];
  if (listfilePath) {
    for (const row of readFileSync(listfilePath, "utf8").split("\n")) {
      const match = row.trim().match(/^(\d+);interface\/icons\/(.+)\.blp$/i);
      if (match) extraIcons.set(match[2].toLowerCase(), Number(match[1]));
    }
  }

  const [tabs, talents] = await Promise.all([wagoTable("TalentTab"), wagoTable("Talent")]);
  const captured = capturedClassTokens();

  for (const classInfo of CLASSES) {
    if (captured.has(classInfo.token)) {
      console.log(`${classInfo.name}: real capture present, skipped`);
      continue;
    }
    const { envelope, tabs: tabNames, missingIcons } = await buildClass(classInfo, tabs, talents, iconLookup);
    const file = join(treeDir, `synthetic-${classInfo.token.toLowerCase()}.json`);
    writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`);
    console.log(`${classInfo.name}: ${envelope.payload.nodes.length} nodes, ${envelope.payload.edges.length} edges (${tabNames.join(" / ")})${missingIcons.length ? `; missing icons: ${missingIcons.join(", ")}` : ""}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
