// Guilds become first-class: the site was one guild (Holdfast) and is now a
// directory of many. Holdfast is seeded as the first guild and every active
// member joins it, so existing pages keep working while new guilds register.
//
// `members` stays the account table (one row per Discord user). Belonging to
// a guild moves to guild_memberships, where a partial unique index keeps one
// active guild per player.

export const HOLDFAST_GUILD_ID = "guild-holdfast";

export const guildDirectoryMigration = {
  version: 12,
  name: "multi_guild_directory",
  up(db) {
    db.exec(`
      CREATE TABLE guilds (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        faction TEXT NOT NULL CHECK (faction IN ('alliance', 'horde')),
        region TEXT NOT NULL,
        realm TEXT NOT NULL,
        realm_type TEXT NOT NULL CHECK (realm_type IN ('normal', 'pvp', 'rp', 'rp_pvp', 'hardcore')),
        language TEXT NOT NULL DEFAULT 'en',
        timezone TEXT NOT NULL DEFAULT '',
        recruiting INTEGER NOT NULL DEFAULT 1 CHECK (recruiting IN (0, 1)),
        recruiting_classes_json TEXT NOT NULL DEFAULT '[]',
        recruiting_roles_json TEXT NOT NULL DEFAULT '[]',
        minimum_level INTEGER NOT NULL DEFAULT 1,
        raid_days_json TEXT NOT NULL DEFAULT '[]',
        raid_start TEXT NOT NULL DEFAULT '',
        raid_end TEXT NOT NULL DEFAULT '',
        voice_required INTEGER NOT NULL DEFAULT 0 CHECK (voice_required IN (0, 1)),
        age_policy TEXT NOT NULL DEFAULT 'any' CHECK (age_policy IN ('any', 'adult')),
        discord_invite_url TEXT NOT NULL DEFAULT '',
        discord_server_id TEXT NOT NULL DEFAULT '',
        accent_color TEXT NOT NULL DEFAULT '#c4a667',
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        owner_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX guilds_directory_idx
        ON guilds(status, visibility, faction, region, realm_type);
      CREATE INDEX guilds_name_idx ON guilds(name COLLATE NOCASE);

      CREATE TABLE guild_play_styles (
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        style TEXT NOT NULL,
        PRIMARY KEY (guild_id, style)
      );
      CREATE INDEX guild_play_styles_style_idx ON guild_play_styles(style, guild_id);

      CREATE TABLE guild_memberships (
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'officer', 'member')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'departed')),
        joined_at TEXT NOT NULL,
        departed_at TEXT,
        PRIMARY KEY (guild_id, member_id)
      );
      CREATE UNIQUE INDEX guild_memberships_one_active_guild_idx
        ON guild_memberships(member_id) WHERE status = 'active';
      CREATE INDEX guild_memberships_guild_idx ON guild_memberships(guild_id, status, role);

      CREATE TABLE guild_links (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        linked_guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'sister' CHECK (kind IN ('sister')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
        requested_by TEXT REFERENCES members(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        responded_at TEXT,
        CHECK (guild_id <> linked_guild_id)
      );
      CREATE UNIQUE INDEX guild_links_pair_idx ON guild_links(
        MIN(guild_id, linked_guild_id), MAX(guild_id, linked_guild_id), kind
      );

      CREATE TABLE guild_applications (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        character_name TEXT NOT NULL DEFAULT '',
        class_token TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT REFERENCES members(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX guild_applications_one_pending_idx
        ON guild_applications(guild_id, member_id) WHERE status = 'pending';
      CREATE INDEX guild_applications_guild_idx ON guild_applications(guild_id, status, created_at DESC);
    `);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO guilds (
        id, slug, name, tagline, description, faction, region, realm, realm_type, language,
        recruiting, recruiting_classes_json, recruiting_roles_json, voice_required,
        created_at, updated_at
      ) VALUES (?, 'holdfast', 'Holdfast', ?, ?, 'alliance', 'US', 'WoW Forever', 'pvp', 'en', 1, ?, ?, 0, ?, ?)
    `).run(
      HOLDFAST_GUILD_ID,
      "Service-based leadership. High standards, no elitism.",
      "An Alliance guild for WoW Forever focused on organized PvE, PvP, mentorship and shared prosperity. No attendance treadmill, voice optional, every class and experience level welcome.",
      JSON.stringify(["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]),
      JSON.stringify(["tank", "healer", "dps"]),
      now,
      now,
    );
    const style = db.prepare("INSERT INTO guild_play_styles (guild_id, style) VALUES (?, ?)");
    for (const value of ["raiding", "pvp", "mentorship", "casual", "social"]) style.run(HOLDFAST_GUILD_ID, value);

    db.prepare(`
      INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at)
      SELECT ?, id, 'member', 'active', COALESCE(guild_joined_at, first_seen_at)
      FROM members WHERE status = 'active'
    `).run(HOLDFAST_GUILD_ID);
  },
};
