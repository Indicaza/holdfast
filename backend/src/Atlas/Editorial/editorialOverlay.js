// Lays effective editorial content over the website's atlas responses
// (docs/dungeon-atlas-contract.md shapes). Additions only: every field a
// client already reads keeps its meaning, the editorial ones are optional.
// Observed loot, observed drop rates, telemetry and readiness are never
// touched: they are not in the editorial schema.

import { effectiveEditorial, resolveEditorial } from "./editorialResolve.js";

// The atlas detail's boss key: its atlas name, not the catalog's source name
// (bossWithCatalog may replace `name`).
const detailBossKey = (boss) => String(boss?.encounterId || boss?.npcId || boss?.atlasName || boss?.name || "");

const art = (value) => (!value ? null : typeof value === "string" ? { url: value, focusX: 0.5, focusY: 0.5 } : value);

// resolveMedia(id) → { url, focusX, focusY } | null
export function editorialView(imported, document, { resolveMedia = () => null, revision = null, publishedAt = null, preview = false } = {}) {
  const resolution = resolveEditorial(imported, document);
  const effective = effectiveEditorial(resolution, { resolveMedia });
  return { resolution, effective, revision, publishedAt, preview };
}

function bossOverlay(boss, editorial) {
  if (!editorial) return boss;
  const strategy = { ...(boss.strategy || {}) };
  for (const [from, to] of [["strategy", "summary"], ["tank", "tank"], ["healer", "healer"], ["dps", "dps"]]) if (editorial[from]) strategy[to] = editorial[from];
  const portrait = art(editorial.portrait);
  return {
    ...boss,
    name: editorial.name || boss.name,
    portraitUrl: portrait?.url || boss.portraitUrl || null,
    strategy: Object.keys(strategy).length ? strategy : boss.strategy ?? null,
    // Optional additions.
    description: editorial.description || null,
    positioning: editorial.positioning || null,
    interrupts: editorial.interrupts || null,
    dispels: editorial.dispels || null,
    mechanics: (editorial.mechanics || []).map((mechanic) => ({ ...mechanic, source: mechanic.source || "editorial" })),
    lootNotes: editorial.lootNotes || [],
  };
}

// The detail response with `atlas` (and the instance name) overlaid.
export function withEditorialDetail(detail, view) {
  if (!detail?.atlas || !view) return detail;
  const { effective, resolution } = view;
  const d = effective.dungeon;
  const byKey = new Map(effective.bosses.map((boss) => [boss.key, boss]));
  const order = new Map(resolution.bosses.map((boss, index) => [boss.key, index]));
  const bosses = detail.atlas.bosses.map((boss) => bossOverlay(boss, byKey.get(detailBossKey(boss))))
    .map((boss, index) => ({ boss, index }))
    .sort((a, b) => (order.get(detailBossKey(a.boss)) ?? 1e6 + a.index) - (order.get(detailBossKey(b.boss)) ?? 1e6 + b.index))
    .map(({ boss }) => boss);
  const card = art(d.cardArt);
  const map = art(d.mapArt);
  const editorialMap = map && !(detail.atlas.maps || []).some((entry) => entry.imageUrl === map.url)
    ? [{ floorId: "editorial-map", name: "Dungeon map", kind: "editorial", imageUrl: map.url, width: null, height: null }] : [];
  return {
    ...detail,
    instance: detail.instance ? { ...detail.instance, name: d.name || detail.instance.name } : detail.instance,
    atlas: {
      ...detail.atlas,
      name: d.name || null,
      subtitle: d.subtitle || null,
      description: d.description || detail.atlas.description || null,
      levelMin: d.levelMin ?? detail.atlas.levelMin,
      levelMax: d.levelMax ?? detail.atlas.levelMax,
      entrance: d.entrance || detail.atlas.entrance,
      artworkUrl: card?.url || detail.atlas.artworkUrl || null,
      maps: [...editorialMap, ...(detail.atlas.maps || [])],
      bosses,
      editorial: editorialBlock(view),
    },
  };
}

function editorialBlock(view) {
  const d = view.effective.dungeon;
  return {
    revision: view.revision === null || view.revision === undefined ? null : String(view.revision),
    publishedAt: view.publishedAt,
    preview: view.preview === true,
    tips: d.tips || [], preparation: d.preparation || [], warnings: d.warnings || [],
    groupComposition: d.groupComposition || null, questNotes: d.questNotes || null, routeNotes: d.routeNotes || null,
    attribution: d.attribution || null, verification: d.verification || null,
    art: { card: art(d.cardArt), overview: art(d.overviewArt), map: art(d.mapArt) },
    conflicts: view.resolution.conflicts.length,
  };
}

// A list entry's `atlas` summary overlaid (cards: name, levels, art).
export function withEditorialSummary(entry, view) {
  if (!entry?.atlas || !view) return entry;
  const d = view.effective.dungeon;
  const card = art(d.cardArt);
  return {
    ...entry,
    name: d.name || entry.name,
    atlas: { ...entry.atlas, levelMin: d.levelMin ?? entry.atlas.levelMin, levelMax: d.levelMax ?? entry.atlas.levelMax,
      entrance: d.entrance || entry.atlas.entrance, artworkUrl: card?.url || entry.atlas.artworkUrl || null,
      subtitle: d.subtitle || null, artFocus: card ? { x: card.focusX, y: card.focusY } : null,
      editorial: { revision: view.revision === null || view.revision === undefined ? null : String(view.revision) } },
  };
}
