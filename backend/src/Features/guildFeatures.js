// The guild surfaces (guild directory, registration, guild pages, Holdfast's
// own site) are switched off while Guildweaver is a solo, personal product.
// Their data and code stay; this one switch hides them. Set
// GUILDWEAVER_GUILD_FEATURES=true to bring them back.
//
// Read on every request, so tests and operators can flip it without a
// rebuild. The frontend learns the setting from a meta tag the server adds
// to index.html (Production/frontend.js).

const ENABLED = /^(1|true|on|yes)$/i;

export function guildFeaturesEnabled(env = process.env) {
  return ENABLED.test(String(env.GUILDWEAVER_GUILD_FEATURES || "").trim());
}

// Guild-only API routes answer 404 while the switch is off, as if they did
// not exist.
export function requireGuildFeatures(req, res, next) {
  if (guildFeaturesEnabled()) {
    next();
    return;
  }
  res.status(404).json({ error: "not_found" });
}
