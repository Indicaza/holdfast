# Development

## Requirements

- Node.js 24
- npm
- Git
- Optional: a Discord application and bot for authentication/integration work

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
npm run dev
```

Frontend in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Environment

`backend/.env.example` documents every supported backend variable.

For ordinary local UI/API development, keep production-only values unset. Discord login, guild membership checks, and provisioning commands require valid Discord credentials.

Never commit `.env`, tokens, session secrets, SQLite files, backups, or exported live Discord state.

## Runtime data

Local mutable state defaults to `backend/data/` and is ignored by Git. `GUILD_DATA_DIR` can override the location.

Production data is not seed data and should never be copied into the repository for debugging.

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
