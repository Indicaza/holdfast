import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { createBridgeAdmission } from "../src/Security/bridgeAdmission.js";
import { createArchiveQueue } from "../src/Character/archiveQueue.js";

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.set = (key, value) => { res.headers[key] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test("1000 concurrent submissions consume only the configured in-flight admission budget", () => {
  let clock = 0, admitted = 0;
  const gate = createBridgeAdmission({ capacity: 4, burst: 12, perSecond: 6, now: () => clock });
  const results = Array.from({ length: 1000 }, () => {
    const res = response();
    gate({}, res, () => admitted++);
    return res;
  });
  assert.equal(admitted, 4);
  assert.equal(results.filter(res => res.statusCode === 503).length, 996);
  assert.equal(results[4].headers["Retry-After"], "3");
  assert.equal(results[4].headers["X-Guildweaver-Backpressure"], "1");
  for (const res of results.slice(0, 4)) { res.emit("finish"); res.emit("close"); }
  for (let index = 0; index < 8; index++) {
    const res = response();
    gate({}, res, () => admitted++);
    res.emit("finish");
  }
  assert.equal(admitted, 12);
  const exhausted = response();
  gate({}, exhausted, () => assert.fail("admitted beyond burst"));
  assert.equal(exhausted.statusCode, 503);
  clock += 1000;
  const recovered = response();
  gate({}, recovered, () => admitted++);
  assert.equal(admitted, 13);
});

test("archive tickets are bounded, FIFO, device-isolated and execute one worker at a time", async () => {
  let active = 0, maxActive = 0;
  const order = [];
  const queue = createArchiveQueue({
    capacity: 32, intervalMs: 1,
    run: async query => {
      maxActive = Math.max(maxActive, ++active);
      order.push(query.index);
      await sleep(2);
      active--;
      return { index: query.index };
    },
  });
  const submit = index => queue.submit({ owner: "device-" + index, query: { index }, authorized: () => true });
  const tickets = Array.from({ length: 1000 }, (_, index) => submit(index));
  assert.equal(tickets.filter(job => job.status === "queued").length, 32);
  assert.equal(tickets.filter(job => job.status === "full").length, 968);
  assert.equal(tickets[31].position, 32);
  assert.equal(submit(0).ticket, tickets[0].ticket);
  assert.equal(queue.poll("wrong-device", tickets[0].ticket), null);
  assert.equal(queue.cancel("wrong-device", tickets[0].ticket), false);
  assert.equal(queue.cancel("device-3", tickets[3].ticket), true);
  const deadline = Date.now() + 10000;
  while (queue.poll("device-31", tickets[31].ticket)?.status !== "ready" && Date.now() < deadline) await sleep(10);
  assert.equal(queue.poll("device-31", tickets[31].ticket)?.status, "ready");
  assert.equal(maxActive, 1);
  assert.deepEqual(order, Array.from({ length: 32 }, (_, index) => index).filter(index => index !== 3));
  assert.equal(queue.cancel("device-0", tickets[0].ticket), true);
  assert.equal(submit(999).status, "queued");
  queue.cancel("device-999", submit(999).ticket);
});

test("archive authorization is checked again before executing queued work", async () => {
  let granted = true, calls = 0;
  const queue = createArchiveQueue({ intervalMs: 5, run: async () => { calls++; return {}; } });
  const job = queue.submit({ owner: "device", query: { market: "a" }, authorized: () => granted });
  granted = false;
  await sleep(50);
  assert.equal(queue.poll("device", job.ticket).status, "failed");
  assert.equal(calls, 0);
});
