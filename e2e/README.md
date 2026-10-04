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

## CI selection

Pull requests do not blindly run every browser journey:

- Quest changes → smoke + quest journeys
- Member/Auth/Guild/shared-state changes → full browser suite
- Other application changes → smoke suite
- Docs/non-runtime changes → browser suite can be skipped
- Pushes to `main` → full browser suite

When adding a new feature area, add its spec and extend the path mapping in `.github/workflows/ci.yml` so later changes to that area trigger the relevant journey.

## Failures

CI retains the Playwright HTML report, trace, screenshots/video, and backend server log on failure. Those artifacts are the first place to look when a browser test breaks.

The goal is velocity: catch expensive regressions automatically without turning Holdfast into a QA project.
