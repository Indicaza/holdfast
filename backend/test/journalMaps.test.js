import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { decodeBlp } from "../src/Atlas/blpCodec.js";
import { createMediaInDatabase } from "../src/Atlas/Editorial/atlasMedia.js";
import { decodePng, encodePng } from "../src/Atlas/Editorial/imageCodec.js";
import { assembleFloor, buildManifest, MAP_HEIGHT, MAP_WIDTH, mapCoverage, mediaNameOf, parseAddonMaps, parseLuaTable } from "../src/Atlas/journalMapPipeline.js";
import { importJournalMapsInDatabase, journalMapView, loadJournalMaps, withJournalMap } from "../src/Atlas/journalMaps.js";
import { withGuildTransaction } from "../src/Data/database.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

// Synthetic tiles only: every pixel says which tile it came from.
const flatTile = (index) => {
  const rgba = Buffer.alloc(256 * 256 * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = index * 20; rgba[i + 1] = 255 - index * 20; rgba[i + 2] = index; rgba[i + 3] = 255; }
  return { width: 256, height: 256, rgba };
};
const pixel = ({ pixels }, x, y) => pixels[(y * MAP_WIDTH + x) * 4 + 2];
const tiles = (base) => Array.from({ length: 12 }, (_, i) => base + i);
const LUA = `A.source = { openmap = "abc1234", planner = "x" }
local maps = {
  [36]={{n="The Deadmines",t={${tiles(100)}}},{n="Ironclad Cove",t={${tiles(200)}}}},
  [429]={{n="Gordok Commons",w="Dire Maul - North",t={${tiles(300)}}},{n="Capital Gardens",w="Dire Maul - West",t={${tiles(400)}}}},
}
local pins = {
  [36]={{n="Edwin VanCleef",f=2,x=0.6076,y=0.4489},{n="Rhahk'Zor",f=1,x=0.3653,y=0.6123},{n="Nobody",f=1,x=0.1,y=0.1}},
}
`;

test("the add-on's table parses: floors, order, wings, pins", () => {
  assert.deepEqual(parseLuaTable(`{[3]={a=1,"x"},b="it's"}`)[3].a, 1);
  const parsed = parseAddonMaps(LUA, { addonCommit: "c" });
  assert.deepEqual(parsed.problems, []);
  const deadmines = parsed.instances[0];
  assert.deepEqual(deadmines.floors.map((floor) => [floor.floorId, floor.name]), [["journal-36-1", "The Deadmines"], ["journal-36-2", "Ironclad Cove"]]);
  assert.deepEqual(deadmines.floors[1].tiles, tiles(200));
  assert.equal(parsed.instances[1].floors[1].wing, "Dire Maul - West");
  assert.deepEqual(deadmines.pins.find((pin) => pin.name === "Edwin VanCleef"), { name: "Edwin VanCleef", floor: 2, x: 0.6076, y: 0.4489 });
  assert.equal(parsed.source.openmap, "abc1234");
});

test("a bad floor or pin is reported, never guessed", () => {
  const bad = parseAddonMaps(`local maps = {[1]={{t={1,2}}}}\nlocal pins = {[1]={{n="A",f=9,x=0.5,y=0.5},{n="B",f=1,x=1.5,y=0.5}},[2]={{n="C",f=1,x=0,y=0}}}`);
  assert.deepEqual(bad.problems.map((problem) => problem.code).sort(), ["bad-pin", "bad-pin", "bad-tiles", "pins-without-map"]);
  assert.deepEqual(bad.instances[0].pins, []);
});

test("every checked-in pin is on a real floor of the 1002 x 668 picture", () => {
  const { instances, problems } = loadJournalMaps();
  assert.deepEqual(problems, []);
  assert.equal(instances.length, 25);
  const deadmines = instances.find((entry) => entry.instanceId === 36);
  assert.deepEqual(deadmines.floors.map((floor) => floor.name), ["The Deadmines", "Ironclad Cove"]);
  assert.equal(deadmines.pins.find((pin) => pin.name === "Sneed").floor, 1);
  assert.equal(deadmines.pins.find((pin) => pin.name === "Edwin VanCleef").floor, 2);
});

test("tiles assemble row by row and crop to 1002 x 668", () => {
  const image = assembleFloor(Array.from({ length: 12 }, (_, index) => flatTile(index)));
  assert.deepEqual([image.width, image.height], [1002, 668]);
  assert.deepEqual([pixel(image, 0, 0), pixel(image, 256, 0), pixel(image, 768, 0), pixel(image, 0, 256), pixel(image, 255, 511), pixel(image, 1001, 667)], [0, 1, 3, 4, 4, 11]);
  const round = decodePng(encodePng(image));
  assert.deepEqual([round.width, round.height], [1002, 668]);
});

test("a tile of the wrong size refuses the floor", () => {
  const list = Array.from({ length: 12 }, (_, index) => flatTile(index));
  list[5] = { width: 128, height: 128, rgba: Buffer.alloc(128 * 128 * 4) };
  assert.throws(() => assembleFloor(list), /Tile 6/);
  assert.throws(() => assembleFloor(list.slice(1)), /12 tiles/);
});

test("raw BLP2 tiles decode to RGBA", () => {
  const header = Buffer.alloc(148);
  header.write("BLP2", 0, "latin1");
  header[8] = 3;
  header.writeUInt32LE(1, 12);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(148, 20);
  const decoded = decodeBlp(Buffer.concat([header, Buffer.from([1, 2, 3, 4])]));
  assert.deepEqual([...decoded.rgba], [3, 2, 1, 4]);
});

test("the manifest is deterministic and lists what is missing", () => {
  const metadata = parseAddonMaps(LUA, { addonCommit: "c" });
  const results = [
    { instanceId: 36, floor: 1, status: "ok", file: mediaNameOf(36, 1), bytes: Buffer.from("one") },
    { instanceId: 36, floor: 2, status: "missing", missing: [205], invalid: [] },
  ];
  const one = buildManifest(metadata, results, { assetSource: "fixture" });
  assert.equal(JSON.stringify(one), JSON.stringify(buildManifest(metadata, [...results].reverse(), { assetSource: "fixture" })));
  assert.equal(one.floors[0].sha256.length, 64);
  assert.deepEqual(one.floors[0].sourceTiles, tiles(100));
  assert.deepEqual(one.missing[0].missingTiles, [205]);
  const coverage = mapCoverage(metadata, [{ instanceId: 36, name: "The Deadmines", bosses: [{ name: "Rhahk'Zor" }, { name: "Edwin VanCleef" }, { name: "Sneed" }] }, { instanceId: 3065, name: "Hall", bosses: [] }], one);
  assert.equal(coverage.totals.renderedFloors, 1);
  assert.deepEqual(coverage.rows[0].unmatchedPins, ["Nobody"]);
  assert.deepEqual(coverage.rows[0].bossesWithoutPin, ["Sneed"]);
  assert.deepEqual(coverage.totals.instancesWithoutMap, ["3065 Hall"]);
});

test("a wing shows only its floors and pins; a floor without a picture is not shown", () => {
  const { instances } = parseAddonMaps(`local maps = {[429]={{n="North",t={${tiles(1)}}},{n="West",t={${tiles(20)}}}}}\nlocal pins = {[429]={{n="A",f=1,x=0.1,y=0.2},{n="B",f=2,x=0.3,y=0.4}}}`);
  const bosses = [{ npcId: 1, name: "A" }, { npcId: 2, name: "B" }];
  const media = new Map([1, 2].map((floor) => [floor, { urls: { web: `/m/${floor}` }, width: 1002, height: 668 }]));
  const wing = journalMapView(instances[0], { wing: "West", floors: [{ name: "West" }], bosses: [bosses[1]] }, bosses, media);
  assert.deepEqual(wing.floors.map((floor) => floor.floorId), ["journal-429-2"]);
  assert.deepEqual(wing.pins.map((pin) => pin.name), ["B"]);
  const partial = journalMapView(instances[0], { bosses }, bosses, new Map([[2, media.get(2)]]));
  assert.deepEqual(partial.floors.map((floor) => floor.index), [2]);
  assert.deepEqual(partial.pins.map((pin) => pin.name), ["B"]);
  assert.equal(journalMapView(instances[0], { bosses }, bosses, new Map()), null);
});

const png = (shade) => encodePng({ width: 64, height: 64, pixels: Buffer.alloc(64 * 64 * 4, shade) });

test("Studio media drives the floors: imports keep editors' images, newest wins", () => withHttpApp(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "journal-maps-"));
  writeFileSync(path.join(directory, "a.png"), png(9));
  const floor = { instanceId: 36, floor: 1, floorId: "journal-36-1", sourceTiles: tiles(1), filename: "a.png", sha256: "f" };
  const manifest = { mapVersion: "v1", assetSource: "fixture", floors: [floor] };
  const options = { attribution: "Test", license: "fixture" };
  const atlas = { bosses: [{ encounterId: 2741, npcId: 644, name: "Rhahk'Zor" }], maps: [] };
  withGuildTransaction((db) => {
    assert.equal(withJournalMap(db, { atlas }, 36).atlas.journalMap, undefined, "no picture, no map");
    assert.deepEqual(importJournalMapsInDatabase(db, manifest, directory, options), { imported: 1, kept: 0, failed: [] });
    assert.deepEqual(importJournalMapsInDatabase(db, manifest, directory, options), { imported: 0, kept: 1, failed: [] });
    const first = withJournalMap(db, { atlas }, 36).atlas.journalMap;
    assert.equal(first.floors[0].attribution, "Test");
    assert.deepEqual(first.pins.map((pin) => [pin.bossKey, pin.floorId, pin.x]), [["2741", "journal-36-1", 0.3653]]);
    const editor = createMediaInDatabase(db, png(50), { name: mediaNameOf(36, 1), purpose: "map", attribution: "Editor" });
    assert.equal(editor.status, "ok");
    db.prepare("UPDATE atlas_media SET created_at = ? WHERE id = ?").run("2999-01-01T00:00:00.000Z", editor.media.id);
    assert.equal(withJournalMap(db, { atlas }, 36).atlas.journalMap.floors[0].attribution, "Editor");
    assert.equal(importJournalMapsInDatabase(db, manifest, directory, options).kept, 1);
    const edited = { atlas: { ...atlas, maps: [{ floorId: "editorial-map", imageUrl: "/editor.png" }] } };
    assert.equal(withJournalMap(db, edited, 36).atlas.journalMap, undefined, "a published editorial map wins");
  });
}));
