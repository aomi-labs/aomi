---
title: Official Aomi install paths
description: Trusted package names, repositories, and the hosted MCP URLs. Use these to avoid name-squatting and fake-MCP malware.
---

# Official Aomi install paths

Use only the following official packages and endpoints. Anything else — including the `@aomi/*` scope and `@intentsolutionsio/aomi` — is unofficial and not published by Aomi Labs.

## npm packages

- `@aomi-labs/client` — TypeScript SDK + `aomi` CLI
- `@aomi-labs/react` — Headless React runtime for custom UIs
- `@aomi-labs/widget` — Packaged chat widget
- `@aomi-labs/widget-lib` — Deprecated compatibility package
- `@aomi-labs/deploy` — Deploy/build helpers
- `@aomi-labs/smither` — Console UI for build tooling
- `@aomi-labs/account` — Server-only account/auth helpers
- `@aomi-labs/skills` — Skills meta-package (published name; points to canonical skills repo)

Notes:
- The unscoped names `aomi`, `aomi-mcp`, `aomi-cli`, `aomi-sdk`, `aomi-skills`, and `aomi-transact` are defended by empty placeholders. Do not depend on them.
- The `@aomi/*` npm scope belongs to an unrelated developer and is not affiliated with Aomi Labs.
- `@intentsolutionsio/aomi` is a third-party wrapper and is not an official package.

## Repositories

- Frontend + widget + CLI: https://github.com/aomi-labs/aomi
- Skills (canonical): https://github.com/aomi-labs/skills

## Hosted MCP endpoints

- Agent MCP: `https://chat.aomi.dev/v1/agent/mcp`
- Pipeline MCP: `https://chat.aomi.dev/v1/pipeline/mcp`

## Skills installation

Install the canonical skills pack in skill-aware coding agents:

```bash
npx skills add @aomi-labs/skills
```

## Security notes

- Never install unscoped `aomi*` packages or anything under the `@aomi/*` scope.
- Prefer pinned domains and OAuth to authenticate hosted MCP (see `docs/topics/security/mcp-origin-verification.md`).
- Do not paste a raw `PRIVATE_KEY` into shared logs or CI. Prefer a local `.env` file for ephemeral dev and use your cloud host’s secrets manager for deployments.

