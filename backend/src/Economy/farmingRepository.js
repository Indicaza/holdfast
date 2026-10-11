import { withGuildDatabase } from "../Data/database.js";
import { ECONOMIC_EVENT_TYPES } from "./economicObservationModel.js";
import { SKILL_BUCKET_SIZE, observedRate, skillBucket } from "./farmingStatistics.js";

// Farming intelligence reads: the source browser (search by source or by
// what it produces) and one source's drop table under context filters.
// Everything is computed from economic_observations on request; nothing here
// writes.

const SOURCE_LIMIT = 200;

function text(value, maxLength = 120) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalInteger(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function likePattern(value) {
  return `%${text(value).toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function displayName(row) {
  return row.source_name || (row.source_object_id ? `Object ${row.source_object_id}` : "Unknown source");
}

function itemView(row) {
  return {
    itemKey: row.item_key,
    itemId: row.item_id === null ? null : Number(row.item_id),
    name: row.item_name || (row.item_id ? `Item ${row.item_id}` : "Unknown item"),
    qualityId: row.quality_id === null ? null : Number(row.quality_id),
    iconFileDataId: row.icon_file_data_id === null ? null : Number(row.icon_file_data_id),
  };
}

// --- Source browser -------------------------------------------------------

export function searchFarmingSources({ q = "", discipline = "", limit = SOURCE_LIMIT } = {}) {
  return withGuildDatabase((db) => {
    const query = text(q);
    const disciplineFilter = text(discipline, 60).toLowerCase();
    const clauses = [];
    const params = [];
    if (disciplineFilter) {
      clauses.push("o.discipline = ?");
      params.push(disciplineFilter);
    }

    let matchedItemKeys = null;
    if (query) {
      const pattern = likePattern(query);
      const numeric = /^\d+$/.test(query) ? `item:${query}` : "";
      matchedItemKeys = db.prepare(`
        SELECT DISTINCT item_key FROM economic_observation_outputs
        WHERE LOWER(item_name) LIKE ? ESCAPE '\\' OR item_key = ?
      `).all(pattern, numeric).map((row) => row.item_key);

      const itemPlaceholders = matchedItemKeys.map(() => "?").join(", ");
      clauses.push(`(
        LOWER(o.source_name) LIKE ? ESCAPE '\\'
        ${matchedItemKeys.length ? `OR o.source_key IN (
          SELECT DISTINCT so.source_key FROM economic_observations so
          JOIN economic_observation_outputs si ON si.observation_id = so.id
          WHERE si.item_key IN (${itemPlaceholders})
        )` : ""}
      )`);
      params.push(pattern, ...matchedItemKeys);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT
        o.source_key,
        o.discipline,
        MAX(o.source_kind) AS source_kind,
        MAX(o.source_name) AS source_name,
        MAX(o.source_object_id) AS source_object_id,
        COUNT(*) AS observations,
        COUNT(DISTINCT NULLIF(o.character_key, '')) AS characters,
        COUNT(DISTINCT NULLIF(o.zone, '')) AS zones,
        (
          SELECT zone_observation.zone
          FROM economic_observations zone_observation
          WHERE zone_observation.source_key = o.source_key
            AND zone_observation.zone <> ''
          GROUP BY zone_observation.zone
          ORDER BY COUNT(*) DESC, zone_observation.zone ASC
          LIMIT 1
        ) AS primary_zone,
        MAX(o.captured_at) AS last_observed_at
      FROM economic_observations o
      ${where}
      GROUP BY o.source_key
      ORDER BY observations DESC, source_name ASC
      LIMIT ?
    `).all(...params, Math.min(SOURCE_LIMIT, Math.max(1, Number(limit) || SOURCE_LIMIT)));

    const sourceKeys = rows.map((row) => row.source_key);
    const outputs = sourceOutputs(db, sourceKeys);
    const matches = matchedItemKeys?.length ? sourceItemMatches(db, sourceKeys, matchedItemKeys) : new Map();

    const sources = rows.map((row) => {
      const observations = Number(row.observations);
      const sourceMatches = (matches.get(row.source_key) || []).map((match) => ({
        ...match,
        ...observedRate(match.drops, observations),
      }));
      return {
        sourceKey: row.source_key,
        name: displayName(row),
        discipline: row.discipline,
        kind: row.source_kind,
        observations,
        characters: Number(row.characters),
        zones: Number(row.zones),
        primaryZone: row.primary_zone || "",
        lastObservedAt: row.last_observed_at,
        icon: outputs.get(row.source_key)?.[0] || null,
        // What else it drops, beyond the output it is named for.
        drops: (outputs.get(row.source_key) || []).slice(1).map((output) => ({
          ...output,
          ...observedRate(output.drops, observations),
        })),
        matchedBy: query && row.source_name.toLowerCase().includes(query.toLowerCase()) ? "source" : query ? "output" : null,
        matches: sourceMatches,
      };
    });

    return { query, discipline: disciplineFilter, disciplines: disciplineCounts(db), sources };
  });
}

function disciplineCounts(db) {
  return db.prepare(`
    SELECT discipline, COUNT(*) AS observations, COUNT(DISTINCT source_key) AS sources
    FROM economic_observations
    GROUP BY discipline
    ORDER BY observations DESC
  `).all().map((row) => ({
    discipline: row.discipline,
    observations: Number(row.observations),
    sources: Number(row.sources),
  }));
}

// A source's outputs, most common first: the first is what the source looks
// like (Peacebloom the herb for Peacebloom the node), the next few are what
// else it is worth gathering for.
const PREVIEW_OUTPUTS = 4;

function sourceOutputs(db, sourceKeys) {
  if (!sourceKeys.length) return new Map();
  const rows = db.prepare(`
    SELECT source_key, item_key, item_id, item_name, quality_id, icon_file_data_id, drops FROM (
      SELECT
        o.source_key, i.item_key, MAX(i.item_id) AS item_id, MAX(i.item_name) AS item_name,
        MAX(i.quality_id) AS quality_id, MAX(i.icon_file_data_id) AS icon_file_data_id,
        COUNT(*) AS drops,
        ROW_NUMBER() OVER (PARTITION BY o.source_key ORDER BY COUNT(*) DESC, i.item_key) AS position
      FROM economic_observations o
      JOIN economic_observation_outputs i ON i.observation_id = o.id
      WHERE o.source_key IN (${sourceKeys.map(() => "?").join(", ")})
      GROUP BY o.source_key, i.item_key
    ) WHERE position <= ?
    ORDER BY source_key, position
  `).all(...sourceKeys, PREVIEW_OUTPUTS);
  const bySource = new Map();
  for (const row of rows) {
    const list = bySource.get(row.source_key) || [];
    list.push({ ...itemView(row), drops: Number(row.drops) });
    bySource.set(row.source_key, list);
  }
  return bySource;
}

function sourceItemMatches(db, sourceKeys, itemKeys) {
  if (!sourceKeys.length) return new Map();
  const rows = db.prepare(`
    SELECT
      o.source_key, i.item_key, MAX(i.item_id) AS item_id, MAX(i.item_name) AS item_name,
      MAX(i.quality_id) AS quality_id, MAX(i.icon_file_data_id) AS icon_file_data_id,
      COUNT(*) AS drops
    FROM economic_observations o
    JOIN economic_observation_outputs i ON i.observation_id = o.id
    WHERE o.source_key IN (${sourceKeys.map(() => "?").join(", ")})
      AND i.item_key IN (${itemKeys.map(() => "?").join(", ")})
    GROUP BY o.source_key, i.item_key
    ORDER BY drops DESC
  `).all(...sourceKeys, ...itemKeys);
  const bySource = new Map();
  for (const row of rows) {
    const list = bySource.get(row.source_key) || [];
    list.push({ ...itemView(row), drops: Number(row.drops) });
    bySource.set(row.source_key, list);
  }
  return bySource;
}

// --- One source -----------------------------------------------------------

export function normalizeFarmingFilters(input = {}) {
  const rank = text(input.rank, 12).toLowerCase();
  return {
    zone: text(input.zone),
    build: text(input.build, 40),
    rank: rank === "unknown" ? "unknown" : optionalInteger(rank),
    skillMin: optionalInteger(input.skillMin),
    skillMax: optionalInteger(input.skillMax),
    levelMin: optionalInteger(input.levelMin),
    levelMax: optionalInteger(input.levelMax),
  };
}

function filterClauses(sourceKey, filters) {
  const clauses = ["o.source_key = ?"];
  const params = [sourceKey];
  if (filters.zone) {
    clauses.push("o.zone = ?");
    params.push(filters.zone);
  }
  if (filters.build) {
    clauses.push("o.game_build = ?");
    params.push(filters.build);
  }
  if (filters.rank === "unknown") {
    clauses.push("o.bountiful_harvest_rank IS NULL");
  } else if (filters.rank !== null) {
    clauses.push("o.bountiful_harvest_rank = ?");
    params.push(filters.rank);
  }
  // A range filter excludes observations that do not report the value.
  for (const [column, min, max] of [
    ["o.skill_level", filters.skillMin, filters.skillMax],
    ["o.character_level", filters.levelMin, filters.levelMax],
  ]) {
    if (min !== null) {
      clauses.push(`${column} >= ?`);
      params.push(min);
    }
    if (max !== null) {
      clauses.push(`${column} <= ?`);
      params.push(max);
    }
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, params };
}

function sourceFacets(db, sourceKey) {
  const facet = (column) => db.prepare(`
    SELECT ${column} AS value, COUNT(*) AS observations
    FROM economic_observations
    WHERE source_key = ?
    GROUP BY ${column}
    ORDER BY observations DESC
  `).all(sourceKey).map((row) => ({ value: row.value, observations: Number(row.observations) }));
  const ranges = db.prepare(`
    SELECT MIN(skill_level) AS skill_min, MAX(skill_level) AS skill_max,
           MIN(character_level) AS level_min, MAX(character_level) AS level_max
    FROM economic_observations WHERE source_key = ?
  `).get(sourceKey);

  return {
    zones: facet("zone").filter((entry) => entry.value),
    builds: facet("game_build").filter((entry) => entry.value),
    ranks: facet("bountiful_harvest_rank")
      .map((entry) => ({ value: entry.value === null ? "unknown" : Number(entry.value), observations: entry.observations }))
      .sort((a, b) => (a.value === "unknown") - (b.value === "unknown") || a.value - b.value),
    skill: { min: ranges.skill_min ?? null, max: ranges.skill_max ?? null },
    level: { min: ranges.level_min ?? null, max: ranges.level_max ?? null },
  };
}

// The item the skill and Bountiful Harvest breakdowns follow: the one asked
// for, else the most common output that is not (nearly) guaranteed — the
// interesting drop, not the herb itself.
function selectedOutput(outputs, requested) {
  if (requested) {
    const match = outputs.find((output) => output.itemKey === requested);
    if (match) return match;
  }
  return outputs.find((output) => output.rate < 0.95) || outputs[0] || null;
}

function breakdown(db, { where, params }, itemKey, groupExpression) {
  return db.prepare(`
    SELECT
      ${groupExpression} AS bucket,
      COUNT(*) AS observations,
      COUNT(i.observation_id) AS drops,
      COALESCE(SUM(i.quantity), 0) AS quantity
    FROM economic_observations o
    LEFT JOIN economic_observation_outputs i ON i.observation_id = o.id AND i.item_key = ?
    ${where}
    GROUP BY bucket
    ORDER BY bucket IS NULL, bucket
  `).all(itemKey, ...params);
}

function breakdownRow(row) {
  const observations = Number(row.observations);
  const drops = Number(row.drops);
  return {
    ...observedRate(drops, observations),
    drops,
    quantity: Number(row.quantity),
    avgQuantityPerObservation: observations ? Number(row.quantity) / observations : 0,
  };
}

export function readFarmingSource(sourceKey, { filters: rawFilters = {}, item = "" } = {}) {
  return withGuildDatabase((db) => {
    const key = text(sourceKey, 240);
    const identity = db.prepare(`
      SELECT source_key, discipline, MAX(source_kind) AS source_kind, MAX(source_name) AS source_name,
             MAX(source_object_id) AS source_object_id, COUNT(*) AS observations
      FROM economic_observations WHERE source_key = ?
      GROUP BY source_key
    `).get(key);
    if (!identity) return null;

    const filters = normalizeFarmingFilters(rawFilters);
    const scope = filterClauses(key, filters);
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS observations,
        COUNT(DISTINCT NULLIF(o.character_key, '')) AS characters,
        COUNT(DISTINCT NULLIF(o.zone, '')) AS zones,
        MIN(o.captured_at) AS first_observed_at,
        MAX(o.captured_at) AS last_observed_at
      FROM economic_observations o
      ${scope.where}
    `).get(...scope.params);
    const observations = Number(totals.observations);
    const builds = db.prepare(`
      SELECT o.game_build AS build, MAX(o.game_version) AS version, COUNT(*) AS observations
      FROM economic_observations o
      ${scope.where} AND o.game_build <> ''
      GROUP BY o.game_build
      ORDER BY o.game_build DESC
    `).all(...scope.params).map((row) => ({ build: row.build, version: row.version, observations: Number(row.observations) }));
    const objectIds = db.prepare(`
      SELECT DISTINCT source_object_id AS id FROM economic_observations
      WHERE source_key = ? AND source_object_id IS NOT NULL
      ORDER BY id
    `).all(key).map((row) => Number(row.id));

    const outputs = db.prepare(`
      SELECT
        i.item_key, MAX(i.item_id) AS item_id, MAX(i.item_name) AS item_name,
        MAX(i.quality_id) AS quality_id, MAX(i.icon_file_data_id) AS icon_file_data_id,
        COUNT(*) AS drops, SUM(i.quantity) AS quantity
      FROM economic_observations o
      JOIN economic_observation_outputs i ON i.observation_id = o.id
      ${scope.where}
      GROUP BY i.item_key
      ORDER BY drops DESC, quantity DESC, item_name
    `).all(...scope.params).map((row) => {
      const drops = Number(row.drops);
      const quantity = Number(row.quantity);
      return {
        ...itemView(row),
        ...observedRate(drops, observations),
        drops,
        quantity,
        avgQuantity: drops ? quantity / drops : 0,
      };
    });

    const selected = selectedOutput(outputs, text(item, 200));
    let bySkill = [];
    let byBountifulHarvest = [];
    if (selected) {
      bySkill = breakdown(db, scope, selected.itemKey, `CASE WHEN o.skill_level >= 1 THEN (o.skill_level - 1) / ${SKILL_BUCKET_SIZE} END`)
        .map((row) => {
          const bucket = row.bucket === null ? null : skillBucket(Number(row.bucket) * SKILL_BUCKET_SIZE + 1);
          return { bucket: bucket ? bucket.label : "unknown", min: bucket?.min ?? null, max: bucket?.max ?? null, ...breakdownRow(row) };
        });
      byBountifulHarvest = breakdown(db, scope, selected.itemKey, "o.bountiful_harvest_rank")
        .map((row) => ({ rank: row.bucket === null ? "unknown" : Number(row.bucket), ...breakdownRow(row) }));
    }

    return {
      source: {
        sourceKey: identity.source_key,
        name: displayName(identity),
        discipline: identity.discipline,
        kind: identity.source_kind,
        objectIds,
        totalObservations: Number(identity.observations),
      },
      filters,
      facets: sourceFacets(db, key),
      summary: {
        observations,
        characters: Number(totals.characters),
        zones: Number(totals.zones),
        builds,
        firstObservedAt: totals.first_observed_at,
        lastObservedAt: totals.last_observed_at,
      },
      outputs,
      selectedItemKey: selected?.itemKey || null,
      bySkill,
      byBountifulHarvest,
    };
  });
}

// --- Ingest status ----------------------------------------------------------

// Whether economic telemetry is reaching Farming: raw events received (within
// raw retention), how many became observations, and the ones that could not
// be analysed, with a few record ids to inspect in the Guildweaver console.
export function readFarmingIngestStatus() {
  return withGuildDatabase((db) => {
    const placeholders = ECONOMIC_EVENT_TYPES.map(() => "?").join(", ");
    const raw = db.prepare(`
      SELECT r.event_type, COUNT(*) AS received, MAX(r.received_at) AS last_received_at,
             SUM(CASE WHEN o.id IS NULL THEN 1 ELSE 0 END) AS unrecorded
      FROM guildweaver_telemetry_records r
      LEFT JOIN economic_observations o ON o.record_id = r.id
      WHERE r.kind = 'event' AND r.event_type IN (${placeholders})
      GROUP BY r.event_type
    `).all(...ECONOMIC_EVENT_TYPES);
    const unrecorded = db.prepare(`
      SELECT r.id, r.event_type, r.received_at
      FROM guildweaver_telemetry_records r
      WHERE r.kind = 'event' AND r.event_type IN (${placeholders})
        AND NOT EXISTS (SELECT 1 FROM economic_observations o WHERE o.record_id = r.id)
      ORDER BY r.id DESC LIMIT 5
    `).all(...ECONOMIC_EVENT_TYPES);
    const observations = db.prepare(`
      SELECT discipline, COUNT(*) AS observations, COUNT(DISTINCT source_key) AS sources,
             MAX(captured_at) AS last_captured_at, MAX(received_at) AS last_received_at
      FROM economic_observations
      GROUP BY discipline
      ORDER BY observations DESC
    `).all();

    return {
      eventTypes: ECONOMIC_EVENT_TYPES,
      raw: raw.map((row) => ({
        eventType: row.event_type,
        received: Number(row.received),
        recorded: Number(row.received) - Number(row.unrecorded),
        unrecorded: Number(row.unrecorded),
        lastReceivedAt: row.last_received_at,
      })),
      unrecordedSamples: unrecorded.map((row) => ({ recordId: Number(row.id), eventType: row.event_type, receivedAt: row.received_at })),
      observations: observations.map((row) => ({
        discipline: row.discipline,
        observations: Number(row.observations),
        sources: Number(row.sources),
        lastCapturedAt: row.last_captured_at,
        lastReceivedAt: row.last_received_at,
      })),
    };
  });
}
