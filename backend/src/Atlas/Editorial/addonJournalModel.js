// What the add-on's Dungeon Journal would show for a dungeon, for the CMS's
// add-on preview (a browser simulation, not the game). Imported facts follow
// the add-on exporter's own rules (Indicaza/guildweaver
// scripts/exportDungeonAtlas.lua: names cut to 80, ability names to 60 and
// summaries to 90, at most 12 abilities per creature by priority, at most 40
// quests by level, at most 64 drops per boss); editorial content is exactly
// the entry addonTransform.js exports. Art: the client draws its own maps and
// boss models; CMS images reach the add-on only as packaged textures (see
// ADDON_ART and docs/dungeon-content-studio.md).

import { ADDON_LIMITS } from "./addonTransform.js";

export const ADDON_EXPORT_RULES = Object.freeze({ name: 80, abilityName: 60, abilitySummary: 90, maxAbilities: 12, maxQuests: 40, maxLoot: 64 });
// Textures the add-on export packages from PNG uploads (power-of-two sides).
export const ADDON_ART = Object.freeze({ card: { width: 512, height: 256, aspect: 2 }, portrait: { width: 128, height: 128, aspect: 1 } });

const CATEGORIES = new Set(["interrupt", "tank-danger", "healer-danger", "positioning", "dispel", "crowd-control", "special-mechanic"]);
const RANK = { high: 1, medium: 2, low: 3 };
const cut = (value, max) => (typeof value === "string" && value ? value.slice(0, max) : null);

function abilities(list) {
  const rows = (list || []).map((ability, index) => ({ ability, index }))
    .filter(({ ability }) => Number.isSafeInteger(ability?.spellId) && ability.name && CATEGORIES.has(ability.category))
    .sort((a, b) => (RANK[a.ability.priority] || 3) - (RANK[b.ability.priority] || 3) || a.index - b.index);
  const seen = new Set();
  return rows.filter(({ ability }) => !seen.has(ability.spellId) && seen.add(ability.spellId)).slice(0, ADDON_EXPORT_RULES.maxAbilities)
    .map(({ ability }) => ({ spellId: ability.spellId, name: cut(ability.name, ADDON_EXPORT_RULES.abilityName), category: ability.category,
      priority: RANK[ability.priority] ? ability.priority : "low", interruptible: ability.interruptible === true ? true : ability.interruptible === false ? false : null,
      summary: cut(ability.summary, ADDON_EXPORT_RULES.abilitySummary), verified: ability.verifiedForForever === true }));
}

function artStatus(art, kind) {
  if (!art) return { packaged: false, reason: "none" };
  const spec = ADDON_ART[kind];
  if (art.mime && art.mime !== "image/png") return { packaged: false, reason: "format", url: art.url, note: "Only PNG uploads are converted to the client's TGA textures; this image stays on the website." };
  return { packaged: true, url: art.url, focusX: art.focusX ?? 0.5, focusY: art.focusY ?? 0.5, width: spec.width, height: spec.height,
    note: `Packaged at add-on export as a ${spec.width}×${spec.height} TGA.` };
}

// detail: the website detail (with loot); entry: addonEditorialEntry(); art:
// { card, portraits: Map bossKey → art } with { url, mime, focusX, focusY }.
export function addonJournalModel(detail, entry, { art = {}, importedName = null } = {}) {
  const atlas = detail?.atlas || {};
  const editorialBosses = new Map((entry?.bosses || []).map((boss) => [boss.k, boss]));
  const bossKey = (boss) => String(boss.encounterId || boss.npcId || boss.atlasName || boss.name || "");
  const order = entry?.order || null;
  let bosses = (atlas.bosses || []).map((boss) => {
    const key = bossKey(boss);
    const editorial = editorialBosses.get(key) || {};
    const loot = [...(boss.referenceLoot || []), ...(boss.foreverLoot || [])].slice(0, ADDON_EXPORT_RULES.maxLoot)
      .map((item) => ({ itemId: item.itemId, name: item.name, qualityId: item.qualityId ?? null, iconFileDataId: item.iconFileDataId ?? null }));
    return {
      key, name: cut(editorial.n || boss.atlasName || boss.name, ADDON_EXPORT_RULES.name), npcId: boss.npcId ?? null,
      portrait: art.portraits?.get(key) ? artStatus(art.portraits.get(key), "portrait") : { packaged: false, reason: "client-model", note: "The client draws the boss from its creature model when the journal art lists a display ID." },
      abilities: abilities(boss.abilities),
      mechanics: editorial.mech || [],
      text: { description: editorial.desc || null, strategy: editorial.strat || null, tank: editorial.tank || null, healer: editorial.heal || null, dps: editorial.dps || null,
        positioning: editorial.pos || null, interrupts: editorial.kick || null, dispels: editorial.disp || null },
      loot,
    };
  });
  if (order) {
    const rank = new Map(order.map((key, index) => [key, index]));
    bosses = bosses.slice().sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
  }
  const quests = (atlas.quests || []).filter((quest) => quest.questId && quest.name)
    .map((quest) => ({ id: quest.questId, name: cut(quest.name, 80), level: quest.level ?? null, minLevel: quest.minLevel ?? null }))
    .sort((a, b) => (a.minLevel || a.level || 999) - (b.minLevel || b.level || 999) || a.id - b.id);
  const entrance = entry?.ent || (atlas.entrance ? { m: atlas.entrance.mapId, x: Math.floor(atlas.entrance.x * 1000 + 0.5), y: Math.floor(atlas.entrance.y * 1000 + 0.5) } : null);
  return {
    simulation: true,
    name: cut(entry?.n || importedName || detail?.instance?.name, ADDON_EXPORT_RULES.name),
    subtitle: entry?.sub || null,
    description: entry?.desc || null,
    levelMin: entry?.lmin ?? atlas.levelMin ?? null,
    levelMax: entry?.lmax ?? atlas.levelMax ?? null,
    zone: cut(atlas.zoneName, 60),
    origin: atlas.origin || "classic",
    entrance,
    card: artStatus(art.card || null, "card"),
    tips: entry?.tips || [], preparation: entry?.prep || [], warnings: entry?.warn || [],
    groupComposition: entry?.comp || null, routeNotes: entry?.route || null, questNotes: entry?.qnotes || null, attribution: entry?.attr || null,
    bosses,
    quests: quests.slice(0, ADDON_EXPORT_RULES.maxQuests), questsTotal: quests.length,
    // The add-on draws dungeon maps from the client's own textures (journal
    // art file IDs) or, without them, the site's spawn layout points.
    map: (atlas.maps || []).find((map) => map.kind === "spawn-layout") ? { kind: "spawn-layout", points: (atlas.maps.find((map) => map.kind === "spawn-layout").points || []).length }
      : { kind: "client", note: "Drawn from the client's own dungeon map textures when the journal art has them." },
    limits: ADDON_LIMITS,
  };
}
