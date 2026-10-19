import { randomUUID } from "node:crypto";

import { withGuildDatabase, withGuildTransaction } from "../../Data/database.js";
import { ensureCharacterReadModelSchema } from "../../Character/ReadModel/readModelSchema.js";
import { CLASSES, PLAY_STYLES, REALM_TYPES, FACTIONS } from "./guildDirectoryModel.js";
import { memberHasGuildPermissionInDatabase } from "./guildRoles.js";

// A character counts toward a guild's verified activity when Guildweaver saw
// it recently. Only aggregates leave this module; never player names.
const ACTIVE_DAYS = 7;
const VERIFIED_DAYS = 30;

function json(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function daysAgo(days, now = Date.now()) {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function classToken(value) {
  const token = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return CLASSES.includes(token) ? token : "";
}

function sizeBand(memberCount) {
  if (memberCount >= 100) return "large";
  if (memberCount >= 30) return "mid";
  return "small";
}

// Aggregate roster facts for a set of guilds, from the characters their
// active members have synced. One query per fact, not per guild.
function rosterStats(db, guildIds, now = Date.now()) {
  const stats = new Map(guildIds.map((id) => [id, {
    memberCount: 0,
    verifiedCharacters: 0,
    activeCharacters: 0,
    averageLevel: null,
    maxLevelCharacters: 0,
    classMix: {},
    lastActiveAt: null,
  }]));
  if (!guildIds.length) return stats;
  ensureCharacterReadModelSchema(db);
  const placeholders = guildIds.map(() => "?").join(", ");

  for (const row of db.prepare(`
    SELECT guild_id, COUNT(*) AS members FROM guild_memberships
    WHERE status = 'active' AND guild_id IN (${placeholders}) GROUP BY guild_id
  `).all(...guildIds)) {
    stats.get(row.guild_id).memberCount = Number(row.members);
  }

  const verifiedSince = daysAgo(VERIFIED_DAYS, now);
  const activeSince = daysAgo(ACTIVE_DAYS, now);
  for (const row of db.prepare(`
    SELECT gm.guild_id, card.class_name, card.level, card.last_seen_at
    FROM guild_memberships gm
    JOIN character_cards card ON card.member_id = gm.member_id
    WHERE gm.status = 'active' AND gm.guild_id IN (${placeholders}) AND card.last_seen_at >= ?
  `).all(...guildIds, verifiedSince)) {
    const entry = stats.get(row.guild_id);
    entry.verifiedCharacters += 1;
    if (row.last_seen_at >= activeSince) entry.activeCharacters += 1;
    if (!entry.lastActiveAt || row.last_seen_at > entry.lastActiveAt) entry.lastActiveAt = row.last_seen_at;
    const level = Number(row.level) || 0;
    entry.levelTotal = (entry.levelTotal || 0) + level;
    if (level >= 60) entry.maxLevelCharacters += 1;
    const token = classToken(row.class_name);
    if (token) entry.classMix[token] = (entry.classMix[token] || 0) + 1;
  }

  for (const entry of stats.values()) {
    entry.averageLevel = entry.verifiedCharacters ? Math.round(entry.levelTotal / entry.verifiedCharacters) : null;
    entry.sizeBand = sizeBand(entry.memberCount);
    entry.verified = entry.verifiedCharacters > 0;
    delete entry.levelTotal;
  }
  return stats;
}

function playStylesFor(db, guildIds) {
  const styles = new Map(guildIds.map((id) => [id, []]));
  if (!guildIds.length) return styles;
  for (const row of db.prepare(`
    SELECT guild_id, style FROM guild_play_styles
    WHERE guild_id IN (${guildIds.map(() => "?").join(", ")}) ORDER BY style
  `).all(...guildIds)) {
    styles.get(row.guild_id).push(row.style);
  }
  return styles;
}

function guildView(row, { styles = [], stats, sisters } = {}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    faction: row.faction,
    region: row.region,
    realm: row.realm,
    realmType: row.realm_type,
    language: row.language,
    timezone: row.timezone,
    playStyles: styles,
    recruiting: Boolean(row.recruiting),
    recruitingClasses: json(row.recruiting_classes_json, []),
    recruitingRoles: json(row.recruiting_roles_json, []),
    minimumLevel: Number(row.minimum_level) || 1,
    schedule: {
      raidDays: json(row.raid_days_json, []),
      raidStart: row.raid_start,
      raidEnd: row.raid_end,
    },
    voiceRequired: Boolean(row.voice_required),
    agePolicy: row.age_policy,
    discordInviteUrl: row.discord_invite_url,
    discordConnected: Boolean(row.discord_server_id),
    accentColor: row.accent_color,
    visibility: row.visibility,
    createdAt: row.created_at,
    stats,
    ...(sisters ? { sisters } : {}),
  };
}

function searchClauses(search) {
  const clauses = ["g.status = 'active'", "g.visibility = 'public'"];
  const params = [];
  const anyOf = (column, values) => {
    if (!values.length) return;
    clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  };
  anyOf("g.faction", search.factions);
  anyOf("g.region", search.regions);
  anyOf("g.realm_type", search.realmTypes);
  anyOf("g.language", search.languages);
  if (search.playStyles.length) {
    // Every requested style, not any: "raiding + hardcore" narrows.
    clauses.push(`(SELECT COUNT(*) FROM guild_play_styles s WHERE s.guild_id = g.id AND s.style IN (${search.playStyles.map(() => "?").join(", ")})) = ?`);
    params.push(...search.playStyles, search.playStyles.length);
  }
  if (search.recruitingOnly || search.recruitingClass || search.recruitingRole) clauses.push("g.recruiting = 1");
  if (search.recruitingClass) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(g.recruiting_classes_json) WHERE value = ?)");
    params.push(search.recruitingClass);
  }
  if (search.recruitingRole) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(g.recruiting_roles_json) WHERE value = ?)");
    params.push(search.recruitingRole);
  }
  if (search.raidDay) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(g.raid_days_json) WHERE value = ?)");
    params.push(search.raidDay);
  }
  if (search.q) {
    const like = `%${search.q.toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    clauses.push("(LOWER(g.name) LIKE ? ESCAPE '\\' OR LOWER(g.tagline) LIKE ? ESCAPE '\\' OR LOWER(g.realm) LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return { where: clauses.join(" AND "), params };
}

const SORT_ORDER = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name),
  members: (a, b) => b.stats.memberCount - a.stats.memberCount || a.name.localeCompare(b.name),
  active: (a, b) =>
    b.stats.activeCharacters - a.stats.activeCharacters ||
    b.stats.verifiedCharacters - a.stats.verifiedCharacters ||
    Number(b.recruiting) - Number(a.recruiting) ||
    b.createdAt.localeCompare(a.createdAt),
};

// Counts of public guilds per filter value, so the browser can show how many
// guilds each chip leads to.
function directoryFacets(db) {
  const facet = (column, values) => {
    const counts = Object.fromEntries(values.map((value) => [value, 0]));
    for (const row of db.prepare(`
      SELECT ${column} AS value, COUNT(*) AS n FROM guilds
      WHERE status = 'active' AND visibility = 'public' GROUP BY ${column}
    `).all()) {
      if (row.value in counts) counts[row.value] = Number(row.n);
    }
    return counts;
  };
  const styles = Object.fromEntries(PLAY_STYLES.map((value) => [value, 0]));
  for (const row of db.prepare(`
    SELECT s.style, COUNT(*) AS n FROM guild_play_styles s JOIN guilds g ON g.id = s.guild_id
    WHERE g.status = 'active' AND g.visibility = 'public' GROUP BY s.style
  `).all()) {
    if (row.style in styles) styles[row.style] = Number(row.n);
  }
  const total = db.prepare("SELECT COUNT(*) AS n FROM guilds WHERE status = 'active' AND visibility = 'public'").get();
  return {
    total: Number(total.n),
    factions: facet("faction", FACTIONS),
    realmTypes: facet("realm_type", REALM_TYPES),
    playStyles: styles,
  };
}

export function searchGuildDirectory(search, { now = Date.now() } = {}) {
  return withGuildDatabase((db) => {
    const { where, params } = searchClauses(search);
    const rows = db.prepare(`SELECT g.* FROM guilds g WHERE ${where}`).all(...params);
    const ids = rows.map((row) => row.id);
    const styles = playStylesFor(db, ids);
    const stats = rosterStats(db, ids, now);
    const guilds = rows
      .map((row) => guildView(row, { styles: styles.get(row.id), stats: stats.get(row.id) }))
      .sort(SORT_ORDER[search.sort] || SORT_ORDER.active);
    return {
      total: guilds.length,
      guilds: guilds.slice(search.offset, search.offset + search.limit),
      pagination: { limit: search.limit, offset: search.offset, hasMore: search.offset + search.limit < guilds.length },
      facets: directoryFacets(db),
    };
  });
}

function sistersOf(db, guildId) {
  return db.prepare(`
    SELECT g.id, g.slug, g.name, g.faction, g.realm, g.accent_color
    FROM guild_links l
    JOIN guilds g ON g.id = CASE WHEN l.guild_id = ? THEN l.linked_guild_id ELSE l.guild_id END
    WHERE (l.guild_id = ? OR l.linked_guild_id = ?) AND l.kind = 'sister' AND l.status = 'accepted'
      AND g.status = 'active'
    ORDER BY g.name COLLATE NOCASE
  `).all(guildId, guildId, guildId).map((row) => ({
    id: row.id, slug: row.slug, name: row.name, faction: row.faction, realm: row.realm, accentColor: row.accent_color,
  }));
}

export function readGuildBySlug(slug, { now = Date.now() } = {}) {
  return withGuildDatabase((db) => {
    const row = db.prepare("SELECT * FROM guilds WHERE slug = ? AND status = 'active'").get(String(slug || ""));
    if (!row) return null;
    return guildView(row, {
      styles: playStylesFor(db, [row.id]).get(row.id),
      stats: rosterStats(db, [row.id], now).get(row.id),
      sisters: sistersOf(db, row.id),
    });
  });
}

export function readMemberGuild(memberId) {
  return withGuildDatabase((db) => {
    const row = db.prepare(`
      SELECT g.slug, g.name, gm.role FROM guild_memberships gm JOIN guilds g ON g.id = gm.guild_id
      WHERE gm.member_id = ? AND gm.status = 'active' LIMIT 1
    `).get(String(memberId || ""));
    return row ? { slug: row.slug, name: row.name, role: row.role } : null;
  });
}

function writeListing(db, guildId, listing, now) {
  db.prepare(`
    UPDATE guilds SET
      tagline = ?, description = ?, faction = ?, region = ?, realm = ?, realm_type = ?, language = ?,
      timezone = ?, recruiting = ?, recruiting_classes_json = ?, recruiting_roles_json = ?, minimum_level = ?,
      raid_days_json = ?, raid_start = ?, raid_end = ?, voice_required = ?, age_policy = ?,
      discord_invite_url = ?, accent_color = ?, visibility = ?, updated_at = ?
    WHERE id = ?
  `).run(
    listing.tagline, listing.description, listing.faction, listing.region, listing.realm, listing.realmType,
    listing.language, listing.timezone, listing.recruiting ? 1 : 0, JSON.stringify(listing.recruitingClasses),
    JSON.stringify(listing.recruitingRoles), listing.minimumLevel, JSON.stringify(listing.raidDays),
    listing.raidStart, listing.raidEnd, listing.voiceRequired ? 1 : 0, listing.agePolicy,
    listing.discordInviteUrl || "", listing.accentColor, listing.visibility, now, guildId,
  );
  db.prepare("DELETE FROM guild_play_styles WHERE guild_id = ?").run(guildId);
  const insert = db.prepare("INSERT INTO guild_play_styles (guild_id, style) VALUES (?, ?)");
  for (const style of listing.playStyles) insert.run(guildId, style);
}

// Registers a guild with the signed-in player as its owner. A player already
// in a guild cannot found another: they must leave first.
export function registerGuild({ memberId, listing, now = new Date().toISOString() }) {
  return withGuildTransaction((db) => {
    const member = db.prepare("SELECT id FROM members WHERE id = ?").get(memberId);
    if (!member) return { ok: false, error: "member_not_found" };
    if (db.prepare("SELECT 1 FROM guild_memberships WHERE member_id = ? AND status = 'active'").get(memberId)) {
      return { ok: false, error: "already_in_guild" };
    }
    if (db.prepare("SELECT 1 FROM guilds WHERE slug = ?").get(listing.slug)) {
      return { ok: false, error: "guild_slug_taken" };
    }
    const id = `guild-${randomUUID()}`;
    db.prepare(`
      INSERT INTO guilds (id, slug, name, faction, region, realm, realm_type, owner_member_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, listing.slug, listing.name, listing.faction, listing.region, listing.realm, listing.realmType, memberId, now, now);
    writeListing(db, id, listing, now);
    db.prepare(`
      INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', ?)
    `).run(id, memberId, now);
    return { ok: true, slug: listing.slug };
  });
}

export function updateGuildListing({ slug, memberId, listing, siteAdmin = false, now = new Date().toISOString() }) {
  return withGuildTransaction((db) => {
    const guild = db.prepare("SELECT id FROM guilds WHERE slug = ? AND status = 'active'").get(slug);
    if (!guild) return { ok: false, error: "guild_not_found" };
    if (!siteAdmin && !memberHasGuildPermissionInDatabase(db, guild.id, memberId, "guild.listing.edit")) return { ok: false, error: "guild_manager_required" };
    writeListing(db, guild.id, listing, now);
    return { ok: true };
  });
}

export function applyToGuild({ slug, memberId, application, now = new Date().toISOString() }) {
  return withGuildTransaction((db) => {
    const guild = db.prepare("SELECT id, recruiting FROM guilds WHERE slug = ? AND status = 'active'").get(slug);
    if (!guild) return { ok: false, error: "guild_not_found" };
    if (!guild.recruiting) return { ok: false, error: "guild_not_recruiting" };
    if (db.prepare("SELECT 1 FROM guild_memberships WHERE member_id = ? AND status = 'active'").get(memberId)) {
      return { ok: false, error: "already_in_guild" };
    }
    if (db.prepare("SELECT 1 FROM guild_applications WHERE guild_id = ? AND member_id = ? AND status = 'pending'").get(guild.id, memberId)) {
      return { ok: false, error: "application_pending" };
    }
    const id = `application-${randomUUID()}`;
    db.prepare(`
      INSERT INTO guild_applications (id, guild_id, member_id, character_name, class_token, role, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, guild.id, memberId, application.characterName, application.classToken, application.role, application.message, now);
    return { ok: true, id };
  });
}

// Asks another guild to become a sister guild. Both guilds' managers must
// agree: the request stays pending until the other side accepts.
export function requestSisterGuild({ slug, targetSlug, memberId, now = new Date().toISOString() }) {
  return withGuildTransaction((db) => {
    const guild = db.prepare("SELECT id FROM guilds WHERE slug = ? AND status = 'active'").get(slug);
    const target = db.prepare("SELECT id FROM guilds WHERE slug = ? AND status = 'active'").get(targetSlug);
    if (!guild || !target) return { ok: false, error: "guild_not_found" };
    if (guild.id === target.id) return { ok: false, error: "sister_guild_self" };
    if (!memberHasGuildPermissionInDatabase(db, guild.id, memberId, "guild.sisters.manage")) return { ok: false, error: "guild_manager_required" };
    const existing = db.prepare(`
      SELECT id, status, guild_id FROM guild_links
      WHERE MIN(guild_id, linked_guild_id) = MIN(?, ?) AND MAX(guild_id, linked_guild_id) = MAX(?, ?) AND kind = 'sister'
    `).get(guild.id, target.id, guild.id, target.id);
    if (existing?.status === "accepted") return { ok: true, status: "accepted" };
    if (existing?.status === "pending" && existing.guild_id === target.id) {
      // They already asked us: asking back accepts.
      db.prepare("UPDATE guild_links SET status = 'accepted', responded_at = ? WHERE id = ?").run(now, existing.id);
      return { ok: true, status: "accepted" };
    }
    if (existing) {
      db.prepare(`
        UPDATE guild_links SET guild_id = ?, linked_guild_id = ?, status = 'pending', requested_by = ?, created_at = ?, responded_at = NULL
        WHERE id = ?
      `).run(guild.id, target.id, memberId, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO guild_links (id, guild_id, linked_guild_id, kind, status, requested_by, created_at)
        VALUES (?, ?, ?, 'sister', 'pending', ?, ?)
      `).run(`link-${randomUUID()}`, guild.id, target.id, memberId, now);
    }
    return { ok: true, status: "pending" };
  });
}

export function respondToSisterGuild({ slug, fromSlug, memberId, accept, now = new Date().toISOString() }) {
  return withGuildTransaction((db) => {
    const guild = db.prepare("SELECT id FROM guilds WHERE slug = ? AND status = 'active'").get(slug);
    const from = db.prepare("SELECT id FROM guilds WHERE slug = ? AND status = 'active'").get(fromSlug);
    if (!guild || !from) return { ok: false, error: "guild_not_found" };
    if (!memberHasGuildPermissionInDatabase(db, guild.id, memberId, "guild.sisters.manage")) return { ok: false, error: "guild_manager_required" };
    const result = db.prepare(`
      UPDATE guild_links SET status = ?, responded_at = ?
      WHERE guild_id = ? AND linked_guild_id = ? AND kind = 'sister' AND status = 'pending'
    `).run(accept ? "accepted" : "declined", now, from.id, guild.id);
    return result.changes ? { ok: true, status: accept ? "accepted" : "declined" } : { ok: false, error: "sister_request_not_found" };
  });
}

// Leaves the player's guild. An owner hands the guild to someone else first,
// unless they are its last member.
export function leaveCurrentGuild({ memberId, now = new Date().toISOString() }) {
  return withGuildTransaction((db) => {
    const membership = db.prepare(`
      SELECT guild_id, role FROM guild_memberships WHERE member_id = ? AND status = 'active'
    `).get(memberId);
    if (!membership) return { ok: false, error: "not_in_guild" };
    if (membership.role === "owner") {
      const others = db.prepare(`
        SELECT COUNT(*) AS n FROM guild_memberships WHERE guild_id = ? AND status = 'active' AND member_id <> ?
      `).get(membership.guild_id, memberId);
      if (Number(others.n) > 0) return { ok: false, error: "owner_must_transfer" };
    }
    db.prepare(`
      UPDATE guild_memberships SET status = 'departed', departed_at = ? WHERE guild_id = ? AND member_id = ?
    `).run(now, membership.guild_id, memberId);
    return { ok: true };
  });
}
