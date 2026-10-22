---
title: Verifying the hosted MCP server is genuinely Aomi’s
description: Design options to prevent fake-MCP origin abuse; recommend pinned domains with optional cert/server-key pinning and OAuth resource verification. Scoping only — no implementation.
---

# MCP origin verification — design note

Threat model: fake-MCP campaigns (e.g., REF8801) publish look‑alike endpoints and npm packages to trick clients into connecting to a malicious server. We want CLI/SDK checks that the hosted MCP server in use is genuinely operated by Aomi.

## Options

- Pinned domain allowlist
  - Allow only `https://chat.aomi.dev` (production) and optionally `https://chat-staging.aomi.dev` (staging) in release builds.
  - Pros: simple, robust; no runtime calls needed beyond TLS + hostname.
  - Cons: blocks custom self‑hosted stacks unless explicitly opted in.

- TLS certificate (SPKI) pinning
  - Pin the server certificate’s public key hash (SPKI) for `chat.aomi.dev`.
  - Pros: defends against compromised CAs and on‑path TLS interception.
  - Cons: operationally brittle — cert/key rotation must update pins before rollout; fallback path required.

- Signed server identity (first‑party key)
  - Host a short JSON “server card” under `/.well-known/aomi-server.json` with:
    - `server_id`, `origin`, `issued_at`, `expires_at`, `public_key_fingerprint`
  - Sign the payload with an Aomi service key whose public half is already pinned in the client (see `packages/account/src/topology-data.ts`).
  - Pros: explicit first‑party assertion, independent of the TLS chain.
  - Cons: requires new well-known endpoint and rotation procedures.

- OAuth protected‑resource verification (MCP)
  - MCP clients already authorize against Aomi with scopes like `mcp:agent`. During OAuth, verify:
    - Issuer and signing key match the pinned Aomi keys.
    - The authorized `resource` equals `https://chat.aomi.dev/v1/{agent|pipeline}/mcp`.
  - Pros: leverages existing OAuth, no extra endpoints needed.
  - Cons: Only applies after OAuth; doesn’t help for pre‑auth probing.

## Recommendation

Layer the checks for defense‑in‑depth:

1) Pinned domains by default
- Hardcode allowlist: `https://chat.aomi.dev` (+ `https://chat-staging.aomi.dev` in non‑production builds).
- SDK: refuse other base URLs unless `allowUntrustedEndpoint: true` is passed explicitly.
- CLI: refuse `--base-url` outside the allowlist unless `AOMI_UNSAFE_ALLOW_ENDPOINT=1` is set.

2) OAuth resource verification (MCP)
- During MCP OAuth, validate the issuer and signature against the pinned keys in `packages/account/src/topology-data.ts` and ensure the requested `resource` is exactly the expected MCP URL.

3) Optional SPKI pin (advanced)
- Ship a small rolling set of accepted SPKI fingerprints for `chat.aomi.dev` and warn on mismatches; fail closed in production unless an override flag is set.

Operational notes:
- Maintain the pinned service public keys in `packages/account/src/topology-data.ts`.
- Rotate SPKI pins using an overlap window: publish new pins before certificate/key rotation.
- Provide explicit overrides only for development and documented self‑hosted setups.

Scope: design only. No code changes in this PR.

