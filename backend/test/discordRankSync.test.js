import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileDiscordMemberRanks,
  syncDiscordMemberRank,
} from "../src/Discord/rankSync.js";
import { GUILD_RANKS } from "../src/Guild/rankSystem.js";

const GUILD_ID = "223456789012345678";
const MEMBER_ID = "323456789012345678";
const UNRELATED_ROLE_ID = "999999999999999999";

function environment() {
  return {
    DISCORD_GUILD_ID: GUILD_ID,
    DISCORD_BOT_TOKEN: "bot-token",
  };
}

function rankRoles() {
  return GUILD_RANKS.map((name, index) => ({
    id: String(500000000000000000n + BigInt(index)),
    name,
    managed: false,
    position: index + 1,
  }));
}

class FakeDiscordClient {
  constructor({
    roles = rankRoles(),
    members = {},
  } = {}) {
    this.roles = roles;
    this.members = new Map(
      Object.entries(members).map(([id, roleIds]) => [
        id,
        { roles: [...roleIds] },
      ]),
    );
    this.writes = [];
  }

  async request(endpoint, options = {}) {
    const method = options.method || "GET";

    if (method === "GET" && endpoint === `/guilds/${GUILD_ID}/roles`) {
      return this.roles.map((role) => ({ ...role }));
    }

    const memberMatch = endpoint.match(
      new RegExp(`^/guilds/${GUILD_ID}/members/([^/]+)$`),
    );

    if (method === "GET" && memberMatch) {
      const member = this.members.get(memberMatch[1]);

      if (!member) {
        const error = new Error("missing");
        error.status = 404;
        throw error;
      }

      return { roles: [...member.roles] };
    }

    const roleMatch = endpoint.match(
      new RegExp(
        `^/guilds/${GUILD_ID}/members/([^/]+)/roles/([^/]+)$`,
      ),
    );

    if (roleMatch && (method === "PUT" || method === "DELETE")) {
      const [, memberId, roleId] = roleMatch;
      const member = this.members.get(memberId);

      if (!member) {
        const error = new Error("missing");
        error.status = 404;
        throw error;
      }

      this.writes.push({ endpoint, method });

      if (method === "PUT" && !member.roles.includes(roleId)) {
        member.roles.push(roleId);
      }

      if (method === "DELETE") {
        member.roles = member.roles.filter((id) => id !== roleId);
      }

      return null;
    }

    throw new Error(`Unexpected Discord request: ${method} ${endpoint}`);
  }
}

function roleId(roles, rank) {
  return roles.find((role) => role.name === rank).id;
}

test("rank sync adds the website rank, removes stale Holdfast ranks, and preserves unrelated roles", async () => {
  const roles = rankRoles();
  const recruit = roleId(roles, "Recruit");
  const sergeant = roleId(roles, "Sergeant");
  const client = new FakeDiscordClient({
    roles,
    members: {
      [MEMBER_ID]: [recruit, UNRELATED_ROLE_ID],
    },
  });

  const result = await syncDiscordMemberRank(
    {
      id: MEMBER_ID,
      rank: "Sergeant",
      rankManaged: true,
    },
    {
      env: environment(),
      client,
      liveRoles: roles,
    },
  );

  assert.equal(result.status, "synced");
  assert.equal(result.added, true);
  assert.equal(result.removed, 1);
  assert.deepEqual(
    new Set(client.members.get(MEMBER_ID).roles),
    new Set([sergeant, UNRELATED_ROLE_ID]),
  );
  assert.deepEqual(
    client.writes.map((write) => write.method),
    ["PUT", "DELETE"],
  );
});

test("rank sync is idempotent when Discord already matches the website", async () => {
  const roles = rankRoles();
  const corporal = roleId(roles, "Corporal");
  const client = new FakeDiscordClient({
    roles,
    members: {
      [MEMBER_ID]: [corporal, UNRELATED_ROLE_ID],
    },
  });

  const result = await syncDiscordMemberRank(
    {
      id: MEMBER_ID,
      rank: "Corporal",
      rankManaged: true,
    },
    {
      env: environment(),
      client,
      liveRoles: roles,
    },
  );

  assert.equal(result.status, "unchanged");
  assert.equal(client.writes.length, 0);
});

test("rank sync reports members who are no longer in Discord without inventing membership", async () => {
  const roles = rankRoles();
  const client = new FakeDiscordClient({ roles });

  const result = await syncDiscordMemberRank(
    {
      id: MEMBER_ID,
      rank: "Private",
      rankManaged: true,
    },
    {
      env: environment(),
      client,
      liveRoles: roles,
    },
  );

  assert.equal(result.status, "missing");
  assert.equal(client.writes.length, 0);
});

test("reconciliation repairs only ranks that the website has claimed authority over", async () => {
  const roles = rankRoles();
  const recruit = roleId(roles, "Recruit");
  const privateRole = roleId(roles, "Private");
  const sergeant = roleId(roles, "Sergeant");
  const client = new FakeDiscordClient({
    roles,
    members: {
      managed: [recruit],
      legacy: [privateRole],
    },
  });

  const summary = await reconcileDiscordMemberRanks({
    env: environment(),
    client,
    members: [
      {
        id: "managed",
        rank: "Sergeant",
        rankManaged: true,
      },
      {
        id: "legacy",
        rank: "Private",
        rankManaged: false,
      },
    ],
    logger: { error() {} },
  });

  assert.deepEqual(summary, {
    checked: 1,
    changed: 1,
    unchanged: 0,
    missing: 0,
    failed: 0,
    unmanaged: 1,
  });
  assert.deepEqual(client.members.get("legacy").roles, [privateRole]);
  assert.deepEqual(client.members.get("managed").roles, [sergeant]);
});
