import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

function frontendDirectory() {
  const configured = String(process.env.FRONTEND_DIST_DIR || "").trim();

  if (configured) {
    return path.resolve(configured);
  }

  return fileURLToPath(new URL("../../../frontend/dist/", import.meta.url));
}

function shouldServeFrontend() {
  return (
    process.env.NODE_ENV === "production" ||
    String(process.env.SERVE_FRONTEND || "").toLowerCase() === "true"
  );
}

export function mountProductionFrontend(app) {
  if (!shouldServeFrontend()) {
    return;
  }

  const directory = frontendDirectory();
  const indexFile = path.join(directory, "index.html");

  if (!existsSync(indexFile)) {
    throw new Error(`Frontend build not found at ${indexFile}`);
  }

  app.use(
    express.static(directory, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== "GET" || !req.accepts("html")) {
      next();
      return;
    }

    res.set("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });
}
