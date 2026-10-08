function text(value, maxLength = 160) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function tableExists(db, name) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(String(name)),
  );
}

export function ensureGuildweaverCharacterIdentitySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_character_aliases (
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL DEFAULT '',
      installation_id TEXT NOT NULL DEFAULT '',
      raw_character_id TEXT NOT NULL,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      character_name TEXT NOT NULL DEFAULT '',
      realm TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(member_id, device_id, raw_character_id)
    );

    CREATE INDEX IF NOT EXISTS guildweaver_character_aliases_character_idx
      ON guildweaver_character_aliases(character_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS guildweaver_character_aliases_raw_idx
      ON guildweaver_character_aliases(member_id, raw_character_id, last_seen_at DESC);
  `);
}

export function readGuildweaverCharacterAliasInDatabase({
  db,
  memberId,
  deviceId = "",
  rawCharacterId = "",
}) {
  ensureGuildweaverCharacterIdentitySchema(db);
  const raw = text(rawCharacterId, 200);
  if (!raw) return null;

  const member = text(memberId, 160);
  const device = text(deviceId, 160);
  const exact = db
    .prepare(`
      SELECT a.character_id
      FROM guildweaver_character_aliases a
      JOIN characters c ON c.id = a.character_id AND c.member_id = a.member_id
      WHERE a.member_id = ? AND a.device_id = ? AND a.raw_character_id = ?
      LIMIT 1
    `)
    .get(member, device, raw);
  if (exact?.character_id) return exact.character_id;

  const uniqueAcrossDevices = db
    .prepare(`
      SELECT a.character_id, COUNT(DISTINCT a.character_id) AS targets
      FROM guildweaver_character_aliases a
      JOIN characters c ON c.id = a.character_id AND c.member_id = a.member_id
      WHERE a.member_id = ? AND a.raw_character_id = ?
      GROUP BY a.raw_character_id
      HAVING COUNT(DISTINCT a.character_id) = 1
      LIMIT 1
    `)
    .get(member, raw);

  return uniqueAcrossDevices?.character_id || null;
}

function characterByStableIdentity(db, { memberId, characterName, realm, region }) {
  const name = text(characterName, 96);
  if (!name) return null;

  const normalizedRealm = text(realm, 120);
  const normalizedRegion = text(region, 32);
  return db
    .prepare(`
      SELECT c.id, c.is_main, c.sort_order
      FROM characters c
      LEFT JOIN telemetry_characters t ON t.character_id = c.id
      WHERE c.member_id = ?
        AND c.name = ? COLLATE NOCASE
        AND (? = '' OR LOWER(COALESCE(t.realm, '')) = LOWER(?))
        AND (? = '' OR COALESCE(t.region, '') = '' OR LOWER(t.region) = LOWER(?))
      ORDER BY c.sort_order, c.id
      LIMIT 1
    `)
    .get(
      text(memberId, 160),
      name,
      normalizedRealm,
      normalizedRealm,
      normalizedRegion,
      normalizedRegion,
    );
}

export function resolveGuildweaverCharacterIdentityInDatabase({
  db,
  memberId,
  deviceId = "",
  rawCharacterId = "",
  preferredCharacterId = "",
  characterName = "",
  realm = "",
  region = "",
}) {
  ensureGuildweaverCharacterIdentitySchema(db);

  const aliased = readGuildweaverCharacterAliasInDatabase({
    db,
    memberId,
    deviceId,
    rawCharacterId,
  });
  if (aliased) {
    return db
      .prepare("SELECT id, is_main, sort_order FROM characters WHERE id = ? AND member_id = ? LIMIT 1")
      .get(aliased, text(memberId, 160));
  }

  // A local anonymous character ID belongs to an installation. The stable
  // cross-device identity is the member + realm + full character name. Prefer
  // an existing stable identity before accepting a second machine's local ID.
  const stable = characterByStableIdentity(db, {
    memberId,
    characterName,
    realm,
    region,
  });
  if (stable) return stable;

  // Keep GUID/legacy/direct IDs working for characters that predate the alias
  // ledger or whose name/realm is temporarily unavailable.
  const preferred = text(preferredCharacterId, 200);
  if (preferred) {
    return db
      .prepare("SELECT id, is_main, sort_order FROM characters WHERE id = ? AND member_id = ? LIMIT 1")
      .get(preferred, text(memberId, 160));
  }

  return null;
}

export function recordGuildweaverCharacterAliasInDatabase({
  db,
  memberId,
  deviceId = "",
  installationId = "",
  rawCharacterId = "",
  characterId,
  characterName = "",
  realm = "",
  region = "",
  observedAt = new Date().toISOString(),
}) {
  const raw = text(rawCharacterId, 200);
  if (!raw || !characterId) return false;
  ensureGuildweaverCharacterIdentitySchema(db);

  const member = text(memberId, 160);
  const device = text(deviceId, 160);
  const canonical = text(characterId, 200);

  db.prepare(`
    INSERT INTO guildweaver_character_aliases (
      member_id, device_id, installation_id, raw_character_id, character_id,
      character_name, realm, region, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id, device_id, raw_character_id) DO UPDATE SET
      installation_id = CASE
        WHEN excluded.installation_id <> '' THEN excluded.installation_id
        ELSE guildweaver_character_aliases.installation_id
      END,
      character_id = excluded.character_id,
      character_name = excluded.character_name,
      realm = excluded.realm,
      region = excluded.region,
      last_seen_at = excluded.last_seen_at
  `).run(
    member,
    device,
    text(installationId, 200),
    raw,
    canonical,
    text(characterName, 96),
    text(realm, 120),
    text(region, 32),
    String(observedAt),
    String(observedAt),
  );

  // Repair already-ingested debug telemetry as soon as we learn the alias.
  // The immutable envelope still contains the original raw character ID.
  if (tableExists(db, "guildweaver_telemetry_records")) {
    db.prepare(`
      UPDATE guildweaver_telemetry_records
      SET character_id = ?
      WHERE member_id = ? AND device_id = ? AND character_id = ?
    `).run(canonical, member, device, raw);
  }

  return true;
}
