# Holdfast

Holdfast is the public website and software foundation for the **Holdfast** World of Warcraft guild.

The immediate goal is simple:

- give the guild a strong public presence
- explain who we are and what we value
- provide a seamless path into our Discord
- establish the technical foundation for future guild tools

Over time, Holdfast may grow into a broader **GuildOS** connecting the website, Discord, World of Warcraft addons, guild data, economic tools, and other services.

For now, the focus is the guild website and onboarding experience.

## Philosophy

**Leave it stronger.**

Holdfast is intended to be an organized, durable guild without making the game feel like a second job.

The software follows the same philosophy.

Tools should reduce friction rather than create more work for members.

The long-term goal is for systems such as recruiting, organization, guild-bank accounting, professions, events, Discord roles, and economic coordination to happen as automatically as practical while keeping humans in control.

## Current Scope

The project currently focuses on:

- public guild website
- visual identity and branding
- guild information and charter
- Discord onboarding
- basic membership infrastructure
- foundations for future GuildOS integrations

Future experimentation may include:

- Discord automation
- World of Warcraft addons
- guild roster synchronization
- guild-bank ledger and inventory
- profession and recipe tracking
- Auction House market data
- economic Writs and guild opportunities
- Archivist integration
- GuildOS dashboards and tooling

These are future directions rather than requirements for the initial release.

## Tech Stack

### Frontend

- React
- Vite
- JavaScript

### Backend

- Node.js
- Express

### Infrastructure

- Discord OAuth and bot integration
- SQLite relational persistence for guild and member data
- GitHub Actions CI
- portable Docker deployment

## Repository Structure

holdfast/
├── frontend/
│ └── React website
├── backend/
│ └── API, integrations, and server-side services
├── scripts/
│ └── development and AI context tooling
├── AI_HANDOFF.md
└── README.md

Additional applications such as a WoW addon or Archivist plugin will receive their own top-level directories if and when they are actually built.

## Architecture

Holdfast uses a lightweight **fractal architecture**.

The basic rule is:

**Ownership > file type.**

Files that belong to a feature should live close to that feature rather than being scattered across large global folders.

Feature/
├── Feature.jsx
├── Feature.css
├── FeatureHelper.js
└── SubFeature/

Shared infrastructure should only become global when it is genuinely shared across unrelated parts of the application.

The project intentionally avoids unnecessary enterprise architecture, Atomic Design hierarchies, and speculative abstraction.

## Design System

The frontend will use centralized design tokens for global visual primitives such as:

- colors
- typography
- spacing
- borders
- radii
- shadows
- transitions
- layout widths
- layering

Component-specific styling remains close to the component that owns it.

This allows the overall visual identity of Holdfast to be changed from a small number of centralized values without creating a large design framework.

## Visual Direction

The public website is intended to feel cinematic, atmospheric, and professionally designed.

The current direction includes:

- full-screen rotating background artwork
- dark environmental imagery
- restrained warm and gold accents
- strong editorial typography
- translucent feature cards
- generous spacing
- subtle motion
- responsive layouts
- minimal visual clutter

The goal is a modern guild website rather than a generic gaming template.

## Development

Install the frontend:

cd frontend
npm install
npm run dev

Install and run the backend:

cd backend
npm install
npm run dev

Backend authentication changes carry a dedicated coverage gate. Run the full backend suite and the focused auth gate before opening a pull request:

```bash
cd backend
npm test
npm run test:auth
```

The auth gate exercises signed sessions, OAuth state integrity, redirect safety, member-versus-recruit behavior, Discord failure handling, permission checks, and session revalidation. CI requires at least 95% line coverage, 85% branch coverage, and 93% function coverage across `backend/src/Auth/`.

## Runtime Guild Data

Mutable GuildOS state is not committed to Git.

GuildOS stores runtime state in SQLite:

```text
<GUILD_DATA_DIR>/holdfast.sqlite
```

- `backend/data/` is the ignored default runtime directory for local development.
- `GUILD_DATA_DIR` overrides the runtime location.
- production requires `GUILD_DATA_DIR` to point at persistent storage.

For example:

```text
GUILD_DATA_DIR=/var/lib/holdfast
```

The backend intentionally refuses to start in production without an explicit data directory. Back up the entire runtime directory, including SQLite WAL/SHM files when present.

### Migrating existing JSON data

Older Holdfast builds stored mutable state in:

- `members.json`
- `quests.json`
- `contributions.json`

On the first startup with a fresh SQLite database, Holdfast looks for those files inside `GUILD_DATA_DIR` and imports them in one database transaction.

The import:

- preserves member/profile/character records
- preserves quests, objectives, assignments, and reward settings
- preserves contribution history and transaction IDs
- runs once and records its result in SQLite
- leaves the old JSON files untouched as a safety copy

Malformed legacy JSON aborts the import rather than partially migrating data.

The committed files under `backend/seed/` are retained as clean legacy/example JSON fixtures; new runtime state initializes directly from SQLite migrations.

## Production Security

Production should run behind HTTPS. Holdfast sets secure session cookies and baseline browser security headers when `NODE_ENV=production`.

Configure:

- `FRONTEND_URL` as the canonical website origin.
- `TRUSTED_ORIGINS` only when additional browser origins legitimately need GuildOS access.
- `SESSION_SECRET` with at least 32 bytes of random secret material. For example, generate a deployment secret with `openssl rand -hex 32`.
- `TRUST_PROXY` only when the hosting platform places Holdfast behind a known reverse proxy. `TRUST_PROXY=1` means one trusted proxy hop; do not enable broad proxy trust casually.

Cookie-authenticated POST/PUT/PATCH/DELETE requests are origin-checked. In production, mutation requests without a trusted Origin or Referer are rejected.

Current abuse-sensitive routes are rate limited in memory:

- Discord authentication
- member profile/timezone writes
- quest administration and objective completion

The current limiter is appropriate for a single Holdfast Node process. If the application is later scaled across multiple backend instances, move rate-limit state to shared infrastructure.

## Production Deployment

Holdfast ships as one Docker image. The image builds the Vite frontend, serves it from Express, and runs the API on the same origin. Mount `/data` on durable storage so the SQLite database survives deploys.

Build the image:

```bash
docker build \
  --build-arg VITE_GA_MEASUREMENT_ID=G-HFK0GNKKJ7 \
  -t holdfast:latest .
```

Run it locally with production settings:

```bash
docker run --rm \
  -p 3000:3000 \
  -v holdfast-data:/data \
  --env-file backend/.env.production \
  holdfast:latest
```

The host should terminate HTTPS and forward traffic to port `3000`. Configure its health check to request:

```text
/api/health/ready
```

The process validates production configuration before listening. At minimum, configure:

- `FRONTEND_URL`, using the canonical HTTPS origin with no trailing path
- `GUILD_DATA_DIR=/data`
- `SESSION_SECRET`, containing at least 32 bytes of random material
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `DISCORD_BOT_TOKEN`
- `GUILD_OWNER_DISCORD_IDS`
- `TRUST_PROXY=1` when the platform uses one trusted proxy hop

Set optional `DISCORD_RECRUIT_ROLE_ID` to automatically assign the Recruit role when Holdfast adds a new Discord member. Existing-member login and Discord joining remain available when it is unset.

Set the Discord application's OAuth redirect URL to:

```text
https://YOUR_DOMAIN/api/auth/discord/callback
```

Holdfast defaults to the public GA4 measurement ID `G-HFK0GNKKJ7`. Analytics remains consent-gated and does not load until a visitor opts in. Override `VITE_GA_MEASUREMENT_ID` at build time only when deploying the same code for another property.

### Launch checklist

- Point `FRONTEND_URL` and the Discord redirect URL at the final domain.
- Generate a fresh production `SESSION_SECRET`.
- Attach durable storage at `/data` and confirm backups cover the whole directory.
- Confirm the bot is in the configured Discord server and its role is above roles it manages.
- Confirm `/api/health/ready` returns HTTP 200.
- Complete recruit login, existing-member login, logout, profile editing, quest signup, and quest leave on the live domain.
- Verify a non-officer cannot access the control room and an owner can.
- Accept analytics once and confirm the GA4 Realtime report receives a page view.
- Restart or redeploy once and confirm guild data remains intact.

Create a consistent on-demand SQLite backup to storage outside the live data volume:

```bash
cd backend
BACKUP_DIR=/path/to/backup-storage npm run backup
```

Schedule that command with the host or use the platform's volume snapshots. A successful backup contains the SQLite database, metadata, and Discord provisioning state when present.

## Discord Provisioning

The committed manifest in `backend/config/discord.manifest.json` is the source of truth for Holdfast-managed Discord roles, categories, and channels. Add the bot to the existing server with Manage Server, Manage Roles, and Manage Channels permissions, then move the bot role above every role the manifest manages.

Always start with a read-only plan. Existing roles and channels are adopted only when their name, type, and parent make the match unambiguous; an ambiguous match stops the run before any write.

```bash
cd backend
npm run discord:plan
```

For a machine-readable review:

```bash
npm run --silent discord:plan -- --json
```

Apply the reviewed plan:

```bash
npm run discord:apply
```

Before writing, the provisioner verifies the bot's effective permissions and role hierarchy. Apply is idempotent, never targets an unmanaged resource, and refuses category changes that would alter synced unmanaged children. It never immediately deletes a managed resource removed from the manifest; removed resources are disabled and moved into a private archive instead.

To undo a manifest change, restore the earlier manifest in Git, review its plan, and reconcile it. Archived resources return with their original Discord IDs, memberships, and channel history:

```bash
npm run discord:plan
npm run discord:restore
```

Export a normalized snapshot of the live server before a major change:

```bash
npm run discord:export
```

Pruning is a separate, guarded operation. The default command is read-only. It only considers resources previously archived by this provisioner, requires a minimum archive age (seven days by default), refuses renamed resources, refuses roles that still have members, and will not remove a category with untracked children.

```bash
# Preview only
npm run discord:prune

# Deliberate deletion after reviewing the preview
npm run discord:prune -- --apply --confirm "$DISCORD_GUILD_ID"
```

The state file, append-only JSONL audit log, latest report, and live export default to `GUILD_DATA_DIR`. Keep them with persistent deployment data and backups. Their default names are `discord-provisioning-state.json`, `discord-provisioning-audit.jsonl`, `discord-provisioning-last-report.json`, and `discord-live-export.json`. Mutating commands also hold an exclusive lock so two operators cannot reconcile the server concurrently; a lock left by a terminated process must be removed only after confirming that no provisioning command is still running.

After applying, the command prints the role IDs required by the production environment. New members who use the website recruitment flow receive the generated Recruit role automatically.

## AI-Assisted Development

Holdfast includes a lightweight workflow for working with AI across development sessions.

See:

AI_HANDOFF.md

The repository also contains a context-generation script:

./scripts/context.sh context001.txt . README.md AI_HANDOFF.md

The script can collect:

- repository information
- current branch
- current commit
- git status
- project tree
- explicitly requested files

This allows an AI assistant to request only the context it needs and return small Git patches that can be reviewed and applied locally.

Typical workflow:

README + AI_HANDOFF
↓
targeted context file
↓
AI-generated Git patch
↓
git apply --check
↓
git apply
↓
verify
↓
repeat

Local working-tree context is authoritative.

The GitHub repository is used as a reference for committed state and history.

## Repository

https://github.com/Indicaza/holdfast

## Status

Holdfast is in early development.

The current priority is:

**Website → Discord → Guild**

Everything beyond that will be added only when it provides real value.


## Continuous Integration

GitHub Actions runs on every pull request and every push to `main`.

Frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
```

Backend checks:

```bash
cd backend
npm ci
npm run lint
npm test
```

CI uses Node 24 and read-only repository permissions.
