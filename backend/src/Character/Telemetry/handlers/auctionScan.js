import { recordAuctionScanInDatabase, validAuctionScan } from "../../../Market/auctionScanTelemetry.js";

// auction_scan: auction house results the player's client showed. Feeds the
// shared market data; the contributing account is never stored in it.
export const auctionScanTelemetryHandler = {
  eventType: "auction_scan",
  validate(record) {
    return validAuctionScan(record) ? { ok: true } : { ok: false, error: "invalid_auction_scan" };
  },
  canonicalize({ envelope }) {
    return envelope.payload;
  },
  recordEvent: recordAuctionScanInDatabase,
};
