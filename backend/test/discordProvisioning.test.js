import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCHIVE_CATEGORY_NAME,
  DiscordApiClient,
  exportDiscordSnapshot,
  normalizeProvisioningState,
  pruneDiscordArchives,
  runDiscordProvisioning,
  validateDiscordManifest,
} from "../src/Discord/provisioning.js";

const GUILD_ID = "guild";
const BOT_ID = "bot";
const ALL_MANAGEMENT_PERMISSIONS = "268435504";

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function manifest() {
  return {
    version: 1,
    guild: {
      name: "Holdfast",
      verificationLevel: 1,
      defaultMessageNotifications: 1,
      explicitContentFilter: 2,
    },
    roles: [
      {
        key: "member",
        name: "Member",
        color: 123,
        hoist: true,
      },
    ],
    categories: [
      {
        key: "info",
        name: "INFO",
        channels: [
          {
            key: "general",
            name: "general",
            type: "text",
            topic: "Main room",
          },
        ],
      },
    ],
  };
}

function emptyState() {
  return normalizeProvisioningState(null, GUILD_ID);
}

function baseGuild() {
  return {
    id: GUILD_ID,
    name: "Holdfast",
    verification_level: 1,
    default_message_notifications: 1,
    explicit_content_filter: 2,
  };
}

function everyoneRole(permissions = "0") {
  return {
    id: GUILD_ID,
    name: "@everyone",
    color: 0,
    hoist: false,
    position: 0,
    permissions,
    managed: false,
    mentionable: false,
  };
}

function botRole(permissions = ALL_MANAGEMENT_PERMISSIONS, position = 10) {
  return {
    id: "bot-role",
    name: "Holdfast Bot",
    color: 0,
    hoist: true,
    position,
    permissions,
    managed: true,
    mentionable: false,
  };
}

function memberRole(overrides = {}) {
  return {
    id: "role-member",
    name: "Member",
    color: 123,
    hoist: true,
    position: 5,
    permissions: "0",
    managed: false,
    mentionable: false,
    ...overrides,
  };
}

function infoCategory(overrides = {}) {
  return {
    id: "category-info",
    name: "INFO",
    type: 4,
    position: 0,
    permission_overwrites: [],
    ...overrides,
  };
}

function generalChannel(overrides = {}) {
  return {
    id: "channel-general",
    name: "general",
    type: 0,
    position: 0,
    parent_id: "category-info",
    topic: "Main room",
    nsfw: false,
    rate_limit_per_user: 0,
    permission_overwrites: [],
    ...overrides,
  };
}

class FakeDiscordClient {
  constructor({
    guild = baseGuild(),
    roles = [everyoneRole(), botRole(), memberRole()],
    channels = [infoCategory(), generalChannel()],
    member = { roles: ["bot-role"] },
    roleMemberCounts = {},
  } = {}) {
    this.guild = copy(guild);
    this.roles = copy(roles);
    this.channels = copy(channels);
    this.member = copy(member);
    this.roleMemberCounts = copy(roleMemberCounts);
    this.writes = [];
    this.nextRole = 1;
    this.nextChannel = 1;
    this.token = "never-export-this-token";
  }

  async request(endpoint, options = {}) {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== "GET") this.writes.push({ endpoint, method, body });

    if (method === "GET" && endpoint === "/users/@me") {
      return { id: BOT_ID, username: "holdfast-bot" };
    }
    if (method === "GET" && endpoint === `/guilds/${GUILD_ID}`) {
      return copy(this.guild);
    }
    if (
      method === "GET" &&
      endpoint === `/guilds/${GUILD_ID}/members/${BOT_ID}`
    ) {
      return copy(this.member);
    }
    if (
      method === "GET" &&
      endpoint === `/guilds/${GUILD_ID}/roles/member-counts`
    ) {
      return copy(this.roleMemberCounts);
    }
    if (method === "GET" && endpoint === `/guilds/${GUILD_ID}/roles`) {
      return copy(this.roles);
    }
    if (method === "GET" && endpoint === `/guilds/${GUILD_ID}/channels`) {
      return copy(this.channels);
    }
    if (method === "PATCH" && endpoint === `/guilds/${GUILD_ID}`) {
      Object.assign(this.guild, body);
      return copy(this.guild);
    }
    if (method === "POST" && endpoint === `/guilds/${GUILD_ID}/roles`) {
      const role = {
        id: `created-role-${this.nextRole++}`,
        position: 1,
        managed: false,
        ...body,
      };
      this.roles.push(role);
      return copy(role);
    }
    if (method === "PATCH" && endpoint === `/guilds/${GUILD_ID}/roles`) {
      for (const update of body) {
        Object.assign(
          this.roles.find((role) => role.id === update.id),
          update,
        );
      }
      return copy(this.roles);
    }
    const roleMatch = endpoint.match(
      new RegExp(`^/guilds/${GUILD_ID}/roles/([^/]+)$`),
    );
    if (roleMatch && method === "PATCH") {
      const role = this.roles.find((item) => item.id === roleMatch[1]);
      Object.assign(role, body);
      return copy(role);
    }
    if (roleMatch && method === "DELETE") {
      this.roles = this.roles.filter((item) => item.id !== roleMatch[1]);
      return null;
    }
    if (method === "POST" && endpoint === `/guilds/${GUILD_ID}/channels`) {
      const channel = { id: `created-channel-${this.nextChannel++}`, ...body };
      this.channels.push(channel);
      return copy(channel);
    }
    const channelMatch = endpoint.match(/^\/channels\/([^/]+)$/);
    if (channelMatch && method === "PATCH") {
      const channel = this.channels.find((item) => item.id === channelMatch[1]);
      Object.assign(channel, body);
      return copy(channel);
    }
    if (channelMatch && method === "DELETE") {
      this.channels = this.channels.filter(
        (item) => item.id !== channelMatch[1],
      );
      return null;
    }

    throw new Error(`Unexpected fake Discord request: ${method} ${endpoint}`);
  }
}

function fakeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  };
}

test("API client sends bot auth and audit reason without leaking internal options", async () => {
  let request;
  const client = new DiscordApiClient("secret", {
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return fakeResponse(200, '{"ok":true}');
    },
  });
  const result = await client.request("/test", {
    method: "PATCH",
    body: "{}",
    auditReason: "Holdfast test reason",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(request.url, "https://discord.com/api/v10/test");
  assert.equal(request.options.headers.Authorization, "Bot secret");
  assert.equal(
    request.options.headers["X-Audit-Log-Reason"],
    "Holdfast%20test%20reason",
  );
  assert.equal("auditReason" in request.options, false);
});

test("API client retries rate limits and reports JSON or text failures", async () => {
  const waits = [];
  const responses = [
    fakeResponse(429, '{"retry_after":0.01}'),
    fakeResponse(200, ""),
  ];
  const client = new DiscordApiClient("secret", {
    fetchImplementation: async () => responses.shift(),
    sleepImplementation: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(await client.request("/rate-limited"), null);
  assert.deepEqual(waits, [250]);

  const jsonFailure = new DiscordApiClient("secret", {
    fetchImplementation: async () => fakeResponse(403, '{"message":"Nope"}'),
  });
  await assert.rejects(jsonFailure.request("/forbidden"), /\(403\): Nope/);

  const textFailure = new DiscordApiClient("secret", {
    fetchImplementation: async () => fakeResponse(500, "plain failure"),
  });
  await assert.rejects(textFailure.request("/broken"), /plain failure/);
});

test("manifest validation rejects duplicate keys, unknown roles, and reserved archive names", () => {
  const duplicate = manifest();
  duplicate.categories[0].channels.push({
    key: "general",
    name: "other",
    type: "text",
  });
  assert.throws(() => validateDiscordManifest(duplicate), /duplicate Discord channel key/);

  const unknownRole = manifest();
  unknownRole.categories[0].accessRoles = ["ghost"];
  assert.throws(() => validateDiscordManifest(unknownRole), /Unknown role ghost/);

  const reserved = manifest();
  reserved.categories[0].name = ARCHIVE_CATEGORY_NAME;
  assert.throws(() => validateDiscordManifest(reserved), /reserved/);
});

test("manifest validation rejects Discord limit and type hazards", () => {
  const cases = [
    [(value) => (value.version = 2), /version must be 1/],
    [(value) => (value.guild.name = " H"), /trimmed characters/],
    [(value) => (value.guild.verificationLevel = 5), /verificationLevel/],
    [
      (value) => (value.guild.defaultMessageNotifications = 2),
      /defaultMessageNotifications/,
    ],
    [(value) => (value.guild.explicitContentFilter = 3), /explicitContentFilter/],
    [(value) => (value.roles[0].key = "Bad-Key"), /lowercase letters/],
    [(value) => (value.roles[0].color = -1), /role color/],
    [(value) => (value.roles[0].hoist = "yes"), /hoist/],
    [(value) => (value.roles[0].mentionable = "yes"), /mentionable/],
    [(value) => (value.roles[0].unexpected = true), /unsupported fields/],
    [(value) => (value.categories[0].access = "public"), /unsupported fields/],
    [(value) => (value.categories[0].channels = "bad"), /channels must be an array/],
    [
      (value) => (value.categories[0].accessRoles = ["member", "member"]),
      /accessRoles cannot contain duplicates/,
    ],
    [
      (value) =>
        value.categories[0].channels.push({
          key: "general_two",
          name: "general",
          type: "text",
        }),
      /duplicate channel name/,
    ],
    [(value) => (value.categories[0].channels[0].type = "forum"), /Invalid channel type/],
    [
      (value) =>
        (value.categories[0].channels[0].writerRoles = ["member", "member"]),
      /writerRoles cannot contain duplicates/,
    ],
    [
      (value) => (value.categories[0].channels[0].topic = "x".repeat(4097)),
      /channel topic/,
    ],
    [(value) => (value.categories[0].channels[0].slowmodeSeconds = 21_601), /slowmode/],
    [(value) => (value.categories[0].channels[0].bitrate = 7_999), /bitrate/],
    [(value) => (value.categories[0].channels[0].userLimit = 100), /userLimit/],
    [(value) => (value.categories[0].channels[0].readOnly = "yes"), /readOnly/],
    [
      (value) => (value.categories[0].channels[0].bitrate = 64_000),
      /voice-only fields/,
    ],
    [
      (value) => (value.categories[0].channels[0].type = "voice"),
      /text-only fields/,
    ],
  ];

  for (const [mutate, expected] of cases) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateDiscordManifest(value), expected);
  }
});

test("legacy state is upgraded and cannot cross guilds", () => {
  const upgraded = normalizeProvisioningState(
    { version: 1, guildId: GUILD_ID, roles: { member: "r1" }, channels: {} },
    GUILD_ID,
  );
  assert.equal(upgraded.version, 2);
  assert.deepEqual(upgraded.archived, { roles: {}, channels: {} });
  assert.throws(
    () => normalizeProvisioningState({ guildId: "other" }, GUILD_ID),
    /different guild/,
  );

  const recovered = normalizeProvisioningState(
    {
      guildId: GUILD_ID,
      archived: {
        roles: { old_role: { id: "archived-role" } },
        channels: { old_channel: { id: "archived-channel" } },
      },
    },
    GUILD_ID,
  );
  assert.equal(recovered.roles.old_role, "archived-role");
  assert.equal(recovered.channels.old_channel, "archived-channel");
});

test("plan adopts an unambiguous existing server without writing", async () => {
  const client = new FakeDiscordClient();
  const result = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: emptyState(),
    command: "plan",
    now: "2026-01-10T00:00:00.000Z",
  });

  assert.equal(client.writes.length, 0);
  assert.equal(result.state.roles.member, "role-member");
  assert.equal(result.state.channels.info, "category-info");
  assert.equal(result.state.channels.general, "channel-general");
  assert.deepEqual(
    result.report.changes.map((change) => change.type),
    ["state.adopt-role", "state.adopt-channel", "state.adopt-channel"],
  );
});

test("ambiguous role adoption fails before any write", async () => {
  const client = new FakeDiscordClient({
    roles: [
      everyoneRole(),
      botRole(),
      memberRole(),
      memberRole({ id: "role-member-2", position: 4 }),
    ],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /Ambiguous role adoption/,
  );
  assert.equal(client.writes.length, 0);
});

test("ambiguous channel adoption fails before any write", async () => {
  const client = new FakeDiscordClient({
    channels: [
      infoCategory(),
      generalChannel(),
      generalChannel({ id: "channel-general-2" }),
    ],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /Ambiguous channel adoption/,
  );
  assert.equal(client.writes.length, 0);
});

test("missing permissions stop the complete plan before any write", async () => {
  const client = new FakeDiscordClient({
    roles: [everyoneRole(), botRole("0")],
    channels: [],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /missing Manage Roles/,
  );
  assert.equal(client.writes.length, 0);
});

test("equal numeric role positions require a strict bot hierarchy", async () => {
  const client = new FakeDiscordClient({
    roles: [
      everyoneRole(),
      { ...botRole(ALL_MANAGEMENT_PERMISSIONS, 10), id: "100" },
      memberRole({ id: "200", position: 10, color: 999 }),
    ],
    member: { roles: ["100"] },
  });

  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /strictly higher position.*drag it below and back above/,
  );
  assert.equal(client.writes.length, 0);
});

test("fresh role creation stops before channels when the bot has no hierarchy space", async () => {
  const client = new FakeDiscordClient({
    roles: [everyoneRole(), botRole(ALL_MANAGEMENT_PERMISSIONS, 1)],
    channels: [],
  });

  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /strictly higher position/,
  );

  assert.ok(
    client.writes.some(
      (write) =>
        write.endpoint === `/guilds/${GUILD_ID}/roles` &&
        write.method === "POST",
    ),
  );
  assert.equal(
    client.writes.some((write) =>
      write.endpoint.endsWith("/channels"),
    ),
    false,
  );
});

test("role hierarchy violations stop before any write", async () => {
  const client = new FakeDiscordClient({
    roles: [
      everyoneRole(),
      botRole(ALL_MANAGEMENT_PERMISSIONS, 10),
      memberRole({ position: 11, color: 999 }),
    ],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /strictly higher position/,
  );
  assert.equal(client.writes.length, 0);
});

test("corrupt state cannot claim managed roles or the wrong channel type", async () => {
  const managedClient = new FakeDiscordClient();
  const managedState = emptyState();
  managedState.roles.member = "bot-role";
  await assert.rejects(
    runDiscordProvisioning({
      client: managedClient,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: managedState,
      command: "apply",
    }),
    /is not user-managed/,
  );
  assert.equal(managedClient.writes.length, 0);

  const wrongTypeClient = new FakeDiscordClient({
    channels: [
      infoCategory(),
      generalChannel(),
      infoCategory({ id: "wrong-type", name: "WRONG" }),
    ],
  });
  const wrongTypeState = emptyState();
  wrongTypeState.channels.general = "wrong-type";
  await assert.rejects(
    runDiscordProvisioning({
      client: wrongTypeClient,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: wrongTypeState,
      command: "apply",
    }),
    /has type 4; expected 0/,
  );
  assert.equal(wrongTypeClient.writes.length, 0);
});

test("a missing archived resource fails closed instead of losing identity", async () => {
  const client = new FakeDiscordClient({
    roles: [everyoneRole(), botRole()],
  });
  const state = normalizeProvisioningState(
    {
      guildId: GUILD_ID,
      archived: {
        roles: {
          member: {
            id: "deleted-role",
            archivedName: "Archived · Member",
            archivedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    },
    GUILD_ID,
  );
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: manifest(),
      state,
      command: "restore",
    }),
    /Archived Discord role member .* no longer exists/,
  );
  assert.equal(client.writes.length, 0);
});

test("Manage Server and Manage Channels are independently preflighted", async () => {
  const noServer = new FakeDiscordClient({
    guild: { ...baseGuild(), name: "Wrong" },
    roles: [everyoneRole(), botRole(String((1n << 28n) | (1n << 4n))), memberRole()],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client: noServer,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /missing Manage Server/,
  );
  assert.equal(noServer.writes.length, 0);

  const noChannels = new FakeDiscordClient({
    channels: [infoCategory(), generalChannel({ topic: "Wrong" })],
    roles: [everyoneRole(), botRole(String((1n << 28n) | (1n << 5n))), memberRole()],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client: noChannels,
      guildId: GUILD_ID,
      manifest: manifest(),
      state: emptyState(),
      command: "apply",
    }),
    /missing Manage Channels/,
  );
  assert.equal(noChannels.writes.length, 0);
});

test("Administrator permission satisfies all provisioning preflights", async () => {
  const client = new FakeDiscordClient({
    guild: { ...baseGuild(), name: "Wrong" },
    roles: [everyoneRole(), botRole("8"), memberRole({ color: 999 })],
    channels: [infoCategory(), generalChannel({ topic: "Wrong" })],
  });
  await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: emptyState(),
    command: "apply",
  });
  assert.ok(client.writes.length >= 3);
});

test("apply creates missing resources and a second apply is idempotent", async () => {
  const client = new FakeDiscordClient({
    roles: [everyoneRole(), botRole()],
    channels: [],
  });
  const first = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: emptyState(),
    command: "apply",
  });
  assert.ok(first.roleIds.member);
  assert.ok(first.state.channels.info);
  assert.ok(first.state.channels.general);
  assert.ok(client.writes.length > 0);

  client.writes = [];
  const second = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: first.state,
    command: "apply",
  });
  assert.equal(client.writes.length, 0);
  assert.deepEqual(second.report.changes, []);
});

test("apply reconciles guild, role, text, voice, and permission-overwrite fields", async () => {
  const desiredManifest = manifest();
  desiredManifest.categories[0].accessRoles = ["member"];
  desiredManifest.categories[0].channels[0].readOnly = true;
  desiredManifest.categories[0].channels[0].writerRoles = ["member"];
  desiredManifest.categories[0].channels.push({
    key: "lounge",
    name: "Lounge",
    type: "voice",
    bitrate: 96000,
    userLimit: 8,
  });
  const client = new FakeDiscordClient({
    guild: { ...baseGuild(), name: "Old name" },
    roles: [everyoneRole(), botRole(), memberRole({ color: 999 })],
  });
  let checkpoints = 0;
  const result = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: desiredManifest,
    state: emptyState(),
    command: "apply",
    onStateChange: async () => {
      checkpoints += 1;
    },
  });

  assert.equal(client.guild.name, "Holdfast");
  assert.equal(client.roles.find((role) => role.id === "role-member").color, 123);
  assert.equal(
    client.channels.find((channel) => channel.id === "category-info")
      .permission_overwrites.length,
    2,
  );
  const text = client.channels.find((channel) => channel.id === "channel-general");
  assert.equal(text.permission_overwrites.length, 2);
  assert.equal(text.permission_overwrites.find((entry) => entry.id === "role-member").deny, "0");
  const voice = client.channels.find((channel) => channel.id === result.state.channels.lounge);
  assert.equal(voice.bitrate, 96000);
  assert.equal(voice.user_limit, 8);
  assert.equal(checkpoints, 2);
});

test("removed managed resources archive and restore with the same IDs", async () => {
  const client = new FakeDiscordClient();
  const adopted = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: emptyState(),
    command: "apply",
    now: "2026-01-01T00:00:00.000Z",
  });
  const emptyManifest = manifest();
  emptyManifest.roles = [];
  emptyManifest.categories = [];
  const archived = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: emptyManifest,
    state: adopted.state,
    command: "apply",
    now: "2026-01-02T00:00:00.000Z",
  });

  assert.equal(archived.state.archived.roles.member.id, "role-member");
  assert.equal(
    archived.state.archived.channels.general.id,
    "channel-general",
  );
  assert.ok(archived.state.archiveCategoryId);
  assert.equal(
    client.roles.find((role) => role.id === "role-member").name,
    "Archived · Member",
  );

  Object.assign(client.roles.find((role) => role.id === "role-member"), {
    name: "tampered-role",
    hoist: true,
    permissions: "8",
  });
  Object.assign(
    client.channels.find((channel) => channel.id === "channel-general"),
    {
      name: "tampered-channel",
      parent_id: "category-info",
      permission_overwrites: [],
    },
  );
  client.writes = [];
  const reconciled = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: emptyManifest,
    state: archived.state,
    command: "apply",
    now: "2026-01-02T12:00:00.000Z",
  });
  assert.ok(
    reconciled.report.changes.some(
      (change) => change.type === "role.archive-reconcile",
    ),
  );
  assert.ok(
    reconciled.report.changes.some(
      (change) => change.type === "channel.archive-reconcile",
    ),
  );
  assert.equal(
    client.roles.find((role) => role.id === "role-member").permissions,
    "0",
  );
  assert.equal(
    client.channels.find((channel) => channel.id === "channel-general")
      .parent_id,
    archived.state.archiveCategoryId,
  );
  assert.equal(
    reconciled.state.archived.roles.member.archivedAt,
    "2026-01-02T00:00:00.000Z",
  );

  const restored = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: reconciled.state,
    command: "restore",
    now: "2026-01-03T00:00:00.000Z",
  });
  assert.equal(restored.state.roles.member, "role-member");
  assert.equal(restored.state.channels.info, "category-info");
  assert.equal(restored.state.channels.general, "channel-general");
  assert.deepEqual(restored.state.archived, { roles: {}, channels: {} });
  assert.equal(
    client.roles.find((role) => role.id === "role-member").name,
    "Member",
  );
  assert.ok(
    restored.report.changes.some((change) => change.type === "role.restore"),
  );
  assert.ok(
    restored.report.changes.some((change) => change.type === "channel.restore"),
  );
});

test("archiving a category refuses to alter unmanaged child channels", async () => {
  const client = new FakeDiscordClient({
    channels: [
      infoCategory(),
      generalChannel(),
      generalChannel({ id: "unmanaged", name: "staff-notes" }),
    ],
  });
  const adopted = await runDiscordProvisioning({
    client,
    guildId: GUILD_ID,
    manifest: manifest(),
    state: emptyState(),
    command: "plan",
  });
  const emptyManifest = manifest();
  emptyManifest.roles = [];
  emptyManifest.categories = [];
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: emptyManifest,
      state: adopted.state,
      command: "apply",
    }),
    /move unmanaged child channels first: staff-notes \(unmanaged\)/,
  );
  assert.equal(client.writes.length, 0);
});

test("category permission changes refuse synced unmanaged children", async () => {
  const desiredManifest = manifest();
  desiredManifest.categories[0].accessRoles = ["member"];
  const client = new FakeDiscordClient({
    channels: [
      infoCategory(),
      generalChannel(),
      generalChannel({ id: "unmanaged", name: "staff-notes" }),
    ],
  });
  await assert.rejects(
    runDiscordProvisioning({
      client,
      guildId: GUILD_ID,
      manifest: desiredManifest,
      state: emptyState(),
      command: "apply",
    }),
    /move or unsync unmanaged child channels first: staff-notes \(unmanaged\)/,
  );
  assert.equal(client.writes.length, 0);
});

function archivedFixture({ memberCount = 0 } = {}) {
  const role = memberRole({ name: "Archived · Member", hoist: false });
  const channel = generalChannel({
    name: "archived-general",
    parent_id: "archive-category",
  });
  const state = normalizeProvisioningState(
    {
      guildId: GUILD_ID,
      roles: { member: role.id },
      channels: { general: channel.id },
      archived: {
        roles: {
          member: {
            id: role.id,
            originalName: "Member",
            archivedName: role.name,
            archivedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        channels: {
          general: {
            id: channel.id,
            originalName: "general",
            archivedName: channel.name,
            archivedAt: "2026-01-01T00:00:00.000Z",
            type: 0,
          },
        },
      },
      archiveCategoryId: "archive-category",
    },
    GUILD_ID,
  );
  const client = new FakeDiscordClient({
    roles: [everyoneRole(), botRole(), role],
    channels: [
      infoCategory({
        id: "archive-category",
        name: ARCHIVE_CATEGORY_NAME,
      }),
      channel,
    ],
    roleMemberCounts: { [role.id]: memberCount },
  });
  return { client, state };
}

test("prune is read-only by default and apply requires exact guild confirmation", async () => {
  const { client, state } = archivedFixture();
  const planned = await pruneDiscordArchives({
    client,
    guildId: GUILD_ID,
    state,
    now: "2026-01-10T00:00:00.000Z",
    minimumAgeDays: 7,
  });
  assert.equal(client.writes.length, 0);
  assert.ok(
    planned.report.changes.some((change) => change.type === "role.prune"),
  );
  await assert.rejects(
    pruneDiscordArchives({
      client,
      guildId: GUILD_ID,
      state,
      apply: true,
      confirmation: "wrong",
    }),
    /requires --confirm guild/,
  );
  assert.equal(client.writes.length, 0);
});

test("prune enforces minimum age and preserves roles that still have members", async () => {
  const { client, state } = archivedFixture({ memberCount: 2 });
  state.archived.channels.general.archivedAt = "2026-01-09T00:00:00.000Z";
  const result = await pruneDiscordArchives({
    client,
    guildId: GUILD_ID,
    state,
    apply: true,
    confirmation: GUILD_ID,
    now: "2026-01-10T00:00:00.000Z",
    minimumAgeDays: 7,
  });
  assert.equal(client.writes.length, 0);
  assert.ok(
    result.report.changes.some(
      (change) => change.type === "prune.blocked-members",
    ),
  );
  assert.ok(
    result.report.changes.some((change) => change.type === "prune.skip-young"),
  );
});

test("prune refuses a role when Discord omits its member count", async () => {
  const { client, state } = archivedFixture();
  client.roleMemberCounts = {};
  const result = await pruneDiscordArchives({
    client,
    guildId: GUILD_ID,
    state,
    now: "2026-01-10T00:00:00.000Z",
    minimumAgeDays: 7,
  });
  assert.ok(
    result.report.changes.some(
      (change) => change.type === "prune.blocked-count-unknown",
    ),
  );
  assert.equal(
    result.report.changes.some((change) => change.type === "role.prune"),
    false,
  );
  await assert.rejects(
    pruneDiscordArchives({
      client,
      guildId: GUILD_ID,
      state,
      now: "not-a-date",
    }),
    /Invalid archivedAt for prune now/,
  );
});

test("confirmed prune repairs state after an earlier partial deletion", async () => {
  const { client, state } = archivedFixture();
  client.roles = client.roles.filter((role) => role.id !== "role-member");
  client.channels = client.channels.filter(
    (channel) => channel.id !== "channel-general",
  );
  const checkpoints = [];
  const result = await pruneDiscordArchives({
    client,
    guildId: GUILD_ID,
    state,
    apply: true,
    confirmation: GUILD_ID,
    now: "2026-01-10T00:00:00.000Z",
    minimumAgeDays: 7,
    onStateChange: async (nextState) => checkpoints.push(nextState),
  });

  assert.equal(client.writes.length, 0);
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(result.state.archived, { roles: {}, channels: {} });
  assert.equal(
    result.report.changes.filter(
      (change) => change.type === "prune.clean-missing",
    ).length,
    2,
  );
});

test("confirmed prune deletes only eligible archived resources", async () => {
  const { client, state } = archivedFixture();
  const result = await pruneDiscordArchives({
    client,
    guildId: GUILD_ID,
    state,
    apply: true,
    confirmation: GUILD_ID,
    now: "2026-01-10T00:00:00.000Z",
    minimumAgeDays: 7,
  });
  assert.equal(client.roles.some((role) => role.id === "role-member"), false);
  assert.equal(
    client.channels.some((channel) => channel.id === "channel-general"),
    false,
  );
  assert.equal(result.state.roles.member, undefined);
  assert.equal(result.state.channels.general, undefined);
  assert.deepEqual(result.state.archived, { roles: {}, channels: {} });
});

test("export is deterministic and never exposes the API token", async () => {
  const client = new FakeDiscordClient();
  const snapshot = await exportDiscordSnapshot({
    client,
    guildId: GUILD_ID,
    now: "2026-01-10T00:00:00.000Z",
  });
  assert.equal(snapshot.guild.id, GUILD_ID);
  assert.equal(snapshot.roles[0].id, "bot-role");
  assert.equal(JSON.stringify(snapshot).includes(client.token), false);
  assert.equal("token" in snapshot, false);
  assert.equal(client.writes.length, 0);
});
