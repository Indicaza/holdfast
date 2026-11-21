// The Dungeon Content Studio's editorial document (schema 1): an override
// layer over the imported Dungeon Atlas (data/atlas.json). It never changes
// the imported data or the generated JSON; the site and the add-on exporter
// resolve the two at read time (editorialResolve.js).
//
// One document per dungeon:
//   {
//     schemaVersion: 1, instanceId,
//     dungeon: { <field>: Override },
//     bosses:  { <bossKey>: { <field>: Override } },
//     questPlan: { entrance?, instructions?, quests? }   // the planner contract
//   }
// Override = { value, verified: boolean, source: string }. A field that is
// absent inherits the imported value; "clear override" removes the key.
// bossKey is the atlas's boss key: String(encounterId || npcId || name),
// the same key the website's boss URLs use.
//
// The schema is a whitelist: an unknown key is a problem, never stored. That
// is what keeps telemetry, observed drop rates and readiness out of reach:
// there is no field for them, and a document that names one is refused.

export const EDITORIAL_SCHEMA_VERSION = 1;

export const MECHANIC_TYPES = Object.freeze(["interrupt", "dispel", "positioning", "tank-danger", "healer-danger", "crowd-control", "special-mechanic"]);
export const MECHANIC_PRIORITIES = Object.freeze(["high", "medium", "low"]);
export const ROLES = Object.freeze(["tank", "healer", "dps"]);
export const MAX_MECHANICS = 16;
export const MAX_LIST_ITEMS = 20;

// Keys that can never be edited, wherever they appear. Telemetry and
// observed aggregates come from players' clients; nobody overrides them.
export const PROTECTED_KEYS = Object.freeze(["observed", "observedRates", "observedRate", "observations", "telemetry", "dropRate", "dropRates",
  "referenceRates", "readiness", "questState", "evidence", "kills", "sightings", "runs"]);

// kind: text | longtext | list (strings) | int | location | media | bossOrder | mechanics | lootNotes
export const DUNGEON_FIELDS = Object.freeze([
  { key: "name", label: "Name", kind: "text", max: 80 },
  { key: "subtitle", label: "Subtitle", kind: "text", max: 120 },
  { key: "description", label: "Description and lore", kind: "longtext", max: 4000 },
  { key: "levelMin", label: "Minimum level", kind: "int", min: 1, maxValue: 80 },
  { key: "levelMax", label: "Maximum level", kind: "int", min: 1, maxValue: 80 },
  { key: "entrance", label: "Entrance", kind: "location" },
  { key: "cardArt", label: "Card art", kind: "media" },
  { key: "overviewArt", label: "Overview art", kind: "media" },
  { key: "mapArt", label: "Map art", kind: "media" },
  { key: "bossOrder", label: "Boss order", kind: "bossOrder" },
  { key: "tips", label: "Tips", kind: "list", max: 200 },
  { key: "preparation", label: "Preparation", kind: "list", max: 200 },
  { key: "groupComposition", label: "Group composition", kind: "longtext", max: 1000 },
  { key: "warnings", label: "Warnings", kind: "list", max: 200 },
  { key: "questNotes", label: "Quest notes", kind: "longtext", max: 2000 },
  { key: "routeNotes", label: "Route notes", kind: "longtext", max: 2000 },
  { key: "attribution", label: "Attribution", kind: "text", max: 300 },
  { key: "verification", label: "Verification notes", kind: "longtext", max: 1000 },
]);

export const BOSS_FIELDS = Object.freeze([
  { key: "name", label: "Name", kind: "text", max: 80 },
  { key: "description", label: "Description", kind: "longtext", max: 2000 },
  { key: "portrait", label: "Portrait", kind: "media" },
  { key: "strategy", label: "Strategy", kind: "longtext", max: 2000 },
  { key: "tank", label: "Tank", kind: "longtext", max: 1000 },
  { key: "healer", label: "Healer", kind: "longtext", max: 1000 },
  { key: "dps", label: "Damage", kind: "longtext", max: 1000 },
  { key: "positioning", label: "Positioning", kind: "longtext", max: 1000 },
  { key: "interrupts", label: "Interrupts", kind: "longtext", max: 1000 },
  { key: "dispels", label: "Dispels", kind: "longtext", max: 1000 },
  { key: "mechanics", label: "Mechanics", kind: "mechanics" },
  { key: "lootNotes", label: "Loot annotations", kind: "lootNotes" },
]);

export const QUEST_SECTIONS = Object.freeze(["collect", "share", "enter", "turnIn"]);
export const QUEST_RELEVANCE = Object.freeze(["dungeon", "optional"]);
export const QUEST_SHAREABLE = Object.freeze(["yes", "no", "unknown"]);

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const SOURCE_MAX = 300;

function text(value, max) {
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  return trimmed.length > max ? { ok: false, tooLong: true } : { ok: true, value: trimmed };
}

// A UiMap location: mapId a positive integer, x and y 0–1 fractions.
export function validLocation(value) {
  return isObject(value) && Number.isSafeInteger(value.mapId) && value.mapId > 0
    && typeof value.x === "number" && value.x >= 0 && value.x <= 1
    && typeof value.y === "number" && value.y >= 0 && value.y <= 1
    && (value.zoneName === undefined || value.zoneName === null || (typeof value.zoneName === "string" && value.zoneName.length <= 80));
}

function location(value) {
  if (!validLocation(value)) return null;
  const out = { mapId: value.mapId, x: Math.round(value.x * 10000) / 10000, y: Math.round(value.y * 10000) / 10000 };
  if (typeof value.zoneName === "string" && value.zoneName.trim()) out.zoneName = value.zoneName.trim();
  return out;
}

const MEDIA_ID = /^m_[a-z0-9]{8,40}$/;
export const isMediaId = (value) => typeof value === "string" && MEDIA_ID.test(value);

function mechanic(raw, where, problems) {
  if (!isObject(raw)) {
    problems.push({ path: where, code: "invalid", message: "A mechanic must be an object." });
    return null;
  }
  unknownKeys(raw, ["id", "ability", "type", "priority", "instruction", "roles", "verified", "source"], where, problems);
  const id = typeof raw.id === "string" && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : null;
  if (!id) problems.push({ path: `${where}.id`, code: "invalid", message: "A mechanic needs an id (a-z, 0-9, -)." });
  const ability = text(raw.ability ?? "", 80);
  if (!ability.ok || !ability.value) problems.push({ path: `${where}.ability`, code: "invalid", message: "A mechanic needs an ability name (at most 80 characters)." });
  if (!MECHANIC_TYPES.includes(raw.type)) problems.push({ path: `${where}.type`, code: "invalid", message: `Type must be one of ${MECHANIC_TYPES.join(", ")}.` });
  const priority = raw.priority === undefined ? "medium" : raw.priority;
  if (!MECHANIC_PRIORITIES.includes(priority)) problems.push({ path: `${where}.priority`, code: "invalid", message: "Priority must be high, medium or low." });
  const instruction = text(raw.instruction ?? "", 300);
  if (!instruction.ok) problems.push({ path: `${where}.instruction`, code: "invalid", message: "The instruction is at most 300 characters." });
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  if (raw.roles !== undefined && (!Array.isArray(raw.roles) || roles.some((role) => !ROLES.includes(role)))) {
    problems.push({ path: `${where}.roles`, code: "invalid", message: "Roles are tank, healer and dps." });
  }
  const source = text(raw.source ?? "", SOURCE_MAX);
  if (!source.ok) problems.push({ path: `${where}.source`, code: "invalid", message: `The source is at most ${SOURCE_MAX} characters.` });
  return {
    id: id || "", ability: ability.ok ? ability.value : "", type: raw.type, priority,
    instruction: instruction.ok ? instruction.value : "",
    roles: ROLES.filter((role) => roles.includes(role)),
    verified: raw.verified === true,
    source: source.ok ? source.value : "",
  };
}

function value(field, raw, where, problems) {
  const fail = (message) => {
    problems.push({ path: where, code: "invalid", message });
    return undefined;
  };
  switch (field.kind) {
    case "text":
    case "longtext": {
      const result = text(raw, field.max);
      return result.ok ? result.value : fail(`${field.label} is text of at most ${field.max} characters.`);
    }
    case "int":
      return Number.isSafeInteger(raw) && raw >= field.min && raw <= field.maxValue ? raw : fail(`${field.label} is a whole number from ${field.min} to ${field.maxValue}.`);
    case "location": {
      const result = location(raw);
      return result || fail(`${field.label}: mapId must be a positive integer and x and y between 0 and 1.`);
    }
    case "media":
      return raw === null || isMediaId(raw) ? raw : fail(`${field.label} must name an image from the media library.`);
    case "list": {
      if (!Array.isArray(raw) || raw.length > MAX_LIST_ITEMS) return fail(`${field.label} is a list of at most ${MAX_LIST_ITEMS} lines.`);
      const lines = [];
      for (const line of raw) {
        const result = text(line, field.max);
        if (!result.ok) return fail(`Each line of ${field.label} is at most ${field.max} characters.`);
        if (result.value) lines.push(result.value);
      }
      return lines;
    }
    case "bossOrder":
      return Array.isArray(raw) && raw.every((key) => typeof key === "string" && key.length <= 80) ? raw.slice() : fail("Boss order is a list of boss keys.");
    case "mechanics": {
      if (!Array.isArray(raw) || raw.length > MAX_MECHANICS) return fail(`Mechanics is a list of at most ${MAX_MECHANICS}.`);
      return raw.map((entry, index) => mechanic(entry, `${where}[${index}]`, problems)).filter(Boolean);
    }
    case "lootNotes": {
      if (!Array.isArray(raw) || raw.length > 40) return fail("Loot annotations are a list of at most 40.");
      return raw.map((entry, index) => {
        const path = `${where}[${index}]`;
        if (!isObject(entry)) return fail("A loot annotation is { itemId, note }.");
        unknownKeys(entry, ["itemId", "note", "verified", "source"], path, problems);
        const note = text(entry.note ?? "", 300);
        if (!Number.isSafeInteger(entry.itemId) || entry.itemId <= 0) problems.push({ path: `${path}.itemId`, code: "invalid", message: "itemId is a positive integer." });
        if (!note.ok) problems.push({ path: `${path}.note`, code: "invalid", message: "A loot note is at most 300 characters." });
        return { itemId: entry.itemId, note: note.ok ? note.value : "", verified: entry.verified === true, source: typeof entry.source === "string" ? entry.source.slice(0, SOURCE_MAX) : "" };
      }).filter(Boolean);
    }
    default:
      return fail("Unknown field kind.");
  }
}

function unknownKeys(raw, allowed, where, problems) {
  for (const key of Object.keys(raw)) {
    if (allowed.includes(key)) continue;
    const protectedKey = PROTECTED_KEYS.includes(key);
    problems.push({ path: where ? `${where}.${key}` : key, code: protectedKey ? "protected" : "unknown",
      message: protectedKey ? `${key} is telemetry or observed data and can never be edited.` : `${key} is not an editable field.` });
  }
}

function overrides(fields, raw, where, problems) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (!isObject(raw)) {
    problems.push({ path: where, code: "invalid", message: "Expected an object of field overrides." });
    return out;
  }
  unknownKeys(raw, fields.map((field) => field.key), where, problems);
  for (const field of fields) {
    const entry = raw[field.key];
    if (entry === undefined || entry === null) continue;
    const path = `${where}.${field.key}`;
    if (!isObject(entry) || !("value" in entry)) {
      problems.push({ path, code: "invalid", message: "An override is { value, verified, source }." });
      continue;
    }
    unknownKeys(entry, ["value", "verified", "source"], path, problems);
    const before = problems.length;
    const parsed = value(field, entry.value, `${path}.value`, problems);
    const source = text(entry.source ?? "", SOURCE_MAX);
    if (!source.ok) problems.push({ path: `${path}.source`, code: "invalid", message: `Source notes are at most ${SOURCE_MAX} characters.` });
    if (problems.length === before && parsed !== undefined) {
      out[field.key] = { value: parsed, verified: entry.verified === true, source: source.ok ? source.value : "" };
    }
  }
  return out;
}

function contractText(raw, max, path, problems) {
  if (raw === undefined || raw === null) return undefined;
  const result = text(raw, max);
  if (!result.ok) {
    problems.push({ path, code: "invalid", message: `At most ${max} characters.` });
    return undefined;
  }
  return result.value;
}

function contractLocation(raw, path, problems) {
  if (raw === undefined || raw === null) return undefined;
  const result = location(raw);
  if (!result) problems.push({ path, code: "coordinates", message: "mapId must be a positive integer and x and y between 0 and 1." });
  return result || undefined;
}

function contractNpc(raw, path, problems) {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) {
    problems.push({ path, code: "invalid", message: "Expected { name, location }." });
    return undefined;
  }
  unknownKeys(raw, ["name", "location"], path, problems);
  const out = {};
  const name = contractText(raw.name, 80, `${path}.name`, problems);
  if (name) out.name = name;
  const where = contractLocation(raw.location, `${path}.location`, problems);
  if (where) out.location = where;
  return Object.keys(out).length ? out : undefined;
}

const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, entry]) => entry !== undefined));

// The quest part, in the planner's contract shape (docs/dungeon-quest-planner.md
// in Worktree B, schema 1). Every field but questId is optional.
function questPlan(raw, problems) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) {
    problems.push({ path: "questPlan", code: "invalid", message: "Expected an object." });
    return {};
  }
  unknownKeys(raw, ["entrance", "instructions", "quests"], "questPlan", problems);
  const out = {};
  if (raw.entrance !== undefined && raw.entrance !== null) {
    if (!isObject(raw.entrance)) problems.push({ path: "questPlan.entrance", code: "invalid", message: "Expected a location." });
    else {
      unknownKeys(raw.entrance, ["mapId", "x", "y", "zoneName", "verified", "source"], "questPlan.entrance", problems);
      const where = contractLocation({ mapId: raw.entrance.mapId, x: raw.entrance.x, y: raw.entrance.y, zoneName: raw.entrance.zoneName }, "questPlan.entrance", problems);
      if (where) out.entrance = { ...where, verified: raw.entrance.verified === true, source: contractText(raw.entrance.source, SOURCE_MAX, "questPlan.entrance.source", problems) || "" };
    }
  }
  if (raw.instructions !== undefined && raw.instructions !== null) {
    if (!Array.isArray(raw.instructions) || raw.instructions.length > 40) problems.push({ path: "questPlan.instructions", code: "invalid", message: "At most 40 instructions." });
    else out.instructions = raw.instructions.map((entry, index) => {
      const path = `questPlan.instructions[${index}]`;
      if (!isObject(entry)) {
        problems.push({ path, code: "invalid", message: "Expected { section, text }." });
        return null;
      }
      unknownKeys(entry, ["section", "text", "verified", "source"], path, problems);
      if (!QUEST_SECTIONS.includes(entry.section)) problems.push({ path: `${path}.section`, code: "invalid", message: `Section is one of ${QUEST_SECTIONS.join(", ")}.` });
      const line = contractText(entry.text ?? "", 200, `${path}.text`, problems);
      return { section: entry.section, text: line || "", verified: entry.verified === true, source: contractText(entry.source, SOURCE_MAX, `${path}.source`, problems) || "" };
    }).filter(Boolean);
  }
  if (raw.quests !== undefined && raw.quests !== null) {
    if (!Array.isArray(raw.quests) || raw.quests.length > 80) problems.push({ path: "questPlan.quests", code: "invalid", message: "At most 80 quests." });
    else out.quests = raw.quests.map((entry, index) => {
      const path = `questPlan.quests[${index}]`;
      if (!isObject(entry)) {
        problems.push({ path, code: "invalid", message: "Expected a quest entry." });
        return null;
      }
      unknownKeys(entry, ["questId", "relevance", "shareable", "prerequisites", "giver", "turnIn", "steps", "notes", "verified", "source"], path, problems);
      if (!Number.isSafeInteger(entry.questId) || entry.questId <= 0) problems.push({ path: `${path}.questId`, code: "invalid", message: "questId is a positive integer." });
      if (entry.relevance !== undefined && entry.relevance !== null && !QUEST_RELEVANCE.includes(entry.relevance)) problems.push({ path: `${path}.relevance`, code: "invalid", message: "Relevance is dungeon or optional." });
      if (entry.shareable !== undefined && entry.shareable !== null && !QUEST_SHAREABLE.includes(entry.shareable)) problems.push({ path: `${path}.shareable`, code: "invalid", message: "Shareable is yes, no or unknown." });
      let prerequisites;
      if (entry.prerequisites !== undefined && entry.prerequisites !== null) {
        if (!Array.isArray(entry.prerequisites) || entry.prerequisites.some((id) => !Number.isSafeInteger(id) || id === 0)) {
          problems.push({ path: `${path}.prerequisites`, code: "invalid", message: "Prerequisites are quest ids (negative: must be in the log at the same time)." });
        } else prerequisites = entry.prerequisites.slice();
      }
      let steps;
      if (entry.steps !== undefined && entry.steps !== null) {
        if (!Array.isArray(entry.steps) || entry.steps.length > 20) problems.push({ path: `${path}.steps`, code: "invalid", message: "At most 20 steps." });
        else steps = entry.steps.map((step, stepIndex) => {
          const stepPath = `${path}.steps[${stepIndex}]`;
          if (!isObject(step)) {
            problems.push({ path: stepPath, code: "invalid", message: "A step is { text }." });
            return null;
          }
          unknownKeys(step, ["text"], stepPath, problems);
          return { text: contractText(step.text ?? "", 200, `${stepPath}.text`, problems) || "" };
        }).filter((step) => step && step.text);
      }
      return compact({
        questId: entry.questId,
        relevance: entry.relevance ?? undefined,
        shareable: entry.shareable ?? undefined,
        prerequisites,
        giver: contractNpc(entry.giver, `${path}.giver`, problems),
        turnIn: contractNpc(entry.turnIn, `${path}.turnIn`, problems),
        steps,
        notes: contractText(entry.notes, 500, `${path}.notes`, problems) || undefined,
        verified: entry.verified === true,
        source: contractText(entry.source, SOURCE_MAX, `${path}.source`, problems) || "",
      });
    }).filter(Boolean);
  }
  return out;
}

// { document, problems }: the document as stored (normalized), and every
// shape problem. A document with problems is never saved.
export function parseEditorialDocument(raw, instanceId) {
  const problems = [];
  if (!isObject(raw)) return { document: null, problems: [{ path: "", code: "invalid", message: "The document must be an object." }] };
  unknownKeys(raw, ["schemaVersion", "instanceId", "dungeon", "bosses", "questPlan"], "", problems);
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== EDITORIAL_SCHEMA_VERSION) {
    problems.push({ path: "schemaVersion", code: "invalid", message: `schemaVersion must be ${EDITORIAL_SCHEMA_VERSION}.` });
  }
  if (raw.instanceId !== undefined && raw.instanceId !== instanceId) {
    problems.push({ path: "instanceId", code: "invalid", message: "instanceId does not match the dungeon being edited." });
  }
  const bosses = {};
  if (raw.bosses !== undefined && raw.bosses !== null) {
    if (!isObject(raw.bosses)) problems.push({ path: "bosses", code: "invalid", message: "Expected bosses by boss key." });
    else for (const [key, entry] of Object.entries(raw.bosses)) {
      if (key.length > 80) {
        problems.push({ path: `bosses.${key.slice(0, 20)}`, code: "invalid", message: "Boss keys are at most 80 characters." });
        continue;
      }
      const parsed = overrides(BOSS_FIELDS, entry, `bosses.${key}`, problems);
      if (Object.keys(parsed).length) bosses[key] = parsed;
    }
  }
  const document = {
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    instanceId,
    dungeon: overrides(DUNGEON_FIELDS, raw.dungeon, "dungeon", problems),
    bosses,
    questPlan: questPlan(raw.questPlan, problems),
  };
  return { document, problems };
}

export function emptyEditorialDocument(instanceId) {
  return { schemaVersion: EDITORIAL_SCHEMA_VERSION, instanceId, dungeon: {}, bosses: {}, questPlan: {} };
}

// Every media id a document refers to.
export function mediaReferences(document) {
  const ids = new Set();
  const visit = (fields, defs) => {
    for (const field of defs) if (field.kind === "media" && isMediaId(fields?.[field.key]?.value)) ids.add(fields[field.key].value);
  };
  visit(document?.dungeon, DUNGEON_FIELDS);
  for (const boss of Object.values(document?.bosses || {})) visit(boss, BOSS_FIELDS);
  return [...ids];
}
