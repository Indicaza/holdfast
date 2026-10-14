import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ingestTelemetry } from '../src/Character/Telemetry/ingestTelemetry.js';
import { validFarmingSession, farmingSessionQuality, farmingSessionCoverage, FARMING_SYNC_GRACE_SECONDS } from '../src/Economy/farmingSessionModel.js';
import { readFarmingSessions, readFarmingLocations } from '../src/Economy/farmingSessionRepository.js';
import { economicObservationFromTelemetry } from '../src/Economy/economicObservationModel.js';
import { withGuildDatabase, migrateGuildDatabase } from '../src/Data/database.js';
import { withHttpApp, memberIds } from '../testSupport/httpHarness.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/guildweaver-gathering-loot.v1.json', import.meta.url), 'utf8'));
const start = 1791761400;

test('migration 10 preserves existing v9 gathering locations and facts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateGuildDatabase(db, { throughVersion: 9 });
    db.prepare(`INSERT INTO economic_observations
      (observation_key,event_type,discipline,source_key,captured_at,received_at,map_id,x,y)
      VALUES ('old','gathering_loot','mining','mining:ore-vein:copper','2026-10-13','2026-10-13',1431,0.42,0.58)`).run();
    migrateGuildDatabase(db);
    const row = db.prepare('SELECT * FROM economic_observations').get();
    assert.equal(row.observation_key, 'old');
    assert.equal(row.x, 0.42);
    assert.equal(row.y, 0.58);
    assert.equal(row.farming_session_key, '');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM farming_sessions').get().n, 0);
  } finally { db.close(); }
});
let nonce = 0;
function session(overrides = {}, identity = {}) {
  return { ...structuredClone(fixture), ...identity, eventType: 'farming_session', capturedAt: start + 1800,
    payload: { schemaVersion: 1, sessionId: 'farm-test', sequence: 3, mode: 'manual', status: 'complete', endReason: 'stopped',
      startedAt: start, endedAt: start + 1800, durationSeconds: 1800, afkAvailable: true, afkSeconds: 300,
      gatheringCount: 10, classToken: 'DRUID', yieldBasis: 'loot_window', location: { zone: 'Duskwood', mapId: 1431 }, ...overrides } };
}
function record(envelope, { memberId = memberIds.member, deviceId = 'farm-device' } = {}) {
  nonce += 1;
  return ingestTelemetry({ memberId, deviceId, idempotencyKey: `farming-${nonce}`,
    body: { kind: 'event', revision: envelope.payload.sequence || 1,
      streamKey: `${envelope.eventType}:${envelope.payload.sessionId || envelope.payload.observationId}`, envelope } });
}
function gather(index, sessionId = 'farm-test', options = {}) {
  const envelope = structuredClone(fixture);
  envelope.capturedAt = start + index * 120;
  envelope.payload.observationId = `${sessionId}-${index}`;
  envelope.payload.context.farming = { sessionId, mode: 'manual' };
  envelope.payload.context.location = { mapId: 1431, zone: 'Duskwood', x: 0, y: 1, positionKind: 'player_at_cast', coordinateSystem: 'ui_map_normalized', ...options.location };
  if (options.realm) envelope.realm = options.realm;
  if (options.build) envelope.gameBuild.build = options.build;
  return envelope;
}

test('rejects malformed farming timing and keeps unknown AFK separate', () => {
  const good = { kind: 'event', envelope: session() };
  assert.equal(validFarmingSession(good), true);
  for (const change of [
    { schemaVersion: 2 }, { sessionId: '' }, { sequence: 0 }, { mode: 'raid' }, { status: 'stale' },
    { startedAt: NaN }, { durationSeconds: -1 }, { durationSeconds: 604801 }, { gatheringCount: -1 },
    { gatheringCount: 0.5 }, { afkSeconds: 1801 }, { afkSeconds: -1 }, { endedAt: start - 1 },
    { endedAt: start + 100 }, { yieldBasis: 'sold' },
  ]) assert.equal(validFarmingSession({ kind: 'event', envelope: session(change) }), false, JSON.stringify(change));
  assert.equal(validFarmingSession({ kind: 'state', envelope: session() }), false);
  assert.equal(validFarmingSession({ kind: 'event', envelope: session({}, { installationId: null }) }), false);
  assert.equal(validFarmingSession({ kind: 'event', envelope: session({ afkAvailable: false, afkSeconds: undefined }) }), true);
  assert.equal(farmingSessionQuality({ status: 'complete', durationSeconds: 1200, expectedGathers: 10, observedGathers: 10 }), 'sustained');
});

test('rates wait for harvest sync, retain travel time, and dedupe retries', () => withHttpApp(async () => {
  assert.equal(record(session()).handlerName, 'farming_session');
  assert.equal(readFarmingSessions().sessions[0].quality, 'awaiting_observations');
  for (let index = 1; index <= 9; index += 1) record(gather(index));
  let run = readFarmingSessions().sessions[0];
  assert.equal(run.outputs[0].perHour, null);
  record(gather(10));
  record(gather(10));
  record(session());
  run = readFarmingSessions().sessions[0];
  assert.equal(run.quality, 'sustained');
  assert.equal(run.observedGathers, 10);
  assert.equal(run.durationSeconds, 1800);
  assert.equal(run.outputs.find((item) => item.itemId === 2447).perHour, 40);
  assert.equal(run.outputs.find((item) => item.itemId === 2447).perNonAfkHour, 48);
  assert.equal(run.timing, 'measured');
  assert.equal(run.yieldBasis, 'loot_window');
  assert.equal(run.classToken, 'DRUID');
  assert.equal('memberId' in run, false);
  assert.equal('sessionKey' in run, false);
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT COUNT(*) AS n FROM farming_sessions').get().n), 1);
}));

test('out-of-order checkpoints cannot reopen or change completed runs', () => withHttpApp(async () => {
  record(session({ sequence: 1, status: 'open', endedAt: undefined, durationSeconds: 300, gatheringCount: 2 }));
  record(session());
  record(session({ sequence: 2, status: 'open', endedAt: undefined, durationSeconds: 600 }));
  record(session({ sequence: 100, status: 'open', endedAt: undefined, durationSeconds: 2400 }));
  assert.equal(readFarmingSessions().sessions[0].status, 'complete');
  assert.equal(readFarmingSessions().sessions[0].durationSeconds, 1800);
  const invalid = record(session({ durationSeconds: -1 }));
  assert.equal(invalid.status, 'invalid');
}));

test('automatic short samples and open/manual partial samples never get hourly rates', () => withHttpApp(async () => {
  record(gather(1, 'short'));
  record(session({ sessionId: 'short', mode: 'automatic', durationSeconds: 60, endedAt: start + 60, gatheringCount: 1, afkAvailable: false }));
  let run = readFarmingSessions({ mode: 'automatic' }).sessions[0];
  assert.equal(run.quality, 'short_sample');
  assert.equal(run.timing, 'estimated');
  assert.equal(run.outputs[0].perHour, null);
  assert.equal(run.afkSeconds, null);
  record(session({ sessionId: 'open', status: 'open', endedAt: undefined }));
  assert.equal(readFarmingSessions({ mode: 'manual' }).sessions[0].quality, 'in_progress');
  assert.equal(readFarmingSessions({ realm: 'other' }).sessions.length, 0);
  assert.equal(readFarmingSessions({ build: 'other' }).sessions.length, 0);
}));

test('session identity remains separate across members and installations', () => withHttpApp(async () => {
  record(session());
  record(session(), { memberId: memberIds.officer });
  record(session({}, { installationId: 'other-install' }));
  assert.equal(readFarmingSessions().sessions.length, 3);
}));

test('coordinates preserve real zero/one edges and drop missing/partial/invalid positions', () => {
  for (const position of [{ x: null }, { x: undefined }, { x: '' }, { x: true }, { x: [] }, { x: {} }, { x: [0.4] }, { x: -1 }, { y: 1.1 }, { x: NaN }, { mapId: null }, { coordinateSystem: 'world_xyz' }]) {
    const envelope = gather(1, 'coords', { location: position });
    const result = economicObservationFromTelemetry({ eventType: 'gathering_loot', envelope });
    assert.equal(result.observation.x, null, JSON.stringify(position));
    assert.equal(result.observation.y, null);
  }
  const valid = economicObservationFromTelemetry({ eventType: 'gathering_loot', envelope: gather(1) });
  assert.equal(valid.observation.x, 0);
  assert.equal(valid.observation.y, 1);
});

test('authenticated map endpoint groups points by map, realm and build without player identities', () => withHttpApp(async ({ request }) => {
  record(gather(1));
  record(gather(2));
  record(gather(3, 'other', { realm: 'Other Realm', build: '999' }));
  record(gather(4, 'missing', { location: { x: null, y: null } }));
  const key = 'herbalism:herb-node:peacebloom';
  const scoped = readFarmingLocations(key, { realm: fixture.realm, build: fixture.gameBuild.build, mapId: 1431 });
  assert.equal(scoped.coordinateSystem, 'ui_map_normalized');
  assert.equal(scoped.points.length, 1);
  assert.equal(scoped.points[0].x, 0);
  assert.equal(scoped.points[0].observations, 2);
  assert.equal(scoped.points[0].positionKind, 'player_at_cast');
  assert.equal(readFarmingLocations(key, { limit: 1 }).truncated, true);
  const route = `/api/intelligence/farming/sources/${encodeURIComponent(key)}/locations`;
  assert.equal((await request(route)).status, 401);
  assert.equal((await request('/api/intelligence/farming/sessions')).status, 401);
  const response = await request(`${route}?realm=${encodeURIComponent(fixture.realm)}&build=${fixture.gameBuild.build}`, { persona: 'member' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.json.points, scoped.points);
  record(session());
  const sessions = await request('/api/intelligence/farming/sessions?mode=manual', { persona: 'member' });
  assert.equal(sessions.status, 200);
  assert.equal(sessions.json.sessions.length, 1);
}));


test('farming quality expires its sync grace period and gates rates on observed coverage and sample size', () => {
  const receivedAt = '2026-10-14T05:00:00.000Z';
  const at = Date.parse(receivedAt);
  const run = { status: 'complete', durationSeconds: 1800, expectedGathers: 20, observedGathers: 18, receivedAt };
  assert.equal(farmingSessionQuality({ ...run, status: 'open', now: at }), 'in_progress');
  assert.equal(farmingSessionQuality({ ...run, now: at + 899999 }), 'awaiting_observations');
  assert.equal(farmingSessionQuality({ ...run, now: at + 900000 }), 'sustained');
  assert.equal(farmingSessionQuality({ ...run, observedGathers: 17, now: at + 900000 }), 'incomplete_sync');
  assert.equal(farmingSessionQuality({ ...run, observedGathers: 21, now: at }), 'sustained');
  assert.equal(farmingSessionQuality({ ...run, observedGathers: 20, durationSeconds: 1199, now: at }), 'short_sample');
  assert.equal(farmingSessionQuality({ ...run, expectedGathers: 10, observedGathers: 9, now: at + 900000 }), 'short_sample');
  assert.equal(farmingSessionQuality({ ...run, receivedAt: 'invalid', observedGathers: 17, now: at }), 'incomplete_sync');
  assert.equal(farmingSessionCoverage(0, 0), 1); assert.equal(farmingSessionCoverage(20, 21), 1);
});

test('partial runs recover after grace without inflating observed yields or extending grace on retries', () => withHttpApp(async () => {
  record(session({ sessionId: 'partial', gatheringCount: 20 }));
  for (let index = 1; index <= 18; index += 1) record(gather(index, 'partial'));
  const received = withGuildDatabase((db) => db.prepare('SELECT received_at FROM farming_sessions').get().received_at);
  const at = Date.parse(received);
  let run = readFarmingSessions({}, { now: at + 1000 }).sessions[0];
  assert.equal(run.quality, 'awaiting_observations'); assert.equal(run.coverage, 0.9); assert.equal(run.partial, true);
  assert.equal(run.outputs[0].perHour, null);
  record(session({ sessionId: 'partial', gatheringCount: 20 }));
  assert.equal(withGuildDatabase((db) => db.prepare('SELECT received_at FROM farming_sessions').get().received_at), received);
  run = readFarmingSessions({}, { now: at + FARMING_SYNC_GRACE_SECONDS * 1000 }).sessions[0];
  assert.equal(run.quality, 'sustained'); assert.equal(run.observedGathers, 18); assert.equal(run.coverage, 0.9);
  const cloth = run.outputs.find((item) => item.itemId === 2447);
  assert.equal(cloth.quantity, 36); assert.equal(cloth.perHour, 72); assert.equal(cloth.perNonAfkHour, 86.4);
  record(session({ sessionId: 'incomplete', gatheringCount: 20 }));
  for (let index = 1; index <= 17; index += 1) record(gather(index, 'incomplete'));
  const rows = readFarmingSessions({}, { now: at + 1000000 }).sessions;
  const incomplete = rows.find((item) => item.expectedGathers === 20 && item.observedGathers === 17);
  assert.equal(incomplete.quality, 'incomplete_sync'); assert.equal(incomplete.coverage, 0.85);
  assert.equal(incomplete.outputs[0].perHour, null);
}));
