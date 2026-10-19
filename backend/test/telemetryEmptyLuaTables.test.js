import assert from "node:assert/strict";
import test from "node:test";

import { canonicalTelemetryPayload, validateTelemetryDomain } from "../src/Character/Telemetry/handlerRegistry.js";
import { array, list, listOrMissing } from "../src/Character/Telemetry/luaList.js";

// The bridge's SavedVariables parser cannot tell an empty Lua table from an
// empty object, so the addon's `professions = {}` arrives as {}.
function record(eventType, payload) {
  return { eventType, payloadSchemaVersion: 1, envelope: { characterId: "character-rook", payload } };
}

function accepted(eventType, payload) {
  const input = record(eventType, payload);
  const result = validateTelemetryDomain(input);
  assert.equal(result.ok, true, `${eventType} rejected: ${result.error}`);
  return canonicalTelemetryPayload(input);
}

test("an empty object is an empty list", () => {
  assert.deepEqual(list({}), []);
  assert.deepEqual(array({}), []);
  assert.equal(list({ 1: "a" }), null);
  assert.equal(list("x"), null);
  assert.equal(listOrMissing({}), true);
  assert.equal(listOrMissing(undefined), true);
  assert.equal(listOrMissing({ a: 1 }), false);
});

test("professions {} is accepted and canonicalizes to []", () => {
  assert.deepEqual(accepted("professions", { schemaVersion: 1, professions: {} }), { schemaVersion: 1, professions: [] });
});

test("equipment {} is accepted and canonicalizes to []", () => {
  assert.deepEqual(accepted("equipment", { schemaVersion: 1, equipment: {} }), { schemaVersion: 1, equipment: [] });
});

test("profession_snapshot with professions {} is accepted and canonicalizes to []", () => {
  assert.deepEqual(accepted("profession_snapshot", { schemaVersion: 1, professions: {} }).professions, []);
});

test("a profession with recipes {} is accepted and canonicalizes to []", () => {
  const payload = accepted("profession_snapshot", {
    schemaVersion: 1,
    professions: [{ skillLineId: 164, name: "Blacksmithing", rank: 1, maxRank: 75, recipes: {} }],
  });
  assert.equal(payload.professions.length, 1);
  assert.deepEqual(payload.professions[0].recipes, []);
});

test("non-empty objects are still rejected", () => {
  assert.equal(validateTelemetryDomain(record("professions", { professions: { a: 1 } })).ok, false);
  assert.equal(validateTelemetryDomain(record("equipment", { equipment: { a: 1 } })).ok, false);
  assert.equal(validateTelemetryDomain(record("profession_snapshot", { professions: [{ recipes: { a: 1 } }] })).ok, false);
});
