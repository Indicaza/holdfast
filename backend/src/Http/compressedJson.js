import { gzipSync } from "node:zlib";

// Sends a JSON body gzip-compressed when the client accepts it and the body is
// large. Used per route (the character armory carries whole recipe books with
// tooltips, over a megabyte of JSON) instead of a global middleware, which
// would also buffer the live-update event stream.
export const COMPRESS_JSON_OVER_BYTES = 16 * 1024;

export function sendCompressedJson(req, res, body) {
  const json = JSON.stringify(body);
  res.vary("Accept-Encoding");
  if (Buffer.byteLength(json, "utf8") < COMPRESS_JSON_OVER_BYTES || req.acceptsEncodings("gzip", "identity") !== "gzip") {
    res.type("application/json").send(json);
    return;
  }
  res.set("Content-Encoding", "gzip");
  res.type("application/json").send(gzipSync(json));
}
