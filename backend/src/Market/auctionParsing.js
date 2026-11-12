import { Worker } from "node:worker_threads";
import { aggregateListings, positiveInteger } from "./marketModel.js";

function list(value) {
  return Array.isArray(value) ? value : [];
}

// Blizzard auction rows → listings for aggregation.
export function listingsFromBlizzard(auctions = [], { commodity = false } = {}) {
  const listings = [];
  for (const auction of list(auctions)) {
    const itemId = positiveInteger(auction?.item?.id);
    const quantity = positiveInteger(auction?.quantity);
    if (!itemId || !quantity) continue;
    listings.push(commodity
      ? { itemId, quantity, unitPrice: auction.unit_price }
      : { itemId, bonusLists: auction.item.bonus_lists, quantity, buyout: auction.buyout, bid: auction.bid });
  }
  return listings;
}

// One response body → what the refresher needs: whether it is a
// recognisable Blizzard answer (it always carries `_links`), how many
// auctions it listed, and the aggregated items.
export function parseAuctionBody(body, { commodity = false } = {}) {
  const payload = JSON.parse(body);
  const auctions = list(payload?.auctions);
  const recognised = Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && payload._links);
  return { recognised, auctions: auctions.length, items: aggregateListings(listingsFromBlizzard(auctions, { commodity })) };
}

// The same, in a worker thread, so the event loop keeps serving requests.
export function parseAuctionBodyInWorker(body, { commodity = false } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./auctionParseWorker.js", import.meta.url), { workerData: { body, commodity } });
    let settled = false;
    worker.once("message", (message) => {
      settled = true;
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.once("error", (error) => { settled = true; reject(error); });
    worker.once("exit", (code) => { if (!settled) reject(new Error(`auction parse worker exited with ${code}`)); });
  });
}
