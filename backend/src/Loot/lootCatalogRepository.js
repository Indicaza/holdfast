// The dungeon loot catalog: Dungeon → Boss/Source → Items, reconciled from
// three kinds of evidence (see lootModel.js) and versioned.
//
// Rules the reconciliation keeps:
// - A loot window or a roll proves an item was offered there. It adds or
//   refreshes an entry. Not seeing an item never changes anything.
// - The journal's list for a boss is what the client advertises. An item is
//   marked removed only when a complete, newer list for the same boss and
//   difficulty no longer has it; the old entry and every snapshot stay.
// - Every change of what the catalog claims gets a revision and a row in
//   dungeon_loot_changes. Refreshing evidence of a known claim does not.

import { createHash } from "node:crypto";

import { withGuildDatabase } from "../Data/database.js";
import { gameBuildKey } from "../GameData/gameDataCatalog.js";
import { gameContext, gameInteger, gameText } from "../GameData/publicGameDataModel.js";
import { learnPublicItemInDatabase } from "../GameData/publicGameDataProjection.js";
import { observedItemDefinitionsInDatabase } from "../GameData/publicGameDataRepository.js";
import { itemsInDatabase } from "../Market/marketRepository.js";
import { inventoryTypeIndex } from "../Market/marketCategories.js";
import { referenceItemFacts, referenceSourcesOf } from "../Atlas/referenceLoot.js";
import { bestConfidence, compareBuilds, CONFIDENCE_ORDER, dungeonInstance, isObject, listOf, normalizedName, slotLabel, sourceConfidence,
  wishlistItemKey } from "./lootModel.js";

const REVISION_KEY = "dungeon_loot_revision";

function hash(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function isoTime(value) {
  const parsed = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? "1970-01-01T00:00:00.000Z" : parsed.toISOString();
}

export function lootCatalogRevisionInDatabase(db) {
  return Number(db.prepare("SELECT value FROM app_meta WHERE key = ?").get(REVISION_KEY)?.value) || 0;
}

// One ingest's changes share one revision, allocated on the first change.
function changeBatch(db, at) {
  let revision = null;
  const insert = db.prepare(`INSERT INTO dungeon_loot_changes (revision, changed_at, kind, instance_id, difficulty_id, source_kind, source_id,
    source_name, item_id, provenance, game_build, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const sources = new Set();
  return {
    revision() {
      if (revision === null) {
        revision = lootCatalogRevisionInDatabase(db) + 1;
        db.prepare(`INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(REVISION_KEY, String(revision), at);
      }
      return revision;
    },
    note(kind, entry, detail = {}) {
      insert.run(this.revision(), at, kind, entry.instanceId, entry.difficultyId, entry.sourceKind, entry.sourceId, entry.sourceName || "",
        entry.itemId ?? null, entry.provenance, entry.build || "", JSON.stringify(detail));
    },
    // A new source is announced once, however many items arrive with it.
    firstOfSource(entry) {
      const key = `${entry.instanceId}:${entry.sourceKind}:${entry.sourceId}`;
      if (sources.has(key)) return false;
      sources.add(key);
      return true;
    },
    get changed() { return revision !== null; },
  };
}

function noteInstance(db, instance, at, journalInstanceId = null) {
  db.prepare(`INSERT INTO dungeon_loot_instances (instance_id, name, instance_type, journal_instance_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(instance_id) DO UPDATE SET
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END,
      instance_type = CASE WHEN excluded.instance_type <> '' THEN excluded.instance_type ELSE instance_type END,
      journal_instance_id = COALESCE(excluded.journal_instance_id, journal_instance_id),
      first_seen_at = MIN(first_seen_at, excluded.first_seen_at), last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`)
    .run(instance.instanceId, instance.name || "", instance.type, journalInstanceId, at, at);
}

// Adds one piece of evidence that `itemId` comes from a source. Returns
// what it did: "created", "refreshed" or "restored".
function touchEntry(db, batch, entry) {
  const existing = db.prepare(`SELECT * FROM dungeon_loot_entries WHERE instance_id = ? AND difficulty_id = ? AND source_kind = ? AND source_id = ?
    AND item_id = ? AND provenance = ?`).get(entry.instanceId, entry.difficultyId, entry.sourceKind, entry.sourceId, entry.itemId, entry.provenance);
  if (existing) {
    const newer = entry.at >= existing.last_seen_at;
    const restored = existing.status === "removed" && entry.provenance === "encounter_journal" && entry.at > (existing.removed_at || "");
    db.prepare(`UPDATE dungeon_loot_entries SET evidence_count = evidence_count + 1,
      first_seen_at = MIN(first_seen_at, ?), last_seen_at = MAX(last_seen_at, ?),
      first_build = CASE WHEN ? < first_seen_at AND ? <> '' THEN ? ELSE first_build END,
      last_build = CASE WHEN ? = 1 AND ? <> '' THEN ? ELSE last_build END,
      source_name = CASE WHEN source_name = '' THEN ? ELSE source_name END,
      status = CASE WHEN ? = 1 THEN 'active' ELSE status END, removed_at = CASE WHEN ? = 1 THEN NULL ELSE removed_at END,
      revision = CASE WHEN ? = 1 THEN ? ELSE revision END WHERE id = ?`)
      .run(entry.at, entry.at, entry.at, entry.build, entry.build, newer ? 1 : 0, entry.build, entry.build, entry.sourceName || "",
        restored ? 1 : 0, restored ? 1 : 0, restored ? 1 : 0, restored ? batch.revision() : 0, existing.id);
    if (restored) {
      // Listed again on the build that dropped it: two lists disagree.
      const removedOn = db.prepare(`SELECT game_build FROM dungeon_loot_changes WHERE kind = 'potentially_removed' AND instance_id = ? AND difficulty_id = ?
        AND source_kind = ? AND source_id = ? AND item_id = ? ORDER BY id DESC LIMIT 1`)
        .get(entry.instanceId, entry.difficultyId, entry.sourceKind, entry.sourceId, entry.itemId)?.game_build || "";
      const sameBuild = compareBuilds(entry.build, removedOn) === 0;
      batch.note(sameBuild ? "conflict" : "restored", entry, { removedAt: existing.removed_at, removedOnBuild: removedOn || null,
        reason: sameBuild ? "listed_again_on_the_build_that_dropped_it" : "listed_again" });
      return "restored";
    }
    return "refreshed";
  }

  const sourceKnown = db.prepare("SELECT 1 FROM dungeon_loot_entries WHERE instance_id = ? AND source_kind = ? AND source_id = ? LIMIT 1")
    .get(entry.instanceId, entry.sourceKind, entry.sourceId);
  const itemRows = db.prepare("SELECT provenance, status FROM dungeon_loot_entries WHERE instance_id = ? AND item_id = ?").all(entry.instanceId, entry.itemId);
  db.prepare(`INSERT INTO dungeon_loot_entries (instance_id, difficulty_id, source_kind, source_id, source_name, item_id, provenance, evidence_count,
    first_seen_at, last_seen_at, first_build, last_build, status, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'active', ?)`)
    .run(entry.instanceId, entry.difficultyId, entry.sourceKind, entry.sourceId, entry.sourceName || "", entry.itemId, entry.provenance,
      entry.at, entry.at, entry.build || "", entry.build || "", batch.revision());
  if (!sourceKnown && entry.sourceKind !== "instance" && batch.firstOfSource(entry)) batch.note("new_source", { ...entry, itemId: null });
  if (!itemRows.length) batch.note("new_item", entry);
  else if (entry.provenance === "encounter_journal") batch.note("advertised_added", entry);
  else batch.note("observed", entry);
  // Seen in the game after the journal stopped listing it.
  if (entry.provenance !== "encounter_journal" && itemRows.some((row) => row.provenance === "encounter_journal" && row.status === "removed")) {
    batch.note("conflict", entry, { reason: "seen_after_the_journal_delisted_it" });
  }
  return "created";
}

// A corpse's loot window inside a dungeon: each item the observation had
// not reported before is one sighting from that creature.
export function recordLootWindowInDatabase(db, { envelope, newItemIds = [] }) {
  const payload = envelope?.payload;
  const instance = dungeonInstance(payload?.context?.instance);
  const npcId = gameInteger(payload?.source?.npcId, 1);
  if (!instance || !npcId || !newItemIds.length) return { status: "skipped" };
  const at = isoTime(envelope.capturedAt);
  const batch = changeBatch(db, at);
  noteInstance(db, instance, at);
  const quest = new Set((listOf(payload.outputs) || []).filter((output) => output?.isQuestItem === true).map((output) => output.itemId));
  for (const itemId of newItemIds) {
    // Quest drops depend on who is on the quest; they are not gear.
    if (quest.has(itemId)) continue;
    touchEntry(db, batch, { instanceId: instance.instanceId, difficultyId: instance.difficultyId, sourceKind: "creature", sourceId: npcId,
      sourceName: gameText(payload.source.name, 120), itemId, provenance: "loot_window", at, build: gameBuildKey(envelope.gameBuild) });
  }
  return { status: "recorded", revision: batch.changed ? batch.revision() : null };
}

// A Need/Greed roll one player saw. Private (it names the account); the
// catalog only learns "this item was rolled for in this dungeon". A resend
// of the same roll updates its outcome and is never a second sighting.
export function recordLootRollInDatabase(db, { envelope, memberId, rawCharacterId }) {
  const payload = envelope.payload;
  const itemId = gameInteger(payload.item.itemId, 1);
  const itemKey = wishlistItemKey(itemId, payload.item.itemKey);
  const rollKey = hash(["roll", String(memberId), String(envelope.installationId || ""), payload.rollKey]);
  const now = Math.floor(Date.now() / 1000);
  const instance = dungeonInstance(payload.context?.instance);
  const pinned = payload.context?.source?.basis === "loot_window_single_source" ? gameInteger(payload.context.source.npcId, 1) : null;
  const acquiredBasis = payload.outcome === "won" ? String(payload.acquired?.basis || "") : "";
  const existing = db.prepare("SELECT id, outcome FROM loot_roll_events WHERE roll_key = ?").get(rollKey);
  if (existing) {
    // "won" is evidence the player received it; a later resend never takes it back.
    if (existing.outcome !== "won" && payload.outcome !== existing.outcome) {
      db.prepare("UPDATE loot_roll_events SET outcome = ?, acquired_basis = ?, updated_at = ? WHERE id = ?").run(payload.outcome, acquiredBasis, now, existing.id);
    }
    return { status: "updated", rollId: existing.id };
  }
  const inserted = db.prepare(`INSERT INTO loot_roll_events (roll_key, member_id, raw_character_id, item_id, item_key, instance_id, difficulty_id,
    source_npc_id, encounter_id, game_build, outcome, acquired_basis, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rollKey, String(memberId), String(rawCharacterId || envelope.characterId || ""), itemId, itemKey, instance?.instanceId ?? null,
      instance?.difficultyId ?? null, pinned, gameInteger(payload.context?.encounter?.id, 1), gameBuildKey(envelope.gameBuild), payload.outcome,
      acquiredBasis, gameInteger(payload.startedAt, 1), now);
  if (instance) {
    const at = isoTime(payload.startedAt);
    const batch = changeBatch(db, at);
    noteInstance(db, instance, at);
    learnPublicItemInDatabase(db, payload.item, gameContext(envelope), { capturedAt: at });
    touchEntry(db, batch, { instanceId: instance.instanceId, difficultyId: instance.difficultyId, sourceKind: pinned ? "creature" : "instance",
      sourceId: pinned || 0, sourceName: pinned ? gameText(payload.context.source.name, 120) : "", itemId, provenance: "group_roll", at,
      build: gameBuildKey(envelope.gameBuild) });
  }
  return { status: "created", rollId: Number(inserted.lastInsertRowid) };
}

// The loot a client's Encounter Journal lists for a dungeon's bosses.
// Every boss's list is stored whole; the catalog's advertised entries are
// then brought in line with it.
export function recordLootCatalogSnapshotInDatabase(db, { envelope, memberId, receivedAt = new Date().toISOString() }) {
  const payload = envelope.payload;
  const instance = dungeonInstance({ ...payload.instance, difficultyId: payload.difficultyId });
  const build = gameBuildKey(envelope.gameBuild);
  const at = isoTime(envelope.capturedAt);
  const contributor = hash([memberId]);
  const context = gameContext(envelope);
  // A list filtered to one class or spec says nothing about the rest.
  const unfiltered = !gameInteger(payload.filters?.classId, 1) && !gameInteger(payload.filters?.specId, 1);
  const batch = changeBatch(db, at);
  noteInstance(db, instance, at, gameInteger(payload.instance.journalInstanceId, 1));
  let stored = 0;
  let removed = 0;
  for (const encounter of listOf(payload.encounters)) {
    const encounterId = gameInteger(encounter.journalEncounterId, 1);
    const entries = listOf(encounter.items).map((entry) => (isObject(entry) ? entry : { itemId: entry }));
    const itemIds = [...new Set(entries.map((entry) => gameInteger(entry.itemId, 1)))].sort((a, b) => a - b);
    const complete = payload.complete && encounter.complete && unfiltered;
    const key = hash(["journal", contributor, build, instance.instanceId, instance.difficultyId, encounterId, itemIds, complete]);
    const snapshot = db.prepare(`INSERT OR IGNORE INTO dungeon_loot_snapshots (snapshot_key, contributor_key, instance_id, journal_instance_id, difficulty_id,
      encounter_id, encounter_name, game_build, source_api, complete, item_count, items_json, captured_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'encounter_journal', ?, ?, ?, ?, ?)`)
      .run(key, contributor, instance.instanceId, gameInteger(payload.instance.journalInstanceId, 1), instance.difficultyId, encounterId,
        gameText(encounter.name, 120), build, complete ? 1 : 0, itemIds.length, JSON.stringify(itemIds), at, receivedAt);
    // The same list from the same client again: nothing new to learn.
    if (!snapshot.changes) continue;
    stored += 1;
    for (const entry of entries) if (entry.name) learnPublicItemInDatabase(db, entry, context, { capturedAt: at });
    const scope = { instanceId: instance.instanceId, difficultyId: instance.difficultyId, sourceKind: "encounter", sourceId: encounterId,
      sourceName: gameText(encounter.name, 120), provenance: "encounter_journal", at, build };
    const before = db.prepare(`SELECT id, item_id, status, last_seen_at, last_build FROM dungeon_loot_entries WHERE instance_id = ? AND difficulty_id = ?
      AND source_kind = 'encounter' AND source_id = ? AND provenance = 'encounter_journal'`).all(instance.instanceId, instance.difficultyId, encounterId);
    for (const itemId of itemIds) touchEntry(db, batch, { ...scope, itemId });
    // Removal needs a complete list that is not empty (an empty "complete"
    // list is more likely a client that had not loaded the journal), taken
    // later than the entry was last seen, on the same or a newer build.
    if (!complete || !itemIds.length) continue;
    const listed = new Set(itemIds);
    for (const row of before) {
      if (row.status !== "active" || listed.has(row.item_id)) continue;
      const order = compareBuilds(build, row.last_build);
      if (!(at > row.last_seen_at) || order === null || order < 0) continue;
      db.prepare("UPDATE dungeon_loot_entries SET status = 'removed', removed_at = ?, revision = ? WHERE id = ?").run(at, batch.revision(), row.id);
      batch.note("potentially_removed", { ...scope, itemId: row.item_id }, { lastListedOnBuild: row.last_build, missingOnBuild: build, snapshot: key.slice(0, 16) });
      removed += 1;
    }
  }
  return { status: stored ? "recorded" : "duplicate", snapshots: stored, removed, revision: batch.changed ? batch.revision() : null };
}

// Reads -----------------------------------------------------------------------------

// "Classes: Warrior, Paladin" from a tooltip the game rendered. Only what
// the tooltip says: no armor-type or stat rule is ever inferred.
export function classesFromTooltip(lines = []) {
  for (const line of lines) {
    const match = /^Classes:\s*(.+)$/i.exec(String(line?.left || ""));
    if (match) return match[1].split(",").map((name) => name.trim()).filter(Boolean);
  }
  return null;
}

// Item facts for catalog and wishlist rows, by id, from the website's item
// index (the same one the Auction House uses). An item the index does not
// know by name but the Dungeon Atlas's Classic reference loot does gets the
// reference facts, marked `reference` (Atlas/referenceLoot.js); the index,
// fed by what players' clients saw, wins whenever it knows the item.
export function lootItemFactsInDatabase(db, itemIds) {
  const ids = [...new Set(itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const facts = new Map();
  const slots = new Map();
  const observedDefinitions = observedItemDefinitionsInDatabase(db, ids);
  for (let start = 0; start < ids.length; start += 200) {
    const chunk = ids.slice(start, start + 200);
    const item = itemsInDatabase(db, chunk);
    for (const id of chunk) facts.set(id, item(id));
    for (const row of db.prepare(`SELECT item_id, inventory_type FROM market_item_meta WHERE item_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) {
      slots.set(row.item_id, row.inventory_type);
    }
  }
  return (itemId) => {
    const known = facts.get(itemId) || { name: `Item ${itemId}`, nameKnown: false };
    const client = observedDefinitions.get(itemId);
    if (!client && !known.nameKnown) {
      const reference = referenceItemFacts(itemId);
      if (reference) return reference;
    }
    const clientName = client?.name && !/^Item \\d+$/.test(client.name) ? client.name : null;
    const itemClass = client?.itemClass?.name || known.itemClass || null;
    const itemSubclass = client?.itemSubclass?.name || known.itemSubclass || null;
    const inventoryType = inventoryTypeIndex(client?.equipLocation) ?? slots.get(itemId) ?? null;
    const captured = (client?.tooltipLines || []).filter((line) => line.left || line.right);
    const clientTooltip = captured.length > 1;
    const lines = clientTooltip ? client.tooltipLines : known.tooltipLines || [];
    return {
      itemId, itemKey: `i:${itemId}`, name: clientName || known.name, nameKnown: Boolean(clientName || known.nameKnown),
      qualityId: client?.qualityId ?? known.qualityId ?? null,
      iconFileDataId: client?.iconFileDataId ?? known.iconFileDataId ?? null,
      itemLevel: client?.itemLevel ?? known.itemLevel ?? null,
      requiredLevel: client?.requiredLevel ?? known.requiredLevel ?? null,
      itemClass, itemSubclass,
      slot: known.slotName || slotLabel(inventoryType) || null,
      equippable: Boolean(inventoryType) || ["Weapon", "Armor"].includes(itemClass),
      bindType: client?.bindType ?? known.bindType ?? null,
      sellPrice: client?.sellPrice ?? known.sellPrice ?? null,
      classes: classesFromTooltip(lines),
      ...(client ? { itemDefinition: { source: "game_item_definition", gameBuild: client.gameBuild, locale: client.locale } } : {}),
      tooltip: { lines, source: clientTooltip ? "game" : known.tooltipSource || null,
        gameBuild: clientTooltip ? client.gameBuild : known.tooltipBuild || null },
    };
  };
}

function entryFromRow(row) {
  return { provenance: row.provenance, status: row.status, evidenceCount: Number(row.evidence_count), firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at, firstBuild: row.first_build || null, lastBuild: row.last_build || null, removedAt: row.removed_at || null,
    difficultyId: Number(row.difficulty_id), revision: Number(row.revision) };
}

// One provenance's rows (one per difficulty) as one line of evidence.
function evidenceLine(rows) {
  const active = rows.filter((row) => row.status === "active");
  const pool = active.length ? active : rows;
  const last = pool.reduce((a, b) => (a.lastSeenAt >= b.lastSeenAt ? a : b));
  const first = pool.reduce((a, b) => (a.firstSeenAt <= b.firstSeenAt ? a : b));
  return { provenance: rows[0].provenance, status: active.length ? "active" : "removed", evidenceCount: pool.reduce((sum, row) => sum + row.evidenceCount, 0),
    firstSeenAt: first.firstSeenAt, lastSeenAt: last.lastSeenAt, firstBuild: first.firstBuild, lastBuild: last.lastBuild,
    removedAt: active.length ? null : rows.map((row) => row.removedAt).filter(Boolean).sort().at(-1) || null, revision: Math.max(...rows.map((row) => row.revision)) };
}

function itemEvidence(rows) {
  const byProvenance = new Map();
  for (const row of rows) byProvenance.set(row.provenance, [...(byProvenance.get(row.provenance) || []), row]);
  const evidence = [...byProvenance.values()].map(evidenceLine);
  return { evidence, confidence: sourceConfidence(evidence), difficultyIds: [...new Set(rows.filter((row) => row.status === "active").map((row) => row.difficultyId))].sort((a, b) => a - b) };
}

// Bosses the client itself named for this dungeon: kills it reported in
// players' runs. Never a guess from a creature's name or rank.
function verifiedBossNames(db, instanceId) {
  const names = new Set();
  for (const row of db.prepare("SELECT timeline_json, checkpoints_json FROM dungeon_runs WHERE instance_id = ? ORDER BY started_at DESC LIMIT 40").all(instanceId)) {
    let entries = [];
    try { entries = row.checkpoints_json ? JSON.parse(row.checkpoints_json) : JSON.parse(row.timeline_json || "[]"); } catch { entries = []; }
    for (const entry of Array.isArray(entries) ? entries : []) {
      if ((entry.kind === "boss" || entry.kind === "boss_kill") && entry.name && ["encounter_end", "boss_kill"].includes(entry.source)) names.add(normalizedName(entry.name));
    }
  }
  return names;
}

function difficultyNames(db, instanceId) {
  return Object.fromEntries(db.prepare("SELECT DISTINCT difficulty_id, difficulty_name FROM dungeon_runs WHERE instance_id = ? AND difficulty_id IS NOT NULL AND difficulty_name <> ''")
    .all(instanceId).map((row) => [row.difficulty_id, row.difficulty_name]));
}

function instanceFromRow(row) {
  return { instanceId: Number(row.instance_id), name: row.name || `Instance ${row.instance_id}`, type: row.instance_type || null,
    journalInstanceId: row.journal_instance_id ?? null, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at };
}

export function readLootDungeons() {
  return withGuildDatabase((db) => ({
    schemaVersion: 1,
    revision: lootCatalogRevisionInDatabase(db),
    dungeons: db.prepare(`SELECT i.*, COUNT(DISTINCT e.item_id) AS item_count,
        COUNT(DISTINCT CASE WHEN e.source_kind <> 'instance' THEN e.source_kind || ':' || e.source_id END) AS source_count, MAX(e.last_seen_at) AS evidence_at
      FROM dungeon_loot_instances i LEFT JOIN dungeon_loot_entries e ON e.instance_id = i.instance_id AND e.status = 'active'
      GROUP BY i.instance_id ORDER BY i.name COLLATE NOCASE, i.instance_id`).all()
      .map((row) => ({ ...instanceFromRow(row), itemCount: Number(row.item_count), sourceCount: Number(row.source_count), lastEvidenceAt: row.evidence_at || null })),
  }));
}

function changeFromRow(row, item) {
  let detail = {};
  try { detail = JSON.parse(row.detail_json || "{}"); } catch { detail = {}; }
  const facts = row.item_id ? item(row.item_id) : null;
  return { id: Number(row.id), revision: Number(row.revision), at: row.changed_at, kind: row.kind, instanceId: Number(row.instance_id),
    difficultyId: Number(row.difficulty_id), source: { kind: row.source_kind, id: Number(row.source_id), name: row.source_name || null },
    item: facts ? { itemId: facts.itemId, name: facts.name, qualityId: facts.qualityId, iconFileDataId: facts.iconFileDataId } : null,
    provenance: row.provenance, gameBuild: row.game_build || null, detail };
}

// One dungeon: its sources (bosses first), each with its items and the
// evidence behind every item. `wishlisted` marks the item keys on one
// character's wishlist when the caller passes them.
export function readLootDungeonInDatabase(db, instanceId, { wishlisted = new Set() } = {}) {
  const id = gameInteger(instanceId, 1);
  const instanceRow = id ? db.prepare("SELECT * FROM dungeon_loot_instances WHERE instance_id = ?").get(id) : null;
  if (!instanceRow) return null;
  const rows = db.prepare("SELECT * FROM dungeon_loot_entries WHERE instance_id = ? ORDER BY source_kind, source_id, item_id").all(id);
  const item = lootItemFactsInDatabase(db, rows.map((row) => row.item_id));
  const bossNames = verifiedBossNames(db, id);
  for (const row of rows) if (row.source_kind === "encounter" && row.source_name) bossNames.add(normalizedName(row.source_name));

  // A creature the journal (or a reported kill) names is the same boss as
  // the journal's encounter: one group, with both kinds of evidence.
  const groups = new Map();
  for (const row of rows) {
    const name = normalizedName(row.source_name);
    const boss = row.source_kind !== "instance" && Boolean(name) && bossNames.has(name);
    const key = row.source_kind === "instance" ? "unknown" : boss ? `boss:${name}` : `${row.source_kind}:${row.source_id}`;
    const group = groups.get(key) || { key, kind: row.source_kind === "instance" ? "unknown" : boss ? "boss" : "creature", name: null, npcIds: new Set(),
      encounterIds: new Set(), items: new Map() };
    if (row.source_name && (!group.name || row.source_kind === "encounter")) group.name = row.source_name;
    if (row.source_kind === "creature") group.npcIds.add(Number(row.source_id));
    if (row.source_kind === "encounter") group.encounterIds.add(Number(row.source_id));
    group.items.set(row.item_id, [...(group.items.get(row.item_id) || []), entryFromRow(row)]);
    groups.set(key, group);
  }
  const rank = { boss: 0, creature: 1, unknown: 2 };
  const sources = [...groups.values()].map((group) => ({
    key: group.key, kind: group.kind, boss: group.kind === "boss",
    name: group.kind === "unknown" ? null : group.name || (group.npcIds.size ? `Creature ${[...group.npcIds][0]}` : "Unknown source"),
    npcIds: [...group.npcIds], encounterIds: [...group.encounterIds],
    items: [...group.items.entries()].map(([itemId, entries]) => ({ ...item(itemId), ...itemEvidence(entries), wishlisted: wishlisted.has(`i:${itemId}`) }))
      .sort((a, b) => (b.qualityId ?? 0) - (a.qualityId ?? 0) || (b.itemLevel ?? 0) - (a.itemLevel ?? 0) || a.name.localeCompare(b.name)),
  })).sort((a, b) => rank[a.kind] - rank[b.kind] || b.items.length - a.items.length || String(a.name).localeCompare(String(b.name)));

  const changes = db.prepare("SELECT * FROM dungeon_loot_changes WHERE instance_id = ? ORDER BY id DESC LIMIT 25").all(id);
  const changeItem = lootItemFactsInDatabase(db, changes.map((row) => row.item_id).filter(Boolean));
  return { schemaVersion: 1, revision: lootCatalogRevisionInDatabase(db), instance: instanceFromRow(instanceRow), difficulties: difficultyNames(db, id),
    sources, changes: changes.map((row) => changeFromRow(row, changeItem)),
    evidence: { note: "Sightings are loot that was offered, not items anyone received. An item nobody has reported yet can still drop; the journal's list is what the game advertises." } };
}

export function readLootDungeon(instanceId, options) {
  return withGuildDatabase((db) => readLootDungeonInDatabase(db, instanceId, options));
}

// Where each item is known to come from, best evidence first:
// Map(itemId → [{ instanceId, dungeon, source, sourceKind, boss, confidence, difficultyIds }]).
export function lootSourcesForItemsInDatabase(db, itemIds) {
  const ids = [...new Set(itemIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const out = new Map();
  for (let start = 0; start < ids.length; start += 400) {
    const chunk = ids.slice(start, start + 400);
    const grouped = new Map();
    for (const row of db.prepare(`SELECT e.*, i.name AS instance_name FROM dungeon_loot_entries e JOIN dungeon_loot_instances i ON i.instance_id = e.instance_id
      WHERE e.item_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) {
      const name = normalizedName(row.source_name);
      const key = `${row.item_id}|${row.instance_id}|${row.source_kind === "instance" ? "unknown" : name || `${row.source_kind}:${row.source_id}`}`;
      const group = grouped.get(key) || { itemId: row.item_id, instanceId: Number(row.instance_id), dungeon: row.instance_name || `Instance ${row.instance_id}`,
        source: null, sourceKind: row.source_kind, entries: [] };
      if (row.source_name && (!group.source || row.source_kind === "encounter")) group.source = row.source_name;
      if (row.source_kind === "encounter") group.sourceKind = "encounter";
      group.entries.push(entryFromRow(row));
      grouped.set(key, group);
    }
    for (const group of grouped.values()) {
      const { confidence, difficultyIds, evidence } = itemEvidence(group.entries);
      const list = out.get(group.itemId) || [];
      list.push({ instanceId: group.instanceId, dungeon: group.dungeon, source: group.source, sourceKind: group.sourceKind, confidence, difficultyIds,
        sightings: evidence.find((line) => line.provenance === "loot_window")?.evidenceCount || 0 });
      out.set(group.itemId, list);
    }
  }
  // Classic reference sources, for dungeons where the catalog has not
  // observed the item (observed evidence wins). Always candidates.
  for (const id of ids) {
    const observedIn = new Set((out.get(id) || []).map((entry) => entry.instanceId));
    for (const source of referenceSourcesOf(id)) {
      if (observedIn.has(source.instanceId)) continue;
      const list = out.get(id) || [];
      list.push({ instanceId: source.instanceId, dungeon: source.dungeonName, source: source.bossName ?? null, sourceKind: "reference", confidence: "candidate",
        difficultyIds: [], sightings: 0, ...source });
      out.set(id, list);
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence) || b.sightings - a.sightings || a.dungeon.localeCompare(b.dungeon));
  }
  return out;
}

// Catalog items by name across every dungeon, with where each comes from.
export function searchLootItemsInDatabase(db, { q = "", limit = 60, wishlisted = new Set() } = {}) {
  const query = String(q || "").trim().slice(0, 80);
  if (query.length < 2 && !/^\d+$/.test(query)) return { schemaVersion: 1, query, items: [], truncated: false };
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = db.prepare(`SELECT DISTINCT e.item_id FROM dungeon_loot_entries e LEFT JOIN market_item_meta m ON m.item_id = e.item_id
    WHERE m.name LIKE ? ESCAPE '\\' OR CAST(e.item_id AS TEXT) = ? ORDER BY m.name COLLATE NOCASE, e.item_id LIMIT ?`).all(pattern, query, limit + 1);
  const ids = rows.slice(0, limit).map((row) => row.item_id);
  const item = lootItemFactsInDatabase(db, ids);
  const sources = lootSourcesForItemsInDatabase(db, ids);
  return { schemaVersion: 1, query, truncated: rows.length > limit, items: ids.map((id) => {
    const list = sources.get(id) || [];
    return { ...item(id), sources: list, confidence: bestConfidence(list.map((entry) => entry.confidence)), wishlisted: wishlisted.has(`i:${id}`) };
  }) };
}

// The distinct equip slots of each dungeon's active catalog loot, as the
// item records name them (`slot`): instanceId → sorted slot names.
export function lootSlotsByInstanceInDatabase(db) {
  const rows = db.prepare("SELECT DISTINCT instance_id, item_id FROM dungeon_loot_entries WHERE status = 'active'").all();
  const item = lootItemFactsInDatabase(db, rows.map((row) => row.item_id));
  const slots = new Map();
  for (const row of rows) {
    const slot = item(row.item_id).slot;
    if (!slot) continue;
    const id = Number(row.instance_id);
    if (!slots.has(id)) slots.set(id, new Set());
    slots.get(id).add(slot);
  }
  return new Map([...slots].map(([id, set]) => [id, [...set].sort()]));
}

// What changed in the catalog lately, across every dungeon.
export function readLootChanges({ limit = 50 } = {}) {
  return withGuildDatabase((db) => {
    const rows = db.prepare(`SELECT c.*, i.name AS instance_name FROM dungeon_loot_changes c LEFT JOIN dungeon_loot_instances i ON i.instance_id = c.instance_id
      ORDER BY c.id DESC LIMIT ?`).all(Math.min(200, Math.max(1, Number(limit) || 50)));
    const item = lootItemFactsInDatabase(db, rows.map((row) => row.item_id).filter(Boolean));
    return { schemaVersion: 1, revision: lootCatalogRevisionInDatabase(db), changes: rows.map((row) => ({ ...changeFromRow(row, item), dungeon: row.instance_name || null })) };
  });
}
