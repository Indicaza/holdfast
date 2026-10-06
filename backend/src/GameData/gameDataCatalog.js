import { withGuildDatabase } from "../Data/database.js";

const ENTITY_TYPES = new Set(["item", "spell", "recipe", "profession", "talent"]);
const DEFAULT_LOCALE = "en_US";
const MAX_REFERENCES_PER_TYPE = 250;

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integer(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function entityName(value) {
  if (typeof value === "string") return text(value, 160);
  return text(value?.name ?? value?.displayName ?? value?.itemName ?? value?.spellName, 160);
}

function iconFileId(value) {
  const icon = value?.icon;
  return integer(
    value?.iconFileDataId ??
      value?.iconFileDataID ??
      value?.iconFileId ??
      value?.iconFileID ??
      (typeof icon === "number" || typeof icon === "string" ? icon : null) ??
      icon?.fileDataID ??
      icon?.fileDataId,
  );
}

function sourcePriority(source) {
  const normalized = text(source, 32).toLowerCase();
  if (normalized === "blizzard") return 100;
  if (normalized === "curated") return 80;
  if (normalized === "import") return 60;
  return 20;
}

export function gameBuildKey(value) {
  const raw = value?.gameBuild ?? value?.build ?? value?.gameVersion ?? value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "object" || Array.isArray(raw)) return text(raw, 64);
  return text(
    raw.build ?? raw.version ?? raw.interface ?? raw.interfaceVersion ?? raw.buildDate,
    64,
  );
}

export function ensureGameDataCatalogSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_data_catalog (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      game_build TEXT NOT NULL DEFAULT '',
      locale TEXT NOT NULL DEFAULT '${DEFAULT_LOCALE}',
      name TEXT NOT NULL DEFAULT '',
      icon_file_id INTEGER,
      quality_id INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'telemetry',
      source_priority INTEGER NOT NULL DEFAULT 20,
      observed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id, game_build, locale)
    );

    CREATE INDEX IF NOT EXISTS game_data_catalog_lookup_idx
      ON game_data_catalog(entity_type, entity_id, locale, game_build);
    CREATE INDEX IF NOT EXISTS game_data_catalog_source_idx
      ON game_data_catalog(source, updated_at DESC);
  `);
}

function cleanMetadata(value) {
  const source = object(value);
  const result = {};
  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined || entry === null || entry === "") continue;
    result[text(key, 64)] = entry;
  }
  return result;
}

export function upsertGameDataEntityInDatabase(db, input = {}) {
  ensureGameDataCatalogSchema(db);
  const type = text(input.type, 32).toLowerCase();
  const id = text(input.id, 96);
  if (!ENTITY_TYPES.has(type) || !id) return null;

  const now = new Date().toISOString();
  const source = text(input.source || "telemetry", 32).toLowerCase() || "telemetry";
  const priority = integer(input.sourcePriority, sourcePriority(source)) ?? sourcePriority(source);
  const metadata = cleanMetadata(input.metadata);
  const metadataJson = JSON.stringify(metadata);

  db.prepare(`
    INSERT INTO game_data_catalog (
      entity_type, entity_id, game_build, locale, name, icon_file_id,
      quality_id, metadata_json, source, source_priority, observed_at,
      expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, game_build, locale) DO UPDATE SET
      name = CASE
        WHEN excluded.source_priority >= game_data_catalog.source_priority AND excluded.name <> ''
          THEN excluded.name
        ELSE game_data_catalog.name
      END,
      icon_file_id = CASE
        WHEN excluded.source_priority >= game_data_catalog.source_priority AND excluded.icon_file_id IS NOT NULL
          THEN excluded.icon_file_id
        ELSE game_data_catalog.icon_file_id
      END,
      quality_id = CASE
        WHEN excluded.source_priority >= game_data_catalog.source_priority AND excluded.quality_id IS NOT NULL
          THEN excluded.quality_id
        ELSE game_data_catalog.quality_id
      END,
      metadata_json = CASE
        WHEN excluded.source_priority >= game_data_catalog.source_priority AND excluded.metadata_json <> '{}'
          THEN excluded.metadata_json
        ELSE game_data_catalog.metadata_json
      END,
      source = CASE
        WHEN excluded.source_priority >= game_data_catalog.source_priority
          THEN excluded.source
        ELSE game_data_catalog.source
      END,
      source_priority = MAX(game_data_catalog.source_priority, excluded.source_priority),
      observed_at = excluded.observed_at,
      expires_at = CASE
        WHEN excluded.source_priority >= game_data_catalog.source_priority
          THEN excluded.expires_at
        ELSE game_data_catalog.expires_at
      END,
      updated_at = excluded.updated_at
  `).run(
    type,
    id,
    text(input.gameBuild, 64),
    text(input.locale || DEFAULT_LOCALE, 16) || DEFAULT_LOCALE,
    text(input.name, 160),
    integer(input.iconFileId),
    integer(input.qualityId),
    metadataJson,
    source,
    priority,
    text(input.observedAt, 48) || now,
    text(input.expiresAt, 48),
    now,
  );

  return { type, id };
}

function itemMetadata(raw) {
  return cleanMetadata({
    itemLevel: integer(raw?.itemLevel ?? raw?.ilevel),
    requiredLevel: integer(raw?.requiredLevel ?? raw?.minLevel),
    itemClassId: integer(raw?.itemClassId ?? raw?.classId),
    itemSubclassId: integer(raw?.itemSubclassId ?? raw?.subclassId),
    equipLocation: text(raw?.equipLocation ?? raw?.inventoryType, 64),
    bindType: text(raw?.bindType, 64),
  });
}

function learnItem(db, raw, context) {
  const id = integer(raw?.itemID ?? raw?.itemId ?? raw?.id);
  if (!id) return;
  upsertGameDataEntityInDatabase(db, {
    type: "item",
    id,
    gameBuild: context.gameBuild,
    locale: context.locale,
    name: entityName(raw?.item ?? raw),
    iconFileId: iconFileId(raw),
    qualityId: integer(raw?.qualityId ?? raw?.quality),
    metadata: itemMetadata(raw),
    source: context.source,
    observedAt: context.observedAt,
  });
}

function learnRecipe(db, raw, profession, context) {
  const id = integer(raw?.recipeID ?? raw?.recipeId ?? raw?.id);
  if (!id) return;
  const craftedItemId = integer(raw?.craftedItemID ?? raw?.craftedItemId ?? raw?.craftedItem?.id);
  const reagents = [];
  for (const reagentGroup of array(raw?.reagents ?? raw?.materials)) {
    const values = Array.isArray(reagentGroup?.reagents) ? reagentGroup.reagents : [reagentGroup];
    for (const reagent of values) {
      const itemId = integer(reagent?.itemID ?? reagent?.itemId ?? reagent?.id);
      if (!itemId) continue;
      reagents.push({
        itemId,
        quantity: integer(
          reagent?.quantity ?? reagent?.quantityRequired ?? reagent?.count ?? reagentGroup?.quantityRequired,
          0,
        ) ?? 0,
      });
      learnItem(db, reagent, context);
    }
  }

  upsertGameDataEntityInDatabase(db, {
    type: "recipe",
    id,
    gameBuild: context.gameBuild,
    locale: context.locale,
    name: entityName(raw),
    iconFileId: iconFileId(raw),
    metadata: {
      professionId: integer(
        raw?.professionID ?? raw?.professionId ?? profession?.professionID ?? profession?.professionId ?? profession?.id,
      ),
      craftedItemId,
      requiredSkill: integer(raw?.requiredSkill ?? raw?.skillRequired),
      reagents,
    },
    source: context.source,
    observedAt: context.observedAt,
  });

  if (craftedItemId) {
    learnItem(
      db,
      {
        id: craftedItemId,
        name: entityName(raw?.craftedItem) || entityName(raw?.craftedItemName),
        iconFileId: iconFileId(raw?.craftedItem),
      },
      context,
    );
  }
}

function talentEntries(snapshot) {
  const talents = object(snapshot?.talents ?? snapshot?.talentTree);
  const nodes = [];
  for (const tree of array(talents?.trees)) nodes.push(...array(tree?.nodes));
  nodes.push(...array(talents?.nodes ?? snapshot?.talentNodes));
  return nodes.flatMap((node) => array(node?.entries));
}

export function learnGameDataFromSnapshotInDatabase(db, snapshot = {}, options = {}) {
  ensureGameDataCatalogSchema(db);
  const context = {
    gameBuild: text(options.gameBuild || gameBuildKey(snapshot), 64),
    locale: text(options.locale || DEFAULT_LOCALE, 16) || DEFAULT_LOCALE,
    source: text(options.source || "telemetry", 32) || "telemetry",
    observedAt: text(options.observedAt, 48) || new Date().toISOString(),
  };

  for (const item of array(snapshot?.equipment?.slots ?? snapshot?.equipment ?? snapshot?.gear)) {
    learnItem(db, item, context);
  }

  for (const profession of array(snapshot?.professions)) {
    const professionId = integer(
      profession?.professionID ?? profession?.professionId ?? profession?.skillLineId ?? profession?.id,
    );
    if (professionId) {
      upsertGameDataEntityInDatabase(db, {
        type: "profession",
        id: professionId,
        gameBuild: context.gameBuild,
        locale: context.locale,
        name: entityName(profession),
        iconFileId: iconFileId(profession),
        metadata: {
          maxSkill: integer(profession?.maxSkillLevel ?? profession?.maxSkill ?? profession?.maximum),
        },
        source: context.source,
        observedAt: context.observedAt,
      });
    }
    for (const recipe of array(profession?.recipes)) learnRecipe(db, recipe, profession, context);
  }

  for (const recipe of array(snapshot?.recipes)) learnRecipe(db, recipe, null, context);

  for (const entry of talentEntries(snapshot)) {
    const spellId = integer(entry?.spellID ?? entry?.spellId);
    if (!spellId) continue;
    upsertGameDataEntityInDatabase(db, {
      type: "spell",
      id: spellId,
      gameBuild: context.gameBuild,
      locale: context.locale,
      name: entityName(entry),
      iconFileId: iconFileId(entry),
      metadata: {
        description: text(entry?.description ?? entry?.tooltip, 2000),
      },
      source: context.source,
      observedAt: context.observedAt,
    });
  }
}

function normalizeReferenceIds(values) {
  const result = [];
  const seen = new Set();
  for (const value of array(values)) {
    const id = text(value, 96);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_REFERENCES_PER_TYPE) break;
  }
  return result;
}

function entryFromRow(row) {
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata_json || "{}");
  } catch {
    metadata = {};
  }
  return {
    type: row.entity_type,
    id: row.entity_id,
    name: row.name,
    iconFileId: row.icon_file_id === null ? null : Number(row.icon_file_id),
    qualityId: row.quality_id === null ? null : Number(row.quality_id),
    metadata,
    gameBuild: row.game_build,
    locale: row.locale,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

function bucketName(type) {
  return `${type}s`;
}

export function resolveGameDataBundleInDatabase(db, references = {}, options = {}) {
  ensureGameDataCatalogSchema(db);
  const gameBuild = text(options.gameBuild, 64);
  const locale = text(options.locale || DEFAULT_LOCALE, 16) || DEFAULT_LOCALE;
  const bundle = {
    gameBuild,
    locale,
    items: {},
    spells: {},
    recipes: {},
    professions: {},
    talents: {},
    missing: [],
  };

  for (const type of ENTITY_TYPES) {
    const ids = normalizeReferenceIds(references[bucketName(type)] ?? references[type]);
    for (const id of ids) {
      const row = db.prepare(`
        SELECT *
        FROM game_data_catalog
        WHERE entity_type = ? AND entity_id = ? AND locale = ?
          AND (game_build = ? OR game_build = '')
        ORDER BY CASE WHEN game_build = ? THEN 0 ELSE 1 END,
          source_priority DESC, updated_at DESC
        LIMIT 1
      `).get(type, id, locale, gameBuild, gameBuild);

      if (!row) {
        bundle.missing.push({ type, id });
        continue;
      }
      bundle[bucketName(type)][id] = entryFromRow(row);
    }
  }

  return bundle;
}

export function resolveGameDataBundle(references = {}, options = {}) {
  return withGuildDatabase((db) =>
    resolveGameDataBundleInDatabase(db, references, options),
  );
}
