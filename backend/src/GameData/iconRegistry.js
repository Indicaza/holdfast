import { createHash } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";

// What the website knows about each icon (a FileDataID): where its image
// was last found, whether a copy is stored, and when a missing icon may be
// asked about again. Metadata lives in SQLite (game_icon_assets); images,
// when copies are kept, live in object storage, never in the database or
// on the server's own disk.
//
// Where an icon's image comes from, in order:
//   1. a stored copy (ICON_STORAGE_* configured and the copy verified)
//   2. the image URL Blizzard's item API gave for an item with this icon
//   3. Blizzard's media search for the FileDataID
// and otherwise nothing: the page shows the game's question mark.

const RETRY_BASE_SECONDS = 3600;
const RETRY_MAX_SECONDS = 7 * 86400;
const MAX_ICON_BYTES = 512 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function iconStorageConfig(env = process.env) {
  const bucket = String(env.ICON_STORAGE_BUCKET || "").trim();
  if (!bucket) return null;
  return {
    bucket,
    prefix: String(env.ICON_STORAGE_PREFIX || "icons/").trim(),
    publicUrl: String(env.ICON_STORAGE_PUBLIC_URL || "").trim().replace(/\/$/, ""),
    clientOptions: { region: env.ICON_STORAGE_REGION || "auto", ...(env.ICON_STORAGE_ENDPOINT ? { endpoint: env.ICON_STORAGE_ENDPOINT, forcePathStyle: true } : {}),
      credentials: { accessKeyId: env.ICON_STORAGE_ACCESS_KEY_ID || "", secretAccessKey: env.ICON_STORAGE_SECRET_ACCESS_KEY || "" } },
  };
}

// An icon the website has a reason to show: one an item it knows uses.
// Keeps the icon routes from being a proxy for anything.
export function iconKnownInDatabase(db, fileDataId) {
  return Boolean(db.prepare("SELECT 1 FROM game_icon_assets WHERE file_data_id = ?").get(fileDataId)
    || db.prepare("SELECT 1 FROM public_game_items WHERE icon_file_id = ? LIMIT 1").get(fileDataId)
    || db.prepare("SELECT 1 FROM market_item_meta WHERE icon_file_id = ? LIMIT 1").get(fileDataId)
    || db.prepare("SELECT 1 FROM game_data_catalog WHERE icon_file_id = ? LIMIT 1").get(fileDataId));
}

// The image URL Blizzard's item API returned for an item using this icon.
function catalogUrlInDatabase(db, fileDataId) {
  for (const row of db.prepare("SELECT metadata_json FROM game_data_catalog WHERE icon_file_id = ? AND source = 'blizzard' LIMIT 5").all(fileDataId)) {
    try {
      const url = httpsUrl(JSON.parse(row.metadata_json || "{}").mediaUrl);
      if (url) return url;
    } catch {
      // A bad row is skipped.
    }
  }
  return "";
}

function retryAfter(failures) {
  return Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.max(0, failures - 1));
}

export function readIconInDatabase(db, fileDataId) {
  return db.prepare("SELECT * FROM game_icon_assets WHERE file_data_id = ?").get(fileDataId) || null;
}

function recordFound(db, fileDataId, url, source, now) {
  db.prepare(`INSERT INTO game_icon_assets (file_data_id, source_url, source, status, first_seen_at, last_success_at, last_attempt_at, failures, next_attempt_at, last_error)
    VALUES (?, ?, ?, 'linked', ?, ?, ?, 0, 0, '')
    ON CONFLICT(file_data_id) DO UPDATE SET source_url = excluded.source_url, source = excluded.source,
      status = CASE WHEN game_icon_assets.status = 'stored' THEN 'stored' ELSE 'linked' END,
      last_success_at = excluded.last_success_at, last_attempt_at = excluded.last_attempt_at, failures = 0, next_attempt_at = 0, last_error = ''`)
    .run(fileDataId, url, source, now, now, now);
}

function recordMissing(db, fileDataId, now, error = "not_found") {
  const failures = (readIconInDatabase(db, fileDataId)?.failures || 0) + 1;
  db.prepare(`INSERT INTO game_icon_assets (file_data_id, status, first_seen_at, last_attempt_at, failures, next_attempt_at, last_error)
    VALUES (?, 'missing', ?, ?, ?, ?, ?)
    ON CONFLICT(file_data_id) DO UPDATE SET status = CASE WHEN game_icon_assets.status = 'stored' THEN 'stored' ELSE 'missing' END,
      last_attempt_at = excluded.last_attempt_at, failures = excluded.failures, next_attempt_at = excluded.next_attempt_at, last_error = excluded.last_error`)
    .run(fileDataId, now, now, failures, now + retryAfter(failures), String(error).slice(0, 120));
}

// Where to send the browser for an icon: { kind: "stored" | "redirect", ... }
// or null (show the question mark). A missing icon is asked about again
// only after its back-off, never on every page view.
export async function resolveIcon(fileDataId, { resolver = null, storage = null, now = nowSeconds() } = {}) {
  const id = positiveInteger(fileDataId);
  if (!id) return null;
  const row = withGuildDatabase((db) => readIconInDatabase(db, id));
  if (row?.status === "stored" && row.storage_key && storage) {
    return storage.publicUrl ? { kind: "redirect", url: `${storage.publicUrl}/${row.storage_key}`, source: "stored" } : { kind: "stored", key: row.storage_key, contentType: row.content_type };
  }
  if ((row?.status === "linked" || row?.status === "stored") && row.source_url) return { kind: "redirect", url: row.source_url, source: row.source };
  if (row?.status === "missing" && row.next_attempt_at > now) return null;
  const fromCatalog = withGuildDatabase((db) => catalogUrlInDatabase(db, id));
  if (fromCatalog) {
    withGuildTransaction((db) => recordFound(db, id, fromCatalog, "blizzard_item", now));
    return { kind: "redirect", url: fromCatalog, source: "blizzard_item" };
  }
  let found = "";
  let error = "not_found";
  try {
    found = httpsUrl(resolver ? await resolver.resolve(id) : "");
  } catch (problem) {
    error = problem?.message || "resolver_failed";
  }
  withGuildTransaction((db) => (found ? recordFound(db, id, found, "blizzard_media", now) : recordMissing(db, id, now, error)));
  return found ? { kind: "redirect", url: found, source: "blizzard_media" } : null;
}

// Sends an icon to the browser: a stored copy streamed or redirected to, a
// known image URL redirected to, or 404 (the page shows the question mark).
export async function sendIcon(res, fileDataId, { resolver, storage = iconStorageConfig(), client = null, cacheControl = "public, max-age=3600" } = {}) {
  const found = await resolveIcon(fileDataId, { resolver, storage });
  if (!found) {
    res.set("Cache-Control", "public, max-age=600");
    res.status(404).json({ error: "icon_media_not_found" });
    return;
  }
  if (found.kind === "stored") {
    try {
      const s3 = client || new S3Client({ ...storage.clientOptions, maxAttempts: 2 });
      const object = await s3.send(new GetObjectCommand({ Bucket: storage.bucket, Key: found.key }));
      res.set("Cache-Control", "public, max-age=604800, immutable");
      res.type(found.contentType || "image/jpeg");
      res.send(Buffer.from(await object.Body.transformToByteArray()));
      return;
    } catch {
      // The copy is unavailable: fall back to where it came from.
      const row = withGuildDatabase((db) => readIconInDatabase(db, positiveInteger(fileDataId)));
      if (!row?.source_url) { res.status(404).json({ error: "icon_media_not_found" }); return; }
      res.set("Cache-Control", cacheControl);
      res.redirect(302, row.source_url);
      return;
    }
  }
  res.set("Cache-Control", cacheControl);
  res.redirect(302, found.url);
}

// Keeps copies of linked icons in object storage, a few at a time, when
// configured. Only images (JPEG, PNG, WebP) up to 512 KB are kept, each
// with its hash. Failures back off like lookups do.
export async function storeIcons({ storage = iconStorageConfig(), client = null, fetchImpl = globalThis.fetch, limit = 25, now = nowSeconds } = {}) {
  if (!storage) return { stored: 0, failed: 0, skipped: true };
  const due = withGuildDatabase((db) => db.prepare(`SELECT file_data_id, source_url FROM game_icon_assets WHERE status = 'linked' AND source_url <> ''
    AND next_attempt_at <= ? ORDER BY last_success_at DESC LIMIT ?`).all(now(), limit));
  const s3 = client || new S3Client({ ...storage.clientOptions, maxAttempts: 2 });
  let stored = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const response = await fetchImpl(row.source_url, { signal: AbortSignal.timeout(15_000) });
      const type = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!response.ok || !ALLOWED_TYPES.has(type)) throw new Error(`bad_response_${response.status}_${type || "unknown"}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_ICON_BYTES) throw new Error("bad_size");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = `${storage.prefix}${row.file_data_id}.${type.split("/")[1].replace("jpeg", "jpg")}`;
      await s3.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: bytes, ContentType: type, CacheControl: "public, max-age=31536000, immutable" }));
      withGuildTransaction((db) => db.prepare(`UPDATE game_icon_assets SET status = 'stored', storage_key = ?, content_type = ?, sha256 = ?, bytes = ?,
        last_success_at = ?, last_attempt_at = ?, failures = 0, next_attempt_at = 0, last_error = '' WHERE file_data_id = ?`)
        .run(key, type, sha256, bytes.length, now(), now(), row.file_data_id));
      stored += 1;
    } catch (error) {
      withGuildTransaction((db) => {
        const failures = (readIconInDatabase(db, row.file_data_id)?.failures || 0) + 1;
        db.prepare("UPDATE game_icon_assets SET failures = ?, last_attempt_at = ?, next_attempt_at = ?, last_error = ? WHERE file_data_id = ?")
          .run(failures, now(), now() + retryAfter(failures), String(error?.message || error).slice(0, 120), row.file_data_id);
      });
      failed += 1;
    }
  }
  return { stored, failed, skipped: false };
}

// Counts for Diagnostics.
export function iconStatusInDatabase(db) {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM game_icon_assets GROUP BY status").all();
  return { ...Object.fromEntries(rows.map((row) => [row.status, row.n])), storageConfigured: Boolean(iconStorageConfig()) };
}
