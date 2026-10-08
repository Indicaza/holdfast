import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createBlizzardIconMediaResolver } from "../GameData/blizzardIconMedia.js";

const ICON_MAP_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "seed",
  "devData",
  "icons.json",
);
const ICON_CDN = "https://wow.zamimg.com/images/wow/icons/large";

function loadIconNames(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).icons || {};
  } catch {
    return {};
  }
}

// Local development rarely has Blizzard API credentials, which leaves every
// seeded icon broken. Prefer Blizzard when it resolves, then fall back to the
// public icon CDN for FileDataIDs recorded alongside the development seed.
// Only mounted when the development sandbox is enabled.
export function createDevelopmentIconMediaResolver({
  blizzard = createBlizzardIconMediaResolver(),
  iconNames = loadIconNames(ICON_MAP_PATH),
} = {}) {
  return {
    async resolve(fileDataId) {
      const resolved = await blizzard.resolve(fileDataId).catch(() => "");
      if (resolved) return resolved;
      const name = iconNames[String(fileDataId)];
      return name ? `${ICON_CDN}/${encodeURIComponent(name)}.jpg` : "";
    },
    status() {
      return { ...blizzard.status(), developmentFallback: true };
    },
  };
}
