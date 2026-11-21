// CMS art for the add-on: the WoW client loads textures from the add-on
// folder (.tga or .blp; the add-on ships .tga, Media/*.tga), never from the
// web, and Classic-era clients need power-of-two sides. Published card art and
// boss portraits that were uploaded as PNG are cropped around their focal
// point, scaled and written as 32-bit TGA. JPEG and WebP cannot be decoded
// here: they stay website-only and are listed as skipped.

import { readFileSync } from "node:fs";

import { ADDON_ART } from "./addonJournalModel.js";
import { mediaFileInDatabase, readMediaInDatabase } from "./atlasMedia.js";
import { resolveEditorial } from "./editorialResolve.js";
import { cropToAspect, decodePng, encodeTga, resize } from "./imageCodec.js";

// The add-on's texture path for a packaged image (no extension, as
// SetTexture takes it).
export const addonTexturePath = (name) => ["Interface", "AddOns", "Guildweaver", "Media", "Atlas", name].join("\\");

// [{ instanceId, kind, key, mediaId, name, texture }] for the active documents.
export function addonArtPlan(activeDocuments, atlasDungeon) {
  const plan = [];
  for (const [instanceId, active] of activeDocuments) {
    const resolution = resolveEditorial(atlasDungeon(instanceId), active.document);
    const card = resolution.dungeon.cardArt;
    if (card.winner === "editorial" && card.effective) plan.push({ instanceId, kind: "card", key: null, mediaId: card.effective, name: `${instanceId}_card` });
    for (const boss of resolution.bosses) {
      const portrait = boss.fields.portrait;
      if (portrait.winner === "editorial" && portrait.effective) plan.push({ instanceId, kind: "portrait", key: boss.key, mediaId: portrait.effective, name: `${instanceId}_${boss.key.replace(/[^A-Za-z0-9]/g, "")}` });
    }
  }
  return plan.map((entry) => ({ ...entry, texture: addonTexturePath(entry.name) }));
}

// { files: [{ name, bytes }], art: { [instanceId]: { card?, portraits? } }, skipped: [...] }
export function buildAddonArt(db, plan) {
  const files = [];
  const art = {};
  const skipped = [];
  for (const entry of plan) {
    const media = readMediaInDatabase(db, entry.mediaId);
    const file = media && mediaFileInDatabase(db, entry.mediaId, "original");
    const decoded = media?.mime === "image/png" && file ? decodePng(readFileSync(file.file)) : null;
    if (!decoded) {
      skipped.push({ ...entry, reason: !media ? "missing" : media.mime !== "image/png" ? "format" : "undecodable" });
      continue;
    }
    const spec = ADDON_ART[entry.kind];
    const cropped = cropToAspect(decoded, spec.aspect, media.crop.focusX, media.crop.focusY);
    files.push({ name: `${entry.name}.tga`, bytes: encodeTga(resize(cropped, spec.width, spec.height)) });
    const slot = (art[entry.instanceId] ||= {});
    if (entry.kind === "card") slot.card = entry.texture;
    else (slot.portraits ||= {})[entry.key] = entry.texture;
  }
  return { files, art, skipped };
}
