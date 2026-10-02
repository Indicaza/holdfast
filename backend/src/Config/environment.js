const DISCORD_ID = /^\d{17,20}$/;

function parsedUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function commaSeparatedValues(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function configuredValue(value) {
  return String(value || "").trim();
}

export function publicWebsiteUrl(env = process.env) {
  return (
    configuredValue(env.FRONTEND_URL) ||
    configuredValue(env.RENDER_EXTERNAL_URL) ||
    "http://localhost:5173"
  );
}

export function productionEnvironmentProblems(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return [];
  }

  const problems = [];
  const required = [
    "GUILD_DATA_DIR",
    "SESSION_SECRET",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "DISCORD_BOT_TOKEN",
    "GUILD_OWNER_DISCORD_IDS",
  ];

  for (const name of required) {
    if (!configuredValue(env[name])) {
      problems.push(`${name} is required`);
    }
  }

  const configuredFrontendUrl =
    configuredValue(env.FRONTEND_URL) ||
    configuredValue(env.RENDER_EXTERNAL_URL);
  const frontendUrlName = configuredValue(env.FRONTEND_URL)
    ? "FRONTEND_URL"
    : "RENDER_EXTERNAL_URL";

  if (!configuredFrontendUrl) {
    problems.push("FRONTEND_URL or RENDER_EXTERNAL_URL is required");
  }

  if (
    env.SESSION_SECRET &&
    Buffer.byteLength(env.SESSION_SECRET, "utf8") < 32
  ) {
    problems.push("SESSION_SECRET must be at least 32 bytes");
  }

  const frontendUrl = parsedUrl(configuredFrontendUrl);

  if (configuredFrontendUrl && !frontendUrl) {
    problems.push(`${frontendUrlName} must be a valid URL`);
  } else if (frontendUrl) {
    if (frontendUrl.protocol !== "https:") {
      problems.push(`${frontendUrlName} must use HTTPS`);
    }

    if (frontendUrl.pathname !== "/" || frontendUrl.search || frontendUrl.hash) {
      problems.push(
        `${frontendUrlName} must be an origin without a path, query, or hash`,
      );
    }

    if (frontendUrl.username || frontendUrl.password) {
      problems.push(`${frontendUrlName} must not contain credentials`);
    }
  }

  const redirectUrl = env.DISCORD_REDIRECT_URI
    ? parsedUrl(env.DISCORD_REDIRECT_URI)
    : null;

  if (env.DISCORD_REDIRECT_URI && !redirectUrl) {
    problems.push("DISCORD_REDIRECT_URI must be a valid URL");
  } else if (redirectUrl) {
    if (redirectUrl.protocol !== "https:") {
      problems.push("DISCORD_REDIRECT_URI must use HTTPS");
    }

    if (frontendUrl && redirectUrl.origin !== frontendUrl.origin) {
      problems.push(
        `DISCORD_REDIRECT_URI must use the ${frontendUrlName} origin`,
      );
    }

    if (
      redirectUrl.pathname !== "/api/auth/discord/callback" ||
      redirectUrl.search ||
      redirectUrl.hash
    ) {
      problems.push(
        "DISCORD_REDIRECT_URI must use the /api/auth/discord/callback path without a query or hash",
      );
    }

    if (redirectUrl.username || redirectUrl.password) {
      problems.push("DISCORD_REDIRECT_URI must not contain credentials");
    }
  }

  for (const name of [
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_ID",
    "DISCORD_RECRUIT_ROLE_ID",
  ]) {
    if (env[name] && !DISCORD_ID.test(String(env[name]).trim())) {
      problems.push(`${name} must be a Discord snowflake ID`);
    }
  }

  for (const name of [
    "GUILD_OWNER_DISCORD_IDS",
    "DISCORD_SITE_ADMIN_ROLE_IDS",
    "DISCORD_QUEST_EDITOR_ROLE_IDS",
    "DISCORD_REWARD_POLICY_ROLE_IDS",
  ]) {
    const invalid = commaSeparatedValues(env[name]).find(
      (value) => !DISCORD_ID.test(value),
    );

    if (invalid) {
      problems.push(`${name} must contain only Discord snowflake IDs`);
    }
  }

  const port = Number(env.PORT || 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push("PORT must be an integer between 1 and 65535");
  }

  if (env.DISCORD_SESSION_REVERIFY_SECONDS) {
    const seconds = Number(env.DISCORD_SESSION_REVERIFY_SECONDS);

    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 2592000) {
      problems.push(
        "DISCORD_SESSION_REVERIFY_SECONDS must be an integer from 60 to 2592000",
      );
    }
  }

  if (env.DISCORD_RANK_RECONCILE_SECONDS) {
    const seconds = Number(env.DISCORD_RANK_RECONCILE_SECONDS);

    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
      problems.push(
        "DISCORD_RANK_RECONCILE_SECONDS must be an integer from 60 to 3600",
      );
    }
  }

  return problems;
}

export function assertProductionEnvironment(env = process.env) {
  const problems = productionEnvironmentProblems(env);

  if (problems.length) {
    throw new Error(
      `Invalid production configuration:\n- ${problems.join("\n- ")}`,
    );
  }
}
