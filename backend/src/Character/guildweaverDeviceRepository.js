import crypto from "node:crypto";

import { withGuildDatabase, withGuildTransaction } from "../Data/database.js";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken(prefix = "") {
  return `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
}

function randomUserCode() {
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function text(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guildweaver_pairings (
      id TEXT PRIMARY KEY,
      device_code_hash TEXT NOT NULL UNIQUE,
      user_code TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'consumed')),
      member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT '',
      consumed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS guildweaver_pairings_expiry_idx
      ON guildweaver_pairings(status, expires_at);

    CREATE TABLE IF NOT EXISTS guildweaver_devices (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS guildweaver_devices_member_idx
      ON guildweaver_devices(member_id, revoked_at, last_seen_at DESC);
  `);
}

function deleteExpiredPairings(db, now) {
  db.prepare("DELETE FROM guildweaver_pairings WHERE expires_at <= ?").run(now);
}

export function startGuildweaverPairing({ deviceName = "Guildweaver Bridge" } = {}) {
  return withGuildTransaction((db) => {
    ensureSchema(db);
    const now = new Date();
    const nowIso = now.toISOString();
    deleteExpiredPairings(db, nowIso);

    const id = crypto.randomUUID();
    const deviceCode = randomToken("gwp_");
    const userCode = randomUserCode();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();

    db.prepare(
      `
        INSERT INTO guildweaver_pairings (
          id, device_code_hash, user_code, device_name, status,
          member_id, created_at, expires_at, approved_at, consumed_at
        ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, '', '')
      `,
    ).run(
      id,
      sha256(deviceCode),
      userCode,
      text(deviceName, 80) || "Guildweaver Bridge",
      nowIso,
      expiresAt,
    );

    return {
      deviceCode,
      userCode,
      expiresAt,
      expiresIn: Math.floor(PAIRING_TTL_MS / 1000),
      interval: 2,
    };
  });
}

export function approveGuildweaverPairing({ userCode, memberId }) {
  return withGuildTransaction((db) => {
    ensureSchema(db);
    const now = new Date().toISOString();
    deleteExpiredPairings(db, now);

    const member = db
      .prepare("SELECT id FROM members WHERE id = ? AND status = 'active'")
      .get(text(memberId, 96));

    if (!member) {
      return { status: "member-not-found" };
    }

    const pairing = db
      .prepare("SELECT * FROM guildweaver_pairings WHERE user_code = ?")
      .get(text(userCode, 16).toUpperCase());

    if (!pairing) {
      return { status: "not-found" };
    }

    if (pairing.status === "consumed") {
      return { status: "consumed" };
    }

    db.prepare(
      `
        UPDATE guildweaver_pairings
        SET status = 'approved', member_id = ?, approved_at = ?
        WHERE id = ?
      `,
    ).run(member.id, now, pairing.id);

    return {
      status: "approved",
      memberId: member.id,
      deviceName: pairing.device_name,
    };
  });
}

export function exchangeGuildweaverPairing(deviceCode) {
  return withGuildTransaction((db) => {
    ensureSchema(db);
    const now = new Date().toISOString();
    deleteExpiredPairings(db, now);

    const pairing = db
      .prepare("SELECT * FROM guildweaver_pairings WHERE device_code_hash = ?")
      .get(sha256(deviceCode));

    if (!pairing) {
      return { status: "expired" };
    }

    if (pairing.status === "pending") {
      return { status: "pending" };
    }

    if (pairing.status === "consumed") {
      return { status: "consumed" };
    }

    if (!pairing.member_id) {
      return { status: "invalid" };
    }

    const deviceId = crypto.randomUUID();
    const deviceToken = randomToken("gwd_");

    db.prepare(
      `
        INSERT INTO guildweaver_devices (
          id, member_id, name, token_hash, created_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `,
    ).run(
      deviceId,
      pairing.member_id,
      pairing.device_name,
      sha256(deviceToken),
      now,
      now,
    );

    db.prepare(
      `
        UPDATE guildweaver_pairings
        SET status = 'consumed', consumed_at = ?
        WHERE id = ?
      `,
    ).run(now, pairing.id);

    return {
      status: "connected",
      deviceId,
      deviceToken,
      memberId: pairing.member_id,
      deviceName: pairing.device_name,
    };
  });
}

export function authenticateGuildweaverDevice(deviceToken) {
  return withGuildTransaction((db) => {
    ensureSchema(db);
    const row = db
      .prepare(
        `
          SELECT d.id, d.member_id, d.name
          FROM guildweaver_devices d
          JOIN members m ON m.id = d.member_id
          WHERE d.token_hash = ?
            AND d.revoked_at IS NULL
            AND m.status = 'active'
        `,
      )
      .get(sha256(deviceToken));

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE guildweaver_devices SET last_seen_at = ? WHERE id = ?").run(
      now,
      row.id,
    );

    return {
      id: row.id,
      memberId: row.member_id,
      name: row.name,
      lastSeenAt: now,
    };
  });
}

export function readGuildweaverDevices(memberId) {
  return withGuildDatabase((db) => {
    ensureSchema(db);
    return db
      .prepare(
        `
          SELECT id, name, created_at, last_seen_at, revoked_at
          FROM guildweaver_devices
          WHERE member_id = ?
          ORDER BY last_seen_at DESC, created_at DESC
        `,
      )
      .all(text(memberId, 96))
      .map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at || null,
      }));
  });
}
