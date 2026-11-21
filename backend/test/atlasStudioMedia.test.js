// Dungeon Content Studio, milestone 2: the media library and the draft
// previews. Images are synthetic (generated here); dungeons are the real
// imported atlas.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { cropToAspect, decodePng, encodePng, encodeTga, fitWithin, imageInfo } from "../src/Atlas/Editorial/imageCodec.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const BASE = "/api/admin/atlas-studio";
const HALL = 3065;
const FALDRIM = "261306";
const override = (value, verified = false, source = "test") => ({ value, verified, source });

function gradient(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 4;
    pixels[at] = (x * 255) / width; pixels[at + 1] = (y * 255) / height; pixels[at + 2] = 128; pixels[at + 3] = 255;
  }
  return { width, height, pixels };
}

test("the codec round-trips PNG, reads dimensions, crops, scales and writes TGA", () => {
  const png = encodePng(gradient(400, 200));
  assert.deepEqual(imageInfo(png), { mime: "image/png", width: 400, height: 200 });
  const decoded = decodePng(png);
  assert.equal(decoded.width, 400);
  assert.deepEqual([...decoded.pixels.subarray(0, 4)], [0, 0, 128, 255]);
  const small = fitWithin(decoded, 100);
  assert.deepEqual([small.width, small.height], [100, 50]);
  const square = cropToAspect(decoded, 1, 0, 0.5);
  assert.deepEqual([square.width, square.height], [200, 200]);
  const tga = encodeTga(fitWithin(square, 64));
  assert.equal(tga.length, 18 + 64 * 64 * 4);
  assert.equal(tga[2], 2);
  assert.equal(tga[16], 32);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 90, 0, 120, 3]);
  assert.deepEqual(imageInfo(jpeg), { mime: "image/jpeg", width: 120, height: 90 });
  assert.equal(imageInfo(Buffer.from("GIF89a....")), null);
});

test("uploads are validated, get variants on disk, are reusable and cannot be removed while referenced", () => withHttpApp(async ({ request, base, cookie, directory }) => {
  const upload = (bytes, type = "image/png", query = "name=card.png&purpose=card&attribution=Synthetic%20test%20art&license=CC0", persona = "owner") => fetch(`${base}${BASE}/media?${query}`, {
    method: "POST", headers: { Origin: "https://holdfast.example", Cookie: cookie(persona), "Content-Type": type }, body: bytes,
  }).then(async (response) => ({ status: response.status, json: await response.json() }));

  assert.equal((await upload(encodePng(gradient(64, 64)), "image/png", "", "member")).status, 403, "members cannot upload");
  const fake = await upload(Buffer.from("not an image at all"), "image/png");
  assert.equal(fake.status, 400);
  assert.equal(fake.json.problems[0].code, "type");
  const tiny = await upload(encodePng(gradient(16, 16)));
  assert.equal(tiny.json.problems[0].code, "dimensions");
  const huge = await upload(Buffer.alloc(9 * 1024 * 1024, 1));
  assert.equal(huge.status, 413);

  const created = await upload(encodePng(gradient(1920, 1080)));
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const media = created.json.media;
  assert.match(media.id, /^m_[a-f0-9]{20}$/);
  assert.deepEqual([media.width, media.height, media.mime, media.attribution, media.license], [1920, 1080, "image/png", "Synthetic test art", "CC0"]);
  assert.deepEqual(media.variants.sort(), ["original", "thumb", "web"]);
  assert.ok(existsSync(path.join(directory, "atlas-media", media.id, "original.png")), "binaries live on disk, not in SQLite");
  const web = await fetch(`${base}${media.urls.web}`);
  assert.equal(web.status, 200);
  assert.equal(web.headers.get("content-type"), "image/png");
  assert.deepEqual(imageInfo(Buffer.from(await web.arrayBuffer())), { mime: "image/png", width: 1600, height: 900 });
  const thumb = await fetch(`${base}${media.urls.thumb}`);
  assert.equal(imageInfo(Buffer.from(await thumb.arrayBuffer())).width, 320);

  const cropped = await request(`${BASE}/media/${media.id}`, { persona: "owner", method: "PATCH", body: { crop: { focusX: 0.25, focusY: 2 }, provenance: "Generated in a test" } });
  assert.deepEqual(cropped.json.media.crop, { focusX: 0.25, focusY: 0.5 });

  // Used as card art and as a portrait (reuse across views), in a draft.
  const document = { dungeon: { cardArt: override(media.id, true) }, bosses: { [FALDRIM]: { portrait: override(media.id),
    mechanics: override([{ id: "shadow-bolt", ability: "Shadow Bolt", type: "interrupt", priority: "high", instruction: "Interrupt whenever possible.", roles: ["dps", "tank"], verified: true }]) } } };
  const saved = await request(`${BASE}/dungeons/${HALL}/draft`, { persona: "owner", method: "PUT", body: { document, expectedVersion: 0 } });
  assert.equal(saved.status, 200, saved.text);
  const refused = await request(`${BASE}/media/${media.id}`, { persona: "owner", method: "DELETE" });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.json.usedBy, [{ instanceId: HALL, in: "draft" }]);
  const listed = await request(`${BASE}/media`, { persona: "owner" });
  assert.equal(listed.json.media[0].usedBy.length, 1);

  // Both previews, from the draft, without publishing.
  const preview = await request(`${BASE}/dungeons/${HALL}/preview`, { persona: "owner", method: "POST", body: { document } });
  assert.equal(preview.status, 200, preview.text);
  assert.equal(preview.json.website.atlas.artworkUrl, media.urls.web);
  assert.equal(preview.json.website.atlas.editorial.preview, true);
  assert.deepEqual(preview.json.website.atlas.editorial.art.card, { url: media.urls.web, mime: "image/png", focusX: 0.25, focusY: 0.5, width: 1920, height: 1080 });
  const faldrim = preview.json.website.atlas.bosses.find((boss) => boss.npcId === 261306);
  assert.equal(faldrim.portraitUrl, media.urls.web);
  assert.equal(faldrim.mechanics[0].instruction, "Interrupt whenever possible.");
  assert.ok(Array.isArray(faldrim.referenceLoot), "loot stays as the public route serves it");
  const addon = preview.json.addon;
  assert.equal(addon.simulation, true);
  assert.equal(addon.card.packaged, true);
  assert.deepEqual([addon.card.width, addon.card.height], [512, 256]);
  const addonBoss = addon.bosses.find((boss) => boss.key === FALDRIM);
  assert.deepEqual(addonBoss.mechanics[0], { a: "Shadow Bolt", t: "interrupt", p: "high", i: "Interrupt whenever possible.", r: "tank,dps", v: true });
  assert.equal(addonBoss.portrait.packaged, true);
  const unpublished = await request(`${BASE}/dungeons/${HALL}`, { persona: "owner" });
  assert.equal(unpublished.json.active, null, "previewing publishes nothing");

  await request(`${BASE}/dungeons/${HALL}/draft`, { persona: "owner", method: "DELETE" });
  const removed = await request(`${BASE}/media/${media.id}`, { persona: "owner", method: "DELETE" });
  assert.equal(removed.status, 200, removed.text);
  assert.equal((await fetch(`${base}${media.urls.web}`)).status, 404);
  assert.equal(existsSync(path.join(directory, "atlas-media", media.id)), false);
}));
