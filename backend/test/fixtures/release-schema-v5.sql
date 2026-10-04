PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
INSERT INTO "app_meta" VALUES('quest_revision','1','2026-10-04T03:38:09.349Z');
INSERT INTO "app_meta" VALUES('legacy_json_import_v1','{"status":"imported","imported":{"members":3,"quests":1,"contributions":0},"sources":["/tmp/tmpnt7l7ciu/members.json","/tmp/tmpnt7l7ciu/quests.json"]}','2026-10-04T03:38:09.349Z');
INSERT INTO "app_meta" VALUES('frozen_release_sentinel','preserve-this-value','2026-10-03T00:00:00Z');
CREATE TABLE assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          objective_id TEXT NOT NULL
            REFERENCES objectives(id) ON DELETE CASCADE,
          member_id TEXT,
          name TEXT NOT NULL,
          responsibility TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          initials TEXT NOT NULL,
          avatar TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0
        );
CREATE TABLE audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_member_id TEXT,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          created_at TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}'
        );
CREATE TABLE billets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          responsibility TEXT NOT NULL DEFAULT '',
          discord_role_id TEXT,
          discord_managed INTEGER NOT NULL DEFAULT 0
            CHECK (discord_managed IN (0, 1)),
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        , permissions_json TEXT NOT NULL DEFAULT '[]', max_managed_rank TEXT, quest_scope TEXT NOT NULL DEFAULT 'own'
          CHECK (quest_scope IN ('own', 'all')), reward_rep_max INTEGER NOT NULL DEFAULT 0, reward_marks_max INTEGER NOT NULL DEFAULT 0, reward_marks_quest_max INTEGER NOT NULL DEFAULT 0);
INSERT INTO "billets" VALUES('billet-steward','Steward','Helps administer Holdfast, coordinate leadership work, and keep guild operations moving.',NULL,1,1,'2026-10-04T03:38:09.340Z','2026-10-04T03:38:09.345Z','["site.admin","quests.create","quests.edit","quests.publish","rewards.approve","rewards.issue","rewards.policy.edit","members.rank.manage","members.billet.assign","audit.view","discord.manage"]','Sergeant Major','all',500,25,100);
INSERT INTO "billets" VALUES('billet-quartermaster','Quartermaster','Manages guild supplies, crafting logistics, procurement, and shared resources.',NULL,1,1,'2026-10-04T03:38:09.340Z','2026-10-04T03:38:09.345Z','["rewards.policy.edit"]',NULL,'own',0,0,0);
INSERT INTO "billets" VALUES('billet-raid-leader','Raid Leader','Organizes raid groups, preparation, strategy, and execution.',NULL,1,1,'2026-10-04T03:38:09.340Z','2026-10-04T03:38:09.346Z','["quests.create","quests.edit"]',NULL,'own',0,0,0);
INSERT INTO "billets" VALUES('billet-pvp-lead','PvP Lead','Organizes battlegrounds, world PvP, premades, and coordinated PvP response.',NULL,1,1,'2026-10-04T03:38:09.340Z','2026-10-04T03:38:09.346Z','["quests.create","quests.edit"]',NULL,'own',0,0,0);
CREATE TABLE character_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          source TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
        );
CREATE TABLE characters (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL
            REFERENCES members(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          race TEXT NOT NULL DEFAULT '',
          class_name TEXT NOT NULL DEFAULT '',
          spec TEXT NOT NULL DEFAULT '',
          professions_json TEXT NOT NULL DEFAULT '[]',
          is_main INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0
        );
INSERT INTO "characters" VALUES('frozen-warrior','e2e-member','Frozen Rook','Night Elf','Warrior','Arms','["Mining"]',1,0);
CREATE TABLE contribution_transactions (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          member_id TEXT NOT NULL,
          member_name TEXT NOT NULL,
          quest_id TEXT NOT NULL,
          quest_title TEXT NOT NULL,
          objective_id TEXT NOT NULL,
          objective_title TEXT NOT NULL,
          rep INTEGER NOT NULL DEFAULT 0,
          marks INTEGER NOT NULL DEFAULT 0,
          items_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          awarded_by_member_id TEXT,
          awarded_by_username TEXT NOT NULL DEFAULT '',
          awarded_by_display_name TEXT NOT NULL DEFAULT ''
        );
INSERT INTO "contribution_transactions" VALUES('frozen-award','objective_reward','e2e-member','Mira Member','e2e-supply-run','E2E Supply Run','frozen-completed','Previous work',100,5,'[]','2026-10-03T00:00:00Z','e2e-officer','e2e-officer','Owen Officer');
CREATE TABLE guild_bank_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
CREATE TABLE member_billets (
          member_id TEXT NOT NULL
            REFERENCES members(id) ON DELETE CASCADE,
          billet_id TEXT NOT NULL
            REFERENCES billets(id) ON DELETE CASCADE,
          assigned_at TEXT NOT NULL,
          assigned_by_member_id TEXT,
          PRIMARY KEY(member_id, billet_id)
        );
CREATE TABLE member_profiles (
          member_id TEXT PRIMARY KEY
            REFERENCES members(id) ON DELETE CASCADE,
          battle_tag TEXT NOT NULL DEFAULT '',
          timezone TEXT NOT NULL DEFAULT '',
          timezone_source TEXT NOT NULL DEFAULT 'detected'
            CHECK (timezone_source IN ('detected', 'manual')),
          availability TEXT NOT NULL DEFAULT '',
          bio TEXT NOT NULL DEFAULT ''
        );
INSERT INTO "member_profiles" VALUES('e2e-member','Mira#0001','America/Detroit','manual','Evenings','Browser-test guild member.');
INSERT INTO "member_profiles" VALUES('e2e-officer','Owen#0002','America/Detroit','manual','Evenings','Browser-test officer.');
INSERT INTO "member_profiles" VALUES('e2e-commander','Casey#0003','America/Detroit','manual','Any time','Browser-test commander.');
CREATE TABLE members (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL,
          initials TEXT NOT NULL,
          avatar_url TEXT NOT NULL DEFAULT '',
          guild_joined_at TEXT,
          rank TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'departed')),
          departed_at TEXT,
          permissions_json TEXT NOT NULL DEFAULT '[]',
          profile_updated_at TEXT,
          first_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        , rank_managed INTEGER NOT NULL DEFAULT 0
          CHECK (rank_managed IN (0, 1)), billets_managed INTEGER NOT NULL DEFAULT 0
          CHECK (billets_managed IN (0, 1)));
INSERT INTO "members" VALUES('e2e-member','e2e-member','Mira Member','MM','',NULL,'Private','active',NULL,'[]',NULL,'2026-10-04T03:38:09.347Z','2026-10-04T03:38:09.347Z',1,1);
INSERT INTO "members" VALUES('e2e-officer','e2e-officer','Owen Officer','OO','',NULL,'Lieutenant','active',NULL,'[]',NULL,'2026-10-04T03:38:09.347Z','2026-10-04T03:38:09.347Z',1,1);
INSERT INTO "members" VALUES('e2e-commander','e2e-commander','Casey Commander','CC','',NULL,'Commander','active',NULL,'[]',NULL,'2026-10-04T03:38:09.348Z','2026-10-04T03:38:09.348Z',1,1);
CREATE TABLE objectives (
          id TEXT PRIMARY KEY,
          quest_id TEXT NOT NULL
            REFERENCES quests(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL
            CHECK (priority IN ('Main', 'High', 'Medium', 'Low')),
          completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          need TEXT NOT NULL DEFAULT '',
          reward_rep INTEGER NOT NULL DEFAULT 0,
          reward_marks INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        , reward_approved_by_member_id TEXT, reward_approved_by_name TEXT NOT NULL DEFAULT '', reward_approved_at TEXT NOT NULL DEFAULT '', reward_approved_fingerprint TEXT NOT NULL DEFAULT '');
INSERT INTO "objectives" VALUES('e2e-linen','e2e-supply-run','Gather the linen','Bring the guild twenty bolts worth of starter cloth.','High',0,'20 Linen Cloth',100,5,0,NULL,'','','');
INSERT INTO "objectives" VALUES('e2e-patrol','e2e-supply-run','Scout the roads','Volunteer for a short patrol so signup and leave flows can be exercised.','Medium',0,'1 volunteer',0,0,1,NULL,'','','');
CREATE TABLE quest_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          focused_quest_id TEXT NOT NULL DEFAULT '',
          reward_policy TEXT NOT NULL DEFAULT '',
          rep_min INTEGER NOT NULL DEFAULT 0,
          rep_max INTEGER NOT NULL DEFAULT 1000,
          marks_min INTEGER NOT NULL DEFAULT 0,
          marks_max INTEGER NOT NULL DEFAULT 1000
        , marks_quest_max INTEGER NOT NULL DEFAULT 1000);
INSERT INTO "quest_settings" VALUES(1,'e2e-supply-run','E2E fixture policy',0,1000,0,1000,1000);
CREATE TABLE quests (
          id TEXT PRIMARY KEY,
          publication TEXT NOT NULL
            CHECK (publication IN ('draft', 'published', 'archived')),
          mode TEXT NOT NULL
            CHECK (mode IN ('rotating', 'permanent')),
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0
        , created_by_member_id TEXT, created_at TEXT NOT NULL DEFAULT '');
INSERT INTO "quests" VALUES('e2e-supply-run','published','rotating','E2E Supply Run','Disposable quest used by browser regression tests.',0,0,'e2e-officer','2026-10-03T00:00:00.000Z');
CREATE TABLE rank_authority (
          rank TEXT PRIMARY KEY,
          permissions_json TEXT NOT NULL DEFAULT '[]',
          max_managed_rank TEXT
        , quest_scope TEXT NOT NULL DEFAULT 'own'
          CHECK (quest_scope IN ('own', 'all')), reward_rep_max INTEGER NOT NULL DEFAULT 0, reward_marks_max INTEGER NOT NULL DEFAULT 0, reward_marks_quest_max INTEGER NOT NULL DEFAULT 0);
INSERT INTO "rank_authority" VALUES('Recruit','[]',NULL,'own',0,0,0);
INSERT INTO "rank_authority" VALUES('Private','[]',NULL,'own',0,0,0);
INSERT INTO "rank_authority" VALUES('Corporal','["quests.create","quests.edit"]',NULL,'own',0,0,0);
INSERT INTO "rank_authority" VALUES('Sergeant','["quests.create","quests.edit"]',NULL,'own',0,0,0);
INSERT INTO "rank_authority" VALUES('Master Sergeant','["quests.create","quests.edit"]',NULL,'own',0,0,0);
INSERT INTO "rank_authority" VALUES('Sergeant Major','["quests.create","quests.edit"]',NULL,'own',0,0,0);
INSERT INTO "rank_authority" VALUES('Lieutenant','["site.admin","quests.create","quests.edit","quests.publish","rewards.approve","rewards.issue","rewards.policy.edit","members.rank.manage","members.billet.assign","audit.view"]','Sergeant','all',250,10,50);
INSERT INTO "rank_authority" VALUES('Captain','["site.admin","quests.create","quests.edit","quests.publish","rewards.approve","rewards.issue","rewards.policy.edit","members.rank.manage","members.billet.assign","audit.view"]','Master Sergeant','all',500,25,100);
INSERT INTO "rank_authority" VALUES('Major','["site.admin","quests.create","quests.edit","quests.publish","rewards.approve","rewards.issue","rewards.policy.edit","members.rank.manage","members.billet.assign","audit.view"]','Sergeant Major','all',750,50,250);
INSERT INTO "rank_authority" VALUES('Commander','["site.admin","quests.create","quests.edit","quests.publish","rewards.approve","rewards.issue","rewards.policy.edit","members.rank.manage","members.billet.assign","billets.create","billets.edit","billets.delete","audit.view","discord.manage","authority.manage"]','Commander','all',1000,1000,1000);
CREATE TABLE reward_items (
          id TEXT PRIMARY KEY,
          objective_id TEXT NOT NULL
            REFERENCES objectives(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity >= 1),
          sort_order INTEGER NOT NULL DEFAULT 0
        );
CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
INSERT INTO "schema_migrations" VALUES(1,'core_guildos_schema','2026-10-04T03:38:09.339Z');
INSERT INTO "schema_migrations" VALUES(2,'website_authoritative_member_ranks','2026-10-04T03:38:09.340Z');
INSERT INTO "schema_migrations" VALUES(3,'billets_and_assignments','2026-10-04T03:38:09.341Z');
INSERT INTO "schema_migrations" VALUES(4,'authority_scopes','2026-10-04T03:38:09.341Z');
INSERT INTO "schema_migrations" VALUES(5,'quest_governance_and_economy','2026-10-04T03:38:09.346Z');
CREATE INDEX members_status_display_name_idx
          ON members(status, display_name COLLATE NOCASE);
CREATE INDEX characters_member_idx
          ON characters(member_id, sort_order);
CREATE INDEX characters_name_idx
          ON characters(name COLLATE NOCASE);
CREATE UNIQUE INDEX characters_one_main_per_member_idx
          ON characters(member_id)
          WHERE is_main = 1;
CREATE INDEX quests_publication_order_idx
          ON quests(publication, sort_order);
CREATE INDEX objectives_quest_order_idx
          ON objectives(quest_id, sort_order);
CREATE INDEX reward_items_objective_order_idx
          ON reward_items(objective_id, sort_order);
CREATE INDEX assignments_objective_order_idx
          ON assignments(objective_id, sort_order);
CREATE INDEX assignments_member_idx
          ON assignments(member_id)
          WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX assignments_objective_member_unique_idx
          ON assignments(objective_id, member_id)
          WHERE member_id IS NOT NULL;
CREATE INDEX contributions_member_created_idx
          ON contribution_transactions(member_id, created_at DESC);
CREATE INDEX contributions_objective_idx
          ON contribution_transactions(objective_id);
CREATE INDEX character_snapshots_character_time_idx
          ON character_snapshots(character_id, captured_at DESC);
CREATE INDEX guild_bank_snapshots_time_idx
          ON guild_bank_snapshots(captured_at DESC);
CREATE INDEX audit_events_entity_time_idx
          ON audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_actor_time_idx
          ON audit_events(actor_member_id, created_at DESC);
CREATE UNIQUE INDEX billets_name_unique_idx
          ON billets(name COLLATE NOCASE);
CREATE UNIQUE INDEX billets_discord_role_unique_idx
          ON billets(discord_role_id)
          WHERE discord_role_id IS NOT NULL;
CREATE INDEX member_billets_billet_idx
          ON member_billets(billet_id, member_id);
DELETE FROM "sqlite_sequence";
COMMIT;
PRAGMA foreign_keys=ON;
