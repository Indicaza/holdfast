import { withGuildDatabase } from "../Data/database.js";
import { HOLDFAST_GUILD_ID } from "./guildScope.js";

// Sets req.guild, the guild every repository call in the request is scoped
// to. Routers never pick a guild themselves.

function readGuildContext(db, column, value) {
  return (
    db
      .prepare(
        `SELECT id, slug, name FROM guilds WHERE ${column} = ? AND status = 'active'`,
      )
      .get(value) || null
  );
}

// /api/g/:slug/... : the guild named by the path.
export function guildContextFromSlug(req, res, next) {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const guild = slug
      ? withGuildDatabase((db) => readGuildContext(db, "slug", slug))
      : null;

    if (!guild) {
      res.status(404).json({ error: "guild_not_found" });
      return;
    }

    req.guild = guild;
    next();
  } catch (error) {
    next(error);
  }
}

// The original unscoped routes (/api/quests, /api/guild/...) are Holdfast's.
export function holdfastGuildContext(req, res, next) {
  try {
    req.guild = withGuildDatabase((db) =>
      readGuildContext(db, "id", HOLDFAST_GUILD_ID),
    ) || { id: HOLDFAST_GUILD_ID, slug: "holdfast", name: "Holdfast" };
    next();
  } catch (error) {
    next(error);
  }
}
