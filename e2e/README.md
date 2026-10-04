# Holdfast browser regression harness

This is intentionally small. Playwright acts like a disposable Chromium user against a temporary Holdfast database in CI.

## Standing rule

When a PR adds or materially changes user-facing behavior, that same PR should add or update the relevant Playwright journey here. Do not create browser tests for implementation details or every CSS tweak.

Prefer a few durable journeys that prove a member can actually use the feature:

- open the page
- perform the important action
- cross an authority boundary when relevant
- verify the resulting UI/state

Use roles, labels, and visible copy before adding test-only selectors.

## Test personas

CI seeds three disposable members:

- `member` — Private
- `officer` — Lieutenant
- `commander` — Commander/owner

The browser receives a normally signed Holdfast session cookie. There is no E2E login route or production test backdoor. Backend authorization still resolves from the seeded member's real rank/billet authority.

## CI coverage

Every pull request, merge-group candidate, and push to `main` runs the complete browser suite. Dependencies, recruitment, shared modals, and new feature directories receive the same coverage as existing features. The release gate rejects failed, skipped, cancelled, or missing checks.

Install the harness with `npm ci` so CI and local runs use the committed lockfile.

## Failures

CI retains the Playwright HTML report, trace, screenshots/video, and backend server log on failure. Those artifacts are the first place to look when a browser test breaks.

The goal is velocity: catch expensive regressions automatically without turning Holdfast into a QA project.

## Saved member and leadership workflows

`workflows.spec.js` checks profile persistence and retry after a failed save, rank changes, billet authority and assignment, quest publication/archive/deletion, invalid and valid JSON imports, concurrent quest edits, and completion rejection/resubmission. Setup and cleanup use the normal API; the important actions run through the rendered UI. Fixtures are disposable and no live Discord calls are needed.

A conflict must preserve the newer server data and offer a recovery path that actually loads it. Failed saves must preserve the editable draft. These assertions are part of the full CI browser gate.
