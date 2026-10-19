// Seeds sample guilds so the guild browser has something to browse locally:
// both factions, every realm type, a spread of play styles and schedules,
// some with synced (verified) rosters and a pair of sister guilds.
//
// Each guild gets a synthetic founder and members, created through the same
// registration rules as the website. Idempotent: guilds that already exist
// are left alone.

import { pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { withGuildTransaction } from "../src/Data/database.js";
import { initializeGuildData } from "../src/Data/initializeData.js";
import { ensureRuntimeDataDirectory } from "../src/Data/runtimeData.js";
import { ensureCharacterReadModelSchema } from "../src/Character/ReadModel/readModelSchema.js";
import { normalizeGuildListing } from "../src/Guild/Directory/guildDirectoryModel.js";
import { seedGuildOperationsInDatabase } from "../src/Guild/guildDefaults.js";

// Classic factions: only the Alliance has paladins and only the Horde shamans.
const CLASSES = {
  alliance: ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Mage", "Warlock", "Druid"],
  horde: ["Warrior", "Shaman", "Hunter", "Rogue", "Priest", "Mage", "Warlock", "Druid"],
};

const GUILDS = [
  {
    name: "Ashen Vanguard", tagline: "Late-night progression on the hardcore realm. One life, no excuses.",
    faction: "horde", region: "US", realm: "Doomhowl", realmType: "hardcore", playStyles: ["hardcore", "raiding", "leveling"],
    recruitingClasses: ["priest", "shaman", "warrior"], recruitingRoles: ["healer", "tank"], raidDays: ["tue", "thu"],
    raidStart: "20:00", raidEnd: "23:00", timezone: "America/Chicago", voiceRequired: true, agePolicy: "adult",
    accentColor: "#b8432f", discordInviteUrl: "discord.gg/ashenvanguard", members: 46, synced: 31,
    description: "We level together, we die alone. Ashen Vanguard runs a guided leveling programme for new hardcore players and fields a weekend raid team for those who make it to 60.\n\nRaid nights are voice-required. Everything else is your call.",
  },
  {
    name: "The Silver Covenant", tagline: "A roleplay guild of Dalaran's loyalists, in character since day one.",
    faction: "alliance", region: "EU", realm: "Argent Dawn", realmType: "rp", playStyles: ["roleplay", "social", "casual"],
    recruitingClasses: ["mage", "priest", "paladin"], recruitingRoles: [], raidDays: ["wed"], raidStart: "19:30", raidEnd: "22:00",
    timezone: "Europe/London", language: "en", accentColor: "#8fa6d8", members: 88, synced: 52,
    description: "Weekly story nights, a guild library and a ministry of magical affairs. New writers welcome; we'll help you build a character.",
  },
  {
    name: "Bloodfang Syndicate", tagline: "World PvP, battleground premades and absolutely no honour.",
    faction: "horde", region: "US", realm: "Skull Rock", realmType: "pvp", playStyles: ["pvp", "economy"],
    recruitingClasses: ["rogue", "warlock", "hunter", "druid"], recruitingRoles: ["dps"], raidDays: ["fri", "sat"],
    raidStart: "21:00", raidEnd: "01:00", timezone: "America/New_York", accentColor: "#7c2b3b", members: 132, synced: 97,
    discordInviteUrl: "discord.gg/bloodfang",
  },
  {
    name: "Lanterns of Elune", tagline: "Night elves, druids and the friends who follow them.",
    faction: "alliance", region: "US", realm: "Whitemane", realmType: "normal", playStyles: ["social", "casual", "mentorship"],
    recruitingClasses: [], recruitingRoles: [], timezone: "America/Los_Angeles", accentColor: "#5d7fbf", members: 24, synced: 0,
  },
  {
    name: "Iron Pact", tagline: "Dwarven engineers funding the war effort, one auction at a time.",
    faction: "alliance", region: "EU", realm: "Firemaw", realmType: "pvp", playStyles: ["economy", "raiding"],
    recruitingClasses: ["warrior", "hunter"], recruitingRoles: ["tank"], raidDays: ["mon", "wed"], raidStart: "20:00", raidEnd: "23:00",
    timezone: "Europe/Berlin", language: "de", accentColor: "#a7783a", members: 61, synced: 40,
  },
  {
    name: "Last Light", tagline: "Hardcore Alliance. We remember every name on the memorial wall.",
    faction: "alliance", region: "US", realm: "Defias Pillager", realmType: "hardcore", playStyles: ["hardcore", "leveling", "mentorship"],
    recruitingClasses: ["paladin", "priest", "mage", "warrior"], recruitingRoles: ["healer"], timezone: "America/Denver",
    accentColor: "#d8b45a", members: 37, synced: 22,
  },
  {
    name: "Thunder Totem", tagline: "Tauren-led, Mulgore-born, raiding with patience.",
    faction: "horde", region: "OCE", realm: "Arugal", realmType: "pvp", playStyles: ["raiding", "social"],
    recruitingClasses: ["shaman", "druid", "priest"], recruitingRoles: ["healer"], raidDays: ["sun", "tue"], raidStart: "19:00", raidEnd: "22:00",
    timezone: "Australia/Sydney", accentColor: "#5b8a4e", members: 54, synced: 33,
  },
  {
    name: "Scarlet Archive", tagline: "Roleplay-PvP crusaders. Purge first, ask questions in character.",
    faction: "alliance", region: "EU", realm: "Hydraxian Waterlords", realmType: "rp_pvp", playStyles: ["roleplay", "pvp"],
    recruitingClasses: ["paladin", "warrior", "priest"], recruitingRoles: [], timezone: "Europe/Paris", language: "fr",
    accentColor: "#9c2f2f", members: 29, synced: 11,
  },
];

const SISTERS = [["ashen-vanguard", "bloodfang-syndicate"]];

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

export function seedDevelopmentGuilds({ now = Date.now(), logger = console } = {}) {
  let created = 0;
  withGuildTransaction((db) => {
    ensureCharacterReadModelSchema(db);
    GUILDS.forEach((seed, guildIndex) => {
      const validation = normalizeGuildListing(seed);
      if (!validation.ok) throw new Error(`Seed guild ${seed.name} is invalid: ${JSON.stringify(validation.errors)}`);
      const { listing } = validation;
      if (db.prepare("SELECT 1 FROM guilds WHERE slug = ?").get(listing.slug)) return;

      const id = `guild-dev-${listing.slug}`;
      const createdAt = new Date(now - (guildIndex + 2) * 9 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO guilds (
          id, slug, name, tagline, description, faction, region, realm, realm_type, language, timezone,
          recruiting, recruiting_classes_json, recruiting_roles_json, minimum_level, raid_days_json, raid_start, raid_end,
          voice_required, age_policy, discord_invite_url, accent_color, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?)
      `).run(
        id, listing.slug, listing.name, listing.tagline, seed.description || "", listing.faction, listing.region, listing.realm,
        listing.realmType, listing.language, listing.timezone, listing.recruitingClasses.length || listing.recruitingRoles.length ? 1 : 0,
        JSON.stringify(listing.recruitingClasses), JSON.stringify(listing.recruitingRoles), listing.minimumLevel,
        JSON.stringify(listing.raidDays), listing.raidStart, listing.raidEnd, listing.voiceRequired ? 1 : 0, listing.agePolicy,
        listing.discordInviteUrl || "", listing.accentColor, createdAt, createdAt,
      );
      for (const style of listing.playStyles) db.prepare("INSERT INTO guild_play_styles (guild_id, style) VALUES (?, ?)").run(id, style);
      seedGuildOperationsInDatabase(db, id, createdAt);

      const random = seededRandom(guildIndex + 7);
      for (let index = 0; index < seed.members; index += 1) {
        const memberId = `dev-guild-${listing.slug}-${index}`;
        const name = `${listing.name.split(" ").pop()} ${index + 1}`;
        db.prepare(`
          INSERT OR IGNORE INTO members (id, username, display_name, initials, rank, status, first_seen_at, updated_at)
          VALUES (?, ?, ?, 'GW', 'Initiate', 'active', ?, ?)
        `).run(memberId, memberId, name, createdAt, createdAt);
        db.prepare(`
          INSERT OR IGNORE INTO guild_memberships (guild_id, member_id, role, status, joined_at, rank) VALUES (?, ?, ?, 'active', ?, ?)
        `).run(
          id,
          memberId,
          index === 0 ? "owner" : index < 3 ? "officer" : "member",
          createdAt,
          index === 0 ? "Guild Master" : index < 3 ? "Officer" : "Member",
        );
        if (index === 0) db.prepare("UPDATE guilds SET owner_member_id = ? WHERE id = ?").run(memberId, id);
        if (index >= seed.synced) continue;

        const characterId = `${memberId}-main`;
        const lastSeen = new Date(now - Math.floor(random() * (index % 3 === 0 ? 20 : 5) * 24 * 60 * 60 * 1000)).toISOString();
        db.prepare("INSERT OR IGNORE INTO characters (id, member_id, name) VALUES (?, ?, ?)").run(characterId, memberId, name);
        db.prepare(`
          INSERT OR IGNORE INTO character_cards (character_id, member_id, name, class_name, level, realm, last_seen_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(characterId, memberId, name, CLASSES[listing.faction][Math.floor(random() * CLASSES[listing.faction].length)], random() < 0.45 ? 60 : 20 + Math.floor(random() * 40), listing.realm, lastSeen, lastSeen);
      }
      created += 1;
    });

    for (const [left, right] of SISTERS) {
      const a = db.prepare("SELECT id FROM guilds WHERE slug = ?").get(left);
      const b = db.prepare("SELECT id FROM guilds WHERE slug = ?").get(right);
      if (!a || !b) continue;
      db.prepare(`
        INSERT OR IGNORE INTO guild_links (id, guild_id, linked_guild_id, kind, status, created_at, responded_at)
        VALUES (?, ?, ?, 'sister', 'accepted', ?, ?)
      `).run(`link-dev-${left}-${right}`, a.id, b.id, new Date(now).toISOString(), new Date(now).toISOString());
    }
  });
  logger.log(`Guilds: ${created} sample guilds created.`);
  return { created };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config();
  try {
    await ensureRuntimeDataDirectory();
    initializeGuildData();
    seedDevelopmentGuilds();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
