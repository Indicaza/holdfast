// The boss portrait pipeline's pure steps: which creature displays to capture,
// the capture sheet's geometry, and turning one sheet into checked portraits.
// The faces come from the game's SetPortraitTextureFromCreatureDisplayID,
// drawn by a temporary add-on on a magenta sheet. No display ID is guessed:
// an NPC without one in the add-on's data stays without a portrait.

import { createHash } from "node:crypto";

import { resize } from "./Editorial/imageCodec.js";

export const COLS = 6;
export const ROWS = 3;
export const PER_PAGE = COLS * ROWS;
export const MARKER = 12;
export const PORTRAIT_SIZE = 256;
export const mediaNameOf = (displayId) => `boss-portrait-d${displayId}.png`;

// The add-on's creature table: { npcId: displayId }.
export function parseCreatureDisplays(lua) {
  const start = /local\s+creatures\s*=\s*\{/.exec(lua);
  if (!start) throw new Error('The add-on\'s file has no "creatures" table.');
  const displays = {};
  const rest = lua.slice(start.index);
  for (const match of rest.matchAll(/\[(\d+)\]=\{d=(\d+)/g)) displays[match[1]] = Number(match[2]);
  return displays;
}

// One row per boss, lowest-level dungeons first. A boss without a display ID
// is listed as unavailable.
export function bossCatalog(dungeons, displays) {
  const byNpc = new Map();
  const ordered = [...dungeons].sort((a, b) => (a.levelMin ?? 999) - (b.levelMin ?? 999) || a.instanceId - b.instanceId);
  for (const dungeon of ordered) {
    for (const boss of dungeon.bosses || []) {
      if (!boss.npcId) continue;
      const entry = byNpc.get(boss.npcId) || { npcId: boss.npcId, name: boss.name, displayId: displays[boss.npcId] ?? null, instanceIds: [] };
      if (!entry.instanceIds.includes(dungeon.instanceId)) entry.instanceIds.push(dungeon.instanceId);
      byNpc.set(boss.npcId, entry);
    }
  }
  return [...byNpc.values()];
}

// Each display once, in catalog order, split into sheets.
export function capturePages(catalog, done = new Set()) {
  const ids = [...new Set(catalog.map((entry) => entry.displayId).filter((id) => id && !done.has(id)))];
  const pages = [];
  for (let at = 0; at < ids.length; at += PER_PAGE) pages.push(ids.slice(at, at + PER_PAGE));
  return pages;
}

export const pageCheck = (page, seed) => (page + seed) % 16;

const isMarker = (p, i) => p[i] < 70 && p[i + 1] > 190 && p[i + 2] < 70;

// Finds the green corner marks, reads the sheet number from the bar under the
// grid. { page, x, y, cell } or null when this is not a valid sheet.
export function readSheet({ width, height, pixels }, seed) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isMarker(pixels, (y * width + x) * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const x = left + MARKER;
  const y = top + MARKER;
  const cell = Math.round((right - left + 1 - 2 * MARKER) / COLS);
  if (cell < 64 || Math.abs((bottom - top + 1 - 2 * MARKER) - cell * ROWS) > 2) return null;
  const block = Math.floor(cell / 16);
  const barY = y + cell * ROWS + MARKER + 4 + Math.floor(block / 2);
  if (barY >= height) return null;
  let value = 0;
  for (let bit = 0; bit < 16; bit += 1) {
    const at = (barY * width + x + Math.floor((bit + 0.5) * block)) * 4;
    if (pixels[at] > 128 && pixels[at + 1] > 128) value |= 1 << bit;
  }
  const page = value & 0xfff;
  return value >> 12 === pageCheck(page, seed) ? { page, x, y, cell } : null;
}

// One cell as a square RGBA portrait, the sheet's magenta made transparent.
export function cropPortrait(sheet, grid, index) {
  const inset = 4;
  const size = grid.cell - inset * 2;
  const left = grid.x + (index % COLS) * grid.cell + inset;
  const top = grid.y + Math.floor(index / COLS) * grid.cell + inset;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const from = ((top + y) * sheet.width + left + x) * 4;
      const to = (y * size + x) * 4;
      const [r, g, b] = [sheet.pixels[from], sheet.pixels[from + 1], sheet.pixels[from + 2]];
      const key = Math.min(r, b) - g;
      const alpha = key >= 190 ? 0 : key <= 90 ? 255 : Math.round(255 * (190 - key) / 100);
      pixels[to] = alpha ? Math.min(r, g + 70) : 0;
      pixels[to + 1] = alpha ? g : 0;
      pixels[to + 2] = alpha ? Math.min(b, g + 70) : 0;
      pixels[to + 3] = alpha;
    }
  }
  const image = { width: size, height: size, pixels };
  return size === PORTRAIT_SIZE ? image : resize(image, PORTRAIT_SIZE, PORTRAIT_SIZE);
}

// Whether a crop is a drawn face: enough of the circle covered, with detail.
export function portraitProblem({ width, height, pixels }) {
  if (width !== PORTRAIT_SIZE || height !== PORTRAIT_SIZE) return "size";
  let opaque = 0;
  let sum = 0;
  let square = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const light = (pixels[i] * 2 + pixels[i + 1] * 5 + pixels[i + 2]) / 8;
    opaque += 1;
    sum += light;
    square += light * light;
  }
  const total = width * height;
  if (opaque < total * 0.5) return "blank";
  const mean = sum / opaque;
  if (Math.sqrt(Math.max(0, square / opaque - mean * mean)) < 10) return "flat";
  return null;
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The manifest: every boss with its capture status. Same input, same bytes.
export function portraitManifest(catalog, captured, { source }) {
  const faces = new Map(Object.entries(captured).map(([id, value]) => [Number(id), value]));
  const seen = new Map();
  for (const [id, face] of faces) if (face.sha256) seen.set(face.sha256, [...(seen.get(face.sha256) || []), id]);
  const repeated = new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
  const bosses = catalog.map((entry) => {
    const face = entry.displayId ? faces.get(entry.displayId) : null;
    const status = !entry.displayId ? "no-display-id" : repeated.has(entry.displayId) ? "duplicate-image" : face?.status || "not-captured";
    return { npcId: entry.npcId, name: entry.name, displayId: entry.displayId, instanceIds: entry.instanceIds, status,
      image: status === "captured" ? mediaNameOf(entry.displayId) : null, sha256: status === "captured" ? face.sha256 : null };
  }).sort((a, b) => a.npcId - b.npcId);
  const count = (status) => bosses.filter((boss) => boss.status === status).length;
  return { schemaVersion: 1, source, totals: { bosses: bosses.length, withDisplayId: bosses.filter((boss) => boss.displayId).length, captured: count("captured"), missing: bosses.length - count("captured") }, bosses };
}
