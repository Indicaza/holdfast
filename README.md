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

Holdfast uses **Node 24**.

```bash
git clone https://github.com/Indicaza/holdfast.git
cd holdfast
```

Run the backend:

```bash
cd backend
cp .env.example .env
npm ci
npm run dev
```

In another terminal, run the frontend:

```bash
cd frontend
npm ci
npm run dev
```

Vite serves the frontend locally and proxies `/api` requests to the backend on port `3000`.

Discord-backed authentication requires local Discord application credentials. See [Development](docs/DEVELOPMENT.md) for setup details and test commands.

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

For meaningful behavior changes, open an issue before investing in a large implementation. Keep pull requests focused and include regression coverage where practical.

Security issues should follow [SECURITY.md](.github/SECURITY.md) rather than being posted publicly.

## Project status

Holdfast is actively developed and used as a live guild platform. The codebase intentionally favors small, understandable systems with strong operational guardrails over speculative enterprise architecture.

Future work includes deeper Discord delivery and the Holdfast WoW addon/bridge while keeping the website authoritative.
