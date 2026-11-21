// The Dungeon Content Studio's media library. Records live in atlas_media
// (editorialMigration.js); the image files live on disk under the runtime
// data directory, never in SQLite:
//   <data dir>/atlas-media/<id>/original.<png|jpg|webp>
//                               thumb.png, web.png   (PNG uploads only)
// Removal is refused while a draft or the active revision of any dungeon
// refers to the image.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runtimeDataDirectory } from "../../Data/runtimeData.js";
import { mediaReferences } from "./editorialSchema.js";
import { decodePng, encodePng, fitWithin, IMAGE_TYPES, imageInfo } from "./imageCodec.js";

export const MEDIA_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, minSide: 32, maxSide: 4096, thumb: 320, web: 1600 });
export const MEDIA_PURPOSES = Object.freeze(["card", "overview", "map", "portrait", "general"]);
// The aspect frames the editor previews and the add-on export crops to.
export const MEDIA_ASPECTS = Object.freeze({ card: 16 / 9, banner: 3, portrait: 1 });

const now = () => new Date().toISOString();
const mediaRoot = () => path.join(runtimeDataDirectory(), "atlas-media");
const directoryOf = (id) => path.join(mediaRoot(), id);

function row(record) {
  if (!record) return null;
  const variants = JSON.parse(record.variants_json);
  return {
    id: record.id, mime: record.mime, width: record.width, height: record.height, bytes: record.bytes, sha256: record.sha256,
    originalName: record.original_name, purpose: record.purpose, crop: JSON.parse(record.crop_json),
    attribution: record.attribution, license: record.license, sourceUrl: record.source_url, provenance: record.provenance,
    createdAt: record.created_at, createdBy: record.created_by, updatedAt: record.updated_at,
    variants: Object.keys(variants),
    urls: Object.fromEntries(["original", "thumb", "web"].map((variant) => [variant, `/api/atlas-media/${record.id}/${variants[variant] ? variant : "original"}`])),
  };
}

export function readMediaInDatabase(db, id) {
  return row(db.prepare("SELECT * FROM atlas_media WHERE id = ?").get(id));
}

export function listMediaInDatabase(db) {
  return db.prepare("SELECT * FROM atlas_media ORDER BY created_at DESC, id").all().map(row);
}

// Every media id a draft or an active revision refers to, with where.
export function mediaUsageInDatabase(db) {
  const usage = new Map();
  const add = (ids, where) => {
    for (const id of ids) usage.set(id, [...(usage.get(id) || []), where]);
  };
  for (const draft of db.prepare("SELECT instance_id, document_json FROM atlas_editorial_drafts").all()) add(mediaReferences(JSON.parse(draft.document_json)), { instanceId: draft.instance_id, in: "draft" });
  for (const active of db.prepare("SELECT a.instance_id, r.number, r.document_json FROM atlas_editorial_active a JOIN atlas_editorial_revisions r ON r.id = a.revision_id").all()) {
    add(mediaReferences(JSON.parse(active.document_json)), { instanceId: active.instance_id, in: `published r${active.number}` });
  }
  return usage;
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function cropOf(raw) {
  const clamp = (value, fallback) => (typeof value === "number" && value >= 0 && value <= 1 ? Math.round(value * 1000) / 1000 : fallback);
  return { focusX: clamp(raw?.focusX, 0.5), focusY: clamp(raw?.focusY, 0.5) };
}

// Validates and stores an upload. { status: "ok", media } | { status: "invalid", problems }.
export function createMediaInDatabase(db, buffer, { name = "", purpose = "general", attribution = "", license = "", sourceUrl = "", provenance = "", actor = {} } = {}) {
  const problems = [];
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { status: "invalid", problems: [{ code: "empty", message: "No image was uploaded." }] };
  if (buffer.length > MEDIA_LIMITS.maxBytes) problems.push({ code: "too-large", message: `Images are at most ${MEDIA_LIMITS.maxBytes / 1024 / 1024} MB.` });
  const info = imageInfo(buffer);
  if (!info) return { status: "invalid", problems: [...problems, { code: "type", message: "Only PNG, JPEG and WebP images are accepted." }] };
  if (Math.min(info.width, info.height) < MEDIA_LIMITS.minSide || Math.max(info.width, info.height) > MEDIA_LIMITS.maxSide) {
    problems.push({ code: "dimensions", message: `Images are ${MEDIA_LIMITS.minSide}–${MEDIA_LIMITS.maxSide} pixels on each side (this one is ${info.width}×${info.height}).` });
  }
  if (!MEDIA_PURPOSES.includes(purpose)) problems.push({ code: "purpose", message: `Purpose is one of ${MEDIA_PURPOSES.join(", ")}.` });
  if (problems.length) return { status: "invalid", problems };

  const id = `m_${randomBytes(10).toString("hex")}`;
  const directory = directoryOf(id);
  mkdirSync(directory, { recursive: true });
  const variants = {};
  const original = `original.${IMAGE_TYPES[info.mime]}`;
  writeFileSync(path.join(directory, original), buffer);
  variants.original = original;
  if (info.mime === "image/png") {
    const decoded = decodePng(buffer);
    if (decoded) {
      for (const [variant, max] of [["thumb", MEDIA_LIMITS.thumb], ["web", MEDIA_LIMITS.web]]) {
        writeFileSync(path.join(directory, `${variant}.png`), encodePng(fitWithin(decoded, max)));
        variants[variant] = `${variant}.png`;
      }
    }
  }
  const stamp = now();
  db.prepare(`INSERT INTO atlas_media (id, mime, width, height, bytes, sha256, original_name, purpose, crop_json, variants_json, attribution, license, source_url, provenance, created_at, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, info.mime, info.width, info.height, buffer.length, createHash("sha256").update(buffer).digest("hex"), text(name, 200), purpose,
      JSON.stringify(cropOf(null)), JSON.stringify(variants), text(attribution, 300), text(license, 120), text(sourceUrl, 500), text(provenance, 500), stamp, actor.name || actor.id || "", stamp);
  return { status: "ok", media: readMediaInDatabase(db, id) };
}

export function updateMediaInDatabase(db, id, patch = {}) {
  const current = readMediaInDatabase(db, id);
  if (!current) return { status: "not-found" };
  if (patch.purpose !== undefined && !MEDIA_PURPOSES.includes(patch.purpose)) return { status: "invalid", problems: [{ code: "purpose", message: "Unknown purpose." }] };
  db.prepare("UPDATE atlas_media SET purpose = ?, crop_json = ?, attribution = ?, license = ?, source_url = ?, provenance = ?, updated_at = ? WHERE id = ?").run(
    patch.purpose ?? current.purpose,
    JSON.stringify(patch.crop !== undefined ? cropOf(patch.crop) : current.crop),
    patch.attribution !== undefined ? text(patch.attribution, 300) : current.attribution,
    patch.license !== undefined ? text(patch.license, 120) : current.license,
    patch.sourceUrl !== undefined ? text(patch.sourceUrl, 500) : current.sourceUrl,
    patch.provenance !== undefined ? text(patch.provenance, 500) : current.provenance,
    now(), id);
  return { status: "ok", media: readMediaInDatabase(db, id) };
}

// Refused while referenced; otherwise the record and its files go.
export function deleteMediaInDatabase(db, id) {
  if (!readMediaInDatabase(db, id)) return { status: "not-found" };
  const usedBy = mediaUsageInDatabase(db).get(id);
  if (usedBy?.length) return { status: "conflict", usedBy };
  db.prepare("DELETE FROM atlas_media WHERE id = ?").run(id);
  rmSync(directoryOf(id), { recursive: true, force: true });
  return { status: "ok" };
}

// { file, mime } of a variant, or null.
export function mediaFileInDatabase(db, id, variant = "original") {
  const record = db.prepare("SELECT mime, variants_json FROM atlas_media WHERE id = ?").get(id);
  if (!record) return null;
  const variants = JSON.parse(record.variants_json);
  const name = variants[variant] || variants.original;
  const file = path.join(directoryOf(id), name);
  if (!existsSync(file)) return null;
  return { file, mime: name.endsWith(".png") ? "image/png" : record.mime };
}

export function readMediaBytes(file) {
  return readFileSync(file);
}

// The public URL a published page uses (web variant when there is one).
export function mediaUrlInDatabase(db, id) {
  const media = readMediaInDatabase(db, id);
  return media ? media.urls.web : null;
}

export function mediaFocusInDatabase(db, id) {
  return readMediaInDatabase(db, id)?.crop || null;
}
