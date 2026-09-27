import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { runtimeDataDirectory } from "../src/Data/runtimeData.js";
import {
  DiscordApiClient,
  exportDiscordSnapshot,
  normalizeProvisioningState,
  pruneDiscordArchives,
  runDiscordProvisioning,
  validateDiscordManifest,
} from "../src/Discord/provisioning.js";

dotenv.config({ quiet: true });

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestFile = path.resolve(
  process.env.DISCORD_MANIFEST_FILE ||
    path.join(scriptDirectory, "../config/discord.manifest.json"),
);

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function validateOptions(command, args) {
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    if (option === "--json") continue;
    if (command === "prune" && option === "--apply") continue;
    if (command === "prune" && option === "--confirm") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--confirm requires a value");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option for ${command}: ${option}`);
  }
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function recordAudit(runtimeDirectory, report) {
  const auditFile = path.resolve(
    process.env.DISCORD_PROVISION_AUDIT_FILE ||
      path.join(runtimeDirectory, "discord-provisioning-audit.jsonl"),
  );
  const lastReportFile = path.resolve(
    process.env.DISCORD_PROVISION_REPORT_FILE ||
      path.join(runtimeDirectory, "discord-provisioning-last-report.json"),
  );
  await mkdir(path.dirname(auditFile), { recursive: true });
  await appendFile(auditFile, `${JSON.stringify(report)}\n`, "utf8");
  await writeJsonAtomic(lastReportFile, report);
}

async function withProvisioningLock(file, metadata, callback) {
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Another Discord provisioning mutation is running (${file}). Remove the lock only after confirming that process has stopped.`,
      );
    }
    throw error;
  }

  try {
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return await callback();
  } finally {
    await handle.close();
    await unlink(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function printReport(report) {
  const heading = report.dryRun ? "Planned" : "Completed";
  console.log(
    `${heading} Discord ${report.command} as ${report.bot.username} (${report.bot.id})`,
  );
  if (!report.changes.length) {
    console.log("No changes required");
    return;
  }
  for (const change of report.changes) {
    const id = change.id ? ` [${change.id}]` : "";
    console.log(`- ${change.type}: ${change.name} (${change.key})${id}`);
  }
}

async function main() {
  const [command = "plan", ...args] = process.argv.slice(2);
  const supported = new Set([
    "validate",
    "plan",
    "apply",
    "restore",
    "export",
    "prune",
  ]);
  if (!supported.has(command)) {
    throw new Error(
      "Usage: provisionDiscord.js validate|plan|apply|restore|export|prune [--json] [--apply --confirm GUILD_ID]",
    );
  }

  validateOptions(command, args);
  const jsonOutput = args.includes("--json");
  let manifest = null;
  if (!new Set(["export", "prune"]).has(command)) {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    validateDiscordManifest(manifest);
  }
  if (command === "validate") {
    const channelCount = manifest.categories.reduce(
      (total, category) => total + category.channels.length,
      0,
    );
    const result = {
      valid: true,
      roles: manifest.roles.length,
      categories: manifest.categories.length,
      channels: channelCount,
    };
    console.log(
      jsonOutput
        ? JSON.stringify(result, null, 2)
        : `Discord manifest valid: ${result.roles} roles, ${result.categories} categories, ${result.channels} channels`,
    );
    return;
  }

  const guildId = required("DISCORD_GUILD_ID");
  const token = required("DISCORD_BOT_TOKEN");
  const runtimeDirectory = runtimeDataDirectory();
  const client = new DiscordApiClient(token);

  if (command === "export") {
    const snapshot = await exportDiscordSnapshot({ client, guildId });
    const exportFile = path.resolve(
      process.env.DISCORD_EXPORT_FILE ||
        path.join(runtimeDirectory, "discord-live-export.json"),
    );
    await writeJsonAtomic(exportFile, snapshot);
    console.log(
      jsonOutput
        ? JSON.stringify({ exportFile, snapshot }, null, 2)
        : `Exported live Discord configuration to ${exportFile}`,
    );
    return;
  }

  const stateFile = path.resolve(
    process.env.DISCORD_PROVISION_STATE_FILE ||
      path.join(runtimeDirectory, "discord-provisioning-state.json"),
  );
  const pruneApply = command === "prune" && args.includes("--apply");
  const mutating =
    command === "apply" || command === "restore" || pruneApply;
  const persistState = (nextState) => writeJsonAtomic(stateFile, nextState);
  const execute = async () => {
    const state = normalizeProvisioningState(
      await loadJson(stateFile, null),
      guildId,
    );
    let executionResult;
    if (command === "prune") {
      executionResult = await pruneDiscordArchives({
        client,
        guildId,
        state,
        apply: pruneApply,
        confirmation: optionValue(args, "--confirm"),
        minimumAgeDays: Number(
          process.env.DISCORD_PRUNE_MIN_AGE_DAYS || "7",
        ),
        onStateChange: pruneApply ? persistState : undefined,
      });
    } else {
      executionResult = await runDiscordProvisioning({
        client,
        guildId,
        manifest,
        state,
        command,
        onStateChange: mutating ? persistState : undefined,
      });
    }

    if (mutating) {
      await persistState(executionResult.state);
      await recordAudit(runtimeDirectory, executionResult.report);
    }
    return executionResult;
  };

  const lockFile = path.resolve(
    process.env.DISCORD_PROVISION_LOCK_FILE || `${stateFile}.lock`,
  );
  const result = mutating
    ? await withProvisioningLock(
        lockFile,
        {
          pid: process.pid,
          command,
          guildId,
          startedAt: new Date().toISOString(),
        },
        execute,
      )
    : await execute();

  if (jsonOutput) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    printReport(result.report);
    if (mutating && result.roleIds) {
      const roleIds = result.roleIds;
      const officerRoles = ["lieutenant", "captain", "major", "commander"]
        .map((key) => roleIds[key])
        .filter(Boolean)
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
        .map((key) => roleIds[key])
        .filter(Boolean)
        .join(",");
      console.log("\nAdd these values to the production environment:");
      console.log(`DISCORD_RECRUIT_ROLE_ID=${roleIds.recruit || ""}`);
      console.log(`DISCORD_SITE_ADMIN_ROLE_IDS=${officerRoles}`);
      console.log(`DISCORD_QUEST_EDITOR_ROLE_IDS=${questRoles}`);
      console.log(`DISCORD_REWARD_POLICY_ROLE_IDS=${officerRoles}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
