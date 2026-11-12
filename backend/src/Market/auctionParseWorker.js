import { parentPort, workerData } from "node:worker_threads";
import { parseAuctionBody } from "./auctionParsing.js";

// Parses and aggregates one Blizzard auction response off the request
// thread: JSON.parse of a multi-megabyte body and per-listing aggregation
// took seconds of event-loop time on production's 0.5-CPU instance.
try {
  parentPort.postMessage({ ok: true, result: parseAuctionBody(workerData.body, { commodity: workerData.commodity }) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error.message).slice(0, 200) });
}
