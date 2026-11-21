// Writes the published Dungeon Content Studio content for the add-on export:
//   node scripts/exportEditorialBundle.mjs --out <bundle.json> [--art <dir>]
// <bundle.json> is what Indicaza/guildweaver scripts/exportDungeonAtlas.lua
// --editorial reads; <dir> receives the packaged textures (<name>.tga), to be
// copied to the add-on's Media/Atlas/. Reads the database of GUILD_DATA_DIR;
// only active published revisions are exported. Deterministic: the same
// published content gives the same bytes (no timestamps).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { withGuildDatabase } from "../src/Data/database.js";
import { readAddonBundle } from "../src/Atlas/Editorial/editorialRouter.js";

function option(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
}

const out = option("--out");
const artDir = option("--art");
if (!out) {
  console.error("usage: node scripts/exportEditorialBundle.mjs --out <bundle.json> [--art <dir>]");
  process.exit(2);
}
const { bundle, files } = withGuildDatabase((db) => readAddonBundle(db, { generatedFrom: process.env.HOLDFAST_RELEASE_SHA || null, withFiles: true }));
writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
if (artDir) {
  mkdirSync(artDir, { recursive: true });
  for (const file of files) writeFileSync(path.join(artDir, file.name), file.bytes);
}
console.log(`Wrote ${bundle.dungeons.length} dungeon(s) to ${out}${artDir ? ` and ${files.length} texture(s) to ${artDir}` : ""}.`);
for (const skipped of bundle.artSkipped) console.log(`Not packaged (${skipped.reason}): ${skipped.kind} of ${skipped.instanceId}${skipped.key ? ` boss ${skipped.key}` : ""}, ${skipped.mediaId}`);
