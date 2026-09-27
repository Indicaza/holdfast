import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const TARGETS = ["src", "test", "scripts"];

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await javascriptFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = [];

for (const target of TARGETS) {
  files.push(...(await javascriptFiles(path.join(BACKEND_ROOT, target))));
}

let failed = false;

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax OK: ${files.length} JavaScript files`);
}
