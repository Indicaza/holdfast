# Deploy Holdfast on Render

Holdfast's production infrastructure is declared in `render.yaml`. Render builds the repository's Docker image, waits for GitHub CI to pass, checks `/api/health/ready`, and stores SQLite and Discord provisioning state on the persistent `/data` disk.

## One-time setup

1. Merge the Render deployment pull request into `main`.
2. Open the [Render Dashboard](https://dashboard.render.com/).
3. Select **New**, then **Blueprint**.
4. Connect GitHub if requested and select `Indicaza/holdfast`.
5. Keep the Blueprint branch on `main` and the Blueprint path as `render.yaml`.
6. Enter the required values below when Render asks for them.
7. Review the `holdfast` web service and apply the Blueprint.

Render generates `SESSION_SECRET`. Do not replace it during ordinary deploys because doing so signs every member out.

## Required Discord values

| Render variable | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | Application ID from the Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret from the Discord Developer Portal |
| `DISCORD_GUILD_ID` | Holdfast Discord server ID |
| `DISCORD_BOT_TOKEN` | Bot token from the Discord Developer Portal |
| `GUILD_OWNER_DISCORD_IDS` | Comma-separated Discord user IDs for site owners |

The first deployment automatically uses Render's generated `onrender.com` URL. After Render shows the live URL, add this redirect in the Discord Developer Portal under **OAuth2**, then **Redirects**:

```text
https://YOUR-RENDER-HOSTNAME.onrender.com/api/auth/discord/callback
```

Optional Discord role settings can be added after the first deployment:

| Render variable | Purpose |
| --- | --- |
| `DISCORD_RECRUIT_ROLE_ID` | Role assigned to a new recruit who joins through the website |
| `DISCORD_SITE_ADMIN_ROLE_IDS` | Comma-separated roles allowed into the control room |
| `DISCORD_QUEST_EDITOR_ROLE_IDS` | Comma-separated roles allowed to edit quests |
| `DISCORD_REWARD_POLICY_ROLE_IDS` | Comma-separated roles allowed to change reward policy |

These Discord IDs are safe to commit once known. Add them to `render.yaml` in a follow-up pull request to keep the complete non-secret configuration in code.

## Custom domain

The generated Render domain is enough to launch. When the final domain is ready:

1. Add the domain to the `domains` list in `render.yaml`.
2. Add `FRONTEND_URL` to `render.yaml` with the final HTTPS origin.
3. Merge the pull request and let the Blueprint sync.
4. Create the DNS records Render displays.
5. Add the final callback URL to the Discord application's OAuth2 redirects.
6. Keep the Render callback registered until the new domain has been verified and tested.

`FRONTEND_URL` must contain only the origin, without a path, query, fragment, or trailing route.

## Launch verification

After the first deployment:

1. Open `/api/health/ready` and confirm it returns a successful response.
2. Sign in as an existing guild member.
3. Sign out and sign in again.
4. Complete the recruit flow with a test Discord account when practical.
5. Edit a member profile.
6. Join and leave a quest objective.
7. Confirm a normal member cannot access the control room.
8. Confirm a configured owner can access the control room.
9. Redeploy the current commit and confirm member and quest data remain present.

## Deployments and rollback

Every merge to `main` runs GitHub Actions. Render deploys the commit only after those checks pass. Infrastructure changes follow the same pull request process because Render continuously synchronizes `render.yaml`.

To roll back application code, revert the faulty pull request. Do not use a code rollback to repair damaged data.

Render takes daily snapshots of the persistent disk. Before a risky data migration or Discord provisioning change, confirm a recent snapshot exists under the service's disk settings. Restore data from that snapshot only after identifying the last known-good point, because restoring replaces newer disk state.

The repository also provides an application-consistent SQLite backup command:

```bash
cd backend
BACKUP_DIR=/external/backup/location npm run backup
```

`BACKUP_DIR` must be outside `/data`. The initial Render deployment relies on Render disk snapshots; adding encrypted off-platform backup storage is a separate hardening task.

## Operational boundaries

- Keep one service instance while Holdfast uses SQLite and a persistent disk.
- Do not enable pull request preview services against production Discord credentials or production data.
- Do not commit Discord secrets, bot tokens, session secrets, or Render API keys.
- Increasing the disk size is safe; Render does not allow shrinking it.
- Expect a brief restart during deploys because the persistent disk can attach to only one instance at a time.
