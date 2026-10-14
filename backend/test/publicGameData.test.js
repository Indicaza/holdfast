import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ingestTelemetry } from '../src/Character/Telemetry/ingestTelemetry.js';
import { withGuildDatabase, migrateGuildDatabase } from '../src/Data/database.js';
import { withHttpApp, memberIds } from '../testSupport/httpHarness.js';
import { gameInteger, gameText, gameLocale, publicItemDefinition, validMobLoot, validGameItem } from '../src/GameData/publicGameDataModel.js';
import { projectPublicGameDataInDatabase, learnPublicItemInDatabase, recordGatheringFactsInDatabase } from '../src/GameData/publicGameDataProjection.js';
import { backfillPublicGameData } from '../src/GameData/backfillPublicGameData.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/guildweaver-${name}.v1.json`, import.meta.url), 'utf8'));
const mob = load('mob-loot');
const definition = load('game-item-definition');
const professions = load('profession-snapshot');
const gathering = load('gathering-loot');
let nonce = 0;
function ingest(envelope, { memberId = memberIds.member, deviceId = 'loot-device', kind = envelope.eventType === 'mob_loot' || envelope.eventType === 'gathering_loot' ? 'event' : 'state', revision = 1 } = {}) {
  nonce += 1;
  return ingestTelemetry({ memberId, deviceId, idempotencyKey: `public-game-${nonce}`, body: {
    kind, revision, streamKey: `${envelope.eventType}:${envelope.payload.observationId || envelope.payload.item?.itemId || 'professions'}`, envelope,
  } });
}
const scope = 'build=70338&locale=en_US';

function changedMob(change = {}, guid = mob.payload.source.guid) {
  const value = structuredClone(mob);
  value.payload = { ...value.payload, ...change, source: { ...value.payload.source, ...change.source, guid } };
  return value;
}

test('validates exact corpse attribution, ignores empty windows, and bounds identifiers', () => {
  assert.equal(validMobLoot({ kind: 'event', envelope: mob }), true);
  assert.equal(validMobLoot({ kind: 'state', envelope: mob }), false);
  for (const change of [{ schemaVersion: 2 }, { activity: 'skinning' }, { outputs: [] }, { outputs: Array(201).fill(mob.payload.outputs[0]) },
    { outputs: [{ itemId: -1, quantity: 1 }] }, { outputs: [{ itemId: 2589, quantity: 0 }] },
    { outputs: [{ itemId: 2589, quantity: 100001 }] }, { outputs: [{ itemId: 2589, quantity: 1.5 }] },
    { source: { npcId: 638 } }, { capture: { attribution: 'target_guess', visibility: 'visible_to_observer', yieldBasis: 'loot_window' } },
  ]) assert.equal(validMobLoot({ kind: 'event', envelope: changedMob(change) }), false, JSON.stringify(change));
  for (const guid of ['Player-1-abc', 'Creature-0-1-36-3-639-xyz', 'GameObject-0-1-36-3-639-000001']) {
    assert.equal(validMobLoot({ kind: 'event', envelope: changedMob({}, guid) }), false);
  }
  assert.equal(validMobLoot({ kind: 'event', envelope: { ...mob, realm: '' } }), false);
  assert.equal(validMobLoot({ kind: 'event', envelope: { ...mob, gameBuild: null } }), false);
  assert.equal(validGameItem({ kind: 'state', envelope: definition, payloadSchemaVersion: 1 }), true);
  assert.equal(validGameItem({ kind: 'event', envelope: definition, payloadSchemaVersion: 1 }), false);
  assert.equal(gameLocale('deDE'), 'de_DE');
  assert.equal(gameLocale('fr_FR'), 'fr_FR');
  assert.equal(gameLocale(null), 'und');
  assert.equal(gameLocale('bad'), 'und');
  for (const value of [null, undefined, '', true, NaN, Infinity, -1, 1.5]) assert.equal(gameInteger(value), null);
  assert.equal(gameInteger(0), 0);
  assert.equal(gameText({ name: 'private' }), '');
  assert.equal(gameText('|cff00ff00|Hitem:2589:0|h[Linen Cloth]|h|r'), '[Linen Cloth]');
  assert.equal(gameText('|Hplayer:PrivatePlayer|hPrivatePlayer|h'), '');
  assert.equal(gameText('Made by PrivatePlayer'), '');
  assert.equal(gameText('Player-1-1234'), '');
  assert.equal(publicItemDefinition({ itemId: 0 }), null);
});

test('public visitor can search and read facts without leaking raw telemetry or player state', () => withHttpApp(async ({ request }) => {
  assert.equal(ingest(mob).handlerName, 'mob_loot');
  const base = structuredClone(definition);
  base.characterId = 'PRIVATE-CHARACTER';
  base.payload.item = { ...base.payload.item, creator: 'PRIVATE-CREATOR',
    durability: { current: 2 }, location: 'PRIVATE-BAG', stats: { ITEM_MOD_STRENGTH_SHORT: 3, PRIVATE_STAT: 9 },
    tooltip: { ...base.payload.item.tooltip, lines: [...base.payload.item.tooltip.lines,
      { left: 'Made by PRIVATE-CREATOR' }, { left: '|Hplayer:PRIVATE-CHARACTER|hPRIVATE-CHARACTER|h' }] } };
  assert.equal(ingest(base).handlerName, 'game_item_definition');
  const privateItem = structuredClone(base);
  privateItem.eventType = 'item_definition';
  privateItem.payload.item.name = 'PRIVATE-INSTANCE-NAME';
  privateItem.payload.item.itemLink = '|Hitem:2589:PRIVATE-ITEM-LINK|hLinen Cloth|h';
  ingest(privateItem);
  const book = structuredClone(professions);
  book.gameBuild = mob.gameBuild;
  book.locale = mob.locale;
  book.payload.professions[0].recipes[0].reagents[0] = { itemId: 2589, name: 'Linen Cloth', quantity: 2, required: true,
    available: 99, itemLink: 'PRIVATE-REAGENT-LINK', tooltip: { lines: [{ left: 'PRIVATE-REAGENT-TOOLTIP' }] } };
  book.payload.professions[0].recipes[0].description = 'PRIVATE-RECIPE-DESCRIPTION';
  ingest(book);
  const scopes = await request('/api/game-data/v1/scopes');
  assert.equal(scopes.status, 200);
  assert.deepEqual(scopes.json.scopes, [{ gameBuild: '70338', locale: 'en_US', itemCount: 2 }]);
  const search = await request(`/api/game-data/v1/items?${scope}&q=linen`);
  assert.equal(search.status, 200);
  assert.equal(search.json.items.length, 1);
  assert.match(search.headers.get('cache-control'), /public/);
  const detail = await request(`/api/game-data/v1/items/2589?${scope}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.item.descriptionBasis, 'base_item_id');
  assert.equal(detail.json.item.tooltipLines.length, 2);
  assert.deepEqual(detail.json.item.stats, { ITEM_MOD_STRENGTH_SHORT: 3 });
  assert.equal(detail.json.sources[0].sourceId, 639);
  assert.equal(detail.json.sources[0].instanceId, 36);
  assert.equal(detail.json.sources[0].observations, 1);
  assert.equal(detail.json.sources[0].observedQuantity, 3);
  assert.equal(detail.json.locations.length, 0);
  assert.equal(detail.json.usedBy[0].recipeId, 2660);
  assert.equal(detail.json.usedBy[0].reagents[0].quantity, 2);
  assert.equal(detail.json.evidence.dropRatesAvailable, false);
  const serialized = JSON.stringify([scopes.json, search.json, detail.json]);
  for (const forbidden of ['PRIVATE-', 'character-rook', 'install-fixture', 'loot-device', 'e2e-member', 'Creature-', 'Classic Beta PvE',
    'memberId', 'deviceId', 'installationId', 'rawCharacterId', 'observationId', 'contributor', 'known', 'craftable', 'cooldown', 'durability', '0.42567']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const crafted = await request(`/api/game-data/v1/items/2862?${scope}`);
  assert.equal(crafted.json.createdBy[0].recipeId, 2660);
  assert.equal(crafted.json.references.find((item) => item.itemId === 2589).name, 'Linen Cloth');
  assert.equal((await request(`/api/game-data/v1/items/2589?${scope}`, { headers: { 'If-None-Match': detail.headers.get('etag'), 'Cache-Control': 'max-age=60' } })).status, 304);
  assert.equal((await request('/api/intelligence/farming/sessions')).status, 401);
}));

test('corpse reopens, transport retries and party reports count once, with max observed quantity', () => withHttpApp(async ({ request }) => {
  ingest(mob); ingest(mob); ingest(mob, { memberId: memberIds.officer, deviceId: 'second-observer' });
  ingest(changedMob({ outputs: [{ ...mob.payload.outputs[0], quantity: 5 }] }), { revision: 2 });
  ingest(mob);
  let data = (await request(`/api/game-data/v1/items/2589?${scope}`)).json;
  assert.equal(data.sources[0].observations, 1);
  assert.equal(data.sources[0].observedQuantity, 5);
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM game_loot_observations').get().n), 1);
  const otherRealm = { ...mob, realm: 'Other realm' };
  ingest(otherRealm);
  data = (await request(`/api/game-data/v1/items/2589?${scope}`)).json;
  assert.equal(data.sources[0].observations, 2);
  const newerBuild = structuredClone(mob); newerBuild.gameBuild.build = '70339'; ingest(newerBuild);
  assert.equal((await request(`/api/game-data/v1/items/2589?${scope}`)).json.sources[0].observations, 2);
  const foreign = structuredClone(mob); foreign.locale = 'deDE'; foreign.payload.source.name = 'Edwin van Cleef'; ingest(foreign);
  assert.equal((await request('/api/game-data/v1/items/2589?build=70338&locale=de_DE')).json.sources[0].observations, 1);
}));

test('publishes map cell centers only with three independent contributors and preserves raw coordinate edges', () => withHttpApp(async ({ request }) => {
  for (let index = 1; index <= 3; index += 1) {
    const value = changedMob({}, `Creature-0-1-36-3-639-00000${index}`);
    value.payload.context.location.x = 0;
    value.payload.context.location.y = 1;
    ingest(value, { memberId: `map-contributor-${index}`, deviceId: `device-${index}` });
    const data = (await request(`/api/game-data/v1/items/2589?${scope}`)).json;
    assert.equal(data.locations.length, index >= 3 ? 1 : 0);
    if (index === 3) assert.deepEqual(data.locations[0], { activity: 'corpse_loot', discipline: 'loot', kind: 'creature', sourceId: 639,
      mapId: 1436, instanceId: 36, difficultyId: 1, positionKind: 'player_at_loot', x: 0.01, y: 0.99, cellSize: 0.02, coordinateSystem: 'ui_map_normalized' });
  }
  const row = withGuildDatabase((db) => db.prepare('SELECT x,y FROM game_loot_observations LIMIT 1').get());
  assert.equal(row.x, 0); assert.equal(row.y, 1);
}));

test('missing, invalid and imprecise coordinates cannot enter public map locations', () => withHttpApp(async ({ request }) => {
  for (const [index, change] of [{ x: -1 }, { y: 2 }, { x: NaN }, { coordinateSystem: 'world' }, { x: null }].entries()) {
    const value = changedMob({}, `Creature-0-1-36-3-639-00000${index}`);
    Object.assign(value.payload.context.location, change);
    ingest(value, { memberId: `contributor-${index}` });
  }
  assert.equal((await request(`/api/game-data/v1/items/2589?${scope}`)).json.locations.length, 0);
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM game_loot_observations WHERE x IS NOT NULL').get().n), 0);
}));

test('gathering and skinning sources stay separate from corpse drops and bag sightings', () => withHttpApp(async ({ request }) => {
  ingest(definition);
  for (const [index, discipline] of ['herbalism', 'skinning'].entries()) {
    const value = structuredClone(gathering);
    value.locale = mob.locale;
    value.payload.observationId = `separate-${index}`;
    value.payload.discipline = discipline;
    value.payload.source = discipline === 'skinning' ? { kind: 'creature', npcId: 639, name: 'Edwin VanCleef' } : value.payload.source;
    value.payload.outputs = [mob.payload.outputs[0]];
    ingest(value);
  }
  ingest(mob);
  const data = (await request(`/api/game-data/v1/items/2589?${scope}`)).json;
  assert.equal(data.sources.length, 3);
  assert.deepEqual(new Set(data.sources.map((entry) => entry.discipline)), new Set(['loot', 'herbalism', 'skinning']));
}));

test('catalog query bounds, search escaping and stable cursor pagination', () => withHttpApp(async ({ request }) => {
  for (let index = 1; index <= 3; index += 1) {
    const value = structuredClone(definition); value.payload.item.itemId = index; value.payload.reference = `item:${index}`; value.payload.item.name = `Test item ${index}`; ingest(value);
  }
  const page = (await request(`/api/game-data/v1/items?${scope}&limit=2`)).json;
  assert.deepEqual(page.items.map((item) => item.itemId), [1, 2]);
  assert.equal(page.nextAfter, 2);
  const last = (await request(`/api/game-data/v1/items?${scope}&limit=2&after=2`)).json;
  assert.deepEqual(last.items.map((item) => item.itemId), [3]); assert.equal(last.nextAfter, null);
  assert.equal((await request(`/api/game-data/v1/items?${scope}&q=2`)).json.items[0].itemId, 2);
  assert.equal((await request(`/api/game-data/v1/items?${scope}&q=%25`)).json.items.length, 0);
  for (const query of ['', 'build=x', `${scope}&limit=0`, `${scope}&limit=101`, `${scope}&after=-1`, `${scope}&after=1.5`,
    `${scope}&q=a&q=b`, `${scope}&q=${'a'.repeat(101)}`, 'build=x&locale=bad', 'build=x%27&locale=en_US']) {
    assert.equal((await request(`/api/game-data/v1/items?${query}`)).status, 400, query);
  }
  assert.equal((await request(`/api/game-data/v1/items/0?${scope}`)).status, 400);
  assert.equal((await request(`/api/game-data/v1/items/nope?${scope}`)).status, 400);
  assert.equal((await request('/api/game-data/v1/items/1')).status, 400);
  assert.equal((await request(`/api/game-data/v1/items/999?${scope}`)).status, 404);
  assert.equal((await request('/api/game-data/v1/items?build=missing&locale=und')).json.items.length, 0);
  assert.equal((await request(`/api/game-data/v1/items?${scope}`, { method: 'POST', body: {} })).status, 404);
}));

test('newer base definitions and recipes survive sparse or stale reports; unknown schemas are rejected atomically', () => withHttpApp(async () => {
  const fresh = structuredClone(definition); fresh.capturedAt += 100; fresh.payload.item.name = 'New Linen'; ingest(fresh);
  ingest(definition); ingest(mob);
  const current = withGuildDatabase((db) => db.prepare('SELECT * FROM public_game_items WHERE item_id=2589').get());
  assert.equal(JSON.parse(current.definition_json).name, 'New Linen');
  assert.equal(current.name, 'New Linen');
  const book = structuredClone(professions); book.locale = 'enUS'; book.gameBuild = mob.gameBuild; ingest(book);
  const stale = structuredClone(book); stale.capturedAt -= 100; stale.payload.professions[0].recipes[0].name = 'Stale';
  withGuildDatabase((db) => projectPublicGameDataInDatabase(db, { eventType: 'profession_snapshot', envelope: stale }));
  assert.notEqual(withGuildDatabase((db) => db.prepare('SELECT name FROM public_game_recipes').get().name), 'Stale');
  const count = withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM guildweaver_telemetry_records').get().n);
  assert.equal(ingest(changedMob({ schemaVersion: 2 })).status, 'invalid');
  assert.equal(ingest({ ...definition, payloadSchemaVersion: 2 }).status, 'invalid');
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM guildweaver_telemetry_records').get().n), count);
  withGuildDatabase((db) => {
    learnPublicItemInDatabase(db, { itemId: 0 }, { gameBuild: '70338', locale: 'en_US' });
    recordGatheringFactsInDatabase(db, -1);
    projectPublicGameDataInDatabase(db, { eventType: 'game_item_definition', envelope: { gameBuild: null, payload: {} } });
    db.exec("CREATE TRIGGER reject_loot BEFORE INSERT ON game_loot_outputs BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  });
  assert.throws(() => ingest(changedMob({}, 'Creature-0-1-36-3-639-abcdef')), /blocked/);
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM game_loot_observations').get().n), 1);
}));

test('migration is additive and one-time backfill learns only whitelisted old facts', () => withHttpApp(async () => {
  ingest(gathering); ingest({ ...professions, locale: 'enUS' });
  const result = withGuildDatabase((db) => {
    db.exec("DELETE FROM app_meta WHERE key = 'public_game_facts_backfill_v1'; DELETE FROM game_loot_observations; DELETE FROM public_game_items; DELETE FROM public_game_recipes");
    return backfillPublicGameData();
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.observations, 1); assert.equal(result.states, 1);
  assert.equal(backfillPublicGameData().status, 'already-complete');
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM public_game_items').get().n), 4);
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT locale FROM game_loot_observations').get().locale), 'und');
  const db = new DatabaseSync(':memory:');
  try {
    migrateGuildDatabase(db, { throughVersion: 10 });
    db.prepare("INSERT INTO app_meta (key,value,updated_at) VALUES ('private','preserved','2026')").run();
    migrateGuildDatabase(db);
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='private'").get().value, 'preserved');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_game_items').get().n, 0);
  } finally { db.close(); }
}));


test('cross-device stale base scans and partial recipe books cannot downgrade richer facts', () => withHttpApp(async ({ request }) => {
  const fresh = structuredClone(definition); fresh.capturedAt += 100; fresh.payload.item.name = 'Fresh Linen'; fresh.payload.item.qualityId = 2;
  ingest(fresh);
  ingest(definition, { memberId: memberIds.officer, deviceId: 'stale-client' });
  let data = (await request(`/api/game-data/v1/items/2589?${scope}`)).json;
  assert.equal(data.item.name, 'Fresh Linen'); assert.equal(data.item.qualityId, 2);
  const book = structuredClone(professions); book.gameBuild = mob.gameBuild; book.locale = 'enUS'; ingest(book);
  const partial = structuredClone(book); partial.capturedAt += 10; partial.payload.professions[0].recipes[0].reagents = [];
  ingest(partial);
  data = (await request(`/api/game-data/v1/items/2862?${scope}`)).json;
  assert.equal(data.createdBy[0].reagents[0].itemId, 2835);
  const copiedSlot = changedMob({ outputs: [mob.payload.outputs[0], mob.payload.outputs[0]] });
  assert.equal(ingest(copiedSlot).status, 'invalid');
  for (const change of [{ basis: 'bag_item' }, { reference: 'item:2589:1234' }, { item: { ...definition.payload.item, itemLink: 'item:2589' } },
    { item: { ...definition.payload.item, tooltip: { ...definition.payload.item.tooltip, method: 'SetBagItem' } } }]) {
    assert.equal(ingest({ ...definition, payload: { ...definition.payload, ...change } }).status, 'invalid');
  }
}));

test('large item relationships have deterministic bounds and honest truncation flags', () => withHttpApp(async ({ request }) => {
  for (let index = 1; index <= 52; index += 1) {
    const value = changedMob({ source: { npcId: index, name: `Creature ${index}` } }, `Creature-0-1-36-3-${index}-abcdef`);
    ingest(value);
  }
  const book = structuredClone(professions); book.gameBuild = mob.gameBuild; book.locale = 'enUS';
  book.payload.professions[0].recipes = Array.from({ length: 52 }, (_, index) => ({ ...book.payload.professions[0].recipes[0],
    recipeId: 1000 + index, crafted: { itemId: 2589, name: 'Linen Cloth' }, reagents: [{ itemId: 2589, quantity: 1 }] }));
  ingest(book);
  const result = (await request(`/api/game-data/v1/items/2589?${scope}`)).json;
  assert.equal(result.sources.length, 50); assert.equal(result.createdBy.length, 50); assert.equal(result.usedBy.length, 50);
  assert.deepEqual(result.truncated, { sources: true, createdBy: true, usedBy: true });
}));


test('public icons resolve only observed static file IDs without opening private media routes', () => {
  let mode = 'ready';
  let calls = 0;
  return withHttpApp(async ({ request }) => {
    ingest(definition);
    const icon = await request('/api/game-data/v1/icons/132889');
    assert.equal(icon.status, 302); assert.equal(icon.headers.get('location'), 'https://render.worldofwarcraft.com/icon.png');
    assert.equal((await request('/api/game-data/v1/icons/0')).status, 400);
    assert.equal((await request('/api/game-data/v1/icons/nope')).status, 400);
    assert.equal((await request('/api/game-data/v1/icons/999')).status, 404);
    assert.equal(calls, 1);
    mode = 'missing'; assert.equal((await request('/api/game-data/v1/icons/132889')).status, 404);
    mode = 'error'; assert.equal((await request('/api/game-data/v1/icons/132889')).status, 404);
    assert.equal((await request('/api/intelligence/media/icon/132889')).status, 401);
  }, { publicGameDataOptions: { iconMediaResolver: { resolve() { calls += 1; if (mode === 'error') throw new Error('offline'); return mode === 'ready' ? 'https://render.worldofwarcraft.com/icon.png' : null; } } } });
});


test('malformed source GUIDs return domain errors and backfill cannot publish a legacy instance scan', () => withHttpApp(async () => {
  for (const source of [{ kind: 'creature', npcId: 639 }, { kind: 'creature', npcId: 639, guid: null }, null, {}]) {
    const value = structuredClone(mob); value.payload.source = source;
    assert.equal(ingest(value).status, 'invalid');
  }
  const instance = structuredClone(definition); instance.payload.item.itemLink = 'item:2589:1234';
  withGuildDatabase((db) => projectPublicGameDataInDatabase(db, { eventType: 'game_item_definition', envelope: instance }));
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM public_game_items').get().n), 0);
}));
