import assert from "node:assert/strict";
import test from "node:test";

import { withGuildDatabase, withGuildTransaction } from "../src/Data/database.js";
import { parseAuctionBody, parseAuctionBodyInWorker } from "../src/Market/auctionParsing.js";
import { createBlizzardAuctionProvider } from "../src/Market/blizzardAuctionProvider.js";
import { createMarketRefresher } from "../src/Market/marketRefresh.js";
import {
  absentMarketItemsInDatabase,
  addMarketSnapshotItemsInDatabase,
  beginMarketSnapshotInDatabase,
  recordMarketSnapshotInDatabase,
} from "../src/Market/marketRepository.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

const quiet = { info() {}, warn() {}, error() {} };
const MARKET = { marketKey: "api:us:house-113", kind: "api_house", region: "us", houseId: 113, faction: "alliance", name: "Alliance Auction House" };
const T = 1794300000;

function item(itemId, price) {
  return { itemKey: `i:${itemId}`, itemId, minUnitBuyout: price, typicalUnitBuyout: price, maxUnitBuyout: price, quantity: 3, listings: 1 };
}

function snapshot(db, id, observedAt, ids, price) {
  return { market: MARKET, sourceType: "official_api", sourceId: id, coverage: "full", scope: "api:auctions", observedAt, now: observedAt, items: ids.map((n) => item(n, price)) };
}

const quantity = (itemId) => withGuildDatabase((db) => db.prepare("SELECT quantity FROM market_summaries WHERE market_key = ? AND item_key = ?").get(MARKET.marketKey, `i:${itemId}`)?.quantity);

test("items a cut-short run never marked as gone are caught up by the next snapshot", () => withHttpApp(async () => {
  const all = Array.from({ length: 10 }, (_, index) => index + 1);
  withGuildTransaction((db) => recordMarketSnapshotInDatabase(db, snapshot(db, "a", T, all, 100)));
  // Snapshot B lists only 1-5, but the process stops before 6-10 are marked.
  withGuildTransaction((db) => {
    const input = snapshot(db, "b", T + 3600, all.slice(0, 5), 110);
    const begun = beginMarketSnapshotInDatabase(db, input);
    addMarketSnapshotItemsInDatabase(db, { ...input, snapshotId: begun.snapshotId, observedAt: begun.observedAt, items: begun.items });
  });
  assert.equal(quantity(8), 3, "still shown as listed after the interruption");
  // Snapshot C lists 1-5 again with new prices: its previous snapshot (B)
  // never saw 6-10, yet they are found through their stale summaries.
  const c = withGuildTransaction((db) => {
    const input = snapshot(db, "c", T + 7200, all.slice(0, 5), 120);
    const begun = beginMarketSnapshotInDatabase(db, input);
    addMarketSnapshotItemsInDatabase(db, { ...input, snapshotId: begun.snapshotId, observedAt: begun.observedAt, items: begun.items });
    return begun;
  });
  const gone = withGuildDatabase((db) => absentMarketItemsInDatabase(db, { snapshotId: c.snapshotId }));
  assert.deepEqual(gone.items.map((entry) => entry.itemId).sort((a, b) => a - b), [6, 7, 8, 9, 10]);
  withGuildTransaction((db) => addMarketSnapshotItemsInDatabase(db, { snapshotId: c.snapshotId, market: MARKET, sourceType: "official_api", coverage: "full",
    observedAt: gone.observedAt, items: gone.items, now: T + 7200 }));
  assert.equal(quantity(8), 0, "none listed after the catch-up");
  assert.equal(quantity(2), 3);
  // Nothing left to catch up.
  assert.deepEqual(withGuildDatabase((db) => absentMarketItemsInDatabase(db, { snapshotId: c.snapshotId })).items, []);
}));

test("auction responses parse the same in the worker thread as inline", async () => {
  const body = JSON.stringify({ _links: { self: {} }, auctions: [
    { id: 1, item: { id: 25 }, quantity: 2, buyout: 900 },
    { id: 2, item: { id: 25 }, quantity: 1, buyout: 1000, bid: 500 },
    { id: 3, item: { id: 7, bonus_lists: [1, 2] }, quantity: 1, buyout: 50 },
  ] });
  assert.deepEqual(await parseAuctionBodyInWorker(body), parseAuctionBody(body));
  assert.equal((await parseAuctionBodyInWorker(body)).auctions, 3);
  assert.deepEqual(await parseAuctionBodyInWorker('{"_links":{}}'), { recognised: true, auctions: 0, items: [] });
  assert.equal((await parseAuctionBodyInWorker("{}")).recognised, false);
  await assert.rejects(parseAuctionBodyInWorker("not json"));
});

test("the refresher records thousands of sold-out items in bounded chunks and refuses unreadable answers", () => withHttpApp(async () => {
  let clock = Date.parse("Tue, 10 Nov 2026 10:05:00 GMT");
  const state = { lastModified: "Tue, 10 Nov 2026 10:00:00 GMT", ids: Array.from({ length: 1200 }, (_, index) => index + 1), raw: null };
  const fetchImpl = async (url) => {
    const path = String(url).replace(/^https:\/\/us\.api\.blizzard\.com/, "").replace(/\?.*$/, "");
    const json = (body, status = 200, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    if (String(url).includes("oauth")) return json({ access_token: "token", expires_in: 3600 });
    if (path === "/data/wow/ruleset/index") return json({ rulesets: [{ id: 2 }] });
    if (path === "/data/wow/ruleset/2/auctions/") return json({ auctions: [{ id: 113, name: "Alliance Auction House" }] });
    if (path.endsWith("/commodities")) return json({ error: "not_found" }, 404);
    if (state.raw) return json(state.raw, 200, { "last-modified": state.lastModified });
    return json({ _links: { self: {} }, auctions: state.ids.map((id) => ({ id, item: { id }, quantity: 1, buyout: 100 + id })) }, 200, { "last-modified": state.lastModified });
  };
  const env = { BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret", MARKET_BLIZZARD_REGIONS: "us" };
  const refresher = createMarketRefresher({ provider: createBlizzardAuctionProvider({ env, fetchImpl, now: () => clock }), now: () => clock, log: quiet });
  assert.equal((await refresher.tick()).status, "recorded");
  // An hour later 1,000 of the 1,200 items have sold out.
  clock += 5 * 3600 * 1000;
  state.lastModified = "Tue, 10 Nov 2026 15:00:00 GMT";
  state.ids = state.ids.slice(0, 200);
  const result = await refresher.tick();
  const auctions = result.endpoints.find((entry) => entry.endpoint === "auctions");
  assert.equal(auctions.absent, 1000);
  const marketKey = "api:us:house-113";
  const counts = withGuildDatabase((db) => db.prepare("SELECT SUM(quantity = 0) AS gone, SUM(quantity > 0) AS listed FROM market_summaries WHERE market_key = ?").get(marketKey));
  assert.deepEqual({ ...counts }, { gone: 1000, listed: 200 });
  // An answer that is not JSON is a failure and changes nothing.
  clock += 5 * 3600 * 1000;
  state.lastModified = "Tue, 10 Nov 2026 20:00:00 GMT";
  state.raw = "<html>maintenance</html>";
  const broken = await refresher.tick();
  assert.equal(broken.endpoints.find((entry) => entry.endpoint === "auctions").error, "unexpected_payload");
  assert.equal(withGuildDatabase((db) => db.prepare("SELECT SUM(quantity > 0) AS listed FROM market_summaries WHERE market_key = ?").get(marketKey)).listed, 200);
}));
