#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PORT="${PORT:-3003}"
HOST="${HOST:-127.0.0.1}"
BACKEND_URL="${NEXT_PUBLIC_BACKEND_URL:-https://api.aomi.dev}"
NGROK_API_URL="${NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"

LANDING_PID=""
NGROK_PID=""

cleanup() {
  local pids=()
  [[ -n "${LANDING_PID:-}" ]] && pids+=("$LANDING_PID")
  [[ -n "${NGROK_PID:-}" ]] && pids+=("$NGROK_PID")

  if [[ ${#pids[@]} -gt 0 ]]; then
    kill "${pids[@]}" 2>/dev/null || true
  fi
}

trap 'cleanup; exit 0' INT TERM EXIT

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok not found. Install it first, for example: brew install ngrok"
  exit 1
fi

pkill -f "ngrok http ${PORT}" 2>/dev/null || true

port_pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
if [[ -n "$port_pids" ]]; then
  # `lsof` exits non-zero when no process is bound to the port, which is expected here.
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -9 "$pid"
  done <<<"$port_pids"
fi

pushd "$PROJECT_ROOT" >/dev/null
PORT="$PORT" HOSTNAME="$HOST" NEXT_PUBLIC_BACKEND_URL="$BACKEND_URL" \
  pnpm --filter landing dev &
LANDING_PID=$!
popd >/dev/null

echo "Starting landing on http://${HOST}:${PORT}"
for _ in $(seq 1 30); do
  if curl -sf "http://${HOST}:${PORT}" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://${HOST}:${PORT}" >/dev/null; then
  echo "Landing did not become ready on http://${HOST}:${PORT}"
  exit 1
fi

ngrok http "${PORT}" --log=stdout --log-format=json >/dev/null &
NGROK_PID=$!

NGROK_URL=""
for _ in $(seq 1 20); do
  NGROK_URL="$(
    curl -s "$NGROK_API_URL" 2>/dev/null \
      | grep -o '"public_url":"https://[^"]*"' \
      | head -1 \
      | cut -d'"' -f4
  )" || true
  [[ -n "$NGROK_URL" ]] && break
  sleep 1
done

if [[ -z "$NGROK_URL" ]]; then
  echo "Failed to acquire ngrok public URL"
  exit 1
fi

cat <<EOF
Landing ready.
  Local:   http://${HOST}:${PORT}
  Public:  ${NGROK_URL}
  Backend: ${BACKEND_URL}
  ngrok dashboard: http://127.0.0.1:4040
EOF

wait "$LANDING_PID"
