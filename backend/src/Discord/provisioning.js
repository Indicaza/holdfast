const API = "https://discord.com/api/v10";

export const CHANNEL_TYPES = Object.freeze({ text: 0, voice: 2, category: 4 });

const ROLE_OVERWRITE = 0;
const MEMBER_OVERWRITE = 1;
const ADMINISTRATOR = 1n << 3n;
const MANAGE_CHANNELS = 1n << 4n;
const MANAGE_GUILD = 1n << 5n;
const MANAGE_ROLES = 1n << 28n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const CREATE_PUBLIC_THREADS = 1n << 35n;
const CREATE_PRIVATE_THREADS = 1n << 36n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;
const READ_ONLY_DENY =
  SEND_MESSAGES |
  CREATE_PUBLIC_THREADS |
  CREATE_PRIVATE_THREADS |
  SEND_MESSAGES_IN_THREADS;

export const ARCHIVE_CATEGORY_NAME = "HOLDFAST ARCHIVE";
const REPORT_VERSION = 1;
const STATE_VERSION = 2;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class DiscordApiClient {
  constructor(
    token,
    {
      fetchImplementation = fetch,
      sleepImplementation = sleep,
      requestTimeoutMilliseconds = 15_000,
    } = {},
  ) {
    this.token = token;
    this.fetchImplementation = fetchImplementation;
    this.sleepImplementation = sleepImplementation;
    this.requestTimeoutMilliseconds = requestTimeoutMilliseconds;
  }

  async request(endpoint, options = {}, attempt = 0) {
    const {
      auditReason = "Holdfast manifest sync",
      headers = {},
      ...requestOptions
    } = options;
    const response = await this.fetchImplementation(`${API}${endpoint}`, {
      ...requestOptions,
      signal:
        requestOptions.signal ||
        AbortSignal.timeout(this.requestTimeoutMilliseconds),
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": encodeURIComponent(auditReason),
        ...headers,
      },
    });
    const raw = await response.text();
    let body = null;

    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    if (response.status === 429 && attempt < 5) {
      const retrySeconds = Math.max(0.25, Number(body?.retry_after) || 1);
      await this.sleepImplementation(retrySeconds * 1000);
      return this.request(endpoint, options, attempt + 1);
    }

    if (!response.ok) {
      const detail =
        typeof body === "string"
          ? body.slice(0, 300)
          : body?.message || "Unknown Discord API error";
      const error = new Error(
        `Discord ${options.method || "GET"} ${endpoint} failed (${response.status}): ${detail}`,
      );
      error.status = response.status;
      throw error;
    }

    return body;
  }
}

function assertArray(value, message) {
  if (!Array.isArray(value)) throw new Error(message);
}

function assertUnique(value, values, message) {
  if (!value || values.has(value)) throw new Error(message);
  values.add(value);
}

function assertKey(value, label) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value || "")) {
    throw new Error(`${label} must use lowercase letters, numbers, and underscores`);
  }
}

function assertText(value, label, { minimum = 1, maximum = 100 } = {}) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(`${label} must be ${minimum}-${maximum} trimmed characters`);
  }
}

function assertInteger(value, label, minimum, maximum, { optional = true } = {}) {
  if (optional && value === undefined) return;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function assertUniqueList(value, label) {
  assertArray(value, `${label} must be an array`);
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} cannot contain duplicates`);
  }
}

function assertKnownKeys(value, allowedKeys, label) {
  const unknown = Object.keys(value || {}).filter((key) => !allowedKeys.has(key));
  if (unknown.length) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
  }
}

export function validateDiscordManifest(manifest) {
  if (!manifest || manifest.version !== 1) {
    throw new Error("Discord manifest version must be 1");
  }
  if (!manifest.guild?.name) {
    throw new Error("Discord manifest guild.name is required");
  }
  assertKnownKeys(
    manifest,
    new Set(["version", "guild", "roles", "categories"]),
    "Discord manifest",
  );
  assertKnownKeys(
    manifest.guild,
    new Set([
      "name",
      "verificationLevel",
      "defaultMessageNotifications",
      "explicitContentFilter",
    ]),
    "Discord guild manifest",
  );
  assertText(manifest.guild.name, "Discord guild name", {
    minimum: 2,
    maximum: 100,
  });
  assertInteger(
    manifest.guild.verificationLevel,
    "Discord verificationLevel",
    0,
    4,
    { optional: false },
  );
  assertInteger(
    manifest.guild.defaultMessageNotifications,
    "Discord defaultMessageNotifications",
    0,
    1,
    { optional: false },
  );
  assertInteger(
    manifest.guild.explicitContentFilter,
    "Discord explicitContentFilter",
    0,
    2,
    { optional: false },
  );

  assertArray(manifest.roles, "Discord manifest roles must be an array");
  assertArray(
    manifest.categories,
    "Discord manifest categories must be an array",
  );
  if (manifest.roles.length > 249) {
    throw new Error("Discord manifest cannot manage more than 249 custom roles");
  }

  const roleKeys = new Set();
  const roleNames = new Set();
  const channelKeys = new Set();
  const categoryNames = new Set();

  for (const role of manifest.roles) {
    assertKnownKeys(
      role,
      new Set(["key", "name", "color", "hoist", "mentionable"]),
      `Discord role ${role?.key || "unknown"}`,
    );
    assertUnique(
      role?.key,
      roleKeys,
      `Invalid or duplicate Discord role key: ${role?.key}`,
    );
    assertUnique(
      role?.name,
      roleNames,
      `Invalid or duplicate Discord role name: ${role?.name}`,
    );
    assertKey(role.key, `Discord role key ${role.key}`);
    assertText(role.name, `Discord role name ${role.key}`);
    assertInteger(role.color, `Discord role color ${role.key}`, 0, 16_777_215);
    if (role.hoist !== undefined && typeof role.hoist !== "boolean") {
      throw new Error(`Discord role hoist ${role.key} must be boolean`);
    }
    if (role.mentionable !== undefined && typeof role.mentionable !== "boolean") {
      throw new Error(`Discord role mentionable ${role.key} must be boolean`);
    }
  }

  let channelCount = 0;
  for (const category of manifest.categories) {
    assertKnownKeys(
      category,
      new Set(["key", "name", "accessRoles", "channels"]),
      `Discord category ${category?.key || "unknown"}`,
    );
    assertUnique(
      category?.key,
      channelKeys,
      `Invalid or duplicate Discord channel key: ${category?.key}`,
    );
    assertUnique(
      category?.name,
      categoryNames,
      `Invalid or duplicate Discord category name: ${category?.name}`,
    );
    assertKey(category.key, `Discord category key ${category.key}`);
    assertText(category.name, `Discord category name ${category.key}`);
    if (category.name === ARCHIVE_CATEGORY_NAME) {
      throw new Error(`${ARCHIVE_CATEGORY_NAME} is reserved for archived channels`);
    }
    assertArray(
      category.channels,
      `Discord category ${category.key} channels must be an array`,
    );
    if (category.channels.length > 50) {
      throw new Error(`Discord category ${category.key} cannot exceed 50 channels`);
    }
    channelCount += category.channels.length + 1;
    assertUniqueList(
      category.accessRoles || [],
      `Discord category ${category.key} accessRoles`,
    );

    for (const roleKey of category.accessRoles || []) {
      if (!roleKeys.has(roleKey)) {
        throw new Error(`Unknown role ${roleKey} in category ${category.key}`);
      }
    }

    const siblingNames = new Set();
    for (const channel of category.channels) {
      assertKnownKeys(
        channel,
        new Set([
          "key",
          "name",
          "type",
          "topic",
          "readOnly",
          "writerRoles",
          "slowmodeSeconds",
          "bitrate",
          "userLimit",
        ]),
        `Discord channel ${channel?.key || "unknown"}`,
      );
      assertUnique(
        channel?.key,
        channelKeys,
        `Invalid or duplicate Discord channel key: ${channel?.key}`,
      );
      if (!channel.name || siblingNames.has(`${channel.type}:${channel.name}`)) {
        throw new Error(
          `Invalid or duplicate channel name in ${category.key}: ${channel.name}`,
        );
      }
      siblingNames.add(`${channel.type}:${channel.name}`);
      assertKey(channel.key, `Discord channel key ${channel.key}`);
      assertText(channel.name, `Discord channel name ${channel.key}`);
      if (!(channel.type in CHANNEL_TYPES) || channel.type === "category") {
        throw new Error(`Invalid channel type for ${channel.key}`);
      }
      assertUniqueList(
        channel.writerRoles || [],
        `Discord channel ${channel.key} writerRoles`,
      );
      for (const roleKey of channel.writerRoles || []) {
        if (!roleKeys.has(roleKey)) {
          throw new Error(`Unknown writer role ${roleKey} in ${channel.key}`);
        }
      }
      if (channel.topic !== undefined) {
        assertText(channel.topic, `Discord channel topic ${channel.key}`, {
          maximum: 4096,
        });
      }
      assertInteger(
        channel.slowmodeSeconds,
        `Discord slowmodeSeconds ${channel.key}`,
        0,
        21_600,
      );
      assertInteger(
        channel.bitrate,
        `Discord bitrate ${channel.key}`,
        8_000,
        384_000,
      );
      assertInteger(
        channel.userLimit,
        `Discord userLimit ${channel.key}`,
        0,
        99,
      );
      if (channel.readOnly !== undefined && typeof channel.readOnly !== "boolean") {
        throw new Error(`Discord readOnly ${channel.key} must be boolean`);
      }
      if (
        channel.type === "text" &&
        (channel.bitrate !== undefined || channel.userLimit !== undefined)
      ) {
        throw new Error(`Discord text channel ${channel.key} has voice-only fields`);
      }
      if (
        channel.type === "voice" &&
        (channel.topic !== undefined ||
          channel.slowmodeSeconds !== undefined ||
          channel.readOnly !== undefined ||
          (channel.writerRoles || []).length)
      ) {
        throw new Error(`Discord voice channel ${channel.key} has text-only fields`);
      }
    }
  }

  if (channelCount > 499) {
    throw new Error(
      "Discord manifest cannot manage more than 499 channels and categories",
    );
  }

  return manifest;
}

export function normalizeProvisioningState(input, guildId) {
  const source = input && typeof input === "object" ? input : {};
  if (source.guildId && source.guildId !== guildId) {
    throw new Error("Discord provisioning state belongs to a different guild");
  }

  const state = {
    version: STATE_VERSION,
    guildId,
    roles: { ...(source.roles || {}) },
    channels: { ...(source.channels || {}) },
    archived: {
      roles: { ...(source.archived?.roles || {}) },
      channels: { ...(source.archived?.channels || {}) },
    },
    archiveCategoryId: source.archiveCategoryId || null,
  };
  for (const [key, archived] of Object.entries(state.archived.roles)) {
    if (archived?.id && !state.roles[key]) state.roles[key] = archived.id;
  }
  for (const [key, archived] of Object.entries(state.archived.channels)) {
    if (archived?.id && !state.channels[key]) state.channels[key] = archived.id;
  }
  return state;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function roleBody(role) {
  return {
    name: role.name,
    color: Number(role.color) || 0,
    hoist: role.hoist === true,
    mentionable: role.mentionable === true,
    permissions: "0",
  };
}

function roleNeedsUpdate(current, desired) {
  return (
    current.name !== desired.name ||
    Number(current.color) !== desired.color ||
    current.hoist !== desired.hoist ||
    current.mentionable !== desired.mentionable ||
    String(current.permissions) !== desired.permissions
  );
}

function archiveOverwrites(guildId, botId) {
  return [
    {
      id: guildId,
      type: ROLE_OVERWRITE,
      allow: "0",
      deny: String(VIEW_CHANNEL),
    },
    {
      id: botId,
      type: MEMBER_OVERWRITE,
      allow: String(VIEW_CHANNEL),
      deny: "0",
    },
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function channelOverwrites(
  guildId,
  accessRoles,
  writerRoles,
  roleIds,
  readOnly,
  botId,
) {
  const overwrites = [];
  let everyoneDeny = 0n;

  if (accessRoles.length) everyoneDeny |= VIEW_CHANNEL;
  if (readOnly) everyoneDeny |= READ_ONLY_DENY;

  if (everyoneDeny) {
    overwrites.push({
      id: guildId,
      type: ROLE_OVERWRITE,
      allow: "0",
      deny: String(everyoneDeny),
    });
  }

  if (accessRoles.length && botId) {
    overwrites.push({
      id: botId,
      type: MEMBER_OVERWRITE,
      allow: String(VIEW_CHANNEL),
      deny: "0",
    });
  }

  for (const key of accessRoles) {
    const id = roleIds.get(key);
    if (!id) throw new Error(`No Discord role ID resolved for ${key}`);
    overwrites.push({
      id,
      type: ROLE_OVERWRITE,
      allow: String(VIEW_CHANNEL),
      deny: "0",
    });
  }

  for (const key of writerRoles) {
    const id = roleIds.get(key);
    if (!id) throw new Error(`No Discord writer role ID resolved for ${key}`);
    const existing = overwrites.find((entry) => entry.id === id);

    if (existing) {
      existing.allow = String(BigInt(existing.allow) | SEND_MESSAGES);
      existing.deny = String(BigInt(existing.deny) & ~READ_ONLY_DENY);
    } else {
      overwrites.push({
        id,
        type: ROLE_OVERWRITE,
        allow: String(VIEW_CHANNEL | SEND_MESSAGES),
        deny: "0",
      });
    }
  }

  return overwrites.sort((left, right) => left.id.localeCompare(right.id));
}

function channelBody({ item, type, parentId, position, overwrites }) {
  const body = {
    name: item.name,
    type,
    position,
    permission_overwrites: overwrites,
  };

  if (parentId) body.parent_id = parentId;
  if (type === CHANNEL_TYPES.text) {
    body.topic = item.topic || null;
    body.nsfw = false;
    body.rate_limit_per_user = Number(item.slowmodeSeconds) || 0;
  }
  if (type === CHANNEL_TYPES.voice) {
    body.bitrate = Number(item.bitrate) || 64000;
    body.user_limit = Number(item.userLimit) || 0;
  }

  return body;
}

function channelNeedsUpdate(current, desired) {
  const keys = [
    "name",
    "type",
    "position",
    "parent_id",
    "topic",
    "nsfw",
    "rate_limit_per_user",
    "bitrate",
    "user_limit",
    "permission_overwrites",
  ];

  return keys.some((key) => {
    if (!(key in desired)) return false;
    const currentValue =
      key === "permission_overwrites"
        ? [...(current[key] || [])].sort((left, right) =>
            left.id.localeCompare(right.id),
          )
        : current[key];
    return !sameValue(currentValue, desired[key]);
  });
}

function exactOne(candidates, description) {
  if (candidates.length > 1) {
    const ids = candidates.map((item) => item.id).join(", ");
    throw new Error(`Ambiguous ${description}; matching Discord IDs: ${ids}`);
  }
  return candidates[0] || null;
}

function resolveRole(existing, stateId, role) {
  if (stateId) {
    const tracked = existing.find((item) => item.id === stateId);
    if (tracked) return tracked;
  }
  return exactOne(
    existing.filter(
      (item) => item.id !== item.guild_id && !item.managed && item.name === role.name,
    ),
    `role adoption for ${role.key} (${role.name})`,
  );
}

function resolveChannel(existing, stateId, desired, key) {
  if (stateId) {
    const tracked = existing.find((item) => item.id === stateId);
    if (tracked) return tracked;
  }

  const byShape = existing.filter(
    (item) => item.name === desired.name && item.type === desired.type,
  );
  if (desired.parent_id && !String(desired.parent_id).startsWith("pending:")) {
    const inParent = byShape.filter(
      (item) => (item.parent_id || null) === desired.parent_id,
    );
    if (inParent.length) {
      return exactOne(inParent, `channel adoption for ${key} (${desired.name})`);
    }
  }
  return exactOne(byShape, `channel adoption for ${key} (${desired.name})`);
}

function claimResource(claims, current, kind, key) {
  if (!current) return;
  const previous = claims.get(current.id);
  if (previous && previous !== key) {
    throw new Error(
      `Discord ${kind} ${current.id} is claimed by both ${previous} and ${key}`,
    );
  }
  claims.set(current.id, key);
}

function memberPermissions(guildId, member, roles) {
  const roleIds = new Set([guildId, ...(member.roles || [])]);
  return roles
    .filter((role) => roleIds.has(role.id))
    .reduce((permissions, role) => permissions | BigInt(role.permissions || 0), 0n);
}

function compareRoleHierarchy(left, right) {
  const positionDifference = Number(left.position) - Number(right.position);

  if (positionDifference !== 0) {
    return positionDifference;
  }

  const leftId = String(left.id);
  const rightId = String(right.id);

  if (leftId === rightId) {
    return 0;
  }

  // Discord permits duplicate numeric positions. When positions tie, the
  // older/lower snowflake sorts above the newer/higher snowflake.
  if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
    return BigInt(leftId) < BigInt(rightId) ? 1 : -1;
  }

  // Keep fixtures and defensive non-snowflake inputs deterministic.
  return leftId < rightId ? 1 : -1;
}

function highestBotRole(member, roles) {
  const ids = new Set(member.roles || []);

  return roles
    .filter((role) => ids.has(role.id))
    .reduce(
      (highest, role) =>
        !highest || compareRoleHierarchy(role, highest) > 0 ? role : highest,
      null,
    );
}

function hasPermission(permissions, permission) {
  return (
    (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
    (permissions & permission) === permission
  );
}

function requirePermission(permissions, permission, label) {
  if (!hasPermission(permissions, permission)) {
    throw new Error(`Discord bot is missing ${label} permission`);
  }
}

function assertRoleManageable(role, botRole, purpose) {
  if (!role) return;
  if (role.managed) {
    throw new Error(`Cannot ${purpose} managed Discord role ${role.name} (${role.id})`);
  }
  if (!botRole || Number(role.position) >= Number(botRole.position)) {
    const botLabel = botRole?.name || "bot";
    throw new Error(
      `Cannot ${purpose} role ${role.name} (${role.id}); Discord requires the ${botLabel} role to have a strictly higher position. If it already appears above this role, drag it below and back above the managed roles to refresh the hierarchy.`,
    );
  }
}

function guildPatch(manifest) {
  return {
    name: manifest.guild.name,
    verification_level: Number(manifest.guild.verificationLevel) || 0,
    default_message_notifications:
      Number(manifest.guild.defaultMessageNotifications) || 0,
    explicit_content_filter: Number(manifest.guild.explicitContentFilter) || 0,
  };
}

function guildNeedsUpdate(guild, desired) {
  return Object.entries(desired).some(([key, value]) => guild[key] !== value);
}

function archivedChannelName(key) {
  return `archived-${key.replace(/_/g, "-")}`.slice(0, 100);
}

function archivedCategoryName(name) {
  return `ARCHIVED · ${name}`.slice(0, 100);
}

function makeReport({ command, guildId, bot, now }) {
  return {
    version: REPORT_VERSION,
    command,
    guildId,
    bot: { id: bot.id, username: bot.username },
    dryRun: command === "plan" || command === "prune-plan",
    startedAt: now,
    finishedAt: null,
    changes: [],
    summary: {},
  };
}

function addChange(report, type, key, current, name, details) {
  const change = { type, key, name };
  if (current?.id) change.id = current.id;
  if (details && Object.keys(details).length) change.details = details;
  report.changes.push(change);
  return change;
}

function finishReport(report, finishedAt) {
  report.finishedAt = finishedAt;
  report.summary = report.changes.reduce((summary, change) => {
    summary[change.type] = (summary[change.type] || 0) + 1;
    return summary;
  }, {});
  return report;
}

function desiredChannelEntries(manifest, roleIds, categoryIds, botId) {
  const entries = [];
  for (const [categoryIndex, category] of manifest.categories.entries()) {
    const accessRoles = category.accessRoles || [];
    const categoryDesired = channelBody({
      item: category,
      type: CHANNEL_TYPES.category,
      position: categoryIndex,
      overwrites: channelOverwrites(
        categoryIds.guildId,
        accessRoles,
        [],
        roleIds,
        false,
        botId,
      ),
    });
    entries.push({
      key: category.key,
      item: category,
      categoryKey: null,
      desired: categoryDesired,
    });
    const parentId = categoryIds.get(category.key) || `pending:${category.key}`;

    for (const [channelIndex, channel] of category.channels.entries()) {
      entries.push({
        key: channel.key,
        item: channel,
        categoryKey: category.key,
        desired: channelBody({
          item: channel,
          type: CHANNEL_TYPES[channel.type],
          parentId,
          position: channelIndex,
          overwrites: channelOverwrites(
            categoryIds.guildId,
            accessRoles,
            channel.writerRoles || [],
            roleIds,
            channel.readOnly === true,
            botId,
          ),
        }),
      });
    }
  }
  return entries;
}

async function inspectProvisioning({ client, guildId, manifest, state, command, now }) {
  const [bot, guild, roles, channels] = await Promise.all([
    client.request("/users/@me"),
    client.request(`/guilds/${guildId}`),
    client.request(`/guilds/${guildId}/roles`),
    client.request(`/guilds/${guildId}/channels`),
  ]);
  const member = await client.request(`/guilds/${guildId}/members/${bot.id}`);
  const report = makeReport({ command, guildId, bot, now });
  const nextState = normalizeProvisioningState(state, guildId);
  const permissions = memberPermissions(guildId, member, roles);
  const botRole = highestBotRole(member, roles);
  const roleClaims = new Map();
  const channelClaims = new Map();
  const resolvedRoles = new Map();
  const resolvedChannels = new Map();
  const roleIds = new Map();
  const categoryIds = new Map();
  categoryIds.guildId = guildId;
  const desiredRoleKeys = new Set(manifest.roles.map((role) => role.key));
  const desiredChannelKeys = new Set();
  const roleActions = [];
  const channelActions = [];
  const desiredGuild = guildPatch(manifest);

  if (guildNeedsUpdate(guild, desiredGuild)) {
    addChange(report, "guild.update", "guild", guild, desiredGuild.name);
  }

  for (const role of manifest.roles) {
    const desired = roleBody(role);
    const previousId = nextState.roles[role.key] || null;
    const current = resolveRole(roles, previousId, role);
    claimResource(roleClaims, current, "role", role.key);
    resolvedRoles.set(role.key, current);
    if (current) {
      if (current.id === guildId || current.managed) {
        throw new Error(
          `Tracked Discord role ${role.key} (${current.id}) is not user-managed`,
        );
      }
      if (previousId !== current.id) {
        addChange(report, "state.adopt-role", role.key, current, role.name, {
          previousId,
        });
      }
      nextState.roles[role.key] = current.id;
      roleIds.set(role.key, current.id);
      const restoring = nextState.archived.roles[role.key]?.id === current.id;
      if (restoring || roleNeedsUpdate(current, desired)) {
        addChange(
          report,
          restoring ? "role.restore" : "role.update",
          role.key,
          current,
          role.name,
        );
        roleActions.push({ type: "patch", key: role.key, current, desired });
      }
      if (restoring) delete nextState.archived.roles[role.key];
    } else {
      if (nextState.archived.roles[role.key]) {
        throw new Error(
          `Archived Discord role ${role.key} (${nextState.archived.roles[role.key].id}) no longer exists`,
        );
      }
      roleIds.set(role.key, `pending:${role.key}`);
      addChange(report, "role.create", role.key, null, role.name);
      roleActions.push({ type: "create", key: role.key, current: null, desired });
    }
  }

  for (const [key, id] of Object.entries(nextState.roles)) {
    if (desiredRoleKeys.has(key) || nextState.archived.roles[key]) continue;
    const current = roles.find((role) => role.id === id);
    if (!current) {
      throw new Error(`Tracked Discord role ${key} (${id}) no longer exists`);
    }
    if (current.id === guildId || current.managed) {
      throw new Error(`Tracked Discord role ${key} (${id}) is not user-managed`);
    }
    claimResource(roleClaims, current, "role", key);
    const archivedName = `Archived · ${current.name}`.slice(0, 100);
    addChange(report, "role.archive", key, current, current.name, {
      archivedName,
    });
    roleActions.push({
      type: "archive",
      key,
      current,
      desired: {
        name: archivedName,
        color: Number(current.color) || 0,
        hoist: false,
        mentionable: false,
        permissions: "0",
      },
    });
    nextState.archived.roles[key] = {
      id,
      originalName: current.name,
      archivedName,
      archivedAt: now,
    };
  }

  for (const [key, archived] of Object.entries(nextState.archived.roles)) {
    if (desiredRoleKeys.has(key)) continue;
    if (
      roleActions.some(
        (action) => action.key === key && action.type === "archive",
      )
    ) {
      continue;
    }
    const current = roles.find((role) => role.id === archived.id);
    if (!current) {
      throw new Error(
        `Archived Discord role ${key} (${archived.id}) no longer exists; use confirmed prune to repair state`,
      );
    }
    if (current.id === guildId || current.managed) {
      throw new Error(`Archived Discord role ${key} is not user-managed`);
    }
    claimResource(roleClaims, current, "role", key);
    const desired = {
      name: archived.archivedName,
      color: Number(current.color) || 0,
      hoist: false,
      mentionable: false,
      permissions: "0",
    };
    if (roleNeedsUpdate(current, desired)) {
      addChange(
        report,
        "role.archive-reconcile",
        key,
        current,
        archived.archivedName,
      );
      roleActions.push({
        type: "archive-reconcile",
        key,
        current,
        desired,
      });
    }
  }

  const resolvedExistingRoles = manifest.roles
    .map((role) => resolvedRoles.get(role.key))
    .filter(Boolean);
  const desiredRoleOrder = manifest.roles
    .map((role) => resolvedRoles.get(role.key)?.id)
    .filter(Boolean);
  const currentRoleOrder = [...resolvedExistingRoles]
    .sort((left, right) => compareRoleHierarchy(right, left))
    .map((role) => role.id);
  const strictRolePositions = manifest.roles
    .map((role) => resolvedRoles.get(role.key))
    .filter(Boolean)
    .every(
      (role, index, ordered) =>
        index === 0 ||
        Number(ordered[index - 1].position) > Number(role.position),
    );
  const roleOrderingNeeded =
    roleIds.size > 0 &&
    (desiredRoleOrder.length !== manifest.roles.length ||
      !sameValue(currentRoleOrder, desiredRoleOrder) ||
      !strictRolePositions);
  if (roleOrderingNeeded) {
    addChange(report, "role.order", "roles", null, "Managed roles");
  }

  for (const role of resolvedExistingRoles) {
    assertRoleManageable(role, botRole, "manage");
  }
  for (const role of roleActions) {
    if (role.current) assertRoleManageable(role.current, botRole, role.type);
  }
  if (roleOrderingNeeded) {
    for (const role of resolvedExistingRoles) {
      assertRoleManageable(role, botRole, "order");
    }
  }

  for (const category of manifest.categories) {
    desiredChannelKeys.add(category.key);
    for (const channel of category.channels) desiredChannelKeys.add(channel.key);
  }

  for (const [categoryIndex, category] of manifest.categories.entries()) {
    const desired = channelBody({
      item: category,
      type: CHANNEL_TYPES.category,
      position: categoryIndex,
      overwrites: channelOverwrites(
        guildId,
        category.accessRoles || [],
        [],
        roleIds,
        false,
        bot.id,
      ),
    });
    const previousId = nextState.channels[category.key] || null;
    const current = resolveChannel(
      channels,
      previousId,
      desired,
      category.key,
    );
    claimResource(channelClaims, current, "channel", category.key);
    resolvedChannels.set(category.key, current);
    if (current) {
      if (current.type !== CHANNEL_TYPES.category) {
        throw new Error(
          `Tracked Discord category ${category.key} (${current.id}) has type ${current.type}`,
        );
      }
      if (previousId !== current.id) {
        addChange(
          report,
          "state.adopt-channel",
          category.key,
          current,
          category.name,
          { previousId },
        );
      }
      nextState.channels[category.key] = current.id;
      categoryIds.set(category.key, current.id);
    } else {
      if (nextState.archived.channels[category.key]) {
        throw new Error(
          `Archived Discord category ${category.key} (${nextState.archived.channels[category.key].id}) no longer exists`,
        );
      }
      categoryIds.set(category.key, `pending:${category.key}`);
    }
  }

  const entries = desiredChannelEntries(manifest, roleIds, categoryIds, bot.id);
  for (const entry of entries) {
    let current = resolvedChannels.get(entry.key);
    if (entry.categoryKey !== null) {
      const previousId = nextState.channels[entry.key] || null;
      current = resolveChannel(
        channels,
        previousId,
        entry.desired,
        entry.key,
      );
      claimResource(channelClaims, current, "channel", entry.key);
      resolvedChannels.set(entry.key, current);
      if (current && previousId !== current.id) {
        addChange(
          report,
          "state.adopt-channel",
          entry.key,
          current,
          entry.desired.name,
          { previousId },
        );
      }
    }
    if (current && current.type !== entry.desired.type) {
      throw new Error(
        `Tracked Discord channel ${entry.key} (${current.id}) has type ${current.type}; expected ${entry.desired.type}`,
      );
    }
    if (!current && nextState.archived.channels[entry.key]) {
      throw new Error(
        `Archived Discord channel ${entry.key} (${nextState.archived.channels[entry.key].id}) no longer exists`,
      );
    }
    const restoring = current && nextState.archived.channels[entry.key]?.id === current.id;
    const hasPendingReference = JSON.stringify(entry.desired).includes("pending:");
    if (!current) {
      addChange(report, "channel.create", entry.key, null, entry.desired.name, {
        type: entry.desired.type,
      });
      channelActions.push({ type: "create", ...entry, current: null });
    } else if (restoring || hasPendingReference || channelNeedsUpdate(current, entry.desired)) {
      addChange(
        report,
        restoring ? "channel.restore" : "channel.update",
        entry.key,
        current,
        entry.desired.name,
        { type: entry.desired.type },
      );
      channelActions.push({ type: "patch", ...entry, current });
    }
    if (current) nextState.channels[entry.key] = current.id;
    if (restoring) delete nextState.archived.channels[entry.key];
  }

  const trackedChannelIds = new Set([
    ...Object.values(nextState.channels),
    ...(nextState.archiveCategoryId ? [nextState.archiveCategoryId] : []),
  ]);
  for (const entry of entries.filter((item) => item.categoryKey === null)) {
    const current = resolvedChannels.get(entry.key);
    if (!current) continue;
    const currentOverwrites = [...(current.permission_overwrites || [])].sort(
      (left, right) => left.id.localeCompare(right.id),
    );
    const desiredOverwrites = [...entry.desired.permission_overwrites].sort(
      (left, right) => left.id.localeCompare(right.id),
    );
    if (sameValue(currentOverwrites, desiredOverwrites)) continue;
    const syncedUnmanagedChildren = channels.filter(
      (channel) =>
        channel.parent_id === current.id &&
        !channelClaims.has(channel.id) &&
        !trackedChannelIds.has(channel.id) &&
        sameValue(
          [...(channel.permission_overwrites || [])].sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
          currentOverwrites,
        ),
    );
    if (syncedUnmanagedChildren.length) {
      throw new Error(
        `Cannot update category ${entry.key} permissions; move or unsync unmanaged child channels first: ${syncedUnmanagedChildren
          .map((channel) => `${channel.name} (${channel.id})`)
          .join(", ")}`,
      );
    }
  }

  const removedChannels = Object.entries(nextState.channels)
    .filter(([key]) => !desiredChannelKeys.has(key) && !nextState.archived.channels[key])
    .map(([key, id]) => {
      const current = channels.find((channel) => channel.id === id);
      if (!current) {
        throw new Error(`Tracked Discord channel ${key} (${id}) no longer exists`);
      }
      claimResource(channelClaims, current, "channel", key);
      return { key, id, current };
    });
  for (const { key, current } of removedChannels) {
    if (current.type !== CHANNEL_TYPES.category) continue;
    const unmanagedChildren = channels.filter(
      (channel) =>
        channel.parent_id === current.id && !trackedChannelIds.has(channel.id),
    );
    if (unmanagedChildren.length) {
      throw new Error(
        `Cannot archive category ${key}; move unmanaged child channels first: ${unmanagedChildren
          .map((channel) => `${channel.name} (${channel.id})`)
          .join(", ")}`,
      );
    }
  }

  let archiveCategory = null;
  if (
    removedChannels.length ||
    nextState.archiveCategoryId ||
    Object.keys(nextState.archived.channels).length
  ) {
    const archiveDesired = {
      name: ARCHIVE_CATEGORY_NAME,
      type: CHANNEL_TYPES.category,
      permission_overwrites: archiveOverwrites(guildId, bot.id),
    };
    const previousArchiveId = nextState.archiveCategoryId;
    archiveCategory = resolveChannel(
      channels,
      nextState.archiveCategoryId,
      archiveDesired,
      "__archive_category__",
    );
    claimResource(channelClaims, archiveCategory, "channel", "__archive_category__");
    if (archiveCategory && archiveCategory.type !== CHANNEL_TYPES.category) {
      throw new Error(
        `Discord archive category ${archiveCategory.id} has type ${archiveCategory.type}`,
      );
    }
    if (!archiveCategory) {
      addChange(
        report,
        "archive-category.create",
        "__archive_category__",
        null,
        ARCHIVE_CATEGORY_NAME,
      );
    } else {
      if (previousArchiveId !== archiveCategory.id) {
        addChange(
          report,
          "state.adopt-archive-category",
          "__archive_category__",
          archiveCategory,
          ARCHIVE_CATEGORY_NAME,
          { previousId: previousArchiveId || null },
        );
      }
      nextState.archiveCategoryId = archiveCategory.id;
      if (channelNeedsUpdate(archiveCategory, archiveDesired)) {
        addChange(
          report,
          "archive-category.update",
          "__archive_category__",
          archiveCategory,
          ARCHIVE_CATEGORY_NAME,
        );
      }
    }
  }

  for (const { key, id, current } of removedChannels) {
    const isCategory = current.type === CHANNEL_TYPES.category;
    const archivedName = isCategory
      ? archivedCategoryName(current.name)
      : archivedChannelName(key);
    addChange(report, "channel.archive", key, current, current.name, {
      archivedName,
      type: current.type,
    });
    channelActions.push({
      type: "archive",
      key,
      current,
      isCategory,
      archivedName,
    });
    nextState.archived.channels[key] = {
      id,
      originalName: current.name,
      archivedName,
      archivedAt: now,
      type: current.type,
    };
  }


  for (const [key, archived] of Object.entries(nextState.archived.channels)) {
    if (desiredChannelKeys.has(key)) continue;
    if (removedChannels.some((removed) => removed.key === key)) continue;
    const current = channels.find((channel) => channel.id === archived.id);
    if (!current) {
      throw new Error(
        `Archived Discord channel ${key} (${archived.id}) no longer exists; use confirmed prune to repair state`,
      );
    }
    if (current.type !== archived.type) {
      throw new Error(
        `Archived Discord channel ${key} (${current.id}) changed type`,
      );
    }
    claimResource(channelClaims, current, "channel", key);
    const isCategory = current.type === CHANNEL_TYPES.category;
    const desired = {
      name: archived.archivedName,
      permission_overwrites: archiveOverwrites(guildId, bot.id),
    };
    if (!isCategory) {
      desired.parent_id =
        archiveCategory?.id || nextState.archiveCategoryId || "pending:archive";
    }
    const hasPendingParent = String(desired.parent_id || "").startsWith(
      "pending:",
    );
    if (hasPendingParent || channelNeedsUpdate(current, desired)) {
      addChange(
        report,
        "channel.archive-reconcile",
        key,
        current,
        archived.archivedName,
        { type: current.type },
      );
      channelActions.push({
        type: "archive-reconcile",
        key,
        current,
        isCategory,
        archivedName: archived.archivedName,
      });
    }
  }

  const needsGuildPermission = report.changes.some(
    (change) => change.type === "guild.update",
  );
  const needsRolePermission = report.changes.some((change) =>
    change.type.startsWith("role."),
  );
  const needsChannelPermission = report.changes.some(
    (change) =>
      change.type.startsWith("channel.") ||
      change.type.startsWith("archive-category."),
  );
  if (needsGuildPermission) {
    requirePermission(permissions, MANAGE_GUILD, "Manage Server");
  }
  if (needsRolePermission) {
    if (!botRole) {
      throw new Error("Discord bot has no role available for hierarchy checks");
    }
    requirePermission(permissions, MANAGE_ROLES, "Manage Roles");
  }
  if (needsChannelPermission) {
    requirePermission(permissions, MANAGE_CHANNELS, "Manage Channels");
  }

  return {
    bot,
    guild,
    member,
    roles,
    channels,
    permissions,
    botRole,
    desiredGuild,
    roleActions,
    roleOrderingNeeded,
    resolvedRoles,
    channelActions,
    resolvedChannels,
    removedChannels,
    archiveCategory,
    nextState,
    report,
  };
}

async function checkpoint(onStateChange, state) {
  if (onStateChange) await onStateChange(clone(state));
}

async function applyRoleChanges({
  client,
  guildId,
  manifest,
  inspection,
  state,
  onStateChange,
}) {
  const roleIds = new Map();

  for (const role of manifest.roles) {
    const action = inspection.roleActions.find((entry) => entry.key === role.key);
    let current = inspection.resolvedRoles.get(role.key);
    if (action?.type === "create") {
      current = await client.request(`/guilds/${guildId}/roles`, {
        method: "POST",
        body: JSON.stringify(action.desired),
        auditReason: `Holdfast create role ${role.key}`,
      });
    } else if (action?.type === "patch") {
      current = await client.request(`/guilds/${guildId}/roles/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify(action.desired),
        auditReason: `Holdfast reconcile role ${role.key}`,
      });
    }
    if (!current) throw new Error(`Failed to resolve Discord role ${role.key}`);
    state.roles[role.key] = current.id;
    delete state.archived.roles[role.key];
    roleIds.set(role.key, current.id);
  }

  for (const action of inspection.roleActions.filter((entry) =>
    entry.type.startsWith("archive"),
  )) {
    await client.request(`/guilds/${guildId}/roles/${action.current.id}`, {
      method: "PATCH",
      body: JSON.stringify(action.desired),
      auditReason: `Holdfast archive role ${action.key}`,
    });
  }

  if (inspection.roleOrderingNeeded && manifest.roles.length) {
    const roles = await client.request(`/guilds/${guildId}/roles`);
    const botRole = highestBotRole(inspection.member, roles);
    const managed = manifest.roles.map((role) => {
      const current = roles.find((item) => item.id === roleIds.get(role.key));
      if (!current) throw new Error(`Discord role ${role.key} vanished during apply`);
      assertRoleManageable(current, botRole, "order");
      return current;
    });
    const topPosition = Number(botRole.position) - 1;
    if (topPosition < managed.length) {
      throw new Error(
        "Bot role does not have enough hierarchy space to order managed roles; move the bot role to the top of the Holdfast-managed roles and retry",
      );
    }
    const orderedRoles = await client.request(`/guilds/${guildId}/roles`, {
      method: "PATCH",
      body: JSON.stringify(
        manifest.roles.map((role, index) => ({
          id: roleIds.get(role.key),
          position: topPosition - index,
        })),
      ),
      auditReason: "Holdfast order managed rank roles",
    });
    const verifiedBotRole = highestBotRole(inspection.member, orderedRoles);
    const verifiedOrder = manifest.roles
      .map((role) => orderedRoles.find((item) => item.id === roleIds.get(role.key)))
      .filter(Boolean);
    if (
      verifiedOrder.length !== manifest.roles.length ||
      verifiedOrder.some(
        (role, index) =>
          !verifiedBotRole ||
          Number(role.position) >= Number(verifiedBotRole.position) ||
          (index > 0 &&
            Number(verifiedOrder[index - 1].position) <= Number(role.position)),
      )
    ) {
      throw new Error("Discord did not preserve the requested managed role order");
    }
  }

  await checkpoint(onStateChange, state);
  return roleIds;
}

async function ensureArchiveCategory({
  client,
  guildId,
  botId,
  inspection,
  state,
}) {
  if (
    !inspection.removedChannels.length &&
    !state.archiveCategoryId &&
    !Object.keys(state.archived.channels).length
  ) {
    return null;
  }
  const desired = {
    name: ARCHIVE_CATEGORY_NAME,
    type: CHANNEL_TYPES.category,
    permission_overwrites: archiveOverwrites(guildId, botId),
  };
  let current = inspection.archiveCategory;
  if (!current) {
    current = await client.request(`/guilds/${guildId}/channels`, {
      method: "POST",
      body: JSON.stringify(desired),
      auditReason: "Holdfast create archive category",
    });
  } else if (channelNeedsUpdate(current, desired)) {
    current = await client.request(`/channels/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify(desired),
      auditReason: "Holdfast reconcile archive category",
    });
  }
  state.archiveCategoryId = current.id;
  return current;
}

async function applyChannelChanges({
  client,
  guildId,
  manifest,
  inspection,
  state,
  roleIds,
  onStateChange,
}) {
  const archiveCategory = await ensureArchiveCategory({
    client,
    guildId,
    botId: inspection.bot.id,
    inspection,
    state,
  });
  const categoryIds = new Map();
  categoryIds.guildId = guildId;

  for (const [categoryIndex, category] of manifest.categories.entries()) {
    const desired = channelBody({
      item: category,
      type: CHANNEL_TYPES.category,
      position: categoryIndex,
      overwrites: channelOverwrites(
        guildId,
        category.accessRoles || [],
        [],
        roleIds,
        false,
        inspection.bot.id,
      ),
    });
    let current = inspection.resolvedChannels.get(category.key);
    if (!current) {
      current = await client.request(`/guilds/${guildId}/channels`, {
        method: "POST",
        body: JSON.stringify(desired),
        auditReason: `Holdfast create category ${category.key}`,
      });
    } else if (channelNeedsUpdate(current, desired)) {
      current = await client.request(`/channels/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify(desired),
        auditReason: `Holdfast reconcile category ${category.key}`,
      });
    }
    state.channels[category.key] = current.id;
    delete state.archived.channels[category.key];
    categoryIds.set(category.key, current.id);

    for (const [channelIndex, channel] of category.channels.entries()) {
      const channelDesired = channelBody({
        item: channel,
        type: CHANNEL_TYPES[channel.type],
        parentId: current.id,
        position: channelIndex,
        overwrites: channelOverwrites(
          guildId,
          category.accessRoles || [],
          channel.writerRoles || [],
          roleIds,
          channel.readOnly === true,
          inspection.bot.id,
        ),
      });
      let existing = inspection.resolvedChannels.get(channel.key);
      if (!existing) {
        existing = await client.request(`/guilds/${guildId}/channels`, {
          method: "POST",
          body: JSON.stringify(channelDesired),
          auditReason: `Holdfast create channel ${channel.key}`,
        });
      } else if (channelNeedsUpdate(existing, channelDesired)) {
        existing = await client.request(`/channels/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify(channelDesired),
          auditReason: `Holdfast reconcile channel ${channel.key}`,
        });
      }
      state.channels[channel.key] = existing.id;
      delete state.archived.channels[channel.key];
    }
  }

  const removed = inspection.channelActions.filter((entry) =>
    entry.type.startsWith("archive"),
  );
  for (const action of removed.filter((entry) => !entry.isCategory)) {
    if (!archiveCategory) throw new Error("Discord archive category was not resolved");
    await client.request(`/channels/${action.current.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: action.archivedName,
        parent_id: archiveCategory.id,
        permission_overwrites: archiveOverwrites(guildId, inspection.bot.id),
      }),
      auditReason: `Holdfast archive channel ${action.key}`,
    });
  }
  for (const action of removed.filter((entry) => entry.isCategory)) {
    await client.request(`/channels/${action.current.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: action.archivedName,
        permission_overwrites: archiveOverwrites(guildId, inspection.bot.id),
      }),
      auditReason: `Holdfast archive category ${action.key}`,
    });
  }

  await checkpoint(onStateChange, state);
}

export async function runDiscordProvisioning({
  client,
  guildId,
  manifest,
  state,
  command = "plan",
  now = new Date().toISOString(),
  onStateChange,
}) {
  if (!new Set(["plan", "apply", "restore"]).has(command)) {
    throw new Error(`Unsupported Discord provisioning command: ${command}`);
  }
  validateDiscordManifest(manifest);
  const inspection = await inspectProvisioning({
    client,
    guildId,
    manifest,
    state,
    command,
    now,
  });

  if (command === "plan") {
    return {
      report: finishReport(inspection.report, now),
      state: inspection.nextState,
      roleIds: Object.fromEntries(
        [...inspection.resolvedRoles].map(([key, role]) => [key, role?.id || null]),
      ),
    };
  }

  const nextState = inspection.nextState;
  if (guildNeedsUpdate(inspection.guild, inspection.desiredGuild)) {
    await client.request(`/guilds/${guildId}`, {
      method: "PATCH",
      body: JSON.stringify(inspection.desiredGuild),
      auditReason: "Holdfast reconcile server settings",
    });
  }
  const roleIds = await applyRoleChanges({
    client,
    guildId,
    manifest,
    inspection,
    state: nextState,
    onStateChange,
  });
  await applyChannelChanges({
    client,
    guildId,
    manifest,
    inspection,
    state: nextState,
    roleIds,
    onStateChange,
  });

  return {
    report: finishReport(inspection.report, new Date().toISOString()),
    state: nextState,
    roleIds: Object.fromEntries(roleIds),
  };
}

function parseTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid archivedAt for ${label}`);
  return timestamp;
}

export async function pruneDiscordArchives({
  client,
  guildId,
  state,
  apply = false,
  confirmation,
  minimumAgeDays = 7,
  now = new Date().toISOString(),
  onStateChange,
}) {
  if (!Number.isInteger(minimumAgeDays) || minimumAgeDays < 1) {
    throw new Error("Discord prune minimum age must be at least 1 day");
  }
  if (apply && confirmation !== guildId) {
    throw new Error(`Prune apply requires --confirm ${guildId}`);
  }

  const nextState = normalizeProvisioningState(state, guildId);
  const [bot, roles, channels] = await Promise.all([
    client.request("/users/@me"),
    client.request(`/guilds/${guildId}/roles`),
    client.request(`/guilds/${guildId}/channels`),
  ]);
  const member = await client.request(`/guilds/${guildId}/members/${bot.id}`);
  const permissions = memberPermissions(guildId, member, roles);
  const botRole = highestBotRole(member, roles);
  const report = makeReport({
    command: apply ? "prune" : "prune-plan",
    guildId,
    bot,
    now,
  });
  const cutoff =
    parseTimestamp(now, "prune now") - minimumAgeDays * 24 * 60 * 60 * 1000;
  const channelCandidates = [];
  const roleCandidates = [];
  const missingChannels = [];
  const missingRoles = [];
  const archivedIds = new Set();

  for (const [key, archived] of [
    ...Object.entries(nextState.archived.channels),
    ...Object.entries(nextState.archived.roles),
  ]) {
    if (!archived?.id || archivedIds.has(archived.id)) {
      throw new Error(`Invalid or duplicate archived Discord ID for ${key}`);
    }
    archivedIds.add(archived.id);
  }

  for (const [key, archived] of Object.entries(nextState.archived.channels)) {
    if (archived.id === nextState.archiveCategoryId) {
      throw new Error("The managed Discord archive category cannot be pruned");
    }
    const current = channels.find((channel) => channel.id === archived.id);
    if (!current) {
      addChange(
        report,
        "prune.clean-missing",
        key,
        { id: archived.id },
        archived.archivedName,
        { resource: "channel" },
      );
      missingChannels.push({ key, archived });
      continue;
    }
    if (current.name !== archived.archivedName) {
      throw new Error(
        `Archived channel ${key} was renamed; refusing to prune ${current.id}`,
      );
    }
    if (parseTimestamp(archived.archivedAt, key) > cutoff) {
      addChange(report, "prune.skip-young", key, current, current.name);
      continue;
    }
    channelCandidates.push({ key, archived, current });
  }

  const roleCounts = Object.values(nextState.archived.roles).some((archived) =>
    roles.some((role) => role.id === archived.id),
  )
    ? await client.request(`/guilds/${guildId}/roles/member-counts`)
    : {};
  for (const [key, archived] of Object.entries(nextState.archived.roles)) {
    const current = roles.find((role) => role.id === archived.id);
    if (!current) {
      addChange(
        report,
        "prune.clean-missing",
        key,
        { id: archived.id },
        archived.archivedName,
        { resource: "role" },
      );
      missingRoles.push({ key, archived });
      continue;
    }
    if (current.name !== archived.archivedName) {
      throw new Error(`Archived role ${key} was renamed; refusing to prune ${current.id}`);
    }
    if (current.id === guildId || current.managed) {
      throw new Error(`Archived Discord role ${key} is not user-managed`);
    }
    assertRoleManageable(current, botRole, "prune");
    if (parseTimestamp(archived.archivedAt, key) > cutoff) {
      addChange(report, "prune.skip-young", key, current, current.name);
      continue;
    }
    if (!Object.hasOwn(roleCounts, current.id)) {
      addChange(report, "prune.blocked-count-unknown", key, current, current.name);
      continue;
    }
    const memberCount = Number(roleCounts[current.id]);
    if (!Number.isInteger(memberCount) || memberCount < 0) {
      throw new Error(`Discord returned an invalid member count for role ${key}`);
    }
    if (memberCount > 0) {
      addChange(report, "prune.blocked-members", key, current, current.name, {
        memberCount,
      });
      continue;
    }
    roleCandidates.push({ key, archived, current });
  }

  const candidateChannelIds = new Set(
    channelCandidates.map(({ current }) => current.id),
  );
  const deletableChannels = channelCandidates.filter(({ current }) => {
    if (current.type !== CHANNEL_TYPES.category) return true;
    const blockingChildren = channels.filter(
      (channel) =>
        channel.parent_id === current.id && !candidateChannelIds.has(channel.id),
    );
    if (blockingChildren.length) {
      addChange(report, "prune.blocked-children", current.id, current, current.name, {
        childIds: blockingChildren.map((channel) => channel.id),
      });
      return false;
    }
    return true;
  });

  for (const candidate of deletableChannels) {
    addChange(
      report,
      "channel.prune",
      candidate.key,
      candidate.current,
      candidate.current.name,
    );
  }
  for (const candidate of roleCandidates) {
    addChange(
      report,
      "role.prune",
      candidate.key,
      candidate.current,
      candidate.current.name,
    );
  }

  if (deletableChannels.length) {
    requirePermission(permissions, MANAGE_CHANNELS, "Manage Channels");
  }
  if (roleCandidates.length) {
    requirePermission(permissions, MANAGE_ROLES, "Manage Roles");
  }

  if (apply) {
    for (const { key } of missingChannels) {
      delete nextState.channels[key];
      delete nextState.archived.channels[key];
    }
    for (const { key } of missingRoles) {
      delete nextState.roles[key];
      delete nextState.archived.roles[key];
    }
    if (missingChannels.length || missingRoles.length) {
      await checkpoint(onStateChange, nextState);
    }
    const orderedChannels = [...deletableChannels].sort(
      (left, right) =>
        Number(left.current.type === CHANNEL_TYPES.category) -
        Number(right.current.type === CHANNEL_TYPES.category),
    );
    for (const { key, current } of orderedChannels) {
      await client.request(`/channels/${current.id}`, {
        method: "DELETE",
        auditReason: `Holdfast prune archived channel ${key}`,
      });
      delete nextState.channels[key];
      delete nextState.archived.channels[key];
      await checkpoint(onStateChange, nextState);
    }
    for (const { key, current } of roleCandidates) {
      await client.request(`/guilds/${guildId}/roles/${current.id}`, {
        method: "DELETE",
        auditReason: `Holdfast prune archived role ${key}`,
      });
      delete nextState.roles[key];
      delete nextState.archived.roles[key];
      await checkpoint(onStateChange, nextState);
    }
    if (
      !missingChannels.length &&
      !missingRoles.length &&
      !orderedChannels.length &&
      !roleCandidates.length
    ) {
      await checkpoint(onStateChange, nextState);
    }
  }

  return {
    report: finishReport(report, new Date().toISOString()),
    state: nextState,
  };
}

function pick(source, keys) {
  return Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );
}

export async function exportDiscordSnapshot({
  client,
  guildId,
  now = new Date().toISOString(),
}) {
  const [guild, roles, channels] = await Promise.all([
    client.request(`/guilds/${guildId}`),
    client.request(`/guilds/${guildId}/roles`),
    client.request(`/guilds/${guildId}/channels`),
  ]);
  return {
    version: 1,
    exportedAt: now,
    guild: pick(guild, [
      "id",
      "name",
      "verification_level",
      "default_message_notifications",
      "explicit_content_filter",
    ]),
    roles: [...roles]
      .sort((left, right) => right.position - left.position)
      .map((role) =>
        pick(role, [
          "id",
          "name",
          "color",
          "hoist",
          "position",
          "permissions",
          "managed",
          "mentionable",
        ]),
      ),
    channels: [...channels]
      .sort(
        (left, right) =>
          Number(left.position) - Number(right.position) ||
          left.name.localeCompare(right.name),
      )
      .map((channel) =>
        pick(channel, [
          "id",
          "name",
          "type",
          "position",
          "parent_id",
          "topic",
          "nsfw",
          "rate_limit_per_user",
          "bitrate",
          "user_limit",
          "permission_overwrites",
        ]),
      ),
  };
}
