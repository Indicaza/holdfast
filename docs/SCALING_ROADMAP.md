# Scaling roadmap

Holdfast runs as one Node process with one SQLite database on a 15 GB Render disk (0.5 CPU, 512 MB). That is right for today's load. This note says where it stops being right, using measured numbers where they exist and labelled assumptions where they don't.

## Measured inputs (November 2026)

| Input | Value | Source |
|---|---|---|
| Character state per character | ≈ 1.54 MiB (character_state domain 38.4 MiB / 25 characters) | Local copy, storage audit |
| Of which profession books | ≈ 1.0 MiB, uncompressed JSON | Local copy |
| gzip ratio on the same telemetry JSON | 14× (24.6 → 1.7 MiB) | Local copy |
| Economy/loot event, incl. outputs and indexes | ≈ 980 B | 19.9 MiB / 21,222 events, local copy |
| Market row costs | 204 B observation, 146 B hourly, 187 B daily, 152 B weekly | Market benchmark |
| US Auction House volume | 16 houses, ≈ 124k item rows per full refresh | Production logs, 12 Nov |
| Production disk throughput | full-database copy 3.5–4 min (DB size not yet measured) | Production logs |
| Event-loop stalls | maintenance 4.0 s → 0.135 s after batching; ingest 0.55 → 0.27 s | Market benchmark (Mac SSD; production is slower) |

## Projections

**Assumptions** (not measured; replace with production values from `/api/admin/storage/ingestion` once deployed): 1.5 characters per user, 30% of characters active on a given day, 200 economy/loot events per active character per day, no archive or compression of events. Market volume is per region and doesn't grow with users. Below is the US region at hourly refresh, with today's retention.

| Users | Character state today | …after gzip + shared recipe definitions (≈10×, estimate) | Economy/loot events per year | US market data |
|---|---|---|---|---|
| 100 | 0.23 GB | 0.02 GB | 3.2 GB | ≈ 6.2 GB steady (3 d raw + 10 d hourly), +≈ 9.5 GB/yr daily and weekly |
| 1,000 | 2.3 GB | 0.23 GB | 32 GB | same |
| 10,000 | 23 GB | 2.3 GB | 320 GB | same |
| 100,000 | 230 GB | 23 GB | 3.2 TB | same, ×regions |
| 1,000,000 | 2.3 TB | 230 GB | 32 TB | same, ×regions |

Two conclusions hold whatever the exact assumptions:
1. **Character state** is dominated by duplicated game definitions. Fixing that is worth about 10× and is cheap: it belongs in PR 4.
2. **Raw events** dominate at scale and grow without bound. They need compact storage (columnar, compressed) and cold archives long before 10,000 users. SQLite on one disk won't hold 32 TB a year, and shouldn't try.

## Natural boundaries

1. Accounts, guilds, quests, permissions: transactional, small, many writers later → **PostgreSQL** when there's more than one app instance.
2. Current character state: one row set per character, read often → stays relational, de-duplicated against shared definitions.
3. Telemetry ingestion: bursty, append-only → a **durable queue** and ingestion workers, batched writes; the request thread only accepts and acknowledges.
4. Market time series: append-only, per house, read as ranges → its own store (a separate SQLite file or Postgres with partitioning, later a columnar store), with integer ids.
5. Shared game definitions: content-addressed by build, shared by all → small relational store plus a CDN for icons.
6. Long-term archives: compressed files in object storage (Parquet or gzip JSON lines) with checksums, queried offline.
7. Analytics: run on snapshots or archives, never on the request path.

## Stages

**Now (current scale).** Stabilise (startup lifecycle, batched maintenance), get off-site backups working (streaming backups), measure (observatory, snapshot audit), then de-duplicate character data and right-size market retention from the measurements (PR 4). One process and SQLite are fine. Watch `event_loop_stall` and the free-disk trend.

**Growing (thousands of users).** Move maintenance, statistics and market ingestion out of the request process (a worker thread now, a separate Render background worker next) with its own SQLite connection. Put the market time series in its own database file so their writes, backups and retention are independent. Accept telemetry into a durable queue table and process it in batches. Store events compactly and archive by month. Revisit the disk size from measured growth, not guesses.

**Large (tens of thousands of users and up).** Introduce what measurements justify: PostgreSQL for transactional data and horizontal API instances; a managed queue and ingestion workers; object-storage archives with an offline query engine; managed backups with point-in-time recovery. Signals that SQLite has become the limit: sustained `SQLITE_BUSY`/lock waits, event-loop stalls from writes that can't be batched further, or a database whose online backup can't finish within its window.
