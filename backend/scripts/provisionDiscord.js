import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { ensureRuntimeDataDirectory } from "../src/Data/runtimeData.js";

dotenv.config();

const API = "https://discord.com/api/v10";
const ROLE = 0;
const CHANNEL_TYPES = { text: 0, voice: 2, category: 4 };
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
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestFile = path.resolve(
  process.env.DISCORD_MANIFEST_FILE ||
    path.join(scriptDirectory, "../config/discord.manifest.json"),
);

function required(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class DiscordClient {
  constructor(token) {
    this.token = token;
  }

  async request(endpoint, options = {}, attempt = 0) {
    const response = await fetch(`${API}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": encodeURIComponent("Holdfast manifest sync"),
        ...(options.headers || {}),
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
      await sleep(retrySeconds * 1000);
      return this.request(endpoint, options, attempt + 1);
    }

    if (!response.ok) {
      const detail =
        typeof body === "string"
          ? body.slice(0, 300)
          : body?.message || "Unknown Discord API error";
      throw new Error(
        `Discord ${options.method || "GET"} ${endpoint} failed (${response.status}): ${detail}`,
      );
    }

    return body;
  }
}

function validateManifest(manifest) {
  if (manifest.version !== 1) {
    throw new Error("Discord manifest version must be 1");
  }

  const keys = new Set();
  const roleKeys = new Set();

  for (const role of manifest.roles || []) {
    if (!role.key || !role.name || roleKeys.has(role.key)) {
      throw new Error(`Invalid or duplicate Discord role key: ${role.key}`);
    }

    roleKeys.add(role.key);
  }

  for (const category of manifest.categories || []) {
    if (!category.key || !category.name || keys.has(category.key)) {
      throw new Error(`Invalid or duplicate Discord channel key: ${category.key}`);
    }

    keys.add(category.key);

    for (const roleKey of category.accessRoles || []) {
      if (!roleKeys.has(roleKey)) {
        throw new Error(`Unknown role ${roleKey} in category ${category.key}`);
      }
    }

    for (const channel of category.channels || []) {
      if (!channel.key || !channel.name || keys.has(channel.key)) {
        throw new Error(`Invalid or duplicate Discord channel key: ${channel.key}`);
      }

      if (!(channel.type in CHANNEL_TYPES) || channel.type === "category") {
        throw new Error(`Invalid channel type for ${channel.key}`);
      }

      for (const roleKey of channel.writerRoles || []) {
        if (!roleKeys.has(roleKey)) {
          throw new Error(`Unknown writer role ${roleKey} in ${channel.key}`);
        }
      }

      keys.add(channel.key);
    }
  }
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function saveState(file, state) {
  const temporary = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
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

function channelOverwrites(guildId, accessRoles, writerRoles, roleIds, readOnly) {
  const overwrites = [];
  let everyoneDeny = 0n;

  if (accessRoles.length) {
    everyoneDeny |= VIEW_CHANNEL;
  }

  if (readOnly) {
    everyoneDeny |= READ_ONLY_DENY;
  }

  if (everyoneDeny) {
    overwrites.push({
      id: guildId,
      type: ROLE,
      allow: "0",
      deny: String(everyoneDeny),
    });
  }

  for (const key of accessRoles) {
    overwrites.push({
      id: roleIds.get(key),
      type: ROLE,
      allow: String(VIEW_CHANNEL),
      deny: "0",
    });
  }

  for (const key of writerRoles) {
    const id = roleIds.get(key);
    const existing = overwrites.find((entry) => entry.id === id);

    if (existing) {
      existing.allow = String(BigInt(existing.allow) | SEND_MESSAGES);
      existing.deny = String(BigInt(existing.deny) & ~READ_ONLY_DENY);
    } else {
      overwrites.push({
        id,
        type: ROLE,
        allow: String(VIEW_CHANNEL | SEND_MESSAGES),
        deny: "0",
      });
    }
  }

  return overwrites.sort((left, right) => left.id.localeCompare(right.id));
}

function channelBody({
  item,
  type,
  parentId,
  position,
  overwrites,
}) {
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

function findManaged(existing, stateId, predicate) {
  return existing.find((item) => item.id === stateId) || existing.find(predicate);
}

async function syncRoles({ client, guildId, manifest, state, apply, changes }) {
  let existing = await client.request(`/guilds/${guildId}/roles`);
  const roleIds = new Map();
  const managedRoles = new Map();

  for (const role of manifest.roles) {
    const desired = roleBody(role);
    let current = findManaged(
      existing,
      state.roles[role.key],
      (item) => item.name === role.name && !item.managed,
    );

    if (!current) {
      changes.push(`Create role: ${role.name}`);

      if (apply) {
        current = await client.request(`/guilds/${guildId}/roles`, {
          method: "POST",
          body: JSON.stringify(desired),
        });
        existing.push(current);
      }
    } else if (roleNeedsUpdate(current, desired)) {
      changes.push(`Update role: ${role.name}`);

      if (apply) {
        current = await client.request(
          `/guilds/${guildId}/roles/${current.id}`,
          { method: "PATCH", body: JSON.stringify(desired) },
        );
      }
    }

    if (current) {
      roleIds.set(role.key, current.id);
      state.roles[role.key] = current.id;
      managedRoles.set(role.key, current);
    } else {
      roleIds.set(role.key, `pending:${role.key}`);
    }
  }

  const needsOrdering = manifest.roles.some((role, index) => {
    const current = managedRoles.get(role.key);
    return !current || current.position !== manifest.roles.length - index;
  });

  if (needsOrdering) {
    changes.push("Order managed roles");
  }

  if (apply && needsOrdering) {
    const positions = manifest.roles.map((role, index) => ({
      id: roleIds.get(role.key),
      position: manifest.roles.length - index,
    }));
    await client.request(`/guilds/${guildId}/roles`, {
      method: "PATCH",
      body: JSON.stringify(positions),
    });
  }

  return roleIds;
}

async function syncChannel({
  client,
  guildId,
  existing,
  state,
  key,
  desired,
  apply,
  changes,
}) {
  let current = findManaged(
    existing,
    state.channels[key],
    (item) =>
      item.name === desired.name &&
      item.type === desired.type &&
      (desired.parent_id === undefined || item.parent_id === desired.parent_id),
  );

  if (!current) {
    changes.push(`Create channel: ${desired.name}`);

    if (apply) {
      current = await client.request(`/guilds/${guildId}/channels`, {
        method: "POST",
        body: JSON.stringify(desired),
      });
      existing.push(current);
    }
  } else if (channelNeedsUpdate(current, desired)) {
    changes.push(`Update channel: ${desired.name}`);

    if (apply) {
      current = await client.request(`/channels/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify(desired),
      });
    }
  }

  if (current) {
    state.channels[key] = current.id;
  }

  return current;
}

async function syncChannels({
  client,
  guildId,
  manifest,
  state,
  roleIds,
  apply,
  changes,
}) {
  const existing = await client.request(`/guilds/${guildId}/channels`);

  for (const [categoryIndex, category] of manifest.categories.entries()) {
    const accessRoles = category.accessRoles || [];
    const categoryOverwrites = channelOverwrites(
      guildId,
      accessRoles,
      [],
      roleIds,
      false,
    );
    const categoryBody = channelBody({
      item: category,
      type: CHANNEL_TYPES.category,
      position: categoryIndex,
      overwrites: categoryOverwrites,
    });
    const currentCategory = await syncChannel({
      client,
      guildId,
      existing,
      state,
      key: category.key,
      desired: categoryBody,
      apply,
      changes,
    });
    const parentId = currentCategory?.id || state.channels[category.key];

    for (const [channelIndex, channel] of category.channels.entries()) {
      const channelBodyValue = channelBody({
        item: channel,
        type: CHANNEL_TYPES[channel.type],
        parentId,
        position: channelIndex,
        overwrites: channelOverwrites(
          guildId,
          accessRoles,
          channel.writerRoles || [],
          roleIds,
          channel.readOnly === true,
        ),
      });

      if (!parentId && !apply) {
        changes.push(`Create channel after category: ${channel.name}`);
        continue;
      }

      await syncChannel({
        client,
        guildId,
        existing,
        state,
        key: channel.key,
        desired: channelBodyValue,
        apply,
        changes,
      });
    }
  }
}

async function main() {
  const mode = process.argv[2] || "plan";

  if (!new Set(["validate", "plan", "apply"]).has(mode)) {
    throw new Error("Usage: provisionDiscord.js validate|plan|apply");
  }

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  validateManifest(manifest);

  if (mode === "validate") {
    const channelCount = manifest.categories.reduce(
      (total, category) => total + category.channels.length,
      0,
    );
    console.log(
      `Discord manifest valid: ${manifest.roles.length} roles, ${manifest.categories.length} categories, ${channelCount} channels`,
    );
    return;
  }

  const apply = mode === "apply";
  const guildId = required("DISCORD_GUILD_ID");
  const token = required("DISCORD_BOT_TOKEN");

  const runtimeDirectory = await ensureRuntimeDataDirectory();
  const stateFile = path.resolve(
    process.env.DISCORD_PROVISION_STATE_FILE ||
      path.join(runtimeDirectory, "discord-provisioning-state.json"),
  );
  const state = await loadJson(stateFile, {
    version: 1,
    guildId,
    roles: {},
    channels: {},
  });

  if (state.guildId !== guildId) {
    throw new Error("Discord provisioning state belongs to a different guild");
  }

  const client = new DiscordClient(token);
  const bot = await client.request("/users/@me");
  const guild = await client.request(`/guilds/${guildId}`);
  const changes = [];
  const guildPatch = {
    name: manifest.guild.name,
    verification_level: manifest.guild.verificationLevel,
    default_message_notifications: manifest.guild.defaultMessageNotifications,
    explicit_content_filter: manifest.guild.explicitContentFilter,
  };

  if (
    guild.name !== guildPatch.name ||
    guild.verification_level !== guildPatch.verification_level ||
    guild.default_message_notifications !==
      guildPatch.default_message_notifications ||
    guild.explicit_content_filter !== guildPatch.explicit_content_filter
  ) {
    changes.push(`Update server settings: ${guild.name}`);
    if (apply) {
      await client.request(`/guilds/${guildId}`, {
        method: "PATCH",
        body: JSON.stringify(guildPatch),
      });
    }
  }

  const roleIds = await syncRoles({
    client,
    guildId,
    manifest,
    state,
    apply,
    changes,
  });

  if (apply) {
    await saveState(stateFile, state);
  }

  await syncChannels({
    client,
    guildId,
    manifest,
    state,
    roleIds,
    apply,
    changes,
  });

  if (apply) {
    await saveState(stateFile, state);
  }

  console.log(`${apply ? "Applied" : "Planned"} Discord manifest as ${bot.username}`);

  if (!changes.length) {
    console.log("No changes required");
  } else {
    for (const change of changes) {
      console.log(`- ${change}`);
    }
  }

  if (apply) {
    const officerRoles = ["lieutenant", "captain", "major", "commander"]
      .map((key) => roleIds.get(key))
      .join(",");
    const questRoles = [
      "corporal",
      "sergeant",
      "master_sergeant",
      "sergeant_major",
      "lieutenant",
      "captain",
      "major",
      "commander",
    ]
      .map((key) => roleIds.get(key))
      .join(",");

    console.log("\nAdd these values to the production environment:");
    console.log(`DISCORD_RECRUIT_ROLE_ID=${roleIds.get("recruit")}`);
    console.log(`DISCORD_SITE_ADMIN_ROLE_IDS=${officerRoles}`);
    console.log(`DISCORD_QUEST_EDITOR_ROLE_IDS=${questRoles}`);
    console.log(`DISCORD_REWARD_POLICY_ROLE_IDS=${officerRoles}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
