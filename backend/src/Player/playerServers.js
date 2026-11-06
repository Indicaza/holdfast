// A player's servers: the realms their characters were synced from.
//
// A server's identity is its region and realm name, exactly as the game
// reported them (case aside). Server type (Hardcore, RP-PvP, ...) is not
// part of the identity and is not reported by the addon, so it is never
// shown or guessed: two RP-PvP realms are two servers. Characters whose
// telemetry has no realm yet sit under "unknown" rather than being merged
// into a real server.

export const UNKNOWN_SERVER = "unknown";

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function serverKey({ realm = "", region = "" } = {}) {
  const realmName = clean(realm, 120).toLowerCase();
  if (!realmName) return UNKNOWN_SERVER;
  return `${clean(region, 32).toLowerCase()}:${realmName}`;
}

// The same key computed in SQL from a table's realm and region columns.
export function serverKeySql(alias) {
  const realm = `TRIM(COALESCE(${alias}.realm, ''))`;
  const region = `TRIM(COALESCE(${alias}.region, ''))`;
  return `(CASE WHEN ${realm} = '' THEN '${UNKNOWN_SERVER}' ELSE LOWER(${region}) || ':' || LOWER(${realm}) END)`;
}

// A server filter from a query parameter: a key, or "" for all servers.
// Anything that cannot be a key is treated as all servers.
export function requestedServer(value) {
  const key = clean(value, 160).toLowerCase();
  if (!key || key === "all") return "";
  if (key === UNKNOWN_SERVER || /^[^:]*:.+$/.test(key)) return key;
  return "";
}

// [{ key, realm, region, characterCount, lastSeenAt }] for a player's
// characters, most recently active first. The region is shown only when two
// of the player's servers share a realm name.
export function groupServers(characters = []) {
  const servers = new Map();
  for (const character of characters) {
    const key = serverKey(character);
    const entry = servers.get(key) || {
      key,
      realm: key === UNKNOWN_SERVER ? "" : clean(character.realm, 120),
      region: key === UNKNOWN_SERVER ? "" : clean(character.region, 32).toUpperCase(),
      characterCount: 0,
      lastSeenAt: null,
    };
    entry.characterCount += 1;
    if (character.lastSeenAt && (!entry.lastSeenAt || character.lastSeenAt > entry.lastSeenAt)) {
      entry.lastSeenAt = character.lastSeenAt;
    }
    servers.set(key, entry);
  }

  const list = [...servers.values()];
  const realmCounts = new Map();
  for (const server of list) {
    const name = server.realm.toLowerCase();
    realmCounts.set(name, (realmCounts.get(name) || 0) + 1);
  }
  return list
    .map((server) => ({
      ...server,
      label: server.key === UNKNOWN_SERVER
        ? "Unknown server"
        : realmCounts.get(server.realm.toLowerCase()) > 1 && server.region
          ? `${server.realm} (${server.region})`
          : server.realm,
    }))
    .sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || ""))
      || left.label.localeCompare(right.label));
}

export function onServer(character, server) {
  return !server || serverKey(character) === server;
}
