import { withGuildDatabase } from "../Data/database.js";
import { validSlug } from "../Guild/Directory/guildDirectoryModel.js";

// The built index.html is the Guildweaver directory's. A guild's pages
// (/:slug/...) are served with that guild's title and description instead,
// so link previews, crawlers and the first paint name the guild before the
// app sets each page's own title.

const HOLDFAST_HEAD = Object.freeze({
  title: "Holdfast | Alliance WoW Forever Guild",
  description:
    "Holdfast is an Alliance guild for WoW Forever focused on organized PvE, PvP, mentorship, shared prosperity, and a durable long-term community.",
});

function readGuildHead(slug) {
  const row = withGuildDatabase((db) =>
    db.prepare("SELECT name, tagline FROM guilds WHERE slug = ? AND status = 'active'").get(slug),
  );
  if (!row) return null;
  return {
    title: `${row.name} | Guildweaver`,
    description: row.tagline || `${row.name} on Guildweaver: who they are, what they play and how to join.`,
  };
}

// { title, description } for a guild page's pathname, or null to serve the
// page as built.
export function guildPageHead(pathname, readGuild = readGuildHead) {
  const slug = String(pathname || "").split("/")[1] || "";
  if (!validSlug(slug)) return null;
  if (slug === "holdfast") return HOLDFAST_HEAD;
  try {
    return readGuild(slug);
  } catch (error) {
    console.error("Unable to read guild page metadata", error);
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceMeta(html, attribute, key, content) {
  const pattern = new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`);
  return html.replace(pattern, `$1${escapeHtml(content)}$2`);
}

export function withPageHead(html, { title, description }) {
  let result = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  result = replaceMeta(result, "name", "description", description);
  result = replaceMeta(result, "property", "og:title", title);
  result = replaceMeta(result, "property", "og:description", description);
  result = replaceMeta(result, "name", "twitter:title", title);
  result = replaceMeta(result, "name", "twitter:description", description);
  return result;
}
