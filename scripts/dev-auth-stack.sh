#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(cd "$ROOT_DIR/.." && pwd)"
PRODUCT_MONO_DIR="${PRODUCT_MONO_DIR:-$WORK_DIR/product-mono}"
PRODUCT_BACKEND_LAUNCHER="${PRODUCT_BACKEND_LAUNCHER:-}"
DB_MASTER_DIR="${DB_MASTER_DIR:-$WORK_DIR/db-master}"
PORTAL_DIR="$ROOT_DIR/apps/portal"

LOCAL_DB_URL="${AOMI_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/aomi_local}"
LOCAL_ADMIN_DB_URL="${AOMI_LOCAL_ADMIN_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
BACKEND_URL="${AOMI_LOCAL_BACKEND_URL:-http://127.0.0.1:8080}"
PORTAL_URL="${AOMI_LOCAL_PORTAL_URL:-http://127.0.0.1:3000}"
OPENROUTER_BASE="${AOMI_OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
SMOKE_CHAT="${AOMI_DEV_STACK_SMOKE_CHAT:-1}"

BACKEND_SESSION="${AOMI_BACKEND_TMUX_SESSION:-aomi-backend}"
PORTAL_SESSION="${AOMI_PORTAL_TMUX_SESSION:-aomi-portal}"
BACKEND_LOG="${AOMI_BACKEND_LOG:-/tmp/aomi-backend.log}"
PORTAL_LOG="${AOMI_PORTAL_LOG:-/tmp/aomi-portal.log}"

usage() {
  cat <<EOF
Usage: $0 [start|restart|stop|status|db]

Starts the merged BFF/BetterAuth local stack:
  backend  $BACKEND_URL  from product-mono/aomi
  portal   $PORTAL_URL   from this repo's apps/portal
  db       $LOCAL_DB_URL

Environment overrides:
  PRODUCT_MONO_DIR, PRODUCT_BACKEND_LAUNCHER, DB_MASTER_DIR,
  AOMI_LOCAL_DB_URL, AOMI_LOCAL_ADMIN_DB_URL, AOMI_BACKEND_LOG,
  AOMI_PORTAL_LOG, AOMI_OPENROUTER_BASE_URL, AOMI_DEV_STACK_SMOKE_CHAT
EOF
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local max="${3:-90}"
  local code

  for _ in $(seq 1 "$max"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    if [ "$code" = "200" ]; then
      echo "$label ready: $url"
      return 0
    fi
    sleep 2
  done

  echo "$label did not become ready: $url" >&2
  return 1
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping listener(s) on :$port: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

stop_stack() {
  tmux kill-session -t "$PORTAL_SESSION" 2>/dev/null || true
  tmux kill-session -t "$BACKEND_SESSION" 2>/dev/null || true
  kill_port 3000
  kill_port 8080
}

ensure_db_exists() {
  need psql

  if ! psql "$LOCAL_ADMIN_DB_URL" -tAc "select 1" >/dev/null 2>&1; then
    cat >&2 <<EOF
Cannot connect to local Postgres at 127.0.0.1:54322.
Start the local Supabase/OrbStack stack that exposes supabase_db_aomi-api-e2e-supabase.
EOF
    exit 1
  fi

  if ! psql "$LOCAL_ADMIN_DB_URL" -tAc "select 1 from pg_database where datname = 'aomi_local'" | grep -q 1; then
    echo "Creating local database aomi_local"
    psql "$LOCAL_ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "create database aomi_local"
  fi
}

ensure_backend_schema() {
  local migrations_dir
  # Keep the schema source aligned with the backend binary we launch below.
  # db-master is retained as a fallback for older worktrees, but it can lag the
  # product-mono runtime and leave newly required columns unapplied.
  if [ -d "$PRODUCT_MONO_DIR/supabase/migrations" ]; then
    migrations_dir="$PRODUCT_MONO_DIR/supabase/migrations"
  elif [ -d "$DB_MASTER_DIR/migrations" ]; then
    migrations_dir="$DB_MASTER_DIR/migrations"
  else
    echo "Missing migrations: $PRODUCT_MONO_DIR/supabase/migrations or $DB_MASTER_DIR/migrations" >&2
    exit 1
  fi

  apply_migration() {
    local name="$1"
    local path="$migrations_dir/$name"
    if [ ! -f "$path" ]; then
      echo "Missing migration: $path" >&2
      exit 1
    fi
    echo "Applying migration: $name"
    psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -q -f "$path"
  }

  if ! psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.users')" | grep -q users; then
    echo "Applying migrations into aomi_local from $migrations_dir"
    for migration in "$migrations_dir"/*.sql; do
      psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
    done
    return 0
  fi

  echo "Converging local backend schema from $migrations_dir"

  if psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.bff_cli_device_sessions') is not null or to_regclass('public.bff_cli_sessions') is not null" | grep -q t; then
    apply_migration 20260713000000_drop_legacy_bff_cli_sessions.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.threads')" | grep -q threads; then
    apply_migration 20260625000000_session_user_state.sql
    apply_migration 20260625010000_drop_sessions_active_identity_wallet_id.sql
    apply_migration 20260626000000_drop_scheduled_intents_authorized_wallet_ref.sql
    apply_migration 20260626010000_sessions_thread_scheduling.sql
    apply_migration 20260626020000_backfill_scheduled_intents_to_threads.sql
    apply_migration 20260626030000_drop_sessions_active_identity_id.sql
    apply_migration 20260627000000_drop_scheduled_intents.sql
    apply_migration 20260627005000_rename_sessions_to_threads.sql
    apply_migration 20260627010000_threads_spawn_input.sql
    apply_migration 20260627020000_threads_fold_intent_into_spawn_input.sql
    apply_migration 20260627030000_cron_jobs.sql
    apply_migration 20260627040000_threads_drop_timers.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.cron_jobs')" | grep -q cron_jobs; then
    apply_migration 20260627030000_cron_jobs.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cron_jobs' and column_name = 'lease_until'" | grep -q 1; then
    apply_migration 20260629010000_cron_jobs_lease.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.auth_providers')" | grep -q auth_providers; then
    if psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.auth_identities')" | grep -q auth_identities; then
      apply_migration 20260624000000_betterauth_global_identity_uidx.sql
    fi
    apply_migration 20260630010000_identity_wallets_signing_authorization.sql
    apply_migration 20260701010000_account_model_consolidation.sql
    apply_migration 20260701020000_account_model_contract.sql
    apply_migration 20260701030000_account_model_slim.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select count(*) = 6 from information_schema.columns where table_schema = 'public' and table_name in ('llm_usage_events', 'user_transactions') and column_name in ('application_id', 'app_source_id', 'platform_id')" | grep -q t; then
    apply_migration 20260707010000_owned_operate_attribution.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.user_transactions_application_created_idx')" | grep -q user_transactions_application_created_idx; then
    apply_migration 20260707010100_owned_operate_attribution_indexes.sql
  fi

  if ! psql "$LOCAL_DB_URL" -tAc "select to_regclass('public.thread_archives')" | grep -q thread_archives; then
    apply_migration 20260717000000_thread_archives.sql
  fi
}

ensure_auth_schema() {
  if [ ! -x "$ROOT_DIR/node_modules/.bin/tsx" ]; then
    echo "Missing node_modules/.bin/tsx. Run pnpm install in $ROOT_DIR first." >&2
    exit 1
  fi

  local tmp_ts
  tmp_ts="$(mktemp /tmp/aomi-better-auth-migrate.XXXXXX.ts)"
  cat > "$tmp_ts" <<'TS'
import { pathToFileURL } from "node:url";
import { getMigrations } from "better-auth/db/migration";

(async () => {
  const root = process.cwd();
  const authModule = await import(
    pathToFileURL(`${root}/packages/account/src/better-auth/auth.ts`).href
  );
  const migrations = await getMigrations(authModule.auth.options);
  await migrations.runMigrations();
  const created = migrations.toBeCreated.map((table) => table.table).join(", ");
  const added = migrations.toBeAdded.map((table) => table.table).join(", ");
  console.log(
    `BetterAuth schema ready: created=[${created || "none"}] added=[${added || "none"}]`,
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
TS

  (
    cd "$ROOT_DIR"
    set -a
    # shellcheck source=/dev/null
    source "$PORTAL_DIR/.env.local"
    set +a
    export DATABASE_URL="$LOCAL_DB_URL"
    "$ROOT_DIR/node_modules/.bin/tsx" "$tmp_ts"
  )
  rm -f "$tmp_ts"
}

ensure_db() {
  ensure_db_exists
  ensure_backend_schema
  ensure_auth_schema
}

start_backend() {
  if [ ! -d "$PRODUCT_MONO_DIR/aomi" ]; then
    echo "Missing product-mono Rust workspace: $PRODUCT_MONO_DIR/aomi" >&2
    exit 1
  fi

  echo "Starting backend tmux session: $BACKEND_SESSION"
  rm -f "$BACKEND_LOG"
  if [ -n "$PRODUCT_BACKEND_LAUNCHER" ]; then
    if [ ! -f "$PRODUCT_BACKEND_LAUNCHER" ]; then
      echo "Missing backend launcher: $PRODUCT_BACKEND_LAUNCHER" >&2
      exit 1
    fi
    tmux new-session -d -s "$BACKEND_SESSION" \
      "cd '$WORK_DIR' && bash '$PRODUCT_BACKEND_LAUNCHER' 2>&1 | tee '$BACKEND_LOG'"
  else
    tmux new-session -d -s "$BACKEND_SESSION" \
      "cd '$PRODUCT_MONO_DIR/aomi' && set -a && source ../.env.dev && set +a && export DATABASE_URL='$LOCAL_DB_URL' AOMI_APPS_DIR='$PRODUCT_MONO_DIR/aomi/plugins' BACKEND_HOST='127.0.0.1' BACKEND_PORT='8080' OPENROUTER_BASE_URL='$OPENROUTER_BASE' OPENROUTER_API_BASE='$OPENROUTER_BASE' RUST_LOG=\"\${RUST_LOG:-info}\" BAML_LOG=\"\${BAML_LOG:-warn}\" && cargo run -p backend 2>&1 | tee '$BACKEND_LOG'"
  fi
  wait_for_url "backend" "$BACKEND_URL/health" 120
}

start_portal() {
  if [ ! -x "$PORTAL_DIR/node_modules/.bin/next" ]; then
    echo "Missing apps/portal/node_modules/.bin/next. Run pnpm install first." >&2
    exit 1
  fi

  echo "Starting merged portal tmux session: $PORTAL_SESSION"
  rm -f "$PORTAL_LOG"
  tmux new-session -d -s "$PORTAL_SESSION" \
    "cd '$PORTAL_DIR' && set -a && source .env.local && set +a && export DATABASE_URL='$LOCAL_DB_URL' NEXT_PUBLIC_BACKEND_URL='$BACKEND_URL' && ./node_modules/.bin/next dev -H 127.0.0.1 -p 3000 2>&1 | tee '$PORTAL_LOG'"
  wait_for_url "portal" "$PORTAL_URL/" 90
}

smoke_chat() {
  if [ "$SMOKE_CHAT" = "0" ]; then
    return 0
  fi

  local thread_id
  local body
  thread_id="dev-stack-smoke-$(date +%s)"
  echo
  echo "Smoke:"
  printf "  create thread: "
  curl -s -o /tmp/aomi-dev-stack-create.json -w "%{http_code}\n" \
    -X POST \
    -H "X-Thread-Id: $thread_id" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "$PORTAL_URL/api/threads" | grep -q '^200$'
  echo "200"

  printf "  agent pong: "
  curl --max-time 30 -s -o /tmp/aomi-dev-stack-agent.json -w "%{http_code}\n" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: dev-stack-$thread_id" \
    -d "{\"sessionId\":\"$thread_id\",\"message\":\"Say only pong\",\"app\":\"default\",\"clientId\":\"dev-stack-smoke\",\"userState\":{\"connection\":{\"is_connected\":false}}}" \
    "$PORTAL_URL/api/v1/agent/chat" | grep -q '^200$'

  local cursor
  cursor="$(jq -r '.cursor // empty' /tmp/aomi-dev-stack-agent.json)"

  for _ in $(seq 1 18); do
    body="$(curl -s "$PORTAL_URL/api/v1/agent/chat/$thread_id?cursor=$cursor&wait=5000")"
    cursor="$(printf "%s" "$body" | jq -r '.cursor // empty')"
    if printf "%s" "$body" | jq -e '[.events[]? | select(.type == "turn_state_changed" and (.state == "complete" or .state == "failed" or .state == "interrupted"))] | length > 0' >/dev/null; then
      if printf "%s" "$body" | jq -e '[.events[]? | select(.type == "message" and (.content | ascii_downcase | contains("pong")))] | length > 0' >/dev/null; then
        echo "200 pong"
        return 0
      fi
      echo "completed without pong" >&2
      printf "%s\n" "$body" >&2
      return 1
    fi
    sleep 5
  done

  echo "timed out" >&2
  return 1
}

status_stack() {
  echo "Health:"
  printf "  backend: "
  curl -s -o /dev/null -w "%{http_code} $BACKEND_URL/health\n" "$BACKEND_URL/health" || true
  printf "  portal:  "
  curl -s -o /dev/null -w "%{http_code} $PORTAL_URL/\n" "$PORTAL_URL/" || true

  echo
  echo "Listeners:"
  lsof -nP -iTCP:8080 -sTCP:LISTEN 2>/dev/null || true
  lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true

  echo
  echo "Tmux:"
  tmux list-sessions 2>/dev/null | grep -E "($BACKEND_SESSION|$PORTAL_SESSION)" || true

  echo
  echo "Logs:"
  echo "  backend: $BACKEND_LOG"
  echo "  portal:  $PORTAL_LOG"
}

main() {
  local action="${1:-start}"
  need tmux
  need curl
  need lsof

  case "$action" in
    start|restart)
      stop_stack
      ensure_db
      start_backend
      start_portal
      status_stack
      smoke_chat
      ;;
    db)
      ensure_db
      ;;
    stop)
      stop_stack
      ;;
    status)
      status_stack
      ;;
    smoke)
      smoke_chat
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
