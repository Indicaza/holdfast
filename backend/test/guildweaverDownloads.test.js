import test from "node:test";
import assert from "node:assert/strict";

import {
  guildweaverDownloadUrl,
  guildweaverReleaseChannel,
  guildweaverReleaseMetadata,
} from "../src/Guildweaver/releaseConfig.js";
import { withHttpApp } from "../testSupport/httpHarness.js";

test("Guildweaver release channel is constrained to known public channels", () => {
  assert.equal(guildweaverReleaseChannel({}), "edge");
  assert.equal(guildweaverReleaseChannel({ GUILDWEAVER_RELEASE_CHANNEL: "BETA" }), "beta");
  assert.equal(guildweaverReleaseChannel({ GUILDWEAVER_RELEASE_CHANNEL: "stable" }), "stable");
  assert.equal(guildweaverReleaseChannel({ GUILDWEAVER_RELEASE_CHANNEL: "nightly" }), "edge");
});

test("Guildweaver package URLs stay pinned to the public release contract", () => {
  const env = { GUILDWEAVER_RELEASE_CHANNEL: "beta" };
  assert.equal(
    guildweaverDownloadUrl("windows", { env }),
    "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge.zip",
  );
  assert.equal(
    guildweaverDownloadUrl("macos-arm64", { env }),
    "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-macos-arm64.zip",
  );
  assert.equal(
    guildweaverDownloadUrl("linux-arm64", { env, checksum: true }),
    "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-linux-arm64.zip.sha256",
  );
  assert.equal(guildweaverDownloadUrl("plan9", { env }), null);
});

test("Guildweaver metadata exposes stable Holdfast routes instead of raw asset URLs", () => {
  const metadata = guildweaverReleaseMetadata({ GUILDWEAVER_RELEASE_CHANNEL: "edge" });
  assert.equal(metadata.channel, "edge");
  assert.equal(metadata.channelLabel, "Alpha / Edge");
  assert.equal(metadata.packages.windows.download, "/guildweaver/download/windows");
  assert.equal(
    metadata.packages["macos-x64"].checksum,
    "/guildweaver/download/macos-x64/sha256",
  );
});

test("public Guildweaver routes redirect to the configured release channel", async () => {
  await withHttpApp(
    async ({ request }) => {
      const windows = await request("/guildweaver/download/windows");
      assert.equal(windows.status, 302);
      assert.equal(
        windows.headers.get("location"),
        "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge.zip",
      );

      const checksum = await request("/guildweaver/download/linux-x64/sha256");
      assert.equal(checksum.status, 302);
      assert.equal(
        checksum.headers.get("location"),
        "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-linux-x64.zip.sha256",
      );

      const unsupported = await request("/guildweaver/download/haiku");
      assert.equal(unsupported.status, 404);
      assert.deepEqual(unsupported.json, { error: "unsupported_platform" });

      const metadata = await request("/api/guildweaver/release");
      assert.equal(metadata.status, 200);
      assert.equal(metadata.json.channel, "beta");
      assert.equal(metadata.json.packages["macos-arm64"].download, "/guildweaver/download/macos-arm64");
    },
    { env: { GUILDWEAVER_RELEASE_CHANNEL: "beta" } },
  );
});
