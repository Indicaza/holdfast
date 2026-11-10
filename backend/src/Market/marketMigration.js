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
      CREATE INDEX market_observations_latest_idx ON market_observations(market_key, item_key, source_type, complete, observed_at DESC);
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

// Version 17: reliable ingestion and multi-resolution history.
//
// - Snapshots are no longer unique by content. A retry is recognised by its
//   source id (market_snapshot_checks); unchanged content seen again at a
//   new time confirms the stored snapshot (confirmed_at) instead of being
//   dropped, so a market that was checked never looks abandoned.
// - Each snapshot has a scope: a full house, one API endpoint (auctions or
//   commodities), or the item set of one in-game search. Absence and
//   "unchanged" are only judged within the same scope.
// - Provider refresh state is kept per endpoint.
// - History moves to hourly, daily and weekly series; market_history rows
//   become daily rows.
// - market_item_meta indexes item names and filters for fast searches.
export const marketReliabilityMigration = {
  version: 17,
  name: "auction_house_reliability_and_series",
  up(db) {
    db.exec(`
      CREATE TABLE market_snapshots_v17 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_key TEXT NOT NULL REFERENCES market_markets(market_key) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK(source_type IN ('addon_scan', 'official_api', 'provider')),
        source_id TEXT NOT NULL,
        scope_key TEXT NOT NULL DEFAULT 'full',
        coverage TEXT NOT NULL CHECK(coverage IN ('full', 'items', 'partial')),
        content_hash TEXT NOT NULL,
        contributor_key TEXT NOT NULL DEFAULT '',
        observed_at INTEGER NOT NULL,
        confirmed_at INTEGER NOT NULL,
        confirmations INTEGER NOT NULL DEFAULT 0,
        ingested_at TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        listing_count INTEGER NOT NULL,
        scan_group TEXT NOT NULL DEFAULT '',
        part INTEGER NOT NULL DEFAULT 1,
        parts INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO market_snapshots_v17 (id, market_key, source_type, source_id, scope_key, coverage, content_hash, contributor_key,
        observed_at, confirmed_at, ingested_at, item_count, listing_count)
        SELECT id, market_key, source_type, source_id, CASE WHEN coverage = 'full' THEN 'full' ELSE 'items:' || content_hash END,
          coverage, content_hash, contributor_key, observed_at, observed_at, ingested_at, item_count, listing_count FROM market_snapshots;

      CREATE TABLE market_observations_v17 (
        snapshot_id INTEGER NOT NULL REFERENCES market_snapshots_v17(id) ON DELETE CASCADE,
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        complete INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        min_unit_buyout INTEGER,
        min_quantity INTEGER,
        typical_unit_buyout INTEGER,
        max_unit_buyout INTEGER,
        min_unit_bid INTEGER,
        quantity INTEGER NOT NULL,
        listings INTEGER,
        bid_only_listings INTEGER NOT NULL DEFAULT 0,
        price_points TEXT,
        PRIMARY KEY(snapshot_id, item_key)
      );
      INSERT INTO market_observations_v17 (snapshot_id, market_key, item_key, item_id, source_type, complete, observed_at,
        min_unit_buyout, typical_unit_buyout, max_unit_buyout, min_unit_bid, quantity, listings, bid_only_listings)
        SELECT snapshot_id, market_key, item_key, item_id, source_type, complete, observed_at,
          min_unit_buyout, typical_unit_buyout, max_unit_buyout, min_unit_bid, quantity, listings, bid_only_listings FROM market_observations;

      DROP TABLE market_observations;
      DROP TABLE market_snapshots;
      ALTER TABLE market_snapshots_v17 RENAME TO market_snapshots;
      ALTER TABLE market_observations_v17 RENAME TO market_observations;
      CREATE INDEX market_snapshots_market_idx ON market_snapshots(market_key, observed_at DESC);
      CREATE INDEX market_snapshots_scope_idx ON market_snapshots(market_key, source_type, scope_key, observed_at DESC);
      CREATE INDEX market_snapshots_group_idx ON market_snapshots(market_key, scan_group) WHERE scan_group <> '';
      CREATE INDEX market_observations_latest_idx ON market_observations(market_key, item_key, source_type, complete, observed_at DESC);
      CREATE INDEX market_observations_age_idx ON market_observations(observed_at);

      -- Every observation that reached the server, including retries,
      -- unchanged confirmations and "not modified" answers. A retry has the
      -- same source id and changes nothing.
      CREATE TABLE market_snapshot_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        observed_at INTEGER,
        checked_at INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('recorded', 'unchanged', 'not_modified', 'too_old', 'failed')),
        snapshot_id INTEGER,
        UNIQUE(market_key, source_type, source_id)
      );
      CREATE INDEX market_snapshot_checks_recent_idx ON market_snapshot_checks(market_key, checked_at DESC);

      ALTER TABLE market_markets ADD COLUMN last_checked_at INTEGER;
      ALTER TABLE market_markets ADD COLUMN last_changed_at INTEGER;
      ALTER TABLE market_markets ADD COLUMN last_full_at INTEGER;
      ALTER TABLE market_markets ADD COLUMN link_shared INTEGER NOT NULL DEFAULT 0;
      UPDATE market_markets SET last_checked_at = last_snapshot_at, last_changed_at = last_snapshot_at;

      ALTER TABLE market_summaries ADD COLUMN confirmed_at INTEGER;
      ALTER TABLE market_summaries ADD COLUMN min_quantity INTEGER;
      ALTER TABLE market_summaries ADD COLUMN price_points TEXT;
      ALTER TABLE market_summaries ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]';
      -- Median of the last 14 observed daily typical asks (same source),
      -- refreshed by maintenance: the "Pct" column and below-market filters.
      ALTER TABLE market_summaries ADD COLUMN reference_price INTEGER;
      ALTER TABLE market_summaries ADD COLUMN reference_days INTEGER NOT NULL DEFAULT 0;
      UPDATE market_summaries SET confirmed_at = observed_at;
      CREATE INDEX market_summaries_market_idx ON market_summaries(market_key, quantity);
      CREATE INDEX market_summaries_price_idx ON market_summaries(market_key, min_unit_buyout);

      -- Per endpoint (auctions, commodities) refresh state: a 304 from one
      -- endpoint never stops the other.
      CREATE TABLE market_provider_endpoints (
        provider TEXT NOT NULL,
        market_key TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        last_modified TEXT NOT NULL DEFAULT '',
        last_checked_at INTEGER,
        last_changed_at INTEGER,
        last_success_at INTEGER,
        last_failure_at INTEGER,
        last_status TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(provider, market_key, endpoint)
      );
      INSERT INTO market_provider_endpoints (provider, market_key, endpoint, last_modified, last_checked_at, last_success_at, last_failure_at, last_error, consecutive_failures)
        SELECT provider, market_key, 'auctions', last_modified, last_attempt_at, last_success_at, last_failure_at, last_error, consecutive_failures FROM market_provider_state;
      ALTER TABLE market_provider_runs ADD COLUMN detail TEXT NOT NULL DEFAULT '';

      -- History at three resolutions. Rows exist only where observations
      -- exist: a missing hour or day is a gap, never filled in. Prices are
      -- copper per unit; *_close is the last observation in the bucket.
      CREATE TABLE market_series_hourly (
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        hour INTEGER NOT NULL,
        first_at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        samples INTEGER NOT NULL,
        min_low INTEGER,
        min_close INTEGER,
        typical_close INTEGER,
        quantity_low INTEGER NOT NULL,
        quantity_high INTEGER NOT NULL,
        quantity_close INTEGER NOT NULL,
        listings_close INTEGER,
        PRIMARY KEY(market_key, item_key, source_type, hour)
      );
      CREATE INDEX market_series_hourly_age_idx ON market_series_hourly(hour);
      CREATE TABLE market_series_daily (
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        day TEXT NOT NULL,
        first_at INTEGER,
        last_at INTEGER,
        samples INTEGER NOT NULL,
        min_low INTEGER,
        min_high INTEGER,
        min_close INTEGER,
        typical_low INTEGER,
        typical_high INTEGER,
        typical_close INTEGER,
        quantity_low INTEGER NOT NULL,
        quantity_high INTEGER NOT NULL,
        quantity_close INTEGER NOT NULL,
        listings_close INTEGER,
        PRIMARY KEY(market_key, item_key, source_type, day)
      );
      CREATE INDEX market_series_daily_age_idx ON market_series_daily(day);
      -- Daily history from version 16: the lowest ask of the day, the last
      -- typical ask and the highest quantity, kept as they were.
      INSERT INTO market_series_daily (market_key, item_key, source_type, day, samples, min_low, min_high, min_close,
        typical_low, typical_high, typical_close, quantity_low, quantity_high, quantity_close, listings_close)
        SELECT market_key, item_key, source_type, day, samples, min_unit_buyout, min_unit_buyout, min_unit_buyout,
          typical_unit_buyout, typical_unit_buyout, typical_unit_buyout, max_quantity, max_quantity, max_quantity, max_listings FROM market_history;
      DROP TABLE market_history;
      CREATE TABLE market_series_weekly (
        market_key TEXT NOT NULL,
        item_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        week TEXT NOT NULL,
        days INTEGER NOT NULL,
        samples INTEGER NOT NULL,
        min_low INTEGER,
        min_high INTEGER,
        min_close INTEGER,
        typical_low INTEGER,
        typical_high INTEGER,
        typical_close INTEGER,
        typical_median INTEGER,
        quantity_low INTEGER NOT NULL,
        quantity_high INTEGER NOT NULL,
        quantity_close INTEGER NOT NULL,
        listings_close INTEGER,
        PRIMARY KEY(market_key, item_key, source_type, week)
      );

      -- Names and filters for every item a market has, so searches never
      -- scan JSON definitions. Filled from the game data the website has;
      -- an in-game scan's name is used only when nothing better is known.
      CREATE TABLE market_item_meta (
        item_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        name_source TEXT NOT NULL DEFAULT '',
        quality_id INTEGER,
        icon_file_id INTEGER,
        item_class TEXT,
        item_class_id INTEGER,
        item_subclass TEXT,
        item_level INTEGER,
        required_level INTEGER,
        stack_count INTEGER,
        sell_price INTEGER,
        bind_type INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX market_item_meta_name_idx ON market_item_meta(name COLLATE NOCASE);
      CREATE INDEX market_item_meta_class_idx ON market_item_meta(item_class, item_subclass);
      -- Names of random-suffix variants ("of the Bear"), as the game showed them.
      CREATE TABLE market_variant_names (
        item_key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Maintenance bookkeeping (last prune, last roll-up) for diagnostics.
      CREATE TABLE market_maintenance (
        name TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}'
      );

      -- Room for price alerts later: a target per favorite. Nothing is sent.
      ALTER TABLE market_favorites ADD COLUMN alert_below INTEGER;
      ALTER TABLE market_favorites ADD COLUMN alert_above INTEGER;
    `);
  },
};
