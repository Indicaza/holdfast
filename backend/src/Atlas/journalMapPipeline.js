// The dungeon map pipeline's pure steps: read the add-on's generated map
// table, assemble a floor from its 12 tiles, and describe the result in a
// deterministic manifest and coverage report. No network and no clock.
//
// A floor is 4 x 3 tiles of 256 px, row by row; the picture is the top-left
// 1002 x 668 px (UI/DungeonMap.lua). Pins are 0-1 of that picture.

import { createHash } from "node:crypto";

export const MAP_WIDTH = 1002;
export const MAP_HEIGHT = 668;
export const TILE_SIZE = 256;
export const TILE_COLUMNS = 4;
export const TILE_ROWS = 3;
export const TILE_COUNT = TILE_COLUMNS * TILE_ROWS;
export const MANIFEST_SCHEMA = 1;

export const normalizeMapName = (name) => String(name ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export const floorIdOf = (instanceId, index) => `journal-${instanceId}-${index}`;
export const mediaNameOf = (instanceId, index) => `journal-map-${instanceId}-${index}.png`;

// A Lua table literal of numbers, strings and nested tables.
export function parseLuaTable(source, start = 0) {
  let at = start;
  const space = () => { while (/\s/.test(source[at] || "")) at += 1; };
  const fail = (what) => { throw new Error(`Lua table: expected ${what} at ${at}`); };
  const string = () => {
    const quote = source[at];
    at += 1;
    let out = "";
    while (source[at] !== quote) {
      if (at >= source.length) fail("end of string");
      if (source[at] === "\\") at += 1;
      out += source[at];
      at += 1;
    }
    at += 1;
    return out;
  };
  const number = () => {
    const match = /^-?\d+(\.\d+)?/.exec(source.slice(at, at + 32));
    if (!match) fail("a number");
    at += match[0].length;
    return Number(match[0]);
  };
  const value = () => {
    space();
    if (source[at] === "{") return table();
    if (source[at] === '"' || source[at] === "'") return string();
    return number();
  };
  const table = () => {
    at += 1;
    const list = [];
    const keyed = {};
    for (;;) {
      space();
      if (source[at] === "}") { at += 1; break; }
      if (source[at] === "[") {
        at += 1;
        const key = value();
        space();
        if (source[at] !== "]") fail("]");
        at += 1;
        space();
        if (source[at] !== "=") fail("=");
        at += 1;
        keyed[key] = value();
      } else {
        const name = /^[A-Za-z_]\w*(?=\s*=)/.exec(source.slice(at, at + 64));
        if (name) {
          at += name[0].length;
          space();
          at += 1;
          keyed[name[0]] = value();
        } else list.push(value());
      }
      space();
      if (source[at] === "," || source[at] === ";") at += 1;
    }
    return Object.keys(keyed).length ? (list.length ? Object.assign(list, keyed) : keyed) : list;
  };
  space();
  if (source[at] !== "{") fail("{");
  return table();
}

function localTable(lua, name) {
  const match = new RegExp(`local\\s+${name}\\s*=\\s*\\{`).exec(lua);
  if (!match) throw new Error(`The add-on's file has no "${name}" table.`);
  return parseLuaTable(lua, match.index + match[0].length - 1);
}

// The add-on's generated file as the site's map metadata, sorted. Refuses a
// floor without 12 tiles or a pin outside its picture rather than guess.
export function parseAddonMaps(lua, { addonCommit = null } = {}) {
  const maps = localTable(lua, "maps");
  const pins = localTable(lua, "pins");
  const openmap = /openmap\s*=\s*"([^"]+)"/.exec(lua)?.[1] ?? null;
  const problems = [];
  const instances = Object.keys(maps).map(Number).sort((a, b) => a - b).map((instanceId) => {
    const floors = maps[instanceId].map((floor, position) => {
      const index = position + 1;
      const tiles = Array.isArray(floor.t) ? floor.t : [];
      if (tiles.length !== TILE_COUNT || !tiles.every((id) => Number.isInteger(id) && id > 0)) problems.push({ code: "bad-tiles", instanceId, floor: index });
      return { index, floorId: floorIdOf(instanceId, index), name: floor.n ?? null, wing: floor.w ?? null, tiles };
    });
    const placed = [];
    for (const pin of pins[instanceId] || []) {
      const valid = typeof pin.n === "string" && floors.some((floor) => floor.index === pin.f) && pin.x >= 0 && pin.x <= 1 && pin.y >= 0 && pin.y <= 1;
      if (valid) placed.push({ name: pin.n, floor: pin.f, x: pin.x, y: pin.y });
      else problems.push({ code: "bad-pin", instanceId, name: pin.n ?? null, floor: pin.f ?? null });
    }
    placed.sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name));
    return { instanceId, floors, pins: placed };
  });
  for (const key of Object.keys(pins)) if (!maps[key]) problems.push({ code: "pins-without-map", instanceId: Number(key) });
  return { schemaVersion: MANIFEST_SCHEMA, source: { addon: "Indicaza/guildweaver", addonCommit, openmap, license: "OpenMap (MIT): IDs and positions only, no art" }, instances, problems };
}

// One RGBA picture from 12 decoded tiles, row by row. Throws on a tile of
// the wrong size: a floor is whole or it is not made.
export function assembleFloor(tiles) {
  if (tiles.length !== TILE_COUNT) throw new Error(`A floor has ${TILE_COUNT} tiles, not ${tiles.length}.`);
  const pixels = Buffer.alloc(MAP_WIDTH * MAP_HEIGHT * 4);
  tiles.forEach((tile, index) => {
    const rgba = tile?.rgba;
    if (tile?.width !== TILE_SIZE || tile?.height !== TILE_SIZE || rgba?.length !== TILE_SIZE * TILE_SIZE * 4) throw new Error(`Tile ${index + 1} is not ${TILE_SIZE} x ${TILE_SIZE}.`);
    const left = (index % TILE_COLUMNS) * TILE_SIZE;
    const top = Math.floor(index / TILE_COLUMNS) * TILE_SIZE;
    const width = Math.min(TILE_SIZE, MAP_WIDTH - left);
    const height = Math.min(TILE_SIZE, MAP_HEIGHT - top);
    for (let y = 0; y < height; y += 1) {
      const from = y * TILE_SIZE * 4;
      Buffer.from(rgba.buffer, rgba.byteOffset + from, width * 4).copy(pixels, ((top + y) * MAP_WIDTH + left) * 4);
    }
  });
  return { width: MAP_WIDTH, height: MAP_HEIGHT, pixels };
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The versioned manifest. `results`: { instanceId, floor, status, file?, bytes?,
// missing?: [tile IDs], invalid?: [tile IDs] }. Same input, same bytes.
export function buildManifest(metadata, results, { assetSource }) {
  const byFloor = new Map(results.map((result) => [`${result.instanceId}:${result.floor}`, result]));
  const floors = [];
  const missing = [];
  for (const instance of metadata.instances) {
    for (const floor of instance.floors) {
      const result = byFloor.get(`${instance.instanceId}:${floor.index}`);
      if (result?.status === "ok") {
        floors.push({ instanceId: instance.instanceId, floor: floor.index, floorId: floor.floorId, name: floor.name, wing: floor.wing, sourceTiles: floor.tiles,
          filename: result.file, width: MAP_WIDTH, height: MAP_HEIGHT, bytes: result.bytes.length, sha256: sha256(result.bytes) });
      } else if (result) {
        missing.push({ instanceId: instance.instanceId, floor: floor.index, floorId: floor.floorId, missingTiles: result.missing || [], invalidTiles: result.invalid || [] });
      }
    }
  }
  const body = { schemaVersion: MANIFEST_SCHEMA, metadataSource: metadata.source, assetSource, width: MAP_WIDTH, height: MAP_HEIGHT, floors, missing };
  return { mapVersion: sha256(JSON.stringify(body)).slice(0, 16), ...body };
}

// Per instance: floors known and rendered, pins matched to the atlas's
// bosses and not, atlas bosses without a pin.
export function mapCoverage(metadata, atlasDungeons, manifest = null) {
  const rendered = new Set((manifest?.floors || []).map((floor) => floor.floorId));
  const known = new Map(metadata.instances.map((instance) => [instance.instanceId, instance]));
  const rows = [...atlasDungeons].sort((a, b) => a.instanceId - b.instanceId).map((dungeon) => {
    const instance = known.get(dungeon.instanceId);
    const names = new Set((dungeon.bosses || []).map((boss) => normalizeMapName(boss.name)));
    const pins = instance?.pins || [];
    const matched = pins.filter((pin) => names.has(normalizeMapName(pin.name)));
    const pinned = new Set(pins.map((pin) => normalizeMapName(pin.name)));
    return {
      instanceId: dungeon.instanceId, name: dungeon.name, floors: instance?.floors.length || 0,
      renderedFloors: (instance?.floors || []).filter((floor) => rendered.has(floor.floorId)).length,
      bosses: (dungeon.bosses || []).length, matchedPins: matched.length,
      unmatchedPins: pins.filter((pin) => !names.has(normalizeMapName(pin.name))).map((pin) => pin.name),
      bossesWithoutPin: (dungeon.bosses || []).filter((boss) => !pinned.has(normalizeMapName(boss.name))).map((boss) => boss.name),
    };
  });
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  return {
    totals: { instancesWithMetadata: rows.filter((row) => row.floors).length, floors: sum("floors"), renderedDungeons: rows.filter((row) => row.renderedFloors).length, renderedFloors: sum("renderedFloors"),
      bosses: sum("bosses"), matchedPins: sum("matchedPins"), unmatchedPins: rows.reduce((total, row) => total + row.unmatchedPins.length, 0),
      missingTextureFloors: manifest?.missing?.length ?? null, instancesWithoutMap: rows.filter((row) => !row.floors).map((row) => `${row.instanceId} ${row.name}`) },
    rows,
  };
}
