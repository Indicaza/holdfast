import assert from "node:assert/strict";
import test from "node:test";

import { bossCatalog, capturePages, COLS, cropPortrait, MARKER, pageCheck, parseCreatureDisplays, portraitManifest, portraitProblem, readSheet, ROWS } from "../src/Atlas/bossPortraitPipeline.js";

const CELL = 264;
function sheet(page, seed, paint) {
  const width = COLS * CELL + 80;
  const height = ROWS * CELL + 120;
  const pixels = Buffer.alloc(width * height * 4);
  const set = (x, y, [r, g, b]) => { const at = (y * width + x) * 4; pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = 255; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) set(x, y, [255, 0, 255]);
  const x0 = 40; const y0 = 40;
  for (const [cx, cy] of [[x0 - MARKER, y0 - MARKER], [x0 + CELL * COLS, y0 - MARKER], [x0 - MARKER, y0 + CELL * ROWS], [x0 + CELL * COLS, y0 + CELL * ROWS]]) {
    for (let y = 0; y < MARKER; y += 1) for (let x = 0; x < MARKER; x += 1) set(cx + x, cy + y, [0, 255, 0]);
  }
  const block = Math.floor(CELL / 16);
  const value = page + pageCheck(page, seed) * 4096;
  for (let bit = 0; bit < 16; bit += 1) {
    const shade = (value >> bit) & 1 ? 255 : 0;
    for (let y = 0; y < block; y += 1) for (let x = 0; x < block; x += 1) set(x0 + bit * block + x, y0 + CELL * ROWS + MARKER + 4 + y, [shade, shade, shade]);
  }
  paint?.(set, x0, y0);
  return { width, height, pixels };
}
const face = (set, left, top, tone) => {
  for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) {
    if ((x - 128) ** 2 + (y - 128) ** 2 < 126 ** 2) set(left + x, top + y, [tone + (x % 40), 60 + (y % 90), 40]);
  }
};

test("display IDs come only from the add-on's table; a boss without one stays without", () => {
  const displays = parseCreatureDisplays('local maps = {[36]={{t={1}}}}\nlocal creatures = {\n  [644]={d=14403,l="19"},\n  [639]={d=2029},\n}');
  assert.deepEqual(displays, { 644: 14403, 639: 2029 });
  const catalog = bossCatalog([{ instanceId: 36, levelMin: 15, bosses: [{ npcId: 644, name: "Rhahk'Zor" }, { npcId: 643, name: "Sneed" }, { npcId: 639, name: "Edwin VanCleef" }] }], displays);
  assert.equal(catalog.find((boss) => boss.npcId === 643).displayId, null);
  assert.deepEqual(capturePages(catalog), [[14403, 2029]]);
  assert.deepEqual(capturePages(catalog, new Set([14403])), [[2029]]);
});

test("a sheet is located by its marks and number; another job's sheet is refused", () => {
  const image = sheet(5, 3);
  assert.deepEqual(readSheet(image, 3), { page: 5, x: 40, y: 40, cell: CELL });
  assert.equal(readSheet(image, 4), null);
  assert.equal(readSheet({ width: 100, height: 100, pixels: Buffer.alloc(40000) }, 3), null);
});

test("each cell crops to its own 256 x 256 face with transparent corners; blanks fail", () => {
  const image = sheet(0, 1, (set, x0, y0) => face(set, x0 + CELL + 4, y0 + 4, 120));
  const grid = readSheet(image, 1);
  const drawn = cropPortrait(image, grid, 1);
  assert.deepEqual([drawn.width, drawn.height], [256, 256]);
  assert.equal(drawn.pixels[3], 0);
  assert.equal(drawn.pixels[(128 * 256 + 128) * 4 + 3], 255);
  assert.equal(portraitProblem(drawn), null);
  assert.equal(portraitProblem(cropPortrait(image, grid, 0)), "blank");
  const flat = { width: 256, height: 256, pixels: Buffer.alloc(256 * 256 * 4, 90) };
  for (let i = 3; i < flat.pixels.length; i += 4) flat.pixels[i] = 255;
  assert.equal(portraitProblem(flat), "flat");
});

test("a purple face stays opaque inside the mask", () => {
  const image = sheet(0, 1, (set, x0, y0) => { for (let y = 60; y < 200; y += 1) for (let x = 60; x < 200; x += 1) set(x0 + 4 + x, y0 + 4 + y, [230, 10, 230]); });
  const crop = cropPortrait(image, readSheet(image, 1), 0);
  assert.equal(crop.pixels[(128 * 256 + 128) * 4 + 3], 255);
  assert.equal(crop.pixels[(128 * 256 + 128) * 4], 230);
});

test("the manifest tracks every boss; a shared model is kept, a placeholder is refused", () => {
  const entry = (npcId, displayId) => ({ npcId, name: `N${npcId}`, displayId, instanceIds: [36] });
  const catalog = [entry(1, 10), entry(2, 10), entry(3, null), entry(4, 20), entry(5, 30), entry(6, 40), entry(7, 50)];
  const manifest = portraitManifest(catalog, { 10: { status: "captured", sha256: "a" }, 20: { status: "blank" }, 30: { status: "captured", sha256: "same" }, 40: { status: "captured", sha256: "same" } }, { source: "test" });
  assert.deepEqual(manifest.bosses.map((boss) => boss.status), ["captured", "captured", "no-display-id", "blank", "captured", "captured", "not-captured"]);
  assert.equal(manifest.bosses[0].image, "boss-portrait-d10.png");
  assert.equal(manifest.bosses[4].sharedModel, true);
  assert.deepEqual(manifest.totals, { bosses: 7, withDisplayId: 6, captured: 4, missing: 3 });
  const many = Array.from({ length: 9 }, (_, index) => entry(index + 1, index + 100));
  const faces = Object.fromEntries(many.map((boss) => [boss.displayId, { status: "captured", sha256: "placeholder" }]));
  assert.ok(portraitManifest(many, faces, { source: "test" }).bosses.every((boss) => boss.status === "duplicate-image"));
});
