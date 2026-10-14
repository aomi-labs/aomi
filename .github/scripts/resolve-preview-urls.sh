#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${PREVIEW_SHA:?PREVIEW_SHA is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

timeout_seconds="${PREVIEW_TIMEOUT_SECONDS:-480}"
[[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid preview timeout" >&2; exit 1; }
deadline=$((SECONDS + timeout_seconds))

resolve() {
  local environment="$1"
  local output_name="$2"
  local deployment_id="" url="" remaining=""
  while (( SECONDS < deadline )); do
    remaining=$((deadline - SECONDS))
    deployment_id="$(timeout "${remaining}s" gh api "repos/$GITHUB_REPOSITORY/deployments?sha=$PREVIEW_SHA&per_page=100" \
      --jq ".[] | select(.environment == \"$environment\") | .id" | head -n 1)"
    if [[ -n "$deployment_id" ]]; then
      remaining=$((deadline - SECONDS))
      (( remaining > 0 )) || break
      url="$(timeout "${remaining}s" gh api "repos/$GITHUB_REPOSITORY/deployments/$deployment_id/statuses?per_page=100" \
        --jq '[.[] | select(.state == "success" and .environment_url != null)] | first | .environment_url // empty')"
    fi
    if [[ "$url" == https://*.vercel.app ]]; then
      echo "$output_name=$url" >> "$GITHUB_OUTPUT"
      return 0
    fi
    remaining=$((deadline - SECONDS))
    (( remaining > 0 )) || break
    sleep "$((remaining < 15 ? remaining : 15))"
  done
  echo "No successful immutable URL for $environment at $PREVIEW_SHA" >&2
  return 1
}

resolve "Preview – chat-portal" portal_url
resolve "Preview – aomi-build" build_url
