import { readFileSync } from "node:fs";

import { readGuildMembers } from "../Guild/memberRepository.js";
import { GUILD_RANKS, normalizeGuildRank } from "../Guild/rankSystem.js";
import { DiscordApiClient } from "./provisioning.js";

const DEFAULT_RECONCILE_SECONDS = 300;
const MIN_RECONCILE_SECONDS = 60;
const MAX_RECONCILE_SECONDS = 3600;

const manifest = JSON.parse(
  readFileSync(
    new URL("../../config/discord.manifest.json", import.meta.url),
    "utf8",
  ),
);

const MANAGED_RANK_NAMES = new Set(GUILD_RANKS);

function configuredValue(value) {
  return String(value || "").trim();
}

function rankSyncConfig(env = process.env) {
  return {
    guildId: configuredValue(env.DISCORD_GUILD_ID),
    botToken: configuredValue(env.DISCORD_BOT_TOKEN),
  };
}

function reconcileMilliseconds(env = process.env) {
  const configured = Number(env.DISCORD_RANK_RECONCILE_SECONDS);
  const seconds =
    Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_RECONCILE_SECONDS;

  return (
    Math.min(
      MAX_RECONCILE_SECONDS,
      Math.max(MIN_RECONCILE_SECONDS, seconds),
    ) * 1000
  );
}

function rankManifestRoles() {
  return GUILD_RANKS.map((rank) => {
    const role = manifest.roles.find((candidate) => candidate.name === rank);

    if (!role) {
      throw new Error(`Discord manifest is missing guild rank role ${rank}`);
    }

    return role;
  });
}

function resolveRankRoles(liveRoles) {
  const resolved = new Map();

  for (const definition of rankManifestRoles()) {
    const matches = liveRoles.filter(
      (role) => role.name === definition.name && !role.managed,
    );

    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one Discord role named ${definition.name}; found ${matches.length}`,
      );
    }

    resolved.set(definition.name, matches[0]);
  }

  return resolved;
}

function discordClient(env, client) {
  if (client) {
    return client;
  }

  const current = rankSyncConfig(env);

  if (!current.guildId || !current.botToken) {
    throw new Error(
      "DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are required for rank synchronization",
    );
  }

  return new DiscordApiClient(current.botToken);
}

async function discordMember(client, guildId, memberId) {
  try {
    return await client.request(
      `/guilds/${guildId}/members/${memberId}`,
    );
  } catch (error) {
    if (error?.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function syncDiscordMemberRank(
  member,
  {
    env = process.env,
    client: providedClient = null,
    liveRoles = null,
  } = {},
) {
  if (!member?.id) {
    throw new Error("Member ID is required for Discord rank synchronization");
  }

  const current = rankSyncConfig(env);

  if (!current.guildId) {
    throw new Error("DISCORD_GUILD_ID is required for rank synchronization");
  }

  const client = discordClient(env, providedClient);
  const roles =
    liveRoles ||
    (await client.request(`/guilds/${current.guildId}/roles`));
  const rankRoles = resolveRankRoles(roles);
  const desiredRank = normalizeGuildRank(member.rank);
  const desiredRole = rankRoles.get(desiredRank);
  const currentMember = await discordMember(client, current.guildId, member.id);

  if (!currentMember) {
    return {
      memberId: member.id,
      desiredRank,
      status: "missing",
      added: false,
      removed: 0,
    };
  }

  const memberRoleIds = new Set(
    Array.isArray(currentMember.roles) ? currentMember.roles : [],
  );
  const staleRoles = [...rankRoles.entries()]
    .filter(
      ([rank, role]) =>
        rank !== desiredRank && memberRoleIds.has(role.id),
    )
    .map(([, role]) => role);

  let added = false;

  if (!memberRoleIds.has(desiredRole.id)) {
    await client.request(
      `/guilds/${current.guildId}/members/${member.id}/roles/${desiredRole.id}`,
      {
        method: "PUT",
        auditReason: `Holdfast rank sync: ${desiredRank}`,
      },
    );
    added = true;
  }

  for (const role of staleRoles) {
    await client.request(
      `/guilds/${current.guildId}/members/${member.id}/roles/${role.id}`,
      {
        method: "DELETE",
        auditReason: `Holdfast remove stale rank: ${role.name}`,
      },
    );
  }

  return {
    memberId: member.id,
    desiredRank,
    status: added || staleRoles.length ? "synced" : "unchanged",
    added,
    removed: staleRoles.length,
  };
}

export async function reconcileDiscordMemberRanks({
  env = process.env,
  client: providedClient = null,
  members: providedMembers = null,
  logger = console,
} = {}) {
  const current = rankSyncConfig(env);
  const client = discordClient(env, providedClient);
  const members = providedMembers || (await readGuildMembers());
  const managedMembers = members.filter((member) => member.rankManaged);
  const liveRoles = await client.request(
    `/guilds/${current.guildId}/roles`,
  );
  const summary = {
    checked: 0,
    changed: 0,
    unchanged: 0,
    missing: 0,
    failed: 0,
    unmanaged: members.length - managedMembers.length,
  };

  for (const member of managedMembers) {
    summary.checked += 1;

    try {
      const result = await syncDiscordMemberRank(member, {
        env,
        client,
        liveRoles,
      });

      if (result.status === "synced") summary.changed += 1;
      else if (result.status === "missing") summary.missing += 1;
      else summary.unchanged += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error(
        `Unable to reconcile Discord rank for member ${member.id}`,
        error,
      );
    }
  }

  return summary;
}

export function startDiscordRankReconciler({
  env = process.env,
  logger = console,
  reconcile = reconcileDiscordMemberRanks,
} = {}) {
  if (env.NODE_ENV !== "production") {
    return () => {};
  }

  const current = rankSyncConfig(env);

  if (!current.guildId || !current.botToken) {
    logger.warn?.(
      "Discord rank reconciliation disabled: DISCORD_GUILD_ID or DISCORD_BOT_TOKEN is missing",
    );
    return () => {};
  }

  let running = false;
  let stopped = false;

  async function run() {
    if (running || stopped) {
      return;
    }

    running = true;

    try {
      const summary = await reconcile({ env, logger });

      if (summary.changed || summary.failed || summary.missing) {
        logger.log?.("Discord rank reconciliation", summary);
      }
    } catch (error) {
      logger.error("Discord rank reconciliation failed", error);
    } finally {
      running = false;
    }
  }

  void run();

  const timer = setInterval(run, reconcileMilliseconds(env));
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function managedDiscordRankNames() {
  return [...MANAGED_RANK_NAMES];
}
