import crypto from "node:crypto";

const SESSION_COOKIE = "guild_session";
const OAUTH_STATE_COOKIE = "guild_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const MAX_COOKIE_HEADER_LENGTH = 16 * 1024;
const MAX_SESSION_TOKEN_LENGTH = 3800;
const MAX_SESSION_CLOCK_SKEW_MS = 5 * 60 * 1000;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function readCookie(header, name) {
  if (typeof header !== "string" || header.length > MAX_COOKIE_HEADER_LENGTH) {
    return null;
  }

  for (const rawPart of header.split(";")) {
    const part = rawPart.trim();
    const index = part.indexOf("=");

    if (index <= 0 || part.slice(0, index).trim() !== name) {
      continue;
    }

    try {
      return decodeURIComponent(part.slice(index + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function cookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "Secure" : "";
  const expires =
    maxAge === 0 ? "Expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";

  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    "Priority=High",
    expires,
    secure,
  ]
    .filter(Boolean)
    .join("; ");
}

function sessionSecret(env = process.env) {
  const secret = env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  if (
    env.NODE_ENV === "production" &&
    Buffer.byteLength(secret, "utf8") < 32
  ) {
    throw new Error(
      "SESSION_SECRET must be at least 32 bytes in production",
    );
  }

  return secret;
}

export function signWithSessionSecret(payload, env = process.env) {
  return crypto
    .createHmac("sha256", sessionSecret(env))
    .update(payload)
    .digest("base64url");
}

export function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function encodeSession(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const token = `${payload}.${signWithSessionSecret(payload)}`;

  if (token.length > MAX_SESSION_TOKEN_LENGTH) {
    throw new Error("Session payload is too large");
  }

  return token;
}

function decodeBase64Url(value) {
  if (!value || !BASE64URL.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

function validatedSession(session) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return null;
  }

  if (
    !session.user ||
    typeof session.user !== "object" ||
    Array.isArray(session.user) ||
    typeof session.user.id !== "string" ||
    !session.user.id.trim() ||
    session.user.id.length > 100
  ) {
    return null;
  }

  if (
    !Array.isArray(session.permissions) ||
    session.permissions.length > 50 ||
    session.permissions.some(
      (permission) =>
        typeof permission !== "string" ||
        !permission ||
        permission.length > 100,
    )
  ) {
    return null;
  }

  const now = Date.now();

  if (
    !Number.isSafeInteger(session.exp) ||
    session.exp <= now ||
    session.exp >
      now + SESSION_MAX_AGE_SECONDS * 1000 + MAX_SESSION_CLOCK_SKEW_MS
  ) {
    return null;
  }

  if (
    session.verifiedAt !== undefined &&
    (!Number.isFinite(session.verifiedAt) ||
      session.verifiedAt < 0 ||
      session.verifiedAt > now + MAX_SESSION_CLOCK_SKEW_MS)
  ) {
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      id: session.user.id.trim(),
    },
    permissions: [...new Set(session.permissions)],
  };
}

function decodeSession(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_SESSION_TOKEN_LENGTH
  ) {
    return null;
  }

  const parts = value.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  const decodedPayload = decodeBase64Url(payload);

  if (
    !decodedPayload ||
    !decodeBase64Url(signature) ||
    !secureEqual(signWithSessionSecret(payload), signature)
  ) {
    return null;
  }

  try {
    return validatedSession(JSON.parse(decodedPayload.toString("utf8")));
  } catch {
    return null;
  }
}

export function attachSession(req, res, next) {
  req.auth = decodeSession(readCookie(req.headers.cookie, SESSION_COOKIE));
  next();
}

export function setSession(res, data) {
  if (
    typeof data?.user?.id !== "string" ||
    !data.user.id.trim() ||
    data.user.id.length > 100
  ) {
    throw new Error("A session requires a user ID");
  }

  const permissions = Array.isArray(data.permissions) ? data.permissions : [];

  if (
    permissions.length > 50 ||
    permissions.some(
      (permission) =>
        typeof permission !== "string" ||
        !permission ||
        permission.length > 100,
    )
  ) {
    throw new Error("Session permissions are invalid");
  }

  const session = {
    ...data,
    user: {
      ...data.user,
      id: data.user.id.trim(),
    },
    permissions: [...new Set(permissions)],
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };

  res.append(
    "Set-Cookie",
    cookie(SESSION_COOKIE, encodeSession(session), SESSION_MAX_AGE_SECONDS),
  );
}

export function clearSession(res) {
  res.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
}

export function setOAuthState(res, state) {
  res.append(
    "Set-Cookie",
    cookie(OAUTH_STATE_COOKIE, state, OAUTH_STATE_MAX_AGE_SECONDS),
  );
}

export function readOAuthState(req) {
  return readCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
}

export function clearOAuthState(res) {
  res.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, "", 0));
}
