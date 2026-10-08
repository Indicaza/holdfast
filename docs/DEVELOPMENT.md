# Development

## Requirements

- Node.js 24
- npm
- Git
- Optional: a Discord application and bot for real authentication/integration work

The frontend runs on Vite and proxies `/api` to the backend at `http://localhost:3000`.

## Clone and install

```bash
git clone https://github.com/Indicaza/holdfast.git
cd holdfast
```

Backend:

```bash
cd backend
cp .env.example .env
npm ci
```

Windows PowerShell:

```powershell
cd backend
Copy-Item .env.example .env
npm ci
```

Frontend in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

## Public contributor sandbox

You do not need Holdfast Discord credentials to work on most of the website.

In `backend/.env`, set:

```text
SESSION_SECRET=local-development-only-change-me
HOLDFAST_DEV_AUTH=true
```

Then prepare the local fixture identities and sample quest:

```bash
cd backend
npm run dev:seed
npm run dev
```

Open the frontend URL shown by Vite, normally `http://localhost:5173`, then choose a local persona by visiting one of these URLs:

```text
http://localhost:5173/api/dev/login/member
http://localhost:5173/api/dev/login/officer
http://localhost:5173/api/dev/login/commander
```

The routes set the normal signed Holdfast session cookie and return you to the website. From that point forward the application uses the normal database, authority, permissions, and session paths.

The personas are:

- **Member** — Private; useful for ordinary member UX and permission-denied states.
- **Officer** — Lieutenant; useful for quest/reward/member-management flows.
- **Commander** — Commander; useful for full administrative UI.

`npm run dev:seed` is conservative:

- it only creates or updates fixture members with `dev-*` IDs
- it adds sample quests only when the local quest database is empty
- it does not replace existing quests by default
- `npm run dev:seed -- --reset-quests` deliberately replaces local quest data with the sample fixture

The development auth surface is defense-in-depth guarded:

- it requires `HOLDFAST_DEV_AUTH=true`
- it is never enabled when `NODE_ENV=production`
- production configuration validation rejects `HOLDFAST_DEV_AUTH=true`
- login fails until the expected seeded rank exists in SQLite

Do not add development identities, bypasses, or fixtures to production-specific code paths.

## Real Discord development

`backend/.env.example` documents every supported backend variable.

Discord login, guild membership checks, rank/billet synchronization, and provisioning commands require valid Discord credentials. Contributors working on those boundaries should use their own disposable development application/server rather than production Holdfast credentials.

Never commit `.env`, tokens, session secrets, SQLite files, backups, or exported live Discord state.

## Runtime data

Local mutable state defaults to `backend/data/` and is ignored by Git. `GUILD_DATA_DIR` can override the location.

Production data is not seed data and should never be copied into the repository for debugging.

If you already have valuable local data, back it up before intentionally using `--reset-quests` or experimenting with persistence code.

## Running the app

From the repository root, start the backend and frontend together:

```bash
npm run dev
```

The launcher (`scripts/dev.mjs`, Node built-ins only) will:

- run `npm ci` in `backend/` and `frontend/` when `node_modules` is missing or older than `package-lock.json`
- create `backend/.env` from `.env.example` with `SESSION_SECRET` and `HOLDFAST_DEV_AUTH=true` filled in for the sandbox — an existing `.env` is never modified
- run `npm run dev:seed` when it just created `.env`, or when passed `--seed` (`npm run dev -- --seed`)
- start both dev servers with `[backend]` / `[frontend]` prefixed output; Ctrl+C stops both

`npm run setup` performs the install, `.env`, and seed steps without starting servers.

To run the servers separately instead:

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Tests

Frontend:

```bash
cd frontend
npm run lint
npm test
npm run build
```

Backend:

```bash
cd backend
npm run lint
npm test
```

Useful focused backend gates include:

```bash
npm run test:db-safety
npm run test:auth
npm run test:discord
npm run test:safety-mutations
```

CI also builds the production image and runs browser journeys against disposable guild data.

## Architecture

Prefer feature ownership over global file-type folders.

A feature may own its React component, CSS, helpers, tests, API code, and subfeatures. Shared infrastructure belongs in a global/shared location only when multiple unrelated domains actually use it.

Avoid broad refactors in the same pull request as product behavior changes.

## Persistence changes

SQLite is authoritative for mutable Holdfast state.

When changing persistence:

1. add a forward migration
2. preserve existing data
3. keep released historical migrations unchanged
4. add migration/restart coverage
5. verify backup/restore assumptions remain valid

Read:

- `docs/BACKUP_AND_RECOVERY.md`
- `docs/RELEASE_GUARDRAILS.md`

## Discord provisioning

The managed Discord manifest lives at `backend/config/discord.manifest.json`.

Always preview changes before applying them:

```bash
cd backend
npm run discord:plan
```

Only apply a reviewed plan against the intended server.

## Pull request workflow

Keep changes small enough to review. Use the PR template, explain safety impact, and include UI evidence for visual changes.

The release gate is intentionally fail-closed. If a guardrail fails, fix the change or strengthen the guardrail; do not route around it.
