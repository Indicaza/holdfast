function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sectionStatus(snapshot, key) {
  const raw = object(snapshot?.capture?.sections)[key];
  if (typeof raw === "string") return raw.toLowerCase();
  if (raw && typeof raw === "object") return String(raw.status || "").toLowerCase();
  return "";
}

function meaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "";
}

function useIncomingSection(previous, incoming, key) {
  const status = sectionStatus(incoming, key);
  if (["complete", "authoritative"].includes(status)) return true;
  if (["partial", "unavailable", "unknown"].includes(status)) {
    return !meaningful(previous?.[key]);
  }

  if (meaningful(incoming?.[key])) return true;
  return !meaningful(previous?.[key]);
}

function copySection(merged, previous, incoming, key, preserved) {
  if (useIncomingSection(previous, incoming, key)) {
    if (Object.prototype.hasOwnProperty.call(incoming || {}, key)) {
      merged[key] = incoming[key];
    }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(previous || {}, key)) {
    merged[key] = previous[key];
    preserved.push(key);
  }
}

export function snapshotCapturedAt(snapshot) {
  const numeric = Number(snapshot?.capturedAt);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 100000000000 ? numeric * 1000 : numeric).toISOString();
  }
  const parsed = new Date(snapshot?.capturedAt);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function isOlderSnapshot(incomingCapturedAt, currentCapturedAt) {
  if (!currentCapturedAt) return false;
  const incoming = new Date(incomingCapturedAt).getTime();
  const current = new Date(currentCapturedAt).getTime();
  if (!Number.isFinite(incoming) || !Number.isFinite(current)) return false;
  return incoming < current;
}

export function mergeCharacterSnapshot(previousSnapshot, incomingSnapshot) {
  const previous = object(previousSnapshot);
  const incoming = object(incomingSnapshot);
  const merged = { ...previous, ...incoming };
  const preservedSections = [];

  for (const key of ["stats", "attributes", "equipment", "talents", "professions", "recipes"]) {
    copySection(merged, previous, incoming, key, preservedSections);
  }

  for (const key of ["guild", "specialization"]) {
    const status = sectionStatus(incoming, key);
    const explicitlyComplete = ["complete", "authoritative"].includes(status);
    const explicitlyUnavailable = ["partial", "unavailable", "unknown"].includes(status);
    if (!explicitlyComplete && (explicitlyUnavailable || !meaningful(incoming[key])) && meaningful(previous[key])) {
      merged[key] = previous[key];
      preservedSections.push(key);
    }
  }

  merged.capture = {
    ...object(previous.capture),
    ...object(incoming.capture),
    projection: {
      preservedSections: [...new Set(preservedSections)],
    },
  };

  return {
    snapshot: merged,
    preservedSections: merged.capture.projection.preservedSections,
  };
}

export function sectionIsAuthoritative(snapshot, key) {
  return ["complete", "authoritative"].includes(sectionStatus(snapshot, key));
}

export function sectionArray(snapshot, key) {
  return array(snapshot?.[key]);
}
