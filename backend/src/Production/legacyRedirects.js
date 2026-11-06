import { guildFeaturesEnabled } from "../Features/guildFeatures.js";

// Permanent redirects from the single-guild site's paths to the multi-guild
// layout: Holdfast's pages moved under /holdfast and the guild directory
// moved from /guilds to the front page. Mounted before the SPA fallback so
// bookmarks, search results and shared links land on the page's new home
// with their query string intact. The frontend follows the same map
// (frontend/src/routing.js legacyRedirectPathname) for links inside the app.
//
// While guild features are off (Features/guildFeatures.js) the guild pages
// are hidden instead: the old guild workspace goes to the player dashboard
// and every other guild page to the front page. Those redirects are
// temporary (302), so browsers do not remember them once guilds return.

const HOLDFAST_SECTIONS = new Set(["quests", "members", "charter", "ranks", "intelligence"]);

export function legacyRedirectPathname(pathname) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/guildos" || normalized === "/guilds") return "/";

  const guild = normalized.match(/^\/guilds\/([^/]+)$/);
  if (guild) return `/${guild[1]}`;

  const [, section, rest = ""] = normalized.match(/^\/([^/]+)(\/.*)?$/) || [];
  if (!HOLDFAST_SECTIONS.has(section)) return null;
  // Only paths that were pages: /members/:id is the one with a tail.
  if (rest && !(section === "members" && /^\/[^/]+$/.test(rest))) return null;
  return `/holdfast/${section}${rest}`;
}

// Where a guild page goes while guild features are off, or null when the
// path is not one of them.
export function hiddenGuildPathname(pathname) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (["/guildos", "/intelligence", "/holdfast/intelligence"].includes(normalized)) return "/dashboard";
  if (["/guilds", "/register", "/join", "/holdfast"].includes(normalized)) return "/";
  if (/^\/(guilds|holdfast)\/.+/.test(normalized)) return "/";
  return legacyRedirectPathname(normalized) ? "/" : null;
}

export function redirectLegacyPaths(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const hidden = guildFeaturesEnabled() ? null : hiddenGuildPathname(req.path);
  const target = hidden || legacyRedirectPathname(req.path);
  if (!target) {
    next();
    return;
  }

  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  // A hidden page's query string belonged to the page that is gone.
  res.redirect(hidden ? 302 : 301, hidden ? target : `${target}${query}`);
}
