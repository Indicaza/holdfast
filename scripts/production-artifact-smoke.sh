#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-holdfast-ci:latest}"
CONTAINER_NAME="holdfast-production-artifact-smoke"
BASE_URL="http://127.0.0.1:4180"
ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/holdfast-production-artifact"
DATA_DIR="$ROOT/data"
FIRST_STATE_FILE="$ROOT/first-state.json"
SECOND_STATE_FILE="$ROOT/second-state.json"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

on_error() {
  local exit_code=$?
  echo "Production artifact smoke failed. Container logs follow:" >&2
  docker logs "$CONTAINER_NAME" 2>&1 || true
  exit "$exit_code"
}

trap cleanup EXIT
trap on_error ERR

rm -rf "$ROOT"
mkdir -p "$DATA_DIR"
chmod 0777 "$DATA_DIR"
cp e2e/fixtures/members.json "$DATA_DIR/members.json"
cp e2e/fixtures/quests.json "$DATA_DIR/quests.json"

start_container() {
  cleanup

  docker run -d \
    --name "$CONTAINER_NAME" \
    -p 127.0.0.1:4180:3000 \
    -v "$DATA_DIR:/data" \
    -e NODE_ENV=production \
    -e PORT=3000 \
    -e GUILD_DATA_DIR=/data \
    -e FRONTEND_URL=https://holdfast-ci.invalid \
    -e SESSION_SECRET=holdfast-production-artifact-session-secret-1234567890 \
    -e DISCORD_CLIENT_ID=11111111111111111 \
    -e DISCORD_CLIENT_SECRET=production-artifact-client-secret \
    -e DISCORD_GUILD_ID=22222222222222222 \
    -e DISCORD_BOT_TOKEN=production-artifact-bot-token \
    -e GUILD_OWNER_DISCORD_IDS=33333333333333333 \
    "$IMAGE" >/dev/null

  for attempt in {1..40}; do
    if curl --fail --silent "$BASE_URL/api/health/ready" >/dev/null; then
      return 0
    fi

    if ! docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
      echo "Production container exited before readiness." >&2
      docker logs "$CONTAINER_NAME" 2>&1 || true
      return 1
    fi

    sleep 1
  done

  echo "Production container never became ready." >&2
  docker logs "$CONTAINER_NAME" 2>&1 || true
  return 1
}

probe_state() {
  docker exec "$CONTAINER_NAME" node --input-type=module -e '
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync("/data/holdfast.sqlite");
    try {
      const count = (table) => Number(db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count);
      const migration = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
      const focused = db.prepare("SELECT focused_quest_id FROM quest_settings WHERE id = 1").get();
      const quest = db.prepare("SELECT title FROM quests WHERE id = ?").get("e2e-supply-run");
      const state = {
        schemaVersion: Number(migration.version),
        members: count("members"),
        quests: count("quests"),
        objectives: count("objectives"),
        assignments: count("assignments"),
        focusedQuestId: focused.focused_quest_id,
        questTitle: quest?.title || "",
        integrity: db.prepare("PRAGMA quick_check").get().quick_check,
        foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
      };
      console.log(JSON.stringify(state));
    } finally {
      db.close();
    }
  '
}

smoke_http() {
  curl --fail --silent "$BASE_URL/api/health/live" | grep -q '"status":"ok"'
  curl --fail --silent "$BASE_URL/api/health/ready" | grep -q '"status":"ok"'
  curl --fail --silent "$BASE_URL/api/quests" | grep -q 'E2E Supply Run'
  curl --fail --silent -H 'Accept: text/html' "$BASE_URL/" | grep -q '<title>Holdfast | Alliance WoW Forever Guild</title>'
}

echo "Booting exact production artifact for the first time..."
start_container
smoke_http
probe_state | tee "$FIRST_STATE_FILE"

grep -q '"schemaVersion":6' "$FIRST_STATE_FILE"
grep -q '"members":3' "$FIRST_STATE_FILE"
grep -q '"quests":1' "$FIRST_STATE_FILE"
grep -q '"objectives":2' "$FIRST_STATE_FILE"
grep -q '"focusedQuestId":"e2e-supply-run"' "$FIRST_STATE_FILE"
grep -q '"questTitle":"E2E Supply Run"' "$FIRST_STATE_FILE"
grep -q '"integrity":"ok"' "$FIRST_STATE_FILE"
grep -q '"foreignKeyViolations":0' "$FIRST_STATE_FILE"

docker stop "$CONTAINER_NAME" >/dev/null
docker rm "$CONTAINER_NAME" >/dev/null

# If restart persistence is real, the application must not need its original
# import files to reconstruct the guild. Removing them also catches accidental
# fresh-database creation on the second boot.
rm -f "$DATA_DIR/members.json" "$DATA_DIR/quests.json"

echo "Restarting the same production artifact on the same persistent disk..."
start_container
smoke_http
probe_state | tee "$SECOND_STATE_FILE"

if ! cmp --silent "$FIRST_STATE_FILE" "$SECOND_STATE_FILE"; then
  echo "Persistent guild state changed across an artifact restart:" >&2
  diff -u "$FIRST_STATE_FILE" "$SECOND_STATE_FILE" || true
  exit 1
fi

echo "Production artifact boot, HTTP smoke, migration, and restart persistence all passed."
