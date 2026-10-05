import test from "node:test";
import assert from "node:assert/strict";

import { memberIds, objective, withHttpApp } from "../testSupport/httpHarness.js";

async function pairDevice(request, persona = "member") {
  const started = await request("/api/bridge/pairing/start", {
    method: "POST",
    body: { deviceName: "Quest bridge test" },
  });
  assert.equal(started.status, 201);

  const approved = await request("/api/bridge/pairing/approve", {
    persona,
    method: "POST",
    body: { userCode: started.json.userCode },
  });
  assert.equal(approved.status, 200);

  const exchanged = await request("/api/bridge/pairing/token", {
    method: "POST",
    body: { deviceCode: started.json.deviceCode },
  });
  assert.equal(exchanged.status, 200);
  return exchanged.json.deviceToken;
}

function authorization(deviceToken) {
  return { Authorization: `Bearer ${deviceToken}` };
}

test("Guildweaver quest snapshot requires a paired device", async () => {
  await withHttpApp(async ({ request }) => {
    const response = await request("/api/bridge/quests/snapshot");
    assert.equal(response.status, 401);
    assert.equal(response.json.error, "invalid_device_token");
  });
});

test("Guildweaver paired device receives member-specific quest state", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairDevice(request);
    const response = await request("/api/bridge/quests/snapshot", {
      headers: authorization(deviceToken),
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.schemaVersion, 1);
    assert.equal(response.json.synced, true);
    assert.ok(Number.isInteger(response.json.revision));
    assert.equal(response.json.items[0].id, objective.questId);
    assert.equal(response.json.items[0].priority, "High");
    assert.deepEqual(response.json.items[0].rewards, [
      { type: "rep", label: "Rep", amount: 100 },
      { type: "marks", label: "Marks", amount: 5 },
    ]);

    const target = response.json.items[0].objectives.find(
      (item) => item.id === objective.objectiveId,
    );
    assert.equal(target.assignment.status, "available");
    assert.equal(target.assignment.me, false);
  });
});

test("Guildweaver quest actions join and leave only the paired member", async () => {
  await withHttpApp(async ({ request }) => {
    const deviceToken = await pairDevice(request);

    const joined = await request("/api/bridge/quests/actions", {
      method: "POST",
      headers: authorization(deviceToken),
      body: {
        memberId: memberIds.officer,
        actions: [
          {
            id: "action-join-1",
            action: "join",
            questId: objective.questId,
            objectiveId: objective.objectiveId,
          },
        ],
      },
    });

    assert.equal(joined.status, 200);
    assert.deepEqual(joined.json.results, [
      { id: "action-join-1", status: "applied" },
    ]);

    const afterJoin = await request("/api/bridge/quests/snapshot", {
      headers: authorization(deviceToken),
    });
    const joinedObjective = afterJoin.json.items[0].objectives.find(
      (item) => item.id === objective.objectiveId,
    );
    assert.equal(joinedObjective.assignment.status, "assigned");
    assert.equal(joinedObjective.assignment.me, true);

    const duplicate = await request("/api/bridge/quests/actions", {
      method: "POST",
      headers: authorization(deviceToken),
      body: {
        actions: [
          {
            id: "action-join-retry",
            action: "join",
            questId: objective.questId,
            objectiveId: objective.objectiveId,
          },
        ],
      },
    });
    assert.deepEqual(duplicate.json.results, [
      { id: "action-join-retry", status: "already-applied" },
    ]);

    const left = await request("/api/bridge/quests/actions", {
      method: "POST",
      headers: authorization(deviceToken),
      body: {
        actions: [
          {
            id: "action-leave-1",
            action: "leave",
            questId: objective.questId,
            objectiveId: objective.objectiveId,
          },
        ],
      },
    });
    assert.deepEqual(left.json.results, [
      { id: "action-leave-1", status: "applied" },
    ]);

    const afterLeave = await request("/api/bridge/quests/snapshot", {
      headers: authorization(deviceToken),
    });
    const leftObjective = afterLeave.json.items[0].objectives.find(
      (item) => item.id === objective.objectiveId,
    );
    assert.equal(leftObjective.assignment.status, "available");
    assert.equal(leftObjective.assignment.me, false);
  });
});
