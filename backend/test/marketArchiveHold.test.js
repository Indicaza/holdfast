import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { withHttpApp, memberIds } from "../testSupport/httpHarness.js";
import { withGuildDatabase } from "../src/Data/database.js";
import { writeMarketIngestionControls, setMarketLink } from "../src/Market/marketRepository.js";
import { maintainMarketsIfDue } from "../src/Market/marketRefresh.js";
import { beginMarketArchiveWriter, setMarketArchiveHold } from "../src/Market/marketArchiveHold.js";
import { readArchiveBatch, normalizeArchiveQuery } from "../src/Character/archiveRepository.js";

test("archive hold requires explicitly paused ingestion and drained writers", () => withHttpApp(async ({ request }) => {
  const route = "/api/admin/guildweaver/archive/hold";
  assert.equal((await request(route)).status, 401);
  assert.equal((await request(route, { persona: "member", method: "PUT", body: { enabled: true } })).status, 403);
  assert.equal((await request(route, { persona: "owner", method: "PUT", body: { enabled: "yes" } })).status, 400);
  assert.equal(setMarketArchiveHold(true, memberIds.owner).status, "ingestion_not_paused");
  writeMarketIngestionControls({ blizzard: false, addon: false }, memberIds.owner);
  const end = beginMarketArchiveWriter();
  try { assert.equal(setMarketArchiveHold(true, memberIds.owner).status, "market_busy"); } finally { end(); }
  const result = await request(route, { persona: "owner", method: "PUT", body: { enabled: true } });
  assert.equal(result.status, 200, result.text);
  const hold = result.json.hold;
  assert.ok(hold.id);
  assert.equal(setMarketArchiveHold(true, memberIds.owner).hold.id, hold.id);
  assert.equal(writeMarketIngestionControls({ blizzard: true, addon: false }, memberIds.owner), null);
  assert.equal(writeMarketIngestionControls({ blizzard: false, addon: true }, memberIds.owner), null);
  assert.equal(setMarketLink({ marketKey: "any" }).reason, "archive_hold_active");
  assert.equal(await maintainMarketsIfDue({ force: true, measure: async () => { throw new Error("must not run"); } }), null);
  assert.equal((await request(route, { persona: "owner", method: "PUT", body: { enabled: false } })).status, 200);
  assert.ok(writeMarketIngestionControls({ blizzard: true, addon: false }, memberIds.owner));
}));

test("held exports traverse all hourly rows in key order and preserve nonfinal monthly history", () => withHttpApp(async () => {
  writeMarketIngestionControls({ blizzard: false, addon: false }, memberIds.owner);
  const market = "archive-fixture";
  withGuildDatabase(db => {
    db.prepare("INSERT INTO market_markets (market_key,kind,region,name,created_at) VALUES (?, 'api_house','us','Archive fixture','2026-01-01')").run(market);
    const insert = db.prepare("INSERT INTO market_series_hourly (market_key,item_key,source_type,hour,first_at,last_at,samples,quantity_low,quantity_high,quantity_close) VALUES (?, 'i:1','official_api',?,1,1,1,2,2,2)");
    for (let hour = 1; hour <= 1500; hour++) insert.run(market, hour);
    db.prepare("INSERT INTO market_series_monthly (market_key,item_key,source_type,month,days,samples,quantity_low,quantity_high,quantity_close,final) VALUES (?, 'i:1','official_api','2026-11-01',1,1,2,2,2,0)").run(market);
  });
  const holdId = setMarketArchiveHold(true, memberIds.owner).hold.id;
  assert.equal(normalizeArchiveQuery({ dataset: "market-hourly", market }), null);
  let cursor, rows = [];
  do {
    const result = readArchiveBatch({ dataset: "market-hourly", market, holdId, cursor });
    assert.equal(result.batch.holdId, holdId);
    assert.equal(result.sha256, createHash("sha256").update(JSON.stringify(result.batch)).digest("hex"));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 256 * 1024);
    rows.push(...result.batch.rows);
    cursor = result.batch.nextCursor;
    if (cursor) assert.equal(normalizeArchiveQuery({ dataset: "market-daily", market, holdId, cursor }), null);
  } while (cursor);
  assert.deepEqual(rows.map(row => row.hour), Array.from({ length: 1500 }, (_, index) => index + 1));
  assert.equal(readArchiveBatch({ dataset: "market-monthly-all", market, holdId }).batch.rows.length, 1);
  assert.equal(readArchiveBatch({ dataset: "market-monthly", market }).batch.rows.length, 0);
  for (const dataset of ["market-daily", "market-weekly", "market-current"]) assert.equal(readArchiveBatch({ dataset, market, holdId }).batch.nextCursor, null);
  setMarketArchiveHold(false, memberIds.owner);
  const newId = setMarketArchiveHold(true, memberIds.owner).hold.id;
  assert.notEqual(newId, holdId);
  assert.equal(readArchiveBatch({ dataset: "market-hourly", market, holdId }), null);
}));

 test("production paused defaults can start a hold and persist paused controls atomically", () => withHttpApp(async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    withGuildDatabase(db => db.prepare("DELETE FROM app_meta WHERE key = 'market_ingestion_controls'").run());
    const result = setMarketArchiveHold(true, memberIds.owner);
    assert.equal(result.status, "ok");
    const stored = withGuildDatabase(db => db.prepare("SELECT value FROM app_meta WHERE key = 'market_ingestion_controls'").get());
    assert.deepEqual(JSON.parse(stored.value), { blizzard: false, addon: false, updatedBy: memberIds.owner });
    assert.equal(writeMarketIngestionControls({ blizzard: true, addon: false }, memberIds.owner), null);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
}));
