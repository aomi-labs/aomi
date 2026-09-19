#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Codex copies ignored environment files via the repository's .worktreeinclude
# before running this setup script.
pnpm install --frozen-lockfile --prefer-offline
pnpm run build:lib
