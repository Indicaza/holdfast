# Holdfast

Holdfast is the website and guild operations platform for the **Holdfast** World of Warcraft guild.

It combines a public guild site with member tooling for onboarding, quests, ranks, billets, rewards, notifications, Discord integration, and durable guild data.

**Leave it stronger.**

## What exists today

Holdfast currently includes:

- public guild website and charter
- Discord OAuth onboarding and membership sync
- member profiles and character information
- quests, objectives, signup, completion review, and reward workflows
- Rep, Marks, rank, and billet systems
- authority and permission controls
- member notifications with durable read/action state
- audit logging
- SQLite persistence with migrations and startup safety checks
- backup and recovery tooling
- Discord provisioning from a committed manifest
- production Docker/Render deployment
- GitHub Actions guardrails, browser journeys, and a fail-closed release gate

The website is the authoritative source of truth for Holdfast-owned state. Discord and the WoW addon are integrations around that state rather than competing databases.

## Stack

- **Frontend:** React 19, Vite, JavaScript
- **Backend:** Node.js 24, Express 5
- **Data:** SQLite
- **Integrations:** Discord OAuth + bot APIs
- **Deployment:** Docker, Render
- **CI:** GitHub Actions + Node test runner + Playwright browser journeys

## Repository

```text
holdfast/
├── frontend/     # React website and browser UI
├── backend/      # API, auth, persistence, Discord, guild systems
├── e2e/          # Playwright browser journeys
├── config/       # checked-in operational policy/configuration
├── docs/         # development, deployment, backup, release docs
├── scripts/      # release and production verification tooling
└── .github/      # CI and contributor workflow
```

The architecture follows one main rule:

> **Ownership > file type.**

Feature-specific code stays close to the feature that owns it. Shared infrastructure should only become global when unrelated domains genuinely share it.

## Quick start

Holdfast uses **Node 24**. `.nvmrc` pins the expected major version for tools that support it.

```bash
git clone https://github.com/Indicaza/holdfast.git
cd holdfast
npm run dev
```

That one command installs backend and frontend dependencies when they are missing or stale, creates `backend/.env` with the local development sandbox enabled (only if it does not already exist), seeds the development personas on first run, and starts both servers with prefixed output. Ctrl+C stops both. Use `npm run dev -- --seed` to re-run the development seed, or `npm run setup` to prepare everything without starting the servers.

### Manual setup

To run each piece yourself instead, install the backend and create a local environment file:

```bash
cd backend
cp .env.example .env
npm ci
```

Windows PowerShell equivalent:

```powershell
Copy-Item .env.example .env
npm ci
```

For ordinary public development you do **not** need access to the Holdfast Discord server. Put a local-only session secret in `backend/.env`, set `HOLDFAST_DEV_AUTH=true`, then seed the development personas:

```text
SESSION_SECRET=local-development-only-change-me
HOLDFAST_DEV_AUTH=true
```

```bash
npm run dev:seed
npm run dev
```

In another terminal, run the frontend:

```bash
cd frontend
npm ci
npm run dev
```

Vite normally serves `http://localhost:5173` and proxies `/api` to the backend on port `3000`.

Development login personas are then available at:

- `http://localhost:5173/api/dev/login/member`
- `http://localhost:5173/api/dev/login/officer`
- `http://localhost:5173/api/dev/login/commander`

The sandbox is explicitly disabled in production and production startup rejects `HOLDFAST_DEV_AUTH=true`.

See [Development](docs/DEVELOPMENT.md) for the complete setup, sandbox behavior, real Discord integration setup, and test commands.

## Testing

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

CI adds focused authentication/Discord safety gates, database disaster tests, production-image verification, browser journeys, and a final release gate. Safety checks are part of the product contract; do not weaken them to make a change pass.

## Runtime data

Mutable guild state is **not committed to Git**. Runtime state lives in SQLite under `GUILD_DATA_DIR`.

Production must use persistent storage and backups. Schema changes must use migrations; released historical migrations are immutable.

See:

- [Backup and recovery](docs/BACKUP_AND_RECOVERY.md)
- [Release guardrails](docs/RELEASE_GUARDRAILS.md)
- [Render deployment](docs/deployment/render.md)

## Contributing

Outside contributions are welcome. Start with [CONTRIBUTING.md](.github/CONTRIBUTING.md).

Look for issues labeled `good first issue` or `help wanted` if you want a contained place to start. For meaningful behavior changes, open or claim an issue before investing in a large implementation. Keep pull requests focused and include regression coverage where practical.

Security issues should follow [SECURITY.md](.github/SECURITY.md) rather than being posted publicly.

## Project status

Holdfast is actively developed and used as a live guild platform. The codebase intentionally favors small, understandable systems with strong operational guardrails over speculative enterprise architecture.

Future work includes deeper Discord delivery and the Holdfast WoW addon/bridge while keeping the website authoritative.

## License

Holdfast is open source under the [MIT License](LICENSE).
