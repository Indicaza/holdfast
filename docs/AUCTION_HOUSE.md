# Auction House data

How market data arrives, how it is stored, what is verified and what is not.

## Sources

| Source | What it is | Scope of one snapshot |
| --- | --- | --- |
| Blizzard API (`official_api`) | `/data/wow/ruleset/{id}/auctions/{house}` and `/commodities`, `dynamic-forever-{region}` | one endpoint of one house (`api:auctions`, `api:commodities`), each complete |
| In-game scan (`addon_scan`) | what a player's client showed: classic browse pages, "get all" scans, modern searches | a page or search (`items:<hash>`), or the whole house (`full`) |

Markets are never merged on their own. An in-game market (`game:<region>:<realm>:<faction>`) only counts toward an API house (`api:<region>:house-<id>`) after an administrator links them on the Diagnostics tab. Links are refused across regions or factions (Blackwater houses are `neutral`), and linking a second realm to the same house needs an explicit confirmation.

## Observations: retry, unchanged, new

Every observation is logged in `market_snapshot_checks` (14 days):

- **duplicate**: the same source id again (a retried upload, the same API generation). Nothing changes.
- **unchanged**: the same contents as the latest snapshot of the same scope, observed later. The snapshot's `confirmed_at` moves forward, history gets a point at the new time, and prices stay current. No second copy is stored.
- **not_modified**: Blizzard answered 304 for one endpoint. The market counts as checked, but its data keeps its own (older) age.
- **recorded**: new contents. A full snapshot that no longer lists an item records it as *none listed* (quantity 0), so supply falls to zero instead of the last price lingering. Partial views never imply anything about items they did not see.
- **too_old**: older than 7 days. Refused, so history is never rewritten.

Markets keep `last_checked_at`, `last_changed_at` and `last_full_at` separately.

## Choosing the price shown

From the latest complete and latest partial observation of each market and source (`selectObservation` in `marketModel.js`):

1. Recency first. A complete view is preferred over a newer partial one only while it is at most 6 hours older.
2. Within 45 minutes of the newest, sources are ranked: in-game scan, then Blizzard API, then provider. An older scan never beats a newer API snapshot.
3. Other recent sources that disagree by more than 15% are listed with their own prices. Confidence drops one level when they do.

Every summary keeps its reasons (`notes_json`). The website shows them under "why this price".

## Item variants

Prices, history, favorites, lists and crafting are keyed by variant (`i:<id>`, `i:<id>:s<suffix>`, `i:<id>:b<bonuses>`). Asking by item id prices the base item only. An item listed only as variants returns those variants (`variantsOnly`) and never borrows one's price. `/api/market/prices?keys=i:15210:s-1081` prices one exact variant (for tooltips).

## History and retention

| Table | Resolution | Kept | Used for |
| --- | --- | --- | --- |
| `market_observations` | each snapshot | 3 days, longer if a summary still shows it | evidence, choosing sources |
| `market_series_hourly` | hour | 10 days (`MARKET_HOURLY_RETENTION_DAYS`) | 24 h and 7 d charts, 24 h change, 7-day median |
| `market_series_daily` | day | 400 days (`MARKET_DAILY_RETENTION_DAYS`) | 30 d – 1 y charts, 30-day median, volatility |
| `market_series_weekly` | week (from days) | 10 years | "All" |

Rows exist only where an observation exists; missing hours or days stay gaps. Only complete observations become history. Each bucket keeps low, high and close prices and quantities, sample count and first/last observation time. Maintenance runs daily (pruning, weekly roll-ups, 14-day reference prices for the Pct column) whether or not the Blizzard API is configured, and records itself for the Diagnostics tab.

Rough size: one hourly row is about 100 bytes. 15 houses × 5,000 listed items × 24 h × 10 days is about 18 million rows (1.8 GB) at the very most. Low-priority houses refresh every 4 hours and most items are not listed every hour, so expect a fraction of that. Lower `MARKET_HOURLY_RETENTION_DAYS` if needed; 7 is the minimum for the 7-day views.

## Metrics and observations

`GET /api/market/items/:id/analysis?market=&key=` returns:

- metrics: 24 h change, 7- and 30-day medians, 7- and 30-day ranges, daily volatility, price against the median, supply and auction counts against their 7-day medians, spikes and dips, coverage
- observations: below recent market, price spike, isolated cheap listing, supply rising or falling, volatile market

Each metric has its window, sample count and basis. Too little data returns `null` with a reason, not a number. Each observation has its window, samples, confidence and a one-line explanation. Listings that disappear are never counted as sales.

## Deploying

1. Deploy as usual. Migration 17 runs on start. It rebuilds `market_snapshots` and `market_observations` (keeping their rows), moves `market_history` into `market_series_daily`, and adds the new tables. Run `npm run backup` first, as for any migration.
2. Optional: set `BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` (server only) and the `MARKET_*` variables in `.env.example`.
3. Open Auction House → Diagnostics as an administrator. It should show each house checked within the hour, with both endpoints `recorded` or `not_modified`.

## Not verified yet

- **Blizzard Forever API:** implemented from community reports, tested only against a fake API. No credentials were available. With credentials, check on Diagnostics that houses are discovered (15 per region), both endpoints return data, `Last-Modified` advances about hourly, and 304s appear between generations.
- **Which API houses are which in-game markets:** never assumed. To verify a link: in game, at a known house, find a distinctive listing (an odd price or stack size) and note it. After the API house's next refresh, search the same item on the website in that API house and confirm the same listing. Then link the markets on Diagnostics. The link evidence table (items both saw within 3 hours, share with the same lowest ask) helps choose the house to check; it is never enough on its own.
- **The add-on on the live client:** see the Guildweaver README, "Auction House".
