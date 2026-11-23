#!/usr/bin/env node
// Boss portraits from the local WoW client (docs/boss-portraits.md).
//
//   addon   writes the temporary capture add-on for what is still missing
//     node scripts/buildBossPortraits.mjs addon --art <DungeonJournalArt.generated.lua> --addons "<WoW>/_forever_/Interface/AddOns" --out DIR
//   (in game: /gwportraits, then wait for "done")
//   ingest  crops and checks the screenshots taken since, updates the manifest
//     node scripts/buildBossPortraits.mjs ingest --screens "<WoW>/_forever_/Screenshots" --out DIR
//   import  adds the faces to Content Studio media (uses GUILD_DATA_DIR)
//     node scripts/buildBossPortraits.mjs import --out DIR

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAtlas } from "../backend/src/Atlas/atlasData.js";
import { bossCatalog, capturePages, COLS, cropPortrait, MARKER, mediaNameOf, parseCreatureDisplays, portraitManifest, portraitProblem, readSheet, ROWS, sha256 } from "../backend/src/Atlas/bossPortraitPipeline.js";
import { decodePng, encodePng } from "../backend/src/Atlas/Editorial/imageCodec.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(root, "backend/src/Atlas/data/sources/boss-portraits.json");
const [command, ...rest] = process.argv.slice(2);
const args = {};
rest.forEach((value, index) => { if (value.startsWith("--")) args[value.slice(2)] = rest[index + 1]; });
const need = (name) => { if (!args[name]) throw new Error(`--${name} is required.`); return args[name]; };
const json = (value) => `${JSON.stringify(value, null, 1)}\n`;

function luaAddon(pages, seed) {
  return `-- Temporary and developer-only: draws boss portraits on a magenta sheet and
-- screenshots each sheet. It sends nothing, plays nothing and saves nothing.
-- Delete this folder when done. /gwportraits starts, /gwportraits stop ends.
local PAGES = {${pages.map((page) => `{${page.join(",")}}`).join(",")}}
local SEED, COLS, ROWS, MARKER = ${seed}, ${COLS}, ${ROWS}, ${MARKER}
local sheet, cells, marks, bits, running, format, quality = nil, {}, {}, {}, false, nil, nil
local function say(text) DEFAULT_CHAT_FRAME:AddMessage("|cffd9b66eGW portraits:|r " .. text) end
local function cvar(name, value)
  if C_CVar and C_CVar.SetCVar then C_CVar.SetCVar(name, value) else SetCVar(name, value) end
end
local function read(name) return (C_CVar and C_CVar.GetCVar and C_CVar.GetCVar(name)) or GetCVar(name) end
local function build()
  local w, h = GetPhysicalScreenSize()
  local cell = math.min(256 + 8, math.floor(math.min((w - 80) / COLS, (h - 120) / ROWS)))
  local block = math.floor(cell / 16)
  sheet = CreateFrame("Frame", "GWPortraitSheet", nil)
  sheet:SetFrameStrata("TOOLTIP"); sheet:SetFrameLevel(9000)
  sheet:SetScale(768 / h); sheet:SetSize(w, h); sheet:SetPoint("TOPLEFT", nil, "TOPLEFT", 0, 0)
  sheet:EnableMouse(true)
  local bg = sheet:CreateTexture(nil, "BACKGROUND"); bg:SetAllPoints(); bg:SetColorTexture(1, 0, 1, 1)
  local x0, y0 = math.floor((w - cell * COLS) / 2), math.floor((h - cell * ROWS - block - MARKER - 8) / 2)
  for _, corner in ipairs({ { x0 - MARKER, y0 - MARKER }, { x0 + cell * COLS, y0 - MARKER }, { x0 - MARKER, y0 + cell * ROWS }, { x0 + cell * COLS, y0 + cell * ROWS } }) do
    local m = sheet:CreateTexture(nil, "ARTWORK"); m:SetSize(MARKER, MARKER); m:SetPoint("TOPLEFT", corner[1], -corner[2]); m:SetColorTexture(0, 1, 0, 1)
  end
  for i = 1, COLS * ROWS do
    local t = sheet:CreateTexture(nil, "ARTWORK"); t:SetSize(cell - 8, cell - 8)
    t:SetPoint("TOPLEFT", x0 + ((i - 1) % COLS) * cell + 4, -(y0 + math.floor((i - 1) / COLS) * cell + 4)); cells[i] = t
  end
  for bit = 0, 15 do
    local b = sheet:CreateTexture(nil, "ARTWORK"); b:SetSize(block, block); b:SetPoint("TOPLEFT", x0 + bit * block, -(y0 + cell * ROWS + MARKER + 4)); bits[bit] = b
  end
end
local function barcode(page)
  local value = page + ((page + SEED) % 16) * 4096
  for bit = 0, 15 do
    local on = math.floor(value / 2 ^ bit) % 2 == 1
    bits[bit]:SetColorTexture(on and 1 or 0, on and 1 or 0, on and 1 or 0, 1)
  end
end
local function finish(text)
  running = false
  if format then cvar("screenshotFormat", format) end
  if quality then cvar("screenshotQuality", quality) end
  if sheet then sheet:Hide() end
  say(text)
end
local showPage
local waiter = CreateFrame("Frame")
local current = 0
waiter:SetScript("OnEvent", function(_, event)
  if not running then return end
  if event == "SCREENSHOT_FAILED" then return finish("a screenshot failed. Run /gwportraits again.") end
  C_Timer.After(0.4, function() if running then showPage(current + 1) end end)
end)
waiter:RegisterEvent("SCREENSHOT_SUCCEEDED"); waiter:RegisterEvent("SCREENSHOT_FAILED")
local function draw(list)
  for i, t in ipairs(cells) do
    if list[i] then SetPortraitTextureFromCreatureDisplayID(t, list[i]); t:Show() else t:Hide() end
  end
end
showPage = function(page)
  if not running then return end
  if page > #PAGES then return finish("done: " .. #PAGES .. " sheets. Tell Claude it finished.") end
  if InCombatLockdown() then return finish("stopped: you are in combat.") end
  current = page
  say("sheet " .. page .. " of " .. #PAGES)
  local list = PAGES[page]
  barcode(page - 1); draw(list)
  C_Timer.After(2.5, function() if running then draw(list) end end)
  C_Timer.After(5, function() if running then draw(list) end end)
  C_Timer.After(6.5, function() if running then Screenshot() end end)
end
SLASH_GWPORTRAITS1 = "/gwportraits"
SlashCmdList.GWPORTRAITS = function(text)
  if text == "stop" then return finish("stopped.") end
  if running then return end
  if InCombatLockdown() then return say("leave combat first.") end
  if #PAGES == 0 then return say("nothing is missing.") end
  if not sheet then build() end
  format, quality = read("screenshotFormat"), read("screenshotQuality")
  cvar("screenshotFormat", "tga"); cvar("screenshotQuality", "10")
  sheet:Show(); running = true; showPage(1)
end
`;
}

function addon() {
  const displays = parseCreatureDisplays(readFileSync(need("art"), "utf8"));
  const catalog = bossCatalog(loadAtlas().atlas.dungeons, displays);
  const out = path.resolve(need("out"));
  mkdirSync(out, { recursive: true });
  const stateFile = path.join(out, "captured.json");
  const captured = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  const done = new Set(Object.entries(captured).filter(([, face]) => face.status === "captured").map(([id]) => Number(id)));
  const pages = capturePages(catalog, done);
  const seed = Math.floor(Date.now() / 1000) % 16;
  writeFileSync(path.join(out, "job.json"), json({ seed, createdAt: Date.now(), pages, catalog }));
  const folder = path.join(path.resolve(need("addons")), "GuildweaverPortraitCapture");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "GuildweaverPortraitCapture.toc"), "## Interface: 16001\n## Title: Guildweaver Portrait Capture (temporary)\n## Notes: Developer tool. Delete after use.\nCapture.lua\n");
  writeFileSync(path.join(folder, "Capture.lua"), luaAddon(pages, seed));
  console.log(`${catalog.length} bosses, ${catalog.filter((entry) => entry.displayId).length} with display IDs, ${pages.flat().length} faces to capture on ${pages.length} sheets. Installed: ${folder}`);
}

function loadScreenshot(file, work) {
  if (file.toLowerCase().endsWith(".png")) return decodePng(readFileSync(file));
  const png = path.join(work, `${path.basename(file)}.png`);
  execFileSync("sips", ["-s", "format", "png", file, "--out", png], { stdio: "ignore" });
  const image = decodePng(readFileSync(png));
  rmSync(png, { force: true });
  return image;
}

function ingest() {
  const out = path.resolve(need("out"));
  const job = JSON.parse(readFileSync(path.join(out, "job.json"), "utf8"));
  const stateFile = path.join(out, "captured.json");
  const captured = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
  const dir = path.resolve(need("screens"));
  const files = readdirSync(dir).filter((name) => /\.(tga|png|jpe?g)$/i.test(name)).map((name) => path.join(dir, name)).filter((file) => statSync(file).mtimeMs >= job.createdAt - 1000).sort();
  const work = mkdtempSync(path.join(tmpdir(), "gw-portraits-"));
  let sheets = 0;
  for (const file of files) {
    const image = loadScreenshot(file, work);
    const grid = image && readSheet(image, job.seed);
    const list = grid ? job.pages[grid.page] : null;
    if (!list) continue;
    sheets += 1;
    list.forEach((displayId, index) => {
      const face = cropPortrait(image, grid, index);
      const problem = portraitProblem(face);
      if (problem) { if (captured[displayId]?.status !== "captured") captured[displayId] = { status: problem }; return; }
      const bytes = encodePng(face);
      writeFileSync(path.join(out, mediaNameOf(displayId)), bytes);
      captured[displayId] = { status: "captured", sha256: sha256(bytes) };
    });
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(stateFile, json(captured));
  const manifest = portraitManifest(job.catalog, captured, { source: "SetPortraitTextureFromCreatureDisplayID, WoW Forever client, local capture" });
  writeFileSync(MANIFEST, json(manifest));
  console.log(JSON.stringify({ screenshots: files.length, sheets, ...manifest.totals }));
}

// Adds captured faces to Content Studio media (GUILD_DATA_DIR); a face already there is kept.
async function importMedia() {
  const out = path.resolve(need("out"));
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const { withGuildTransaction } = await import("../backend/src/Data/database.js");
  const { createMediaInDatabase } = await import("../backend/src/Atlas/Editorial/atlasMedia.js");
  const faces = new Map(manifest.bosses.filter((boss) => boss.image).map((boss) => [boss.image, boss]));
  const result = withGuildTransaction((db) => {
    const counts = { imported: 0, kept: 0 };
    for (const [name, boss] of faces) {
      if (db.prepare("SELECT 1 FROM atlas_media WHERE purpose = 'portrait' AND original_name = ?").get(name)) { counts.kept += 1; continue; }
      const created = createMediaInDatabase(db, readFileSync(path.join(out, name)), { name, purpose: "portrait", attribution: "World of Warcraft creature portrait, Blizzard Entertainment", license: "Blizzard Entertainment; used at the owner's direction", provenance: `${manifest.source}; display ${boss.displayId}; sha256 ${boss.sha256}`, actor: { name: "boss-portrait-pipeline" } });
      if (created.status !== "ok") throw new Error(`${name}: ${JSON.stringify(created.problems)}`);
      counts.imported += 1;
    }
    return counts;
  });
  console.log(JSON.stringify(result));
}

const commands = { addon, ingest, import: importMedia };
if (!commands[command]) { console.error("Usage: buildBossPortraits.mjs addon|ingest"); process.exit(2); }
Promise.resolve().then(commands[command]).catch((error) => { console.error(error.message); process.exit(1); });
