// Writes the add-on editorial parity fixture: a bundle built by Holdfast's
// rules (Atlas/Editorial/addonTransform.js) from SYNTHETIC editorial content
// over two real atlas dungeons, the Lua lines Holdfast expects the add-on's
// exporter to write for it, and the trimmed atlas both sides check it against.
//   node scripts/addonEditorialParity.mjs <out-dir>
// writes <out-dir>/atlas_studio.json, editorial_bundle.json and
// editorial_expected.txt (Indicaza/guildweaver test/fixtures/).
// backend/test/addonEditorialParity.test.js checks the JS side.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadAtlas } from "../src/Atlas/atlasData.js";
import { addonEditorialBundle, addonEditorialEntry, luaLiteral } from "../src/Atlas/Editorial/addonTransform.js";
import { resolveEditorial } from "../src/Atlas/Editorial/editorialResolve.js";
import { parseEditorialDocument } from "../src/Atlas/Editorial/editorialSchema.js";

const override = (value, verified = false) => ({ value, verified, source: "synthetic parity fixture" });

export const PARITY_DOCUMENTS = {
  3065: {
    dungeon: { subtitle: override("Synthetic subtitle"), tips: override(["Tip with \"quotes\" and a back\\slash.", "Tip two…"]),
      routeNotes: override("Line one.\nLine two."), cardArt: override(null) },
    bosses: { 261306: { mechanics: override([
      { id: "low", ability: "Low thing", type: "positioning", priority: "low", instruction: "Move out.", roles: [] },
      { id: "shadow-bolt", ability: "Shadow Bolt", type: "interrupt", priority: "high", instruction: "Interrupt whenever possible.", roles: ["dps", "tank"], verified: true },
    ]), strategy: override("x".repeat(450)) }, Infurnus: { tank: override("Synthetic tank note.") } },
  },
  36: {
    dungeon: { name: override("The Deadmines"), levelMin: override(17), entrance: override({ mapId: 1436, x: 0.38, y: 0.775 }) },
    bosses: { 2741: { dispels: override("Synthetic dispel note.") } },
  },
};

export function parityFixture() {
  const { atlas } = loadAtlas();
  const pick = (id) => {
    const dungeon = structuredClone(atlas.dungeons.find((entry) => entry.instanceId === id));
    return { ...dungeon, creatures: [], rares: [], maps: [], quests: [] };
  };
  const dungeons = [pick(36), pick(3065)];
  const entries = dungeons.map((dungeon) => {
    const { document, problems } = parseEditorialDocument(PARITY_DOCUMENTS[dungeon.instanceId], dungeon.instanceId);
    if (problems.length) throw new Error(JSON.stringify(problems));
    return addonEditorialEntry(dungeon.instanceId, resolveEditorial(dungeon, document), dungeon.instanceId === 36 ? 11 : 12);
  });
  const bundle = { ...addonEditorialBundle(entries, { generatedFrom: "parity-fixture" }),
    art: { 3065: { card: ["Interface", "AddOns", "Guildweaver", "Media", "Atlas", "3065_card"].join("\\") } }, artSkipped: [] };
  const expected = bundle.dungeons.map((entry) => `  [${entry.id}]=${luaLiteral(entry)},`).join("\n") + "\n";
  return {
    atlas: { schemaVersion: 1, generatedAt: atlas.generatedAt, sources: atlas.sources, note: "Real atlas entries (trimmed: no creatures, rares, maps or quests) for the editorial parity spec.", dungeons },
    bundle,
    expected,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node scripts/addonEditorialParity.mjs <out-dir>");
    process.exit(2);
  }
  const fixture = parityFixture();
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "atlas_studio.json"), `${JSON.stringify(fixture.atlas, null, 1)}\n`);
  writeFileSync(path.join(out, "editorial_bundle.json"), `${JSON.stringify({ ...fixture.bundle, note: "SYNTHETIC editorial content over real atlas dungeons (parity fixture)." }, null, 1)}\n`);
  writeFileSync(path.join(out, "editorial_expected.txt"), fixture.expected, "latin1");
  console.log(`wrote the parity fixture to ${out}`);
}
