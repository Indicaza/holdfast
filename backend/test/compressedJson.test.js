import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import express from "express";

import { COMPRESS_JSON_OVER_BYTES, sendCompressedJson } from "../src/Http/compressedJson.js";

function get(port, path, headers) {
  return new Promise((resolve, reject) => {
    httpRequest({ port, path, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
  });
}

test("large JSON bodies are gzipped for clients that accept it", async () => {
  const large = { recipes: Array.from({ length: 400 }, (_, index) => ({ name: `Recipe ${index}`, description: "Hammers out plate." })) };
  assert.ok(JSON.stringify(large).length > COMPRESS_JSON_OVER_BYTES);
  const app = express();
  app.get("/large", (req, res) => sendCompressedJson(req, res, large));
  app.get("/small", (req, res) => sendCompressedJson(req, res, { ok: true }));
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const gzipped = await get(port, "/large", { "Accept-Encoding": "gzip, deflate, br" });
    assert.equal(gzipped.headers["content-encoding"], "gzip");
    assert.match(gzipped.headers["content-type"], /application\/json/);
    assert.match(gzipped.headers.vary, /Accept-Encoding/);
    assert.ok(gzipped.body.length * 4 < JSON.stringify(large).length);
    assert.deepEqual(JSON.parse(gunzipSync(gzipped.body).toString()), large);

    const plain = await get(port, "/large", {});
    assert.equal(plain.headers["content-encoding"], undefined, "no gzip without Accept-Encoding");
    assert.deepEqual(JSON.parse(plain.body.toString()), large);

    const small = await get(port, "/small", { "Accept-Encoding": "gzip" });
    assert.equal(small.headers["content-encoding"], undefined, "small bodies are sent as is");
    assert.deepEqual(JSON.parse(small.body.toString()), { ok: true });
  } finally {
    server.close();
  }
});
