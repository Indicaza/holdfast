import {
  readBillets,
  setBilletDiscordRoleId,
} from "../Guild/billetRepository.js";
import { readGuildMembers } from "../Guild/memberRepository.js";
import { DiscordApiClient } from "./provisioning.js";

const RECONCILE_MILLISECONDS = 24 * 60 * 60 * 1000;
const BILLET_ROLE_COLOR = 14532989;

function configuredValue(value) {
  return String(value || "").trim();
}

function config(env = process.env) {
  return {
    guildId: configuredValue(env.DISCORD_GUILD_ID),
    botToken: configuredValue(env.DISCORD_BOT_TOKEN),
  };
}

function clientFor(env, providedClient) {
  if (providedClient) return providedClient;

  const current = config(env);

  if (!current.guildId || !current.botToken) {
    throw new Error(
      "DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are required for billet synchronization",
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
    if (error?.status === 404) return null;
    throw error;
  }
}

async function ensureBilletRole({
  billet,
  client,
  guildId,
  liveRoles,
  persistRoleId = setBilletDiscordRoleId,
}) {
  let role = billet.discordRoleId
    ? liveRoles.find((candidate) => candidate.id === billet.discordRoleId)
    : null;

  if (!role && billet.discordRoleId) {
    await persistRoleId(billet.id, null).catch(() => {});
  }

  if (!role) {
    const matches = liveRoles.filter(
      (candidate) => candidate.name === billet.name && !candidate.managed,
    );

    if (matches.length > 1) {
      throw new Error(
        `Multiple Discord roles named ${billet.name}; cannot determine billet role`,
      );
    }

    if (matches.length === 1) {
      role = matches[0];
    } else {
      role = await client.request(`/guilds/${guildId}/roles`, {
        method: "POST",
        body: JSON.stringify({
          name: billet.name,
          color: BILLET_ROLE_COLOR,
          hoist: false,
          mentionable: false,
          permissions: "0",
        }),
        auditReason: `Holdfast create billet role ${billet.name}`,
      });
      liveRoles.push(role);
    }

    await persistRoleId(billet.id, role.id);
    billet.discordRoleId = role.id;
  }

  if (role.name !== billet.name) {
    role = await client.request(
      `/guilds/${guildId}/roles/${role.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: billet.name }),
        auditReason: `Holdfast rename billet role ${billet.name}`,
      },
    );

    const index = liveRoles.findIndex((candidate) => candidate.id === role.id);
    if (index >= 0) liveRoles[index] = role;
  }

  return role;
}

export async function deleteDiscordBilletRole(
  billet,
  {
    env = process.env,
    client: providedClient = null,
  } = {},
) {
  if (!billet?.discordRoleId) {
    return { status: "missing" };
  }

  const current = config(env);

  if (!current.guildId) {
    throw new Error("DISCORD_GUILD_ID is required for billet synchronization");
  }

  const client = clientFor(env, providedClient);

  try {
    await client.request(
      `/guilds/${current.guildId}/roles/${billet.discordRoleId}`,
      {
        method: "DELETE",
        auditReason: `Holdfast delete billet role ${billet.name}`,
      },
    );
  } catch (error) {
    if (error?.status === 404) {
      return { status: "missing" };
    }
    throw error;
  }

  return { status: "deleted" };
}

export async function ensureDiscordBilletRoles({
  env = process.env,
  client: providedClient = null,
  billets: providedBillets = null,
  liveRoles: providedRoles = null,
  persistRoleId = setBilletDiscordRoleId,
} = {}) {
  const current = config(env);

  if (!current.guildId) {
    throw new Error("DISCORD_GUILD_ID is required for billet synchronization");
  }

  const client = clientFor(env, providedClient);
  const billets = providedBillets || (await readBillets());
  const liveRoles =
    providedRoles ||
    (await client.request(`/guilds/${current.guildId}/roles`));
  const rolesByBilletId = new Map();

  for (const billet of billets) {
    const role = await ensureBilletRole({
      billet: { ...billet },
      client,
      guildId: current.guildId,
      liveRoles,
      persistRoleId,
    });
    rolesByBilletId.set(billet.id, role);
  }

  return { billets, liveRoles, rolesByBilletId };
}

export async function syncDiscordMemberBillets(
  member,
  {
    env = process.env,
    client: providedClient = null,
    billets: providedBillets = null,
    liveRoles: providedRoles = null,
    rolesByBilletId: providedRoleMap = null,
    persistRoleId = setBilletDiscordRoleId,
  } = {},
) {
  if (!member?.id) {
    throw new Error("Member ID is required for Discord billet synchronization");
  }

  const current = config(env);

  if (!current.guildId) {
    throw new Error("DISCORD_GUILD_ID is required for billet synchronization");
  }

  const client = clientFor(env, providedClient);
  let billets = providedBillets;
  let liveRoles = providedRoles;
  let rolesByBilletId = providedRoleMap;

  if (!billets || !liveRoles || !rolesByBilletId) {
    const ensured = await ensureDiscordBilletRoles({
      env,
      client,
      billets,
      liveRoles,
      persistRoleId,
    });
    billets = ensured.billets;
    liveRoles = ensured.liveRoles;
    rolesByBilletId = ensured.rolesByBilletId;
  }

  const currentMember = await discordMember(client, current.guildId, member.id);

  if (!currentMember) {
    return {
      memberId: member.id,
      status: "missing",
      added: 0,
      removed: 0,
    };
  }

  const currentRoleIds = new Set(
    Array.isArray(currentMember.roles) ? currentMember.roles : [],
  );
  const managedRoleIds = new Set(
    [...rolesByBilletId.values()].map((role) => role.id),
  );
  const desiredBilletIds = new Set(
    (Array.isArray(member.billets) ? member.billets : []).map(
      (billet) => billet.id,
    ),
  );
  const desiredRoleIds = new Set(
    [...desiredBilletIds]
      .map((billetId) => rolesByBilletId.get(billetId)?.id)
      .filter(Boolean),
  );

  const toAdd = [...desiredRoleIds].filter(
    (roleId) => !currentRoleIds.has(roleId),
  );
  const toRemove = [...managedRoleIds].filter(
    (roleId) => currentRoleIds.has(roleId) && !desiredRoleIds.has(roleId),
  );

  for (const roleId of toAdd) {
    await client.request(
      `/guilds/${current.guildId}/members/${member.id}/roles/${roleId}`,
      {
        method: "PUT",
        auditReason: "Holdfast billet assignment sync",
      },
    );
  }

  for (const roleId of toRemove) {
    await client.request(
      `/guilds/${current.guildId}/members/${member.id}/roles/${roleId}`,
      {
        method: "DELETE",
        auditReason: "Holdfast remove stale billet assignment",
      },
    );
  }

  return {
    memberId: member.id,
    status: toAdd.length || toRemove.length ? "synced" : "unchanged",
    added: toAdd.length,
    removed: toRemove.length,
  };
}

export async function reconcileDiscordBillets({
  env = process.env,
  client: providedClient = null,
  billets: providedBillets = null,
  members: providedMembers = null,
  persistRoleId = setBilletDiscordRoleId,
  logger = console,
} = {}) {
  const current = config(env);
  const client = clientFor(env, providedClient);
  const billets = providedBillets || (await readBillets());
  const members = providedMembers || (await readGuildMembers());
  const managedMembers = members.filter((member) => member.billetsManaged);
  const liveRoles = await client.request(
    `/guilds/${current.guildId}/roles`,
  );
  const ensured = await ensureDiscordBilletRoles({
    env,
    client,
    billets,
    liveRoles,
    persistRoleId,
  });

  const summary = {
    billets: billets.length,
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
      const result = await syncDiscordMemberBillets(member, {
        env,
        client,
        billets,
        liveRoles: ensured.liveRoles,
        rolesByBilletId: ensured.rolesByBilletId,
        persistRoleId,
      });

      if (result.status === "synced") summary.changed += 1;
      else if (result.status === "missing") summary.missing += 1;
      else summary.unchanged += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error(
        `Unable to reconcile Discord billets for member ${member.id}`,
        error,
      );
    }
  }

  return summary;
}

export function startDiscordBilletReconciler({
  env = process.env,
  logger = console,
  reconcile = reconcileDiscordBillets,
} = {}) {
  if (env.NODE_ENV !== "production") {
    return () => {};
  }

  const current = config(env);

  if (!current.guildId || !current.botToken) {
    logger.warn?.(
      "Discord billet reconciliation disabled: DISCORD_GUILD_ID or DISCORD_BOT_TOKEN is missing",
    );
    return () => {};
  }

  let running = false;
  let stopped = false;

  async function run() {
    if (running || stopped) return;
    running = true;

    try {
      const summary = await reconcile({ env, logger });

      if (summary.changed || summary.failed || summary.missing) {
        logger.log?.("Discord billet reconciliation", summary);
      }
    } catch (error) {
      logger.error("Discord billet reconciliation failed", error);
    } finally {
      running = false;
    }
  }

  void run();

  const timer = setInterval(run, RECONCILE_MILLISECONDS);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
