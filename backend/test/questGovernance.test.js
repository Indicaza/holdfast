import assert from "node:assert/strict";
import test from "node:test";

import {
  approveObjectiveReward,
  assertObjectiveCanIssue,
  enforceQuestWorkspaceAuthority,
  preserveQuestServerState,
  QuestGovernanceError,
} from "../src/Quest/questGovernance.js";

const ZERO = {
  repPerObjective: 0,
  marksPerObjective: 0,
  marksPerQuest: 0,
};

function authority({
  permissions = [],
  editScope = null,
  createScope = null,
  publishScope = null,
  approveScope = null,
  issueScope = null,
  approveLimits = ZERO,
  issueLimits = ZERO,
} = {}) {
  return {
    permissions,
    questScopes: {
      "quests.create": createScope,
      "quests.edit": editScope,
      "quests.publish": publishScope,
      "rewards.approve": approveScope,
      "rewards.issue": issueScope,
    },
    rewardLimits: {
      approve: approveLimits,
      issue: issueLimits,
    },
  };
}

function objective({
  id = "objective-one",
  rep = 100,
  marks = 5,
  approved = false,
} = {}) {
  const reward = {
    rep,
    marks,
    items: [],
  };

  return {
    id,
    title: "Bring supplies",
    description: "",
    priority: "High",
    completed: false,
    need: "",
    reward,
    rewardApproval: approved
      ? {
          approvedByMemberId: "officer",
          approvedByName: "Officer",
          approvedAt: "2026-10-02T12:00:00.000Z",
          fingerprint: JSON.stringify({
            rep,
            marks,
            items: [],
          }),
        }
      : {
          approvedByMemberId: "",
          approvedByName: "",
          approvedAt: "",
          fingerprint: "",
        },
    assignments: [],
  };
}

function quest({
  id = "quest-one",
  creator = "creator-one",
  publication = "draft",
  objectives = [objective()],
} = {}) {
  return {
    id,
    publication,
    mode: "rotating",
    title: "Supply Run",
    summary: "",
    createdByMemberId: creator,
    createdAt: "2026-10-02T12:00:00.000Z",
    objectives,
    completed: false,
  };
}

function document(quests = [quest()]) {
  return {
    version: 1,
    focusedQuestId: "",
    rewardPolicy: "",
    rewardLimits: {
      rep: { min: 0, max: 1000 },
      marks: { min: 0, max: 1000 },
      marksPerQuestMax: 1000,
    },
    quests,
  };
}

test("own-scope editors can edit their own quest but not somebody else's", () => {
  const ownAuthority = authority({
    permissions: ["quests.edit"],
    editScope: "own",
  });
  const current = document([
    quest({ id: "mine", creator: "member-one" }),
    quest({ id: "theirs", creator: "member-two" }),
  ]);

  const mine = structuredClone(current);
  mine.quests[0].summary = "Changed by creator";

  assert.doesNotThrow(() =>
    enforceQuestWorkspaceAuthority(mine, current, {
      authority: ownAuthority,
      actorMemberId: "member-one",
    }),
  );

  const theirs = structuredClone(current);
  theirs.quests[1].summary = "Changed by someone else";

  assert.throws(
    () =>
      enforceQuestWorkspaceAuthority(theirs, current, {
        authority: ownAuthority,
        actorMemberId: "member-one",
      }),
    (error) =>
      error instanceof QuestGovernanceError &&
      error.code === "quest_scope_forbidden",
  );
});

test("all-scope editors can edit another member's quest", () => {
  const allAuthority = authority({
    permissions: ["quests.edit"],
    editScope: "all",
  });
  const current = document([
    quest({ id: "theirs", creator: "member-two" }),
  ]);
  const next = structuredClone(current);
  next.quests[0].summary = "Officer edit";

  assert.doesNotThrow(() =>
    enforceQuestWorkspaceAuthority(next, current, {
      authority: allAuthority,
      actorMemberId: "member-one",
    }),
  );
});

test("own-scope creators can append a new owned draft without global reorder authority", () => {
  const creatorAuthority = authority({
    permissions: ["quests.create"],
    createScope: "own",
  });
  const current = document([
    quest({ id: "existing", creator: "member-two" }),
  ]);
  const next = structuredClone(current);
  next.quests.push(
    quest({
      id: "new-quest",
      creator: "member-one",
      objectives: [],
    }),
  );

  assert.doesNotThrow(() =>
    enforceQuestWorkspaceAuthority(next, current, {
      authority: creatorAuthority,
      actorMemberId: "member-one",
    }),
  );
});

test("own-scope editor cannot reorder existing global quests", () => {
  const editAuthority = authority({
    permissions: ["quests.edit"],
    editScope: "own",
  });
  const current = document([
    quest({ id: "one", creator: "member-one" }),
    quest({ id: "two", creator: "member-one" }),
  ]);
  const next = structuredClone(current);
  next.quests.reverse();

  assert.throws(
    () =>
      enforceQuestWorkspaceAuthority(next, current, {
        authority: editAuthority,
        actorMemberId: "member-one",
      }),
    (error) =>
      error instanceof QuestGovernanceError &&
      error.code === "quest_order_forbidden",
  );
});

test("server state preserves creator and approval until reward changes", () => {
  const current = document([
    quest({
      creator: "member-one",
      objectives: [objective({ approved: true })],
    }),
  ]);

  const unchanged = preserveQuestServerState(
    structuredClone(current),
    current,
    "different-member",
  );

  assert.equal(
    unchanged.quests[0].createdByMemberId,
    "member-one",
  );
  assert.ok(
    unchanged.quests[0].objectives[0].rewardApproval.approvedAt,
  );

  const changedInput = structuredClone(current);
  changedInput.quests[0].objectives[0].reward.rep = 125;

  const changed = preserveQuestServerState(
    changedInput,
    current,
    "different-member",
  );

  assert.deepEqual(
    changed.quests[0].objectives[0].rewardApproval,
    {
      approvedByMemberId: "",
      approvedByName: "",
      approvedAt: "",
      fingerprint: "",
    },
  );
});

test("reward approval obeys quest scope and approval bracket", () => {
  const doc = document([
    quest({
      creator: "creator-one",
      objectives: [objective({ rep: 200, marks: 10 })],
    }),
  ]);

  const approver = authority({
    permissions: ["rewards.approve"],
    approveScope: "all",
    approveLimits: {
      repPerObjective: 250,
      marksPerObjective: 10,
      marksPerQuest: 50,
    },
  });

  const approved = approveObjectiveReward(
    doc,
    "quest-one",
    "objective-one",
    {
      authority: approver,
      actorMemberId: "officer",
      actorName: "Rook",
      now: "2026-10-02T13:00:00.000Z",
    },
  );

  assert.equal(
    approved.quests[0].objectives[0].rewardApproval.approvedByName,
    "Rook",
  );

  const tooLarge = structuredClone(doc);
  tooLarge.quests[0].objectives[0].reward.rep = 251;

  assert.throws(
    () =>
      approveObjectiveReward(
        tooLarge,
        "quest-one",
        "objective-one",
        {
          authority: approver,
          actorMemberId: "officer",
          actorName: "Rook",
        },
      ),
    (error) =>
      error instanceof QuestGovernanceError &&
      error.code === "reward_authority_exceeded",
  );
});

test("reward issuance requires approval and its own independent bracket", () => {
  const unapproved = document([
    quest({
      creator: "creator-one",
      publication: "published",
      objectives: [objective({ rep: 100, marks: 5 })],
    }),
  ]);

  const issuer = authority({
    permissions: ["rewards.issue"],
    issueScope: "all",
    issueLimits: {
      repPerObjective: 100,
      marksPerObjective: 5,
      marksPerQuest: 20,
    },
  });

  assert.throws(
    () =>
      assertObjectiveCanIssue(
        unapproved,
        "quest-one",
        "objective-one",
        {
          authority: issuer,
          actorMemberId: "officer",
        },
      ),
    (error) =>
      error instanceof QuestGovernanceError &&
      error.code === "reward_approval_required",
  );

  const approved = document([
    quest({
      creator: "creator-one",
      publication: "published",
      objectives: [objective({ rep: 100, marks: 5, approved: true })],
    }),
  ]);

  assert.doesNotThrow(() =>
    assertObjectiveCanIssue(
      approved,
      "quest-one",
      "objective-one",
      {
        authority: issuer,
        actorMemberId: "officer",
      },
    ),
  );

  const lowerIssuer = authority({
    permissions: ["rewards.issue"],
    issueScope: "all",
    issueLimits: {
      repPerObjective: 50,
      marksPerObjective: 5,
      marksPerQuest: 20,
    },
  });

  assert.throws(
    () =>
      assertObjectiveCanIssue(
        approved,
        "quest-one",
        "objective-one",
        {
          authority: lowerIssuer,
          actorMemberId: "officer",
        },
      ),
    (error) =>
      error instanceof QuestGovernanceError &&
      error.code === "reward_authority_exceeded",
  );
});
