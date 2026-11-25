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

export function readGuildweaverCharacterAliasInDatabase({
  db,
  memberId,
  deviceId = "",
  rawCharacterId = "",
}) {
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

// A character is account + region + realm + name. The same name on another
// realm is another character, so a name only matches with a known realm
// (never "any realm" when the upload has none), and a known region must
// agree too.
function characterByStableIdentity(db, { memberId, characterName, realm, region }) {
  const name = text(characterName, 96);
  const normalizedRealm = text(realm, 120);
  if (!name || !normalizedRealm) return null;

  const normalizedRegion = text(region, 32);
  return db
    .prepare(`
      SELECT c.id, c.is_main, c.sort_order
      FROM characters c
      JOIN telemetry_characters t ON t.character_id = c.id
      WHERE c.member_id = ?
        AND c.name = ? COLLATE NOCASE
        AND LOWER(TRIM(COALESCE(t.realm, ''))) = LOWER(?)
        AND (? = '' OR TRIM(COALESCE(t.region, '')) = '' OR LOWER(t.region) = LOWER(?))
      ORDER BY c.sort_order, c.id
      LIMIT 1
    `)
    .get(
      text(memberId, 160),
      name,
      normalizedRealm,
      normalizedRegion,
      normalizedRegion,
    );
}

// True when the character is known on another realm (or region) than the
// upload's. Unknown on either side is not a conflict: it proves nothing.
export function characterRealmConflictInDatabase(db, characterId, { realm = "", region = "" } = {}) {
  const incomingRealm = text(realm, 120).toLowerCase();
  if (!characterId || !incomingRealm || !tableExists(db, "telemetry_characters")) return false;
  const known = db.prepare("SELECT realm, region FROM telemetry_characters WHERE character_id = ?").get(String(characterId));
  const knownRealm = text(known?.realm, 120).toLowerCase();
  if (!knownRealm) return false;
  if (knownRealm !== incomingRealm) return true;
  const knownRegion = text(known?.region, 32).toLowerCase();
  const incomingRegion = text(region, 32).toLowerCase();
  return Boolean(knownRegion && incomingRegion && knownRegion !== incomingRegion);
}

// The id a new character of this account takes. Ids come from the upload
// (the addon's per-install id or a game GUID), so two accounts can send the
// same one: the same WoW install paired from a second Discord account, or a
// forged upload. A character never changes owner, so when the id already
// belongs to another account this account's character gets its own
// (stable) id instead.
export function ownedCharacterIdInDatabase(db, memberId, preferredId) {
  const id = text(preferredId, 200);
  if (!id) return "";
  const member = text(memberId, 160);
  const existing = db.prepare("SELECT member_id FROM characters WHERE id = ?").get(id);
  if (!existing || existing.member_id === member) return id;
  return `${id}@${member}`.slice(0, 400);
}

// The same, on a realm: when the id is already this account's character on
// another realm, the upload's character gets its own stable id for its
// realm instead of joining the other realm's character.
export function realmCharacterIdInDatabase(db, memberId, preferredId, { realm = "", region = "" } = {}) {
  const id = ownedCharacterIdInDatabase(db, memberId, preferredId);
  if (!id || !characterRealmConflictInDatabase(db, id, { realm, region })) return id;
  const server = `${text(region, 32)}:${text(realm, 120)}`.toLowerCase();
  return `${id}~${server}`.slice(0, 400);
}

// Forever's November 20 hotfix removes realm names. Only the explicit
// realm-free identity contract may use regional two-part names, and only
// when exactly one existing character of this owner fits. Legacy uploads
// with a missing realm retain their previous isolation behavior.
function characterByRegionalFullName(db, { memberId, characterName, region, firstName, lastName }) {
  const name = text(characterName, 96);
  const normalizedRegion = text(region, 32);
  const first = text(firstName, 40);
  const last = text(lastName, 40);
  if (!first || !last || !normalizedRegion || name.toLowerCase() !== `${first} ${last}`.toLowerCase()) return null;
  const rows = db.prepare(`
      SELECT c.id, c.is_main, c.sort_order
      FROM characters c
      JOIN telemetry_characters t ON t.character_id = c.id
      WHERE c.member_id = ?
        AND c.name = ? COLLATE NOCASE
        AND LOWER(TRIM(COALESCE(t.region, ''))) = LOWER(?)
      ORDER BY c.sort_order, c.id
      LIMIT 2
  `).all(text(memberId, 160), name, normalizedRegion);
  return rows.length === 1 ? rows[0] : null;
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
  realmUnavailable = false,
  firstName = "",
  lastName = "",
}) {

  const aliased = readGuildweaverCharacterAliasInDatabase({
    db,
    memberId,
    deviceId,
    rawCharacterId,
  });
  // An alias never carries a character to another realm.
  if (aliased && !characterRealmConflictInDatabase(db, aliased, { realm, region })) {
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

  if (realmUnavailable && !text(realm, 120)) {
    const regional = characterByRegionalFullName(db, { memberId, characterName, region, firstName, lastName });
    if (regional) return regional;
  }

  // Keep GUID/legacy/direct IDs working for characters that predate the alias
  // ledger or whose name/realm is temporarily unavailable.
  const preferred = realmCharacterIdInDatabase(db, memberId, preferredCharacterId, { realm, region });
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
