import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { createDiscordAuthRouter } from "./Auth/discordAuth.js";
import { requirePermission } from "./Auth/permissions.js";
import { attachSession } from "./Auth/session.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json());
app.use(attachSession);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", createDiscordAuthRouter());

app.get("/api/me", (req, res) => {
  if (!req.auth) {
    res.json({ authenticated: false });
    return;
  }

  res.json({
    authenticated: true,
    user: req.auth.user,
    permissions: req.auth.permissions,
  });
});

app.get("/api/admin/ping", requirePermission("site.admin"), (req, res) => {
  res.json({
    status: "ok",
    user: req.auth.user,
  });
});

app.listen(PORT, () => {
  console.log(`Guild backend running on port ${PORT}`);
});
