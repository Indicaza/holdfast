// The guild directory's vocabulary and input rules. Pure: no database.
//
// A guild is a listing players can discover (faction, realm type, play
// styles, schedule, recruiting needs) plus the members who belong to it. One
// player belongs to at most one guild; guilds can link to sister guilds.

export const FACTIONS = Object.freeze(["alliance", "horde"]);
export const REGIONS = Object.freeze(["US", "EU", "KR", "TW", "CN", "OCE"]);
export const REALM_TYPES = Object.freeze(["normal", "pvp", "rp", "rp_pvp", "hardcore"]);
export const PLAY_STYLES = Object.freeze([
  "raiding",
  "pvp",
  "leveling",
  "casual",
  "social",
  "roleplay",
  "hardcore",
  "economy",
  "mentorship",
]);
export const CLASSES = Object.freeze([
  "warrior",
  "paladin",
  "hunter",
  "rogue",
  "priest",
  "shaman",
  "mage",
  "warlock",
  "druid",
]);
export const ROLES = Object.freeze(["tank", "healer", "dps"]);
export const LANGUAGES = Object.freeze(["en", "de", "fr", "es", "pt", "it", "ru", "ko", "zh"]);
export const WEEKDAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const AGE_POLICIES = Object.freeze(["any", "adult"]);
export const VISIBILITIES = Object.freeze(["public", "unlisted"]);
export const SORTS = Object.freeze(["active", "newest", "members", "name"]);
export const MEMBERSHIP_ROLES = Object.freeze(["owner", "officer", "member"]);

// Guild pages live at /:slug, so a slug can never be a top-level path of the
// site: platform pages, server paths, the old single-guild paths that now
// redirect, a guild's own sections, and the frontend's public asset folders
// (frontend/src/routing.js RESERVED_TOP_LEVEL_SEGMENTS; a test keeps them in
// step).
export const RESERVED_SLUGS = new Set([
  "admin", "api", "auth", "assets", "guilds", "guild", "guildos", "new", "register",
  "join", "login", "logout", "signin", "signup", "settings", "account", "me", "items",
  "intelligence", "guildweaver", "members", "quests", "privacy", "charter", "ranks",
  "about", "armory-art", "inventory-art", "profession-art", "talent-art", "wow-art",
]);

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function multiline(value, maxLength) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, maxLength) : "";
}

function oneOf(value, allowed, fallback = "") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(normalized) ? normalized : fallback;
}

function setOf(values, allowed, max = allowed.length) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => oneOf(value, allowed)).filter(Boolean))].slice(0, max);
}

export function guildSlug(value) {
  return text(value, 64)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function validSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

function time(value) {
  const normalized = text(value, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : "";
}

function discordInvite(value) {
  const normalized = text(value, 200);
  if (!normalized) return "";
  const match = normalized.match(/^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/);
  return match ? `https://discord.gg/${match[1]}` : null;
}

function timezone(value) {
  const normalized = text(value, 64);
  if (!normalized) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    return normalized;
  } catch {
    return null;
  }
}

// Validates a guild listing from a registration or edit form. Returns
// { ok, listing } or { ok: false, errors: { field: code } }.
export function normalizeGuildListing(input = {}, { requireIdentity = true } = {}) {
  const errors = {};
  const name = text(input.name, 48);
  const slug = guildSlug(input.slug || name);
  const listing = {
    name,
    slug,
    tagline: text(input.tagline, 120),
    description: multiline(input.description, 4000),
    faction: oneOf(input.faction, FACTIONS),
    region: REGIONS.includes(text(input.region, 8).toUpperCase()) ? text(input.region, 8).toUpperCase() : "",
    realm: text(input.realm, 48),
    realmType: oneOf(input.realmType, REALM_TYPES),
    language: oneOf(input.language, LANGUAGES, "en"),
    timezone: timezone(input.timezone),
    playStyles: setOf(input.playStyles, PLAY_STYLES, 5),
    recruiting: input.recruiting !== false,
    recruitingClasses: setOf(input.recruitingClasses, CLASSES),
    recruitingRoles: setOf(input.recruitingRoles, ROLES),
    minimumLevel: Number.isInteger(input.minimumLevel) && input.minimumLevel >= 1 && input.minimumLevel <= 60 ? input.minimumLevel : 1,
    raidDays: setOf(input.raidDays, WEEKDAYS),
    raidStart: time(input.raidStart),
    raidEnd: time(input.raidEnd),
    voiceRequired: input.voiceRequired === true,
    agePolicy: oneOf(input.agePolicy, AGE_POLICIES, "any"),
    discordInviteUrl: discordInvite(input.discordInviteUrl),
    accentColor: /^#[0-9a-fA-F]{6}$/.test(text(input.accentColor, 7)) ? text(input.accentColor, 7).toLowerCase() : "#c4a667",
    visibility: oneOf(input.visibility, VISIBILITIES, "public"),
  };

  if (requireIdentity) {
    if (listing.name.length < 2) errors.name = "guild_name_required";
    if (!validSlug(listing.slug)) errors.slug = "guild_slug_invalid";
  }
  if (!listing.faction) errors.faction = "guild_faction_required";
  if (!listing.region) errors.region = "guild_region_required";
  if (listing.realm.length < 2) errors.realm = "guild_realm_required";
  if (!listing.realmType) errors.realmType = "guild_realm_type_required";
  if (listing.playStyles.length === 0) errors.playStyles = "guild_play_style_required";
  if (listing.timezone === null) errors.timezone = "guild_timezone_invalid";
  if (listing.discordInviteUrl === null) errors.discordInviteUrl = "guild_discord_invite_invalid";
  if (Boolean(listing.raidStart) !== Boolean(listing.raidEnd)) errors.raidStart = "guild_raid_window_incomplete";

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, listing };
}

// Directory search parameters from a query string. Unknown values are
// dropped rather than rejected, so a stale shared link still lists guilds.
export function normalizeGuildSearch(query = {}) {
  const list = (value) => (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []);
  const limit = Number.parseInt(query.limit, 10);
  const offset = Number.parseInt(query.offset, 10);
  return {
    q: text(query.q, 64),
    factions: setOf(list(query.faction), FACTIONS),
    regions: list(query.region).map((value) => text(value, 8).toUpperCase()).filter((value) => REGIONS.includes(value)),
    realmTypes: setOf(list(query.realmType), REALM_TYPES),
    playStyles: setOf(list(query.style), PLAY_STYLES),
    languages: setOf(list(query.language), LANGUAGES),
    recruitingClass: oneOf(query.class, CLASSES),
    recruitingRole: oneOf(query.role, ROLES),
    recruitingOnly: query.recruiting === "1" || query.recruiting === "true",
    raidDay: oneOf(query.day, WEEKDAYS),
    sort: oneOf(query.sort, SORTS, "active"),
    limit: Number.isInteger(limit) ? Math.min(48, Math.max(1, limit)) : 24,
    offset: Number.isInteger(offset) ? Math.min(10000, Math.max(0, offset)) : 0,
  };
}

export function guildDirectoryVocabulary() {
  return {
    factions: FACTIONS,
    regions: REGIONS,
    realmTypes: REALM_TYPES,
    playStyles: PLAY_STYLES,
    classes: CLASSES,
    roles: ROLES,
    languages: LANGUAGES,
    weekdays: WEEKDAYS,
    sorts: SORTS,
  };
}
