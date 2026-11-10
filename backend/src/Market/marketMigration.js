// Auction House market data.
//
// Raw evidence (snapshots and their per-item aggregates) is kept apart from
// the canonical per-item summaries the website reads. Personal tables
// (favorites, shopping lists, saved searches) always name their owner and
// are never joined into public reads.
export const marketMigration = {
  version: 16,
  name: "auction_house_markets",
  up(db) {
    db.exec(`
      -- One auction house. API houses and in-game markets are separate
      -- markets: nothing proves which API house a player's auction house is,
      -- so they are only compared when an administrator links them.
      CREATE TABLE market_markets (
        market_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('api_house', 'client_house')),
        region TEXT NOT NULL,
        ruleset_id INTEGER,
        house_id INTEGER,
        realm TEXT NOT NULL DEFAULT '',
        faction TEXT NOT NULL DEFAULT '' CHECK(faction IN ('', 'alliance', 'horde', 'neutral')),
        name TEXT NOT NULL,
        linked_market_key TEXT,
        created_at TEXT NOT NULL,
        last_snapshot_at INTEGER
      );

      -- One scan or API download of one market.
      CREATE TABLE market_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_key TEXT NOT NULL REFERENCES market_markets(market_key) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK(source_type IN ('addon_scan', 'official_api', 'provider')),
        source_id TEXT NOT NULL,
        coverage TEXT NOT NULL CHECK(coverage IN ('full', 'items', 'partial')),
        content_hash TEXT NOT NULL,
        contributor_key TEXT NOT NULL DEFAULT '',
        observed_at INTEGER NOT NULL,
        ingested_at TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        listing_count INTEGER NOT NULL,
        UNIQUE(market_key, source_type, content_hash)
      );
      CREATE INDEX market_snapshots_market_idx ON market_snapshots(market_key, observed_at DESC);

      -- What one snapshot saw of one item variant. Prices are copper per unit.
      -- complete = 1 when every listing of the item was visible (a full scan,
      -- or an item search the client said was complete).
      CREATE TABLE market_observations (
        snapshot_id INTEGER NOT NULL REFERENCES market_snapshots(id) ON DELETE CASCADE,
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        complete INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        min_unit_buyout INTEGER,
        typical_unit_buyout INTEGER,
        max_unit_buyout INTEGER,
        min_unit_bid INTEGER,
        quantity INTEGER NOT NULL,
        listings INTEGER,
        bid_only_listings INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(snapshot_id, item_key)
      );
      CREATE INDEX market_observations_item_idx ON market_observations(market_key, item_key, observed_at DESC);
      CREATE INDEX market_observations_age_idx ON market_observations(observed_at);

      -- The price shown for an item in a market, chosen from the latest
      -- observation of each source (see marketSelection.js).
      CREATE TABLE market_summaries (
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        snapshot_id INTEGER NOT NULL,
        complete INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        min_unit_buyout INTEGER,
        typical_unit_buyout INTEGER,
        quantity INTEGER NOT NULL,
        listings INTEGER,
        selection_reason TEXT NOT NULL,
        conflict INTEGER NOT NULL DEFAULT 0,
        change_24h_pct REAL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(market_key, item_key)
      );
      CREATE INDEX market_summaries_item_idx ON market_summaries(item_id, market_key);

      -- Daily history, one row per market, item, day and source. Kept for
      -- two years; observations themselves for 14 days.
      CREATE TABLE market_history (
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        day TEXT NOT NULL,
        source_type TEXT NOT NULL,
        min_unit_buyout INTEGER,
        typical_unit_buyout INTEGER,
        max_quantity INTEGER NOT NULL,
        max_listings INTEGER,
        samples INTEGER NOT NULL,
        PRIMARY KEY(market_key, item_key, day, source_type)
      );

      -- External provider refreshes: one state row per market, one row per run.
      CREATE TABLE market_provider_state (
        provider TEXT NOT NULL,
        market_key TEXT NOT NULL,
        last_attempt_at INTEGER,
        last_success_at INTEGER,
        last_failure_at INTEGER,
        last_error TEXT NOT NULL DEFAULT '',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_due_at INTEGER NOT NULL DEFAULT 0,
        last_modified TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(provider, market_key)
      );
      CREATE TABLE market_provider_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        market_key TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        http_status INTEGER,
        auctions INTEGER,
        snapshot_id INTEGER,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX market_provider_runs_recent_idx ON market_provider_runs(provider, started_at DESC);

      -- Personal.
      CREATE TABLE market_favorites (
        member_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(member_id, item_id)
      );
      CREATE INDEX market_favorites_item_idx ON market_favorites(item_id);
      CREATE TABLE market_shopping_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'personal' CHECK(purpose IN ('personal', 'crafting', 'dungeon')),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX market_shopping_lists_member_idx ON market_shopping_lists(member_id, position);
      CREATE TABLE market_shopping_list_items (
        list_id INTEGER NOT NULL REFERENCES market_shopping_lists(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100000),
        purchased INTEGER NOT NULL DEFAULT 0 CHECK(purchased BETWEEN 0 AND 100000),
        note TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL,
        PRIMARY KEY(list_id, item_id)
      );
      CREATE TABLE market_saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL,
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX market_saved_searches_member_idx ON market_saved_searches(member_id, created_at DESC);

      -- How often items are looked at, per day, for refresh priority. No
      -- member ids: only counts.
      CREATE TABLE market_item_interest (
        item_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        views INTEGER NOT NULL,
        PRIMARY KEY(item_id, day)
      );
    `);
  },
};
