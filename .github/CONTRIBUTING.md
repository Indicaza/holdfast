# Contributing to Holdfast

Thanks for helping improve Holdfast.

Holdfast is a live guild platform, not a demo project. Changes should favor durability, clear ownership, and small reviewable slices over speculative abstraction.

## Before you start

- Check existing issues and pull requests before duplicating work.
- Look for `good first issue` and `help wanted` when you want a contained starting point.
- Comment on an issue when you start work so two people do not unknowingly build the same thing.
- For a significant feature or behavior change, open an issue first so scope can be agreed before implementation.
- Keep unrelated refactors out of feature pull requests.
- Do not commit secrets, production data, Discord tokens, SQLite databases, backups, or local environment files.

## Local development

Holdfast uses Node 24. See [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) for the full setup.

Most contributors do **not** need Holdfast Discord credentials. The repository includes an explicitly development-only local identity sandbox with Member, Officer, and Commander personas.

Backend:

```bash
cd backend
cp .env.example .env
npm ci
```

Set a local session secret and `HOLDFAST_DEV_AUTH=true` in `backend/.env`, then:

```bash
npm run dev:seed
npm run dev
```

Frontend in another terminal:

```bash
cd frontend
npm ci
npm run dev
```

The complete sandbox login URLs and Windows setup are documented in [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md).

## Architecture

The codebase follows one simple rule:

**Ownership > file type.**

Feature-specific components, styles, helpers, and tests should stay close to the feature that owns them. Promote code into shared infrastructure only when unrelated domains genuinely share it.

Avoid speculative frameworks, giant global utility folders, and broad rewrites that are not required by the change.

The website is the authoritative source for Holdfast-owned state. Discord and the WoW addon are integrations and delivery surfaces around that state.

## Tests

Run the checks relevant to your change before opening a pull request.

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

Changes touching authentication, Discord provisioning, notifications, persistence, migrations, or release safety may have additional focused coverage gates in CI. Do not weaken those gates to make a change pass.

## Pull requests

A good Holdfast pull request:

- links the issue it addresses when one exists
- explains the user-visible or operational problem
- keeps the change focused
- includes tests for behavior and regressions where practical
- calls out migrations, permissions, persistence, or deployment impact
- includes screenshots for meaningful UI changes
- preserves existing safety invariants unless the PR explicitly replaces them with stronger ones

The full CI suite is the merge contract. It includes frontend/backend checks, production-image verification, database safety, browser journeys, and a fail-closed release gate.

## Database and production safety

Never treat a production-data problem as a normal code cleanup.

- Runtime guild state belongs in SQLite, not Git.
- Schema changes must use migrations.
- Existing data must remain readable after deploys and restarts.
- Do not edit or remove historical migrations after release.
- Do not bypass backup, migration, or release guardrails.

Read [`docs/BACKUP_AND_RECOVERY.md`](../docs/BACKUP_AND_RECOVERY.md) and [`docs/RELEASE_GUARDRAILS.md`](../docs/RELEASE_GUARDRAILS.md) before changing persistence or deployment behavior.

## Visual style

Keep the product visually consistent with Holdfast: deep navy, ivory, aged gold, restrained motion, and clear hierarchy. Reuse the shared design tokens before inventing new visual primitives.

## Questions

If an issue is underspecified, ask in the issue or pull request rather than guessing at product policy.
