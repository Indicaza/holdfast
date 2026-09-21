import crypto from "node:crypto";

const SESSION_COOKIE = "guild_session";
const OAUTH_STATE_COOKIE = "guild_oauth_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        const key = index === -1 ? part : part.slice(0, index);
        const value = index === -1 ? "" : part.slice(index + 1);
        return [key, decodeURIComponent(value)];
      }),
  );
}

function cookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure,
  ]
    .filter(Boolean)
    .join("; ");
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  return secret;
}

function sign(payload) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function encodeSession(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(value) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");

  if (!payload || !signature || !safeEqual(sign(payload), signature)) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );

    if (!session.exp || Date.now() >= session.exp) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function attachSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.auth = decodeSession(cookies[SESSION_COOKIE]);
  next();
}

export function setSession(res, data) {
  const session = {
    ...data,
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
  return parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE] || null;
}

export function clearOAuthState(res) {
  res.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, "", 0));
}
