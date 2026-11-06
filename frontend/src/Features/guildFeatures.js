// Whether the guild surfaces (guild directory, registration, guild pages,
// Holdfast's own site, notifications) are shown. Off while Guildweaver is a
// solo, personal product; the code and data stay for when guilds return.
//
// The server decides (GUILDWEAVER_GUILD_FEATURES, backend/src/Features) and
// says so with a meta tag in index.html. The Vite dev server serves its own
// index.html, so local development can opt in with VITE_GUILD_FEATURES=true.

function fromMeta(documentLike) {
  try {
    return documentLike?.querySelector?.('meta[name="guildweaver-guild-features"]')?.getAttribute('content') === 'on'
  } catch {
    return false
  }
}

function fromViteEnv() {
  try {
    return import.meta.env?.VITE_GUILD_FEATURES === 'true'
  } catch {
    return false
  }
}

export function readGuildFeatures(documentLike = globalThis.document) {
  return fromMeta(documentLike) || fromViteEnv()
}

// Read once: the setting cannot change while a page is open.
export const guildFeaturesEnabled = readGuildFeatures()
