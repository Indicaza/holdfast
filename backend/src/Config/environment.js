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

export function productionEnvironmentProblems(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return [];
  }

  const problems = [];
  const required = [
    "FRONTEND_URL",
    "GUILD_DATA_DIR",
    "SESSION_SECRET",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "DISCORD_BOT_TOKEN",
    "GUILD_OWNER_DISCORD_IDS",
  ];

  for (const name of required) {
    if (!String(env[name] || "").trim()) {
      problems.push(`${name} is required`);
    }
  }

  if (
    env.SESSION_SECRET &&
    Buffer.byteLength(env.SESSION_SECRET, "utf8") < 32
  ) {
    problems.push("SESSION_SECRET must be at least 32 bytes");
  }

  const frontendUrl = parsedUrl(env.FRONTEND_URL);

  if (env.FRONTEND_URL && !frontendUrl) {
    problems.push("FRONTEND_URL must be a valid URL");
  } else if (frontendUrl) {
    if (frontendUrl.protocol !== "https:") {
      problems.push("FRONTEND_URL must use HTTPS");
    }

    if (frontendUrl.pathname !== "/" || frontendUrl.search || frontendUrl.hash) {
      problems.push("FRONTEND_URL must be an origin without a path, query, or hash");
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
      problems.push("DISCORD_REDIRECT_URI must use the FRONTEND_URL origin");
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
