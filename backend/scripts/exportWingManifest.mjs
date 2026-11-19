#!/usr/bin/env node
// Writes src/Atlas/data/wing-manifest.json from Atlas/atlasWings.js and the
// checked-in atlas (see Atlas/atlasWingManifest.js).
//
//   node scripts/exportWingManifest.mjs          write it
//   node scripts/exportWingManifest.mjs --check  fail when it is out of date

import { readFileSync, writeFileSync } from "node:fs";

import { wingManifestText } from "../src/Atlas/atlasWingManifest.js";

const target = new URL("../src/Atlas/data/wing-manifest.json", import.meta.url);
const text = wingManifestText();

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(target, "utf8").replace(/\r\n/g, "\n"); } catch { current = ""; }
  if (current !== text) {
    console.error("wing-manifest.json is out of date: run node scripts/exportWingManifest.mjs");
    process.exit(1);
  }
  console.log("wing-manifest.json is current");
} else {
  writeFileSync(target, text);
  console.log(`wrote ${target.pathname}`);
}
