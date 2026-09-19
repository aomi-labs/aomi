#!/usr/bin/env bash
# Drive one full chat turn against a deployed app and report what came back.
#
# Starts a typed Agent turn, follows its ordered Event cursor to a terminal
# lifecycle event, and asserts that the agent produced a message.
#
# Usage:
#   scripts/check-app-turn.sh <app> <application_id> [message] [backend]
#
# Example (the app whose `get_risk_snapshot` schema broke every turn):
#   scripts/check-app-turn.sh somm-agent 2937568
#
# Exit codes: 0 the app answered, 1 it did not.

set -euo pipefail

APP="${1:?usage: check-app-turn.sh <app> <application_id> [message] [backend]}"
APPLICATION_ID="${2:?missing application_id}"
MESSAGE="${3:-hi}"
BACKEND="${4:-https://api-staging.aomi.dev}"

THREAD_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
CLIENT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
USER_STATE='{"connection":{"is_connected":false},"ext":{"client_type":"web_ui"}}'
HDR=(-H "X-Thread-Id: ${THREAD_ID}" -H "X-Session-Id: ${THREAD_ID}")

say() { printf '%s\n' "$*" >&2; }

say "thread ${THREAD_ID} · app ${APP} (${APPLICATION_ID}) · ${BACKEND}"

# A cold app 503s at the edge until an origin loads its artifact. That is the
# warm-up race the client now retries through, so retry here too rather than
# reporting a transient 503 as a broken app.
for attempt in 1 2 3 4 5; do
  create_status="$(curl -s -o /tmp/aomi-create.$$ -w '%{http_code}' -X POST \
    "${BACKEND}/api/threads?${COMMON}" "${HDR[@]}")"
  [ "$create_status" = "503" ] || break
  say "  create → 503 (app warming), retry ${attempt}"
  sleep 2
done

if [ "$create_status" != "200" ]; then
  say "FAIL: could not create thread (HTTP ${create_status})"
  cat /tmp/aomi-create.$$ >&2 || true
  rm -f /tmp/aomi-create.$$
  exit 1
fi
rm -f /tmp/aomi-create.$$
say "  create → 200"

START_FILE="$(mktemp)"
chat_status="$(curl -s -o "$START_FILE" -w '%{http_code}' -X POST \
  "${BACKEND}/v1/agent/chat" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: ${CLIENT_ID}" \
  -d "$(jq -cn --arg sessionId "$THREAD_ID" --arg message "$MESSAGE" --arg app "$APP" --arg clientId "$CLIENT_ID" --argjson applicationId "$APPLICATION_ID" --argjson userState "$USER_STATE" '{sessionId:$sessionId,message:$message,app:$app,applicationId:$applicationId,clientId:$clientId,userState:$userState}')" \
  "${HDR[@]}")"
say "  agent  → ${chat_status}"

STATE_FILE="$(mktemp)"
trap 'rm -f "$STATE_FILE" "$START_FILE"' EXIT

cp "$START_FILE" "$STATE_FILE"
cursor="$(jq -r '.cursor // empty' "$STATE_FILE")"

for _ in $(seq 1 30); do
  curl -s "${BACKEND}/v1/agent/chat/${THREAD_ID}?cursor=${cursor}&wait=2000" \
    "${HDR[@]}" >"$STATE_FILE"
  cursor="$(jq -r '.cursor // empty' "$STATE_FILE")"
  if jq -e '[.events[]? | select(.type == "turn_state_changed" and (.state == "complete" or .state == "failed" or .state == "interrupted"))] | length > 0' <"$STATE_FILE" >/dev/null; then
    break
  fi
  sleep 2
done

say ""
say "── transcript ──"
jq -r '.events[]? | select(.type == "message") | "  \(.sender): \(.content | .[0:120])"' <"$STATE_FILE" >&2
say ""

fail=0

if jq -e '[.events[]? | select(.type == "message" and .sender == "agent" and (.content | length) > 0)] | length > 0' <"$STATE_FILE" >/dev/null; then
  say "PASS: the app answered"
else
  say "FAIL: no assistant message — the app accepted the turn and said nothing"
  fail=1
fi

# The specific defect this check exists for: one tool schema the provider
# rejects makes it refuse the whole completion, so every turn dies.
if grep -q 'invalid_function_parameters' "$STATE_FILE"; then
  say "FAIL: provider rejected a tool schema (invalid_function_parameters)"
  say "      the offending tool should have been repaired or dropped before the call"
  fail=1
fi

# A dropped tool is the intended fallback, not a failure: the app still answers.
if jq -e '[.events[]? | select(.type == "notice")] | length > 0' <"$STATE_FILE" >/dev/null; then
  say "note: a durable failure notice is present in the transcript"
fi

exit "$fail"
