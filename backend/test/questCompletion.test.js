import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  QuestCompletionError,
  assertObjectiveCompletionApprovedInDatabase,
  readCompletionStatesFromDatabase,
  requestObjectiveCompletionInDatabase,
  reviewObjectiveCompletionInDatabase,
  withdrawObjectiveCompletionInDatabase,
} from "../src/Quest/questCompletion.js";

function document() {
  return {
    quests: [
      {
        id: "quest-one",
        publication: "published",
        createdByMemberId: "creator",
        title: "Launch supplies",
        objectives: [
          {
            id: "objective-one",
            title: "Gather linen",
            description: "Stock the guild bank.",
            priority: "High",
            completed: false,
            need: "20 Linen Cloth",
            reward: { rep: 100, marks: 5, items: [] },
            assignments: [
              {
                memberId: "member-one",
                name: "Rook",
              },
            ],
          },
        ],
      },
    ],
  };
}

function reviewerAuthority(scope = "all") {
  return {
    permissions: ["rewards.issue"],
    questScopes: {
      "rewards.issue": scope,
    },
  };
}

function member(id = "member-one", displayName = "Rook") {
  return { id, displayName, username: displayName.toLowerCase() };
}

function withDb(callback) {
  const db = new DatabaseSync(":memory:");

  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function expectCompletionError(code) {
  return (error) =>
    error instanceof QuestCompletionError && error.code === code;
}

test("assigned member can request completion and see pending state", () => {
  withDb((db) => {
    const source = document();
    const completion = requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
      note: "Twenty linen deposited in the bank.",
      now: "2026-10-03T12:00:00.000Z",
    });

    assert.equal(completion.status, "pending");
    assert.equal(completion.requestedByMemberId, "member-one");
    assert.equal(completion.requestNote, "Twenty linen deposited in the bank.");

    const states = readCompletionStatesFromDatabase(db, source);
    assert.equal(states["objective-one"].status, "pending");
  });
});

test("unassigned member cannot request completion", () => {
  withDb((db) => {
    assert.throws(
      () =>
        requestObjectiveCompletionInDatabase({
          db,
          document: document(),
          questId: "quest-one",
          objectiveId: "objective-one",
          member: member("member-two", "Quill"),
        }),
      expectCompletionError("completion_request_assignment_required"),
    );
  });
});

test("pending request becomes stale when objective state changes", () => {
  withDb((db) => {
    const source = document();

    requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
    });

    const changed = structuredClone(source);
    changed.quests[0].objectives[0].need = "40 Linen Cloth";

    const states = readCompletionStatesFromDatabase(db, changed);
    assert.equal(states["objective-one"].status, "stale");

    assert.throws(
      () =>
        assertObjectiveCompletionApprovedInDatabase(
          db,
          changed,
          "quest-one",
          "objective-one",
        ),
      expectCompletionError("completion_request_stale"),
    );
  });
});

test("reviewer cannot review their own completion request", () => {
  withDb((db) => {
    const source = document();

    requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
    });

    assert.throws(
      () =>
        reviewObjectiveCompletionInDatabase({
          db,
          document: source,
          questId: "quest-one",
          objectiveId: "objective-one",
          decision: "approved",
          authority: reviewerAuthority(),
          actorMemberId: "member-one",
          actor: member(),
        }),
      expectCompletionError("completion_self_review_forbidden"),
    );
  });
});

test("rejection requires a reason and assignee can resubmit", () => {
  withDb((db) => {
    const source = document();

    requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
    });

    assert.throws(
      () =>
        reviewObjectiveCompletionInDatabase({
          db,
          document: source,
          questId: "quest-one",
          objectiveId: "objective-one",
          decision: "rejected",
          note: "",
          authority: reviewerAuthority(),
          actorMemberId: "officer-one",
          actor: member("officer-one", "Bran"),
        }),
      expectCompletionError("completion_note_required"),
    );

    const rejected = reviewObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      decision: "rejected",
      note: "Deposit the materials in tab two.",
      authority: reviewerAuthority(),
      actorMemberId: "officer-one",
      actor: member("officer-one", "Bran"),
      now: "2026-10-03T13:00:00.000Z",
    });

    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.reviewNote, "Deposit the materials in tab two.");

    const resubmitted = requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
      note: "Moved to tab two.",
    });

    assert.equal(resubmitted.status, "pending");
    assert.equal(resubmitted.reviewNote, "");
  });
});

test("authorized reviewer approval unlocks final completion", () => {
  withDb((db) => {
    const source = document();

    requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
    });

    assert.throws(
      () =>
        assertObjectiveCompletionApprovedInDatabase(
          db,
          source,
          "quest-one",
          "objective-one",
        ),
      expectCompletionError("completion_approval_required"),
    );

    const approved = reviewObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      decision: "approved",
      authority: reviewerAuthority(),
      actorMemberId: "officer-one",
      actor: member("officer-one", "Bran"),
    });

    assert.equal(approved.status, "approved");
    assert.doesNotThrow(() =>
      assertObjectiveCompletionApprovedInDatabase(
        db,
        source,
        "quest-one",
        "objective-one",
      ),
    );
  });
});

test("own-scoped reviewer cannot approve somebody else's quest", () => {
  withDb((db) => {
    const source = document();

    requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
    });

    assert.throws(
      () =>
        reviewObjectiveCompletionInDatabase({
          db,
          document: source,
          questId: "quest-one",
          objectiveId: "objective-one",
          decision: "approved",
          authority: reviewerAuthority("own"),
          actorMemberId: "officer-one",
          actor: member("officer-one", "Bran"),
        }),
      expectCompletionError("completion_review_forbidden"),
    );
  });
});

test("requester can withdraw a pending request", () => {
  withDb((db) => {
    const source = document();

    requestObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      member: member(),
    });

    withdrawObjectiveCompletionInDatabase({
      db,
      document: source,
      questId: "quest-one",
      objectiveId: "objective-one",
      memberId: "member-one",
    });

    assert.deepEqual(readCompletionStatesFromDatabase(db, source), {});
  });
});
