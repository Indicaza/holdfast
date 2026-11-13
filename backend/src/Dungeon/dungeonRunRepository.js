import { withGuildDatabase } from "../Data/database.js";
import { clientMarketKey } from "../Market/marketModel.js";
import { itemsInDatabase, readPricesInDatabase } from "../Market/marketRepository.js";
import { serverKeySql } from "../Player/playerServers.js";
import { buildComparisons, deriveCheckpoints, referenceClear } from "./dungeonRunInsights.js";
import { FINAL_DUNGEON_STATUSES, MAX_CHECKPOINTS, MAX_TIMELINE, dungeonRunKey, luaList, xpPerHour } from "./dungeonRunModel.js";

function text(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function int(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function flag(value) {
  return value === true ? 1 : 0;
}

// Stores the newest state of a run. Updates are idempotent and ordered by
// the addon's sequence: a retry, an older checkpoint, or anything arriving
// after the run finished changes nothing, so a reload or a re-send can never
// reopen a finished run or create a second row for it.
export function recordDungeonRunInDatabase(db, { envelope, memberId, receivedAt }) {
  const p = envelope.payload;
  const key = dungeonRunKey(memberId, envelope.installationId, p.runId);
  const instance = p.instance || {};
  const character = p.character || {};
  const group = p.group || {};
  const timeline = (luaList(p.timeline ?? []) || []).slice(0, MAX_TIMELINE).map((entry) => ({
    at: entry.at, kind: entry.kind,
    ...(entry.name ? { name: text(entry.name, 120) } : {}),
    ...(int(entry.encounterId) ? { encounterId: entry.encounterId } : {}),
    ...(int(entry.level) ? { level: entry.level } : {}),
    ...(entry.source ? { source: text(entry.source, 40) } : {}),
  }));
  const schemaVersion = p.schemaVersion === 2 ? 2 : 1;
  const checkpoints = schemaVersion === 2
    ? (luaList(p.checkpoints ?? []) || []).slice(0, MAX_CHECKPOINTS).map((entry) => ({
      id: text(entry.id, 80), kind: entry.kind, at: entry.at,
      ...(entry.name ? { name: text(entry.name, 120) } : {}),
      ...(int(entry.encounterId) ? { encounterId: entry.encounterId } : {}),
      ...(entry.source ? { source: text(entry.source, 40) } : {}),
    }))
    : null;
  const values = {
    run_key: key, run_id: p.runId, member_id: text(memberId), installation_id: text(envelope.installationId),
    raw_character_id: text(envelope.characterId, 240), sequence: p.sequence, status: p.status,
    end_reason: p.status === "open" ? "" : text(p.endReason, 60), started_at: p.startedAt,
    ended_at: p.status === "open" ? null : p.endedAt, last_active_at: int(p.lastActiveAt),
    duration_seconds: p.durationSeconds, inside_seconds: int(p.insideSeconds),
    instance_name: text(instance.name, 120) || "Unknown instance", instance_id: int(instance.instanceId),
    instance_type: instance.type, difficulty_id: int(instance.difficultyId), difficulty_name: text(instance.difficultyName, 60),
    max_players: int(instance.maxPlayers), level_at_entry: int(character.levelAtEntry), level_at_exit: int(character.levelAtExit),
    class_token: text(character.classToken, 40), group_size: int(group.sizeAtEntry), group_max_size: int(group.maxSize),
    xp_available: flag(p.xp.available), xp_at_level_cap: flag(p.xp.atLevelCap),
    xp_gained: p.xp.available && !p.xp.atLevelCap ? int(p.xp.gained) : null, level_ups: int(p.xp.levelUps) || 0,
    wallet_available: flag(p.wallet.available), net_copper: p.wallet.available ? int(p.wallet.netCopper) : null,
    deaths: p.deaths, bosses_defeated: p.bosses.defeated, bosses_total: int(p.bosses.total),
    manual_splits: int(p.bosses.manualSplits) || 0, encounter_events: flag(p.bosses.encounterEvents),
    loot_observations: int(p.loot?.observations) || 0, timeline_json: JSON.stringify(timeline),
    timeline_truncated: flag(p.timelineTruncated), realm: text(envelope.realm), region: text(envelope.region, 40),
    game_build: text(envelope.gameBuild?.build, 40), captured_at: int(envelope.capturedAt) || 0, received_at: receivedAt,
    schema_version: schemaVersion, checkpoints_json: checkpoints ? JSON.stringify(checkpoints) : null,
    completion_basis: schemaVersion === 2 && p.completion?.basis ? p.completion.basis : null, xp_partial: flag(p.xp.partial),
  };
  const columns = Object.keys(values);
  const updatable = columns.filter((column) => !["run_key", "run_id", "member_id", "installation_id",
    "raw_character_id", "started_at"].includes(column));
  const result = db.prepare(`
    INSERT INTO dungeon_runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
    ON CONFLICT(run_key) DO UPDATE SET ${updatable.map((column) => `${column} = excluded.${column}`).join(", ")}
    WHERE excluded.sequence > dungeon_runs.sequence AND dungeon_runs.status = 'open'
      AND excluded.raw_character_id = dungeon_runs.raw_character_id
      AND excluded.started_at = dungeon_runs.started_at
  `).run(...columns.map((column) => values[column]));
  return { status: result.changes ? "updated" : "duplicate", runChanged: Boolean(result.changes), final: FINAL_DUNGEON_STATUSES.has(p.status) };
}

// Links a loot observation recorded during a run to that run. Only the
// link is stored; the loot itself stays where it already is.
export function linkDungeonRunLootInDatabase(db, { envelope, memberId, source, observationId }) {
  const runId = envelope?.payload?.context?.dungeonRun?.runId;
  if (typeof runId !== "string" || !/^[\w:-]{1,160}$/.test(runId) || !Number.isSafeInteger(observationId)) return false;
  const key = dungeonRunKey(memberId, envelope.installationId, runId);
  return db.prepare(`INSERT OR IGNORE INTO dungeon_run_loot (run_key, member_id, source, observation_id) VALUES (?, ?, ?, ?)`)
    .run(key, text(memberId), source, observationId).changes > 0;
}

// Addon character ids resolve to the website character through the
// account's own aliases, so a run only ever names its owner's character.
function characterNames(db, memberId) {
  const names = new Map();
  if (!tableExists(db, "guildweaver_character_aliases")) return names;
  const cards = tableExists(db, "character_cards");
  for (const row of db.prepare(`
    SELECT a.raw_character_id, a.character_id,
      ${cards ? "COALESCE(NULLIF(k.name, ''), a.character_name)" : "a.character_name"} AS name,
      ${cards ? "k.race" : "''"} AS race
    FROM guildweaver_character_aliases a ${cards ? "LEFT JOIN character_cards k ON k.character_id = a.character_id" : ""}
    WHERE a.member_id = ? ORDER BY a.last_seen_at DESC
  `).all(memberId)) {
    if (!names.has(row.raw_character_id)) names.set(row.raw_character_id, { id: row.character_id, name: row.name || null, race: row.race || "" });
  }
  return names;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function runFromRow(row, names) {
  const character = names.get(row.raw_character_id) || { id: null, name: null };
  const durationSeconds = Number(row.duration_seconds);
  const xpAvailable = row.xp_available === 1;
  const atLevelCap = row.xp_at_level_cap === 1;
  const xpGained = row.xp_gained === null ? null : Number(row.xp_gained);
  const partial = row.xp_partial === 1;
  return {
    id: Number(row.id), runId: row.run_id, status: row.status, endReason: row.end_reason || null,
    schemaVersion: Number(row.schema_version) || 1, sequence: Number(row.sequence),
    startedAt: Number(row.started_at), endedAt: row.ended_at === null ? null : Number(row.ended_at),
    durationSeconds, insideSeconds: row.inside_seconds === null ? null : Number(row.inside_seconds),
    dungeon: { name: row.instance_name, instanceId: row.instance_id, type: row.instance_type,
      difficultyId: row.difficulty_id, difficultyName: row.difficulty_name || null, maxPlayers: row.max_players },
    character: { id: character.id || row.raw_character_id, linked: Boolean(character.id), name: character.name, classToken: row.class_token || null,
      levelAtEntry: row.level_at_entry, levelAtExit: row.level_at_exit },
    realm: row.realm, region: row.region, build: row.game_build, groupSize: row.group_size, groupMaxSize: row.group_max_size,
    // XP/hour is XP gained over the run's elapsed online time (time inside
    // plus time outside between leaving and coming back; offline time never
    // counts). Not shown for a multi-level jump the client could not measure.
    xp: { available: xpAvailable, atLevelCap, gained: xpGained, levelUps: Number(row.level_ups) || 0, partial,
      perHour: partial ? null : xpPerHour({ xpAvailable, atLevelCap, xpGained, durationSeconds }), perHourBasis: "elapsed_online" },
    wallet: { basis: "wallet_delta", available: row.wallet_available === 1, netCopper: row.net_copper === null ? null : Number(row.net_copper) },
    deaths: Number(row.deaths),
    bosses: { defeated: Number(row.bosses_defeated), total: row.bosses_total, manualSplits: Number(row.manual_splits),
      encounterEvents: row.encounter_events === 1 },
    completionBasis: row.completion_basis || null,
    lootObservations: Number(row.loot_observations),
    receivedAt: row.received_at,
  };
}

const LIST_COLUMNS = `id, run_id, status, end_reason, sequence, started_at, ended_at, duration_seconds, inside_seconds, instance_name, instance_id,
  instance_type, difficulty_id, difficulty_name, max_players, level_at_entry, level_at_exit, class_token, group_size, group_max_size, xp_available,
  xp_at_level_cap, xp_gained, level_ups, wallet_available, net_copper, deaths, bosses_defeated, bosses_total, manual_splits, encounter_events,
  loot_observations, realm, region, game_build, received_at, raw_character_id`;

function v2Columns(db) {
  return columnExists(db, "dungeon_runs", "schema_version") ? ", schema_version, completion_basis, xp_partial" : "";
}

// A website character id covers every raw addon id linked to it.
function rawIdsFor(names, character) {
  const wanted = text(character, 240);
  const raw = [...names.entries()].filter(([, value]) => value.id === wanted).map(([rawId]) => rawId);
  raw.push(wanted);
  return raw;
}

// Every run of the player in scope (no date or status filter), for personal
// bests and typical values. Bounded; a player's own runs only.
const COMPARISON_LIMIT = 5000;

// The signed-in player's own runs, newest first, with how each compares
// to the same character's other runs of the same dungeon and difficulty.
// Every read is scoped to one account; there is no read of anyone else's.
export function readDungeonRuns({ memberId, server = "", character = "", realm = "", dungeon = "", from = "", to = "", status = "", limit = 100 } = {}) {
  const member = text(memberId);
  return withGuildDatabase((db) => {
    const empty = { runs: [], comparisons: [], filters: { characters: [], realms: [], dungeons: [] }, lastReceivedAt: null };
    if (!tableExists(db, "dungeon_runs")) return empty;
    const names = characterNames(db, member);
    const scope = ["member_id = ?"];
    const params = [member];
    if (server) { scope.push(`${serverKeySql("dungeon_runs")} = ?`); params.push(server); }
    if (text(realm)) { scope.push("realm = ?"); params.push(text(realm)); }
    if (text(dungeon)) { scope.push("instance_name = ?"); params.push(text(dungeon, 120)); }
    if (text(character)) {
      const raw = rawIdsFor(names, character);
      scope.push(`raw_character_id IN (${raw.map(() => "?").join(", ")})`);
      params.push(...raw);
    }
    const columns = LIST_COLUMNS + v2Columns(db);
    const inScope = db.prepare(`SELECT ${columns} FROM dungeon_runs WHERE ${scope.join(" AND ")} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(...params, COMPARISON_LIMIT).map((row) => runFromRow(row, names));
    const { marks, groups } = buildComparisons(inScope);

    const fromSeconds = Date.parse(text(from, 40));
    const toText = text(to, 40);
    const toSeconds = Date.parse(toText);
    // A date without a time means the whole day.
    const toLimit = Number.isFinite(toSeconds) ? Math.floor(toSeconds / 1000) + (/^\d{4}-\d{2}-\d{2}$/.test(toText) ? 86400 : 1) : null;
    const wantStatus = text(status, 20);
    const cappedLimit = Math.min(200, Math.max(1, Math.trunc(Number(limit)) || 100));
    const runs = inScope.filter((run) => {
      if (Number.isFinite(fromSeconds) && run.startedAt < Math.floor(fromSeconds / 1000)) return false;
      if (toLimit !== null && run.startedAt >= toLimit) return false;
      if (wantStatus === "completed" && run.status !== "completed") return false;
      if (wantStatus === "incomplete" && run.status === "completed") return false;
      return true;
    }).slice(0, cappedLimit).map((run) => ({ ...run, marks: marks.get(run.id) || null }));

    const all = db.prepare("SELECT DISTINCT raw_character_id, realm, instance_name FROM dungeon_runs WHERE member_id = ?").all(member);
    const characters = new Map();
    for (const row of all) {
      const known = names.get(row.raw_character_id);
      const id = known?.id || row.raw_character_id;
      if (!characters.has(id)) characters.set(id, { id, name: known?.name || null });
    }
    const last = db.prepare("SELECT MAX(received_at) AS at FROM dungeon_runs WHERE member_id = ?").get(member);
    return {
      runs,
      comparisons: groups,
      lastReceivedAt: last?.at || null,
      truncated: inScope.length >= COMPARISON_LIMIT,
      filters: {
        characters: [...characters.values()].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))),
        realms: [...new Set(all.map((row) => row.realm).filter(Boolean))].sort(),
        dungeons: [...new Set(all.map((row) => row.instance_name).filter(Boolean))].sort(),
      },
    };
  });
}

// Alliance and Horde races as the client names them (race name or token).
const ALLIANCE = new Set(["human", "dwarf", "night elf", "nightelf", "gnome", "draenei", "worgen"]);
const HORDE = new Set(["orc", "undead", "scourge", "tauren", "troll", "blood elf", "bloodelf", "goblin"]);

export function factionForRace(race) {
  const value = String(race || "").trim().toLowerCase();
  if (ALLIANCE.has(value)) return "alliance";
  if (HORDE.has(value)) return "horde";
  return "";
}

// The auction house a run's loot is valued on: the character's own
// faction house on the run's realm. Never another realm's or faction's.
function marketForRun(db, run, race) {
  const faction = factionForRace(race);
  if (!faction) return { marketKey: null, reason: "The character's faction is not known yet, so no auction house is chosen." };
  const key = clientMarketKey({ region: run.region, realm: run.realm, faction });
  if (!key) return { marketKey: null, reason: "This run has no realm to find its auction house." };
  const row = tableExists(db, "market_markets") ? db.prepare("SELECT market_key, name, realm, faction FROM market_markets WHERE market_key = ?").get(key) : null;
  if (!row) return { marketKey: key, known: false, faction, reason: `No auction data for ${run.realm} (${faction}) yet.` };
  return { marketKey: row.market_key, known: true, name: row.name, realm: row.realm || run.realm, faction: row.faction || faction };
}

// Loot linked to a run, one row per item: how many were seen in loot
// windows (corpses: what was offered, which in a group may have gone to
// someone else) and how many came from the player's own gathering. Item
// facts and tooltips come from the shared item catalog in one batch, and
// prices from the run's own auction house in one more: nothing per item.
function runLootInDatabase(db, row, member, run, race) {
  const items = new Map();
  const add = (itemId, name, quantity, source) => {
    const entry = items.get(itemId) || { itemId, name: name || null, quantity: 0, observedQuantity: 0, gatheredQuantity: 0 };
    const amount = Number(quantity) || 0;
    entry.quantity += amount;
    if (source === "mob_loot") entry.observedQuantity += amount;
    else entry.gatheredQuantity += amount;
    entry.name = entry.name || name || null;
    items.set(itemId, entry);
  };
  for (const item of db.prepare(`
    SELECT o.item_id, SUM(o.quantity) AS quantity
    FROM dungeon_run_loot l JOIN game_loot_outputs o ON o.observation_id = l.observation_id
    WHERE l.run_key = ? AND l.member_id = ? AND l.source = 'mob_loot' GROUP BY o.item_id
  `).all(row.run_key, member)) add(item.item_id, null, item.quantity, "mob_loot");
  for (const item of db.prepare(`
    SELECT o.item_id, MAX(o.item_name) AS name, SUM(o.quantity) AS quantity
    FROM dungeon_run_loot l JOIN economic_observation_outputs o ON o.observation_id = l.observation_id
    JOIN economic_observations e ON e.id = l.observation_id AND e.member_id = l.member_id
    WHERE l.run_key = ? AND l.member_id = ? AND l.source = 'gathering' AND o.item_id IS NOT NULL GROUP BY o.item_id
  `).all(row.run_key, member)) add(item.item_id, item.name, item.quantity, "gathering");
  const linked = db.prepare("SELECT source, COUNT(*) AS n FROM dungeon_run_loot WHERE run_key = ? AND member_id = ? GROUP BY source").all(row.run_key, member);
  const counts = Object.fromEntries(linked.map((entry) => [entry.source, Number(entry.n)]));
  const list = [...items.values()].sort((a, b) => b.quantity - a.quantity || a.itemId - b.itemId).slice(0, 100);

  const market = marketForRun(db, run, race);
  const ids = list.map((entry) => entry.itemId);
  const facts = ids.length && tableExists(db, "market_item_meta") ? itemsInDatabase(db, ids) : null;
  const prices = ids.length && market.known ? readPricesInDatabase(db, { marketKey: market.marketKey, itemIds: ids }) : new Map();
  let estimatedCopper = 0;
  let vendorCopper = 0;
  let priced = 0;
  let stale = 0;
  let vendorKnown = 0;
  const enriched = list.map((entry) => {
    const known = facts ? facts(entry.itemId) : {};
    const price = prices.get(entry.itemId) || null;
    const unit = price && !price.variantsOnly ? (price.minUnitBuyout ?? price.typicalUnitBuyout ?? null) : null;
    if (unit !== null) {
      priced += 1;
      estimatedCopper += unit * entry.quantity;
      if (price.stale) stale += 1;
    }
    if (Number(known.sellPrice) > 0) {
      vendorKnown += 1;
      vendorCopper += Number(known.sellPrice) * entry.quantity;
    }
    return {
      itemId: entry.itemId,
      itemKey: `i:${entry.itemId}`,
      quantity: entry.quantity,
      observedQuantity: entry.observedQuantity,
      gatheredQuantity: entry.gatheredQuantity,
      // Catalog identity for ItemLabel and the game tooltip.
      name: known.nameKnown ? known.name : (entry.name || known.name || null),
      nameKnown: Boolean(known.nameKnown || entry.name),
      qualityId: known.qualityId ?? null,
      iconFileDataId: known.iconFileDataId ?? null,
      itemLevel: known.itemLevel ?? null,
      requiredLevel: known.requiredLevel ?? null,
      itemClass: known.itemClass ?? null,
      itemSubclass: known.itemSubclass ?? null,
      slotName: known.slotName || null,
      sellPrice: known.sellPrice ?? null,
      bindType: known.bindType ?? null,
      tooltip: { lines: known.tooltipLines || [], source: known.tooltipSource || null, gameBuild: known.tooltipBuild || null },
      price,
      unitPrice: unit,
    };
  });
  return {
    observations: Object.values(counts).reduce((sum, value) => sum + value, 0),
    corpseObservations: counts.mob_loot || 0,
    gatheringObservations: counts.gathering || 0,
    items: enriched,
    market,
    // Kept apart on purpose: none of these is profit, and none is added to
    // the wallet change.
    value: {
      basis: "loot_window",
      itemsObserved: enriched.reduce((sum, entry) => sum + entry.quantity, 0),
      distinctItems: enriched.length,
      // Loot windows say what was offered, not what reached the bags; the
      // add-on records no proof of acquisition yet.
      confirmedAcquired: null,
      confirmedAcquiredReason: "Not recorded: a loot window shows what was offered, and in a group an item can go to someone else.",
      estimatedAuctionCopper: priced ? estimatedCopper : null,
      pricedItems: priced,
      unpricedItems: enriched.length - priced,
      stalePrices: stale,
      vendorCopper: vendorKnown ? vendorCopper : null,
      vendorKnownItems: vendorKnown,
      realizedRevenueCopper: null,
      realizedRevenueReason: "No sale evidence is recorded for these items.",
    },
  };
}

function checkpointsFor(row) {
  const stored = parseJson(row.checkpoints_json, null);
  if (Array.isArray(stored)) return { list: stored, basis: "addon" };
  return { list: deriveCheckpoints(parseJson(row.timeline_json, [])), basis: "timeline" };
}

// One run with its timeline, checkpoints, the personal best it is paced
// against, and the loot linked to it, or null when it is not this
// account's.
export function readDungeonRun({ memberId, id }) {
  const member = text(memberId);
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId < 1) return null;
  return withGuildDatabase((db) => {
    if (!tableExists(db, "dungeon_runs")) return null;
    const row = db.prepare("SELECT * FROM dungeon_runs WHERE id = ? AND member_id = ?").get(runId, member);
    if (!row) return null;
    const names = characterNames(db, member);
    const run = runFromRow(row, names);
    run.timeline = parseJson(row.timeline_json, []);
    run.timelineTruncated = row.timeline_truncated === 1;
    const checkpoints = checkpointsFor(row);
    run.checkpoints = checkpoints.list;
    run.checkpointBasis = checkpoints.basis;

    // The same character's runs of the same dungeon and difficulty.
    const raw = run.character.linked ? rawIdsFor(names, run.character.id) : [row.raw_character_id];
    const siblings = db.prepare(`SELECT ${LIST_COLUMNS}${v2Columns(db)}, checkpoints_json, timeline_json FROM dungeon_runs
      WHERE member_id = ? AND instance_name = ? AND raw_character_id IN (${raw.map(() => "?").join(", ")}) ORDER BY started_at DESC LIMIT ?`)
      .all(member, row.instance_name, ...raw, COMPARISON_LIMIT);
    const group = siblings.map((entry) => runFromRow(entry, names));
    const { marks, groups } = buildComparisons(group);
    run.marks = marks.get(run.id) || null;
    run.comparison = groups.find((entry) => entry.key === run.marks?.group) || null;
    const reference = referenceClear(run, group);
    if (reference) {
      const referenceRow = siblings.find((entry) => Number(entry.id) === reference.id);
      const referenceCheckpoints = checkpointsFor(referenceRow);
      run.reference = { id: reference.id, startedAt: reference.startedAt, durationSeconds: reference.durationSeconds,
        completion: marks.get(reference.id)?.completion || null, checkpoints: referenceCheckpoints.list, checkpointBasis: referenceCheckpoints.basis };
    } else {
      run.reference = null;
    }
    run.sync = { receivedAt: row.received_at, sequence: Number(row.sequence), schemaVersion: run.schemaVersion, capturedAt: Number(row.captured_at) || null };
    run.loot = runLootInDatabase(db, row, member, run, names.get(row.raw_character_id)?.race || "");
    return run;
  });
}
