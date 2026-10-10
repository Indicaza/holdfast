// Projectors: which character sections each telemetry stream describes.
// Pure functions from a payload to [{ section, payload, weak }].
//
// A section is "weak" when the capture could not vouch for it: the addon
// marked it partial (the client was still loading), or it arrived empty.
// The writer applies a weak section only when the character has nothing for
// it yet, so a login-time or teardown capture never blanks real data.
//
// Section payloads keep the character snapshot's own field names, so the
// armory composer can rebuild a snapshot from them and reuse one set of
// normalizers whichever stream each section came from.

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function meaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "";
}

const IDENTITY_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "fullName",
  "realm",
  "realmName",
  "region",
  "level",
  "sex",
  "bodyType",
  "race",
  "class",
  "guild",
  "organization",
  "specialization",
  "spec",
  "gameBuild",
  "schemaVersion",
  "addonVersion",
  "characterKey",
];

function sectionStatus(snapshot, key) {
  const raw = object(snapshot?.capture?.sections)[key];
  if (typeof raw === "string") return raw.toLowerCase();
  if (raw && typeof raw === "object") return String(raw.status || "").toLowerCase();
  return "";
}

function weakStatus(status) {
  return ["partial", "unavailable", "unknown"].includes(status);
}

function identity(source, { trustedKeys = IDENTITY_FIELDS } = {}) {
  const payload = {};
  for (const key of trustedKeys) {
    if (meaningful(source?.[key])) payload[key] = source[key];
  }
  return payload;
}

function section(name, payload, weak = false) {
  return { section: name, payload, weak: weak || !meaningful(Object.values(payload)[0]) };
}

// A whole character snapshot (the legacy character endpoint, or the
// character_snapshot telemetry stream).
export function sectionsFromCharacterSnapshot(snapshot) {
  const source = object(snapshot);
  if (!Object.keys(source).length) return [];

  // Guild and specialization are dropped, not blanked, when the capture was
  // partial; identity merges field by field (see writer).
  const untrusted = new Set(
    ["guild", "specialization"].filter((key) => weakStatus(sectionStatus(source, key)) && !meaningful(source[key])),
  );
  // A capture taken while the client tore down (every section unavailable)
  // cannot vouch for anything, identity included.
  const statuses = ["stats", "equipment", "talents", "professions"].map((key) => sectionStatus(source, key));
  const tornDown = statuses.every((status) => status === "unavailable");
  const sections = [
    { section: "identity", payload: identity(source, { trustedKeys: IDENTITY_FIELDS.filter((key) => !untrusted.has(key)) }), weak: tornDown },
  ];

  for (const key of ["stats", "equipment", "talents"]) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    sections.push(section(key, { [key]: source[key] }, weakStatus(sectionStatus(source, key))));
  }
  if (Object.prototype.hasOwnProperty.call(source, "professions")) {
    sections.push({
      ...section("professions", { professions: source.professions }, weakStatus(sectionStatus(source, "professions"))),
      // Unless the capture read the recipe books, keep the recipes known for
      // each profession (they are only readable with its window open).
      keepRecipes: !["complete", "authoritative"].includes(sectionStatus(source, "recipes")),
    });
  }
  return sections;
}

// One telemetry stream's latest state. `payload` is the handler's canonical
// payload (profession and inventory models), otherwise the envelope payload.
export function sectionsFromTelemetry(eventType, payload) {
  const source = object(payload);
  switch (eventType) {
    case "character_snapshot":
      return sectionsFromCharacterSnapshot(source);
    case "character":
      return [{ section: "identity", payload: identity(source), weak: false }];
    case "stats":
      return [section("stats", { stats: source.stats })];
    case "equipment":
      return [section("equipment", { equipment: source.equipment })];
    case "talents":
      return [section("talents", { talents: source.talents })];
    case "profession_snapshot":
      return Array.isArray(source.professions) ? [section("profession_books", source)] : [];
    case "inventory_snapshot":
      return Array.isArray(source.containers) ? [{ section: "inventory", payload: source, weak: false }] : [];
    default:
      return [];
  }
}

// Whether a telemetry stream says who the character is (name, realm), so
// the character can be created from it alone.
export function identityFromTelemetry(eventType, payload) {
  if (eventType !== "character" && eventType !== "character_snapshot") return null;
  const source = object(payload);
  const name = String(source.fullName || source.name || "").trim();
  if (!name) return null;
  return {
    name,
    realm: String(source.realm ?? source.realmName ?? "").trim(),
    region: String(source.region ?? "").trim(),
    characterKey: String(source.characterKey ?? "").trim(),
  };
}
