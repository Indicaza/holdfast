# Release guardrails

Every PR runs frontend lint/tests/build, backend tests and focused coverage gates, the complete Chromium browser suite, and the production container smoke test. `Release gate` runs even after a dependency fails and accepts only successful results from all four jobs. Cancelled, skipped, and missing checks block it. Merge-group candidates run the same checks.

## Activate main protection

After the CI PR is merged and `Release gate` has run, use an account with repository administration permission from the repository root:

```sh
gh api --method PUT repos/Indicaza/holdfast/branches/main/protection --input config/main-branch-protection.json
```

The configuration requires PRs and an up-to-date passing `Release gate`, enforces the rule for administrators, and blocks force pushes and branch deletion. It requires no second human approval. The settings can also be applied in GitHub Settings → Branches; select `Release gate` as the required check and enable enforcement for administrators.

Verify the applied rule:

```sh
gh api repos/Indicaza/holdfast/branches/main/protection
```

Repository files do not activate branch protection themselves. The connected coding app lacks GitHub administration permission, so this is a one-time owner setup step.

## Deployment

The Render Blueprint specifies `autoDeployTrigger: checksPass`. Confirm the live service's Auto-Deploy setting is **After CI Checks Pass**. A successful build is required before production deployment; a failed PR must be repaired before merging.

When a test catches a bug, keep the regression assertion. Do not weaken thresholds, remove a failing journey, or change expected business rules merely to make CI green. Permission tests must prove forbidden requests leave persistent state unchanged; reward tests must inspect the ledger after replay; migration tests must retain historical fixtures.
