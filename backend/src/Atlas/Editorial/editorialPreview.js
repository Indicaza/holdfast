// Draft previews for the studio: the website detail exactly as the public
// route would serve it with this document published, and the add-on
// journal simulation built by the add-on export's rules. Nothing is stored.

import { readLootDungeonInDatabase, lootCatalogRevisionInDatabase } from "../../Loot/lootCatalogRepository.js";
import { withObservedRates } from "../../Loot/lootObservationRepository.js";
import { atlasDungeon, withAtlasDetail } from "../atlasRepository.js";
import { withJournalMap } from "../journalMaps.js";
import { addonJournalModel } from "./addonJournalModel.js";
import { addonEditorialEntry } from "./addonTransform.js";
import { readMediaInDatabase } from "./atlasMedia.js";
import { editorialView, withEditorialDetail } from "./editorialOverlay.js";
import { readActiveDocumentsInDatabase, readActiveInDatabase } from "./editorialRepository.js";

// { url, mime, focusX, focusY } of a media id, or null when it is gone.
export function mediaArtInDatabase(db, id) {
  const media = readMediaInDatabase(db, id);
  return media ? { url: media.urls.web, mime: media.mime, focusX: media.crop.focusX, focusY: media.crop.focusY, width: media.width, height: media.height } : null;
}

// The public detail (loot catalog, atlas, observed rates) before editorial content.
export function baseDetailInDatabase(db, instanceId) {
  const detail = readLootDungeonInDatabase(db, instanceId, { wishlisted: new Set() });
  return withObservedRates(db, withAtlasDetail(detail, instanceId, lootCatalogRevisionInDatabase(db)));
}

export function previewInDatabase(db, instanceId, document, { revision = null } = {}) {
  const imported = atlasDungeon(instanceId);
  const resolveMedia = (id) => mediaArtInDatabase(db, id);
  const view = editorialView(imported, document, { resolveMedia, revision, preview: true });
  const base = baseDetailInDatabase(db, instanceId);
  const website = withJournalMap(db, withEditorialDetail(base, view), instanceId);
  const entry = addonEditorialEntry(instanceId, view.resolution, revision);
  const cardId = view.resolution.dungeon.cardArt.winner === "editorial" ? view.resolution.dungeon.cardArt.effective : null;
  const portraits = new Map();
  for (const boss of view.resolution.bosses) {
    const field = boss.fields.portrait;
    if (field.winner === "editorial" && field.effective) {
      const art = resolveMedia(field.effective);
      if (art) portraits.set(boss.key, art);
    }
  }
  const addon = addonJournalModel(base, entry, { art: { card: cardId ? resolveMedia(cardId) : null, portraits }, importedName: imported?.name });
  return { website, addon, entry };
}

// The published editorial views the public routes lay over the atlas:
// Map instanceId → view (editorialOverlay.js), active revisions only.
export function publishedViewsInDatabase(db) {
  const views = new Map();
  for (const [id, active] of readActiveDocumentsInDatabase(db)) {
    const imported = atlasDungeon(id);
    if (!imported) continue;
    views.set(id, editorialView(imported, active.document, { resolveMedia: (mediaId) => mediaArtInDatabase(db, mediaId), revision: active.revisionId, publishedAt: active.publishedAt }));
  }
  return views;
}

export function publishedViewInDatabase(db, instanceId) {
  const active = readActiveInDatabase(db, instanceId);
  const imported = atlasDungeon(instanceId);
  if (!active || !imported) return null;
  return editorialView(imported, active.document, { resolveMedia: (mediaId) => mediaArtInDatabase(db, mediaId), revision: active.revision.id, publishedAt: active.publishedAt });
}
