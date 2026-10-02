import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureDiscordBilletRoles,
  reconcileDiscordBillets,
  syncDiscordMemberBillets,
} from "../src/Discord/billetSync.js";

const GUILD_ID = "223456789012345678";
const MEMBER_ID = "323456789012345678";
const UNRELATED_ROLE_ID = "999999999999999999";

function environment() {
  return {
    DISCORD_GUILD_ID: GUILD_ID,
    DISCORD_BOT_TOKEN: "bot-token",
  };
}

class FakeDiscordClient {
  constructor({ roles = [], members = {} } = {}) {
    this.roles = roles.map((role) => ({ ...role }));
    this.members = new Map(
      Object.entries(members).map(([id, roleIds]) => [
        id,
        { roles: [...roleIds] },
      ]),
    );
    this.writes = [];
    this.nextRole = 700000000000000000n;
  }

  async request(endpoint, options = {}) {
    const method = options.method || "GET";

    if (method === "GET" && endpoint === `/guilds/${GUILD_ID}/roles`) {
      return this.roles.map((role) => ({ ...role }));
    }

    if (method === "POST" && endpoint === `/guilds/${GUILD_ID}/roles`) {
      const body = JSON.parse(options.body);
      const role = {
        id: String(this.nextRole++),
        name: body.name,
        managed: false,
        permissions: body.permissions,
      };
      this.roles.push(role);
      this.writes.push({ method, endpoint, body });
      return { ...role };
    }

    const rolePatch = endpoint.match(
      new RegExp(`^/guilds/${GUILD_ID}/roles/([^/]+)$`),
    );

    if (method === "PATCH" && rolePatch) {
      const role = this.roles.find((candidate) => candidate.id === rolePatch[1]);
      if (!role) throw new Error("missing role");
      const body = JSON.parse(options.body);
      Object.assign(role, body);
      this.writes.push({ method, endpoint, body });
      return { ...role };
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

    const assignment = endpoint.match(
      new RegExp(
        `^/guilds/${GUILD_ID}/members/([^/]+)/roles/([^/]+)$`,
      ),
    );

    if (assignment && (method === "PUT" || method === "DELETE")) {
      const [, memberId, roleId] = assignment;
      const member = this.members.get(memberId);
      if (!member) {
        const error = new Error("missing");
        error.status = 404;
        throw error;
      }

      if (method === "PUT" && !member.roles.includes(roleId)) {
        member.roles.push(roleId);
      }

      if (method === "DELETE") {
        member.roles = member.roles.filter((id) => id !== roleId);
      }

      this.writes.push({ method, endpoint });
      return null;
    }

    throw new Error(`Unexpected request: ${method} ${endpoint}`);
  }
}

test("seeded billets adopt matching Discord roles instead of duplicating them", async () => {
  const client = new FakeDiscordClient({
    roles: [
      {
        id: "500000000000000001",
        name: "Quartermaster",
        managed: false,
      },
    ],
  });
  const persisted = [];

  const result = await ensureDiscordBilletRoles({
    env: environment(),
    client,
    billets: [
      {
        id: "billet-quartermaster",
        name: "Quartermaster",
        responsibility: "",
        discordRoleId: null,
      },
    ],
    persistRoleId: async (...args) => persisted.push(args),
  });

  assert.equal(client.roles.length, 1);
  assert.equal(
    result.rolesByBilletId.get("billet-quartermaster").id,
    "500000000000000001",
  );
  assert.deepEqual(persisted, [
    ["billet-quartermaster", "500000000000000001"],
  ]);
});

test("new billets create a zero-permission Discord role", async () => {
  const client = new FakeDiscordClient();
  const persisted = [];

  const result = await ensureDiscordBilletRoles({
    env: environment(),
    client,
    billets: [
      {
        id: "billet-recruiter",
        name: "Recruiter",
        responsibility: "",
        discordRoleId: null,
      },
    ],
    persistRoleId: async (...args) => persisted.push(args),
  });

  const role = result.rolesByBilletId.get("billet-recruiter");
  assert.equal(role.name, "Recruiter");
  assert.equal(client.writes[0].method, "POST");
  assert.equal(client.writes[0].body.permissions, "0");
  assert.deepEqual(persisted, [["billet-recruiter", role.id]]);
});

test("member billet sync adds desired billets, removes stale billets, and preserves unrelated roles", async () => {
  const quartermaster = {
    id: "billet-quartermaster",
    name: "Quartermaster",
    responsibility: "",
    discordRoleId: "500000000000000001",
  };
  const recruiter = {
    id: "billet-recruiter",
    name: "Recruiter",
    responsibility: "",
    discordRoleId: "500000000000000002",
  };
  const client = new FakeDiscordClient({
    roles: [
      {
        id: quartermaster.discordRoleId,
        name: quartermaster.name,
        managed: false,
      },
      {
        id: recruiter.discordRoleId,
        name: recruiter.name,
        managed: false,
      },
    ],
    members: {
      [MEMBER_ID]: [quartermaster.discordRoleId, UNRELATED_ROLE_ID],
    },
  });
  const roleMap = new Map([
    [
      quartermaster.id,
      client.roles.find((role) => role.id === quartermaster.discordRoleId),
    ],
    [
      recruiter.id,
      client.roles.find((role) => role.id === recruiter.discordRoleId),
    ],
  ]);

  const result = await syncDiscordMemberBillets(
    {
      id: MEMBER_ID,
      billets: [recruiter],
    },
    {
      env: environment(),
      client,
      billets: [quartermaster, recruiter],
      liveRoles: client.roles,
      rolesByBilletId: roleMap,
    },
  );

  assert.equal(result.status, "synced");
  assert.deepEqual(
    new Set(client.members.get(MEMBER_ID).roles),
    new Set([recruiter.discordRoleId, UNRELATED_ROLE_ID]),
  );
});

test("billet reconciliation repairs manual Discord drift", async () => {
  const billet = {
    id: "billet-quartermaster",
    name: "Quartermaster",
    responsibility: "",
    discordRoleId: "500000000000000001",
  };
  const client = new FakeDiscordClient({
    roles: [
      {
        id: billet.discordRoleId,
        name: billet.name,
        managed: false,
      },
    ],
    members: {
      managed: [],
    },
  });

  const summary = await reconcileDiscordBillets({
    env: environment(),
    client,
    billets: [billet],
    members: [
      {
        id: "managed",
        billets: [billet],
      },
    ],
    persistRoleId: async () => {},
    logger: { error() {} },
  });

  assert.equal(summary.changed, 1);
  assert.deepEqual(client.members.get("managed").roles, [
    billet.discordRoleId,
  ]);
});
