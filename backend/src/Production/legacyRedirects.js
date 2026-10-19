// Permanent redirects from the single-guild site's paths to the multi-guild
// layout: Holdfast's pages moved under /holdfast and the guild directory
// moved from /guilds to the front page. Mounted before the SPA fallback so
// bookmarks, search results and shared links land on the page's new home
// with their query string intact. The frontend follows the same map
// (frontend/src/routing.js legacyRedirectPathname) for links inside the app.

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

export function redirectLegacyPaths(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const target = legacyRedirectPathname(req.path);
  if (!target) {
    next();
    return;
  }

  const queryStart = req.originalUrl.indexOf("?");
  const query = queryStart === -1 ? "" : req.originalUrl.slice(queryStart);
  res.redirect(301, `${target}${query}`);
}
