import { withGuildDatabase } from "../Data/database.js";

function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  return number === null ? null : Math.trunc(number);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function slug(value) {
  return text(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unaffiliated";
}

function entityName(value) {
  if (typeof value === "string") return text(value, 96);
  return text(value?.name ?? value?.displayName, 96);
}

function iconFileId(value) {
  return integer(
    value?.iconFileID ?? value?.iconFileId ?? value?.icon?.fileDataID ?? value?.icon?.fileDataId,
  );
}

function professionKey(profession) {
  const id = integer(profession?.id ?? profession?.professionID ?? profession?.professionId);
  return id ? `id:${id}` : `name:${slug(entityName(profession))}`;
}

function recipeKey(recipe) {
  const id = integer(recipe?.id ?? recipe?.recipeID ?? recipe?.recipeId);
  return id ? `id:${id}` : `name:${slug(entityName(recipe))}`;
}

function normalizeReagent(reagent) {
  return {
    itemId: integer(reagent?.itemID ?? reagent?.itemId ?? reagent?.id),
    name: entityName(reagent?.item ?? reagent),
    quantity: integer(reagent?.quantity ?? reagent?.count ?? reagent?.required, 0) ?? 0,
    iconFileId: iconFileId(reagent),
  };
}

export function normalizeProfessions(snapshot) {
  const professions = [];
  const seen = new Set();

  for (const raw of array(snapshot?.professions)) {
    const name = entityName(raw);
    const key = professionKey(raw);
    if ((!name && key === "name:unaffiliated") || seen.has(key)) continue;
    seen.add(key);

    professions.push({
      key,
      id: integer(raw?.id ?? raw?.professionID ?? raw?.professionId),
      name: name || "Profession",
      iconFileId: iconFileId(raw),
      current: integer(raw?.current ?? raw?.skillLevel ?? raw?.skill ?? raw?.rank, 0) ?? 0,
      max: integer(raw?.max ?? raw?.maxSkill ?? raw?.maxSkillLevel ?? raw?.maximum, 0) ?? 0,
      modifier: integer(raw?.modifier ?? raw?.skillModifier, 0) ?? 0,
      specialization: raw?.specialization ?? raw?.specializations ?? null,
      recipes: array(raw?.recipes),
    });
  }

  return professions;
}

export function normalizeRecipes(snapshot, professions = normalizeProfessions(snapshot)) {
  const recipes = [];
  const seen = new Set();

  function add(raw, profession = null) {
    if (!raw || typeof raw !== "object") return;
    const key = recipeKey(raw);
    if (seen.has(key)) return;
    seen.add(key);

    const professionName = entityName(raw?.profession) || profession?.name || "";
    const professionId = integer(
      raw?.professionID ?? raw?.professionId ?? raw?.profession?.id ?? profession?.id,
    );

    recipes.push({
      key,
      id: integer(raw?.id ?? raw?.recipeID ?? raw?.recipeId),
      name: entityName(raw) || "Unknown recipe",
      iconFileId: iconFileId(raw),
      professionKey: professionId ? `id:${professionId}` : profession?.key || `name:${slug(professionName)}`,
      professionId,
      professionName,
      known: raw?.known === undefined ? true : Boolean(raw.known),
      requiredSkill: integer(raw?.requiredSkill ?? raw?.requirements?.skill ?? raw?.skillRequired),
      requirements: raw?.requirements ?? null,
      craftedItemId: integer(raw?.craftedItemID ?? raw?.craftedItemId ?? raw?.craftedItem?.id),
      craftedItemName: entityName(raw?.craftedItem),
      reagents: array(raw?.reagents ?? raw?.materials).map(normalizeReagent),
    });
  }

  for (const profession of professions) {
    for (const recipe of profession.recipes) add(recipe, profession);
  }
  for (const recipe of array(snapshot?.recipes)) add(recipe, null);

  return recipes;
}

function normalizeOrganization(snapshot) {
  const organization = object(snapshot?.organization);
  const guild = snapshot?.guild;
  const guildName = entityName(guild);
  const name = text(organization.name, 96) || guildName || "Unaffiliated";
  const rawId = organization.id ?? organization.slug ?? guild?.id ?? guildName;
  return {
    id: `org:${slug(rawId || name)}`,
    name,
    guildName,
  };
}

export function ensureTelemetryProjectionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      guild_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry_characters (
      character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      organization_id TEXT REFERENCES telemetry_organizations(id) ON DELETE SET NULL,
      realm TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      guild_name TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 0,
      schema_version INTEGER NOT NULL DEFAULT 0,
      game_build TEXT NOT NULL DEFAULT '',
      latest_snapshot_id INTEGER REFERENCES character_snapshots(id) ON DELETE SET NULL,
      last_seen_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry_professions (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      profession_key TEXT NOT NULL,
      profession_id INTEGER,
      name TEXT NOT NULL,
      icon_file_id INTEGER,
      skill_current INTEGER NOT NULL DEFAULT 0,
      skill_max INTEGER NOT NULL DEFAULT 0,
      skill_modifier INTEGER NOT NULL DEFAULT 0,
      specialization_json TEXT NOT NULL DEFAULT 'null',
      snapshot_id INTEGER REFERENCES character_snapshots(id) ON DELETE SET NULL,
      PRIMARY KEY(character_id, profession_key)
    );

    CREATE TABLE IF NOT EXISTS telemetry_recipes (
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      recipe_key TEXT NOT NULL,
      recipe_id INTEGER,
      name TEXT NOT NULL,
      profession_key TEXT NOT NULL DEFAULT '',
      profession_id INTEGER,
      profession_name TEXT NOT NULL DEFAULT '',
      icon_file_id INTEGER,
      known INTEGER NOT NULL DEFAULT 1 CHECK (known IN (0, 1)),
      required_skill INTEGER,
      requirements_json TEXT NOT NULL DEFAULT 'null',
      crafted_item_id INTEGER,
      crafted_item_name TEXT NOT NULL DEFAULT '',
      reagents_json TEXT NOT NULL DEFAULT '[]',
      snapshot_id INTEGER REFERENCES character_snapshots(id) ON DELETE SET NULL,
      PRIMARY KEY(character_id, recipe_key)
    );

    CREATE INDEX IF NOT EXISTS telemetry_characters_org_seen_idx
      ON telemetry_characters(organization_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS telemetry_characters_realm_idx
      ON telemetry_characters(realm COLLATE NOCASE, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS telemetry_professions_name_idx
      ON telemetry_professions(name COLLATE NOCASE, skill_current DESC);
    CREATE INDEX IF NOT EXISTS telemetry_recipes_name_idx
      ON telemetry_recipes(name COLLATE NOCASE, known, profession_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS telemetry_recipes_item_idx
      ON telemetry_recipes(crafted_item_id, known);
    CREATE INDEX IF NOT EXISTS telemetry_recipes_profession_idx
      ON telemetry_recipes(profession_key, known, name COLLATE NOCASE);
  `);
}

export function projectTelemetrySnapshotInDatabase({ db, characterId, snapshotId, snapshot, capturedAt }) {
  ensureTelemetryProjectionSchema(db);
  const organization = normalizeOrganization(snapshot);
  const professions = normalizeProfessions(snapshot);
  const recipes = normalizeRecipes(snapshot, professions);
  const now = new Date().toISOString();
  const guildName = organization.guildName;

  db.prepare(`
    INSERT INTO telemetry_organizations (id, name, guild_name, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      guild_name = excluded.guild_name,
      updated_at = excluded.updated_at
  `).run(organization.id, organization.name, guildName, now);

  db.prepare(`
    INSERT INTO telemetry_characters (
      character_id, organization_id, realm, region, guild_name, level,
      schema_version, game_build, latest_snapshot_id, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET
      organization_id = excluded.organization_id,
      realm = excluded.realm,
      region = excluded.region,
      guild_name = excluded.guild_name,
      level = excluded.level,
      schema_version = excluded.schema_version,
      game_build = excluded.game_build,
      latest_snapshot_id = excluded.latest_snapshot_id,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run(
    characterId,
    organization.id,
    text(snapshot?.realm ?? snapshot?.realmName, 96),
    text(snapshot?.region, 24),
    guildName,
    integer(snapshot?.level, 0) ?? 0,
    integer(snapshot?.schemaVersion, 0) ?? 0,
    text(snapshot?.gameBuild ?? snapshot?.build ?? snapshot?.gameVersion?.build ?? snapshot?.gameVersion, 96),
    snapshotId,
    text(snapshot?.lastSeen ?? capturedAt, 48) || capturedAt,
    now,
  );

  db.prepare("DELETE FROM telemetry_professions WHERE character_id = ?").run(characterId);
  db.prepare("DELETE FROM telemetry_recipes WHERE character_id = ?").run(characterId);

  const insertProfession = db.prepare(`
    INSERT INTO telemetry_professions (
      character_id, profession_key, profession_id, name, icon_file_id,
      skill_current, skill_max, skill_modifier, specialization_json, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const profession of professions) {
    insertProfession.run(
      characterId,
      profession.key,
      profession.id,
      profession.name,
      profession.iconFileId,
      profession.current,
      profession.max,
      profession.modifier,
      JSON.stringify(profession.specialization ?? null),
      snapshotId,
    );
  }

  const insertRecipe = db.prepare(`
    INSERT INTO telemetry_recipes (
      character_id, recipe_key, recipe_id, name, profession_key, profession_id,
      profession_name, icon_file_id, known, required_skill, requirements_json,
      crafted_item_id, crafted_item_name, reagents_json, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const recipe of recipes) {
    insertRecipe.run(
      characterId,
      recipe.key,
      recipe.id,
      recipe.name,
      recipe.professionKey,
      recipe.professionId,
      recipe.professionName,
      recipe.iconFileId,
      recipe.known ? 1 : 0,
      recipe.requiredSkill,
      JSON.stringify(recipe.requirements ?? null),
      recipe.craftedItemId,
      recipe.craftedItemName,
      JSON.stringify(recipe.reagents),
      snapshotId,
    );
  }

  return { organization, professions, recipes };
}

function equipmentSlot(raw, index) {
  const slot = text(raw?.slot ?? raw?.slotName ?? raw?.inventorySlot ?? raw?.slotId ?? index, 48);
  return {
    slot,
    itemId: integer(raw?.itemID ?? raw?.itemId ?? raw?.id),
    itemLink: text(raw?.itemLink ?? raw?.link, 1000),
    name: entityName(raw?.item ?? raw) || text(raw?.itemName, 160),
    quality: integer(raw?.quality),
    itemLevel: integer(raw?.itemLevel ?? raw?.ilevel ?? raw?.level),
    enchant: raw?.enchant ?? raw?.enchantment ?? raw?.modifier ?? raw?.modifiers ?? null,
    iconFileId: iconFileId(raw),
  };
}

export function normalizeEquipment(snapshot) {
  const source = Array.isArray(snapshot?.equipment)
    ? snapshot.equipment
    : array(snapshot?.equipment?.slots ?? snapshot?.gear);
  return source.map(equipmentSlot).filter((item) => item.slot || item.itemId || item.name);
}

function talentEntry(raw) {
  return {
    id: integer(raw?.id ?? raw?.entryID ?? raw?.entryId),
    definitionId: integer(raw?.definitionID ?? raw?.definitionId),
    spellId: integer(raw?.spellID ?? raw?.spellId),
    name: entityName(raw) || text(raw?.spellName, 160),
    description: text(raw?.description ?? raw?.tooltip, 2000),
    iconFileId: iconFileId(raw),
    selected: Boolean(raw?.selected ?? raw?.isSelected ?? raw?.active),
    rank: integer(raw?.rank ?? raw?.currentRank, 0) ?? 0,
    maxRank: integer(raw?.maxRank ?? raw?.ranks, 0) ?? 0,
  };
}

export function normalizeTalents(snapshot) {
  const raw = object(snapshot?.talents ?? snapshot?.talentTree);
  const nodes = array(raw.nodes ?? snapshot?.talentNodes).map((node, index) => {
    const entries = array(node?.entries).map(talentEntry);
    const selectedId = integer(node?.selectedEntryID ?? node?.selectedEntryId);
    if (selectedId !== null) {
      for (const entry of entries) entry.selected = entry.selected || entry.id === selectedId;
    }
    return {
      id: integer(node?.id ?? node?.nodeID ?? node?.nodeId, index) ?? index,
      x: finiteNumber(node?.x ?? node?.posX ?? node?.position?.x, 0) ?? 0,
      y: finiteNumber(node?.y ?? node?.posY ?? node?.position?.y, 0) ?? 0,
      type: text(node?.type, 48),
      rank: integer(node?.rank ?? node?.currentRank, 0) ?? 0,
      maxRank: integer(node?.maxRank, 0) ?? 0,
      selected: Boolean(node?.selected ?? node?.active) || entries.some((entry) => entry.selected),
      entries,
    };
  });

  const edges = array(raw.edges ?? raw.connections ?? snapshot?.talentEdges).map((edge) => ({
    from: integer(edge?.from ?? edge?.source ?? edge?.fromNodeID ?? edge?.fromNodeId),
    to: integer(edge?.to ?? edge?.target ?? edge?.toNodeID ?? edge?.toNodeId),
    required: edge?.required === undefined ? true : Boolean(edge.required),
  })).filter((edge) => edge.from !== null && edge.to !== null);

  return {
    configId: integer(raw?.configID ?? raw?.configId ?? snapshot?.talentConfigID),
    treeId: integer(raw?.treeID ?? raw?.treeId),
    specId: integer(raw?.specID ?? raw?.specId ?? snapshot?.specialization?.id),
    name: entityName(raw) || text(snapshot?.specialization?.name, 96),
    nodes,
    edges,
  };
}

function stats(snapshot) {
  const source = object(snapshot?.stats ?? snapshot?.attributes);
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (["string", "number", "boolean"].includes(typeof value)) result[text(key, 48)] = value;
  }
  return result;
}

function professionFromRow(row) {
  return {
    key: row.profession_key,
    id: row.profession_id === null ? null : Number(row.profession_id),
    name: row.name,
    iconFileId: row.icon_file_id === null ? null : Number(row.icon_file_id),
    current: Number(row.skill_current) || 0,
    max: Number(row.skill_max) || 0,
    modifier: Number(row.skill_modifier) || 0,
    specialization: parseJson(row.specialization_json, null),
  };
}

function recipeFromRow(row) {
  return {
    key: row.recipe_key,
    id: row.recipe_id === null ? null : Number(row.recipe_id),
    name: row.name,
    professionKey: row.profession_key,
    professionId: row.profession_id === null ? null : Number(row.profession_id),
    professionName: row.profession_name,
    iconFileId: row.icon_file_id === null ? null : Number(row.icon_file_id),
    known: Boolean(row.known),
    requiredSkill: row.required_skill === null ? null : Number(row.required_skill),
    requirements: parseJson(row.requirements_json, null),
    craftedItemId: row.crafted_item_id === null ? null : Number(row.crafted_item_id),
    craftedItemName: row.crafted_item_name,
    reagents: parseJson(row.reagents_json, []),
  };
}

function characterRows(db) {
  ensureTelemetryProjectionSchema(db);
  return db.prepare(`
    SELECT
      c.id, c.member_id, c.name, c.race, c.class_name, c.spec, c.is_main,
      m.display_name AS member_name, m.rank AS member_rank,
      t.organization_id, o.name AS organization_name, t.realm, t.region,
      t.guild_name, t.level, t.schema_version, t.game_build,
      t.latest_snapshot_id, t.last_seen_at
    FROM characters c
    JOIN members m ON m.id = c.member_id AND m.status = 'active'
    LEFT JOIN telemetry_characters t ON t.character_id = c.id
    LEFT JOIN telemetry_organizations o ON o.id = t.organization_id
  `).all();
}

export function readIntelligenceSummary() {
  return withGuildDatabase((db) => {
    const characters = characterRows(db).map((row) => ({
      id: row.id,
      name: row.name,
      race: row.race,
      className: row.class_name,
      spec: row.spec,
      level: Number(row.level) || 0,
      realm: row.realm || "",
      guildName: row.guild_name || "",
      organizationName: row.organization_name || "",
      memberName: row.member_name,
      memberRank: row.member_rank,
      lastSeenAt: row.last_seen_at || null,
      isMain: Boolean(row.is_main),
    }));

    const professions = db.prepare(`
      SELECT p.name, COUNT(DISTINCT p.character_id) AS characters
      FROM telemetry_professions p
      JOIN characters c ON c.id = p.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      GROUP BY p.name COLLATE NOCASE
      ORDER BY characters DESC, p.name COLLATE NOCASE
    `).all().map((row) => ({ name: row.name, characters: Number(row.characters) || 0 }));

    const recipeCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM telemetry_recipes r
      JOIN characters c ON c.id = r.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE r.known = 1
    `).get()?.count || 0);

    const classDistribution = db.prepare(`
      SELECT c.class_name AS name, COUNT(*) AS count
      FROM characters c JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE c.class_name <> ''
      GROUP BY c.class_name COLLATE NOCASE
      ORDER BY count DESC, name COLLATE NOCASE
    `).all().map((row) => ({ name: row.name, count: Number(row.count) || 0 }));

    const specDistribution = db.prepare(`
      SELECT c.spec AS name, COUNT(*) AS count
      FROM characters c JOIN members m ON m.id = c.member_id AND m.status = 'active'
      WHERE c.spec <> ''
      GROUP BY c.spec COLLATE NOCASE
      ORDER BY count DESC, name COLLATE NOCASE
    `).all().map((row) => ({ name: row.name, count: Number(row.count) || 0 }));

    return {
      summary: {
        characterCount: characters.length,
        professionCount: professions.length,
        recipeCount,
      },
      characters: [...characters].sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""))),
      professions,
      classDistribution,
      specDistribution,
    };
  });
}

export function readCharacterArmory(characterId) {
  return withGuildDatabase((db) => {
    const row = characterRows(db).find((item) => item.id === String(characterId));
    if (!row) return null;

    let payload = {};
    if (row.latest_snapshot_id) {
      payload = parseJson(
        db.prepare("SELECT payload_json FROM character_snapshots WHERE id = ?").get(row.latest_snapshot_id)?.payload_json,
        {},
      );
    } else {
      payload = parseJson(
        db.prepare("SELECT payload_json FROM character_snapshots WHERE character_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1").get(row.id)?.payload_json,
        {},
      );
    }

    const professions = db.prepare("SELECT * FROM telemetry_professions WHERE character_id = ? ORDER BY name COLLATE NOCASE").all(row.id).map(professionFromRow);
    const recipes = db.prepare("SELECT * FROM telemetry_recipes WHERE character_id = ? ORDER BY profession_name COLLATE NOCASE, name COLLATE NOCASE").all(row.id).map(recipeFromRow);

    return {
      character: {
        id: row.id,
        memberId: row.member_id,
        memberName: row.member_name,
        memberRank: row.member_rank,
        name: text(payload?.name, 32) || row.name,
        race: entityName(payload?.race) || row.race,
        className: entityName(payload?.class) || row.class_name,
        spec: entityName(payload?.specialization) || row.spec,
        level: integer(payload?.level, Number(row.level) || 0) ?? 0,
        realm: text(payload?.realm ?? payload?.realmName, 96) || row.realm || "",
        region: text(payload?.region, 24) || row.region || "",
        guildName: entityName(payload?.guild) || row.guild_name || "",
        organization: row.organization_id ? { id: row.organization_id, name: row.organization_name || "" } : null,
        lastSeenAt: text(payload?.lastSeen, 48) || row.last_seen_at || null,
        gameBuild: text(payload?.gameBuild ?? payload?.build ?? payload?.gameVersion?.build ?? payload?.gameVersion, 96) || row.game_build || "",
        schemaVersion: integer(payload?.schemaVersion, Number(row.schema_version) || 0) ?? 0,
        isMain: Boolean(row.is_main),
      },
      stats: stats(payload),
      equipment: normalizeEquipment(payload),
      talents: normalizeTalents(payload),
      professions,
      recipes,
      capturedAt: row.last_seen_at || null,
    };
  });
}

export function searchRecipes(query = "", { limit = 100 } = {}) {
  const normalized = text(query, 120).toLowerCase();
  return withGuildDatabase((db) => {
    ensureTelemetryProjectionSchema(db);
    const rows = db.prepare(`
      SELECT r.*, c.name AS character_name, c.class_name, t.realm, t.last_seen_at,
        m.display_name AS member_name
      FROM telemetry_recipes r
      JOIN characters c ON c.id = r.character_id
      JOIN members m ON m.id = c.member_id AND m.status = 'active'
      LEFT JOIN telemetry_characters t ON t.character_id = c.id
      WHERE r.known = 1
        AND (? = '' OR lower(r.name) LIKE ? OR lower(r.crafted_item_name) LIKE ? OR CAST(r.crafted_item_id AS TEXT) = ?)
      ORDER BY r.name COLLATE NOCASE, c.name COLLATE NOCASE
      LIMIT ?
    `).all(normalized, `%${normalized}%`, `%${normalized}%`, normalized, Math.max(1, Math.min(250, Number(limit) || 100)));

    return rows.map((row) => ({
      ...recipeFromRow(row),
      character: {
        id: row.character_id,
        name: row.character_name,
        className: row.class_name,
        realm: row.realm || "",
        memberName: row.member_name,
        lastSeenAt: row.last_seen_at || null,
      },
    }));
  });
}

export function searchCraftFinder(query = "") {
  const rows = searchRecipes(query, { limit: 250 });
  const grouped = new Map();

  for (const row of rows) {
    const key = row.id ? `id:${row.id}` : `${row.professionName}:${row.name}`.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        recipe: {
          id: row.id,
          name: row.name,
          iconFileId: row.iconFileId,
          professionName: row.professionName,
          craftedItemId: row.craftedItemId,
          craftedItemName: row.craftedItemName,
          requiredSkill: row.requiredSkill,
        },
        crafters: [],
      });
    }
    grouped.get(key).crafters.push(row.character);
  }

  return [...grouped.values()].slice(0, 80);
}
