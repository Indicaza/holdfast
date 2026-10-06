const BRIDGE_REPOSITORY = "https://github.com/Indicaza/guildweaver-bridge";
const RELEASE_CHANNELS = new Set(["edge", "beta", "stable"]);

export const guildweaverPackages = Object.freeze({
  windows: Object.freeze({
    label: "Windows x64",
    artifact: "GuildweaverBridge.zip",
  }),
  "macos-arm64": Object.freeze({
    label: "macOS Apple Silicon",
    artifact: "GuildweaverBridge-macos-arm64.zip",
  }),
  "macos-x64": Object.freeze({
    label: "macOS Intel",
    artifact: "GuildweaverBridge-macos-x64.zip",
  }),
  "linux-x64": Object.freeze({
    label: "Linux x64",
    artifact: "GuildweaverBridge-linux-x64.zip",
  }),
  "linux-arm64": Object.freeze({
    label: "Linux ARM64",
    artifact: "GuildweaverBridge-linux-arm64.zip",
  }),
});

export function guildweaverReleaseChannel(env = process.env) {
  const configured = String(env.GUILDWEAVER_RELEASE_CHANNEL || "edge")
    .trim()
    .toLowerCase();

  return RELEASE_CHANNELS.has(configured) ? configured : "edge";
}

export function guildweaverDownloadUrl(
  platform,
  { env = process.env, checksum = false } = {},
) {
  const packageInfo = guildweaverPackages[platform];
  if (!packageInfo) return null;

  const channel = guildweaverReleaseChannel(env);
  const artifact = checksum
    ? `${packageInfo.artifact}.sha256`
    : packageInfo.artifact;

  return `${BRIDGE_REPOSITORY}/releases/download/${channel}/${artifact}`;
}

export function guildweaverReleaseMetadata(env = process.env) {
  const channel = guildweaverReleaseChannel(env);
  const channelLabel =
    channel === "stable" ? "Stable" : channel === "beta" ? "Beta" : "Alpha / Edge";

  return {
    channel,
    channelLabel,
    releasePage: `${BRIDGE_REPOSITORY}/releases/tag/${channel}`,
    source: BRIDGE_REPOSITORY,
    buildPipeline: `${BRIDGE_REPOSITORY}/actions/workflows/release.yml`,
    reportIssue: `${BRIDGE_REPOSITORY}/issues/new/choose`,
    packages: Object.fromEntries(
      Object.entries(guildweaverPackages).map(([id, packageInfo]) => [
        id,
        {
          label: packageInfo.label,
          download: `/guildweaver/download/${id}`,
          checksum: `/guildweaver/download/${id}/sha256`,
        },
      ]),
    ),
  };
}
