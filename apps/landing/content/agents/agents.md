---
title: Aomi for Agents
description: How to use Aomi from an AI coding agent or chat agent. Routes the user's intent to the right install path — transact, embed UI, or extend Aomi with a new tool.
source: https://aomi.dev/agents.md
---

# Aomi for Agents

Aomi is the blockchain harness for agentic AI. Three guarantees define the harness:

- **Read by default.** Chat, prices, balances, and simulations require no signing key.
- **Simulate before sign.** Every transaction is dry-run on a forked chain before it can be signed.
- **Credentials never round-trip.** Private keys stay on the user's machine; the agent never sees them.

This page routes you to one of three install paths based on the user's intent.

> **TL;DR:** pick one of the three paths below based on what the user asked for. Each path has a one-line install and a primary entry point. Read the path you need, not everything.

## Transact

### Path 1 — The user wants to act on a wallet

Read prices, balances, build/sign transfers, swaps, stakes, lends, bridges.

**Install once:**
```bash
npx skills add aomi-labs/skills
npm install -g @aomi-labs/client
```

**Then operate:** the [`aomi-transact` skill](https://github.com/aomi-labs/skills/blob/main/aomi-transact/SKILL.md) handles the chat → simulate → sign flow over the `aomi` CLI.

**Verify it works:**
```bash
aomi --prompt "what is the price of ETH?"
```

If `aomi` is not on PATH, replace `aomi` with `npx @aomi-labs/client` everywhere — same flags, same behavior.

**Hard rules** (the skill enforces these; respect them even without the skill):
- Never invent or guess credentials. Pass through only what the user gave you in this turn.
- Never echo a credential value back after using it.
- Always run `aomi tx simulate` before `aomi tx sign` for multi-step batches (approve → swap, etc.).
- Default to `--new-session` on the first command of a fresh task.

## Embed

### Path 2 — The user wants to embed an Aomi chat widget in their app

Drop a working AI chat widget into a Next.js app, with simulation and wallet signing already wired.

**Install:**
```bash
npm install @aomi-labs/widget
```

**Minimum code:**
```tsx
"use client";
import { AomiWidget } from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";
export default function ChatPage() { return <AomiWidget applicationId="123" />; }
```

**Read this for the full quickstart:** https://aomi.dev/docs/guides/widget-installation.md

**For a custom UI** (your own composer, message list, tool views) using the headless React library, install `@aomi-labs/react` and read:
- https://aomi.dev/docs/guides/headless-library.md
- https://aomi.dev/docs/guides/headless/build-custom-ui.md

**Decision: widget vs headless?** Use the widget when you want chat-shaped UX out of the box. Use headless when you need a different layout (sidebar, fullscreen, embedded inline) or your own components. Read https://aomi.dev/docs/guides/integration.md.

## Build

### Path 3 — The user wants to add their product/API to Aomi as a callable AI tool

Take an OpenAPI spec, an SDK, or a repo with a service interface, and turn it into an Aomi App that any Aomi agent can call.

**Install once:**
```bash
npx skills add aomi-labs/skills
```

**Then build:** the [`aomi-build` skill](https://github.com/aomi-labs/skills/blob/main/aomi-build/SKILL.md) scaffolds the standard Aomi SDK file split (`lib.rs`, `client.rs`, `tool.rs`) from the source material. It encodes the tool-design rules you should follow even without the skill (see below).

**Tool design rules that always apply:**
- Prefer the smallest sufficient toolset that makes the primary user workflow work end-to-end.
- Prefer 3–8 tools with clear intent boundaries (`search_*`, `get_*`, `build_*`, `submit_*`).
- Prefer typed args over raw JSON blobs.
- Build against an actual product surface (REST, GraphQL, JSON-RPC, gRPC) over docs-only helpers when one exists.
- Tool descriptions tell the model **when to call**, not just what endpoint they wrap.

**Read these for SDK patterns:**
- https://aomi.dev/docs/build/plugins/anatomy.md
- https://aomi.dev/docs/build/plugins/sdk.md
- https://aomi.dev/docs/reference/api-reference.md

## Key concepts (one paragraph each)

**Apps.** An Aomi App is a tool bundle plus a system prompt. The default app handles general chain reads and tx building. Switch with `--app <name>` on the CLI or `app="<name>"` in widget config. List with `aomi app list`.

**Sessions.** Conversation history persists on the Aomi backend; tx state and pointers live locally under `~/.aomi/`. Use `--new-session` on the first command of a fresh task. Resume with `aomi session resume <id>`. Read https://aomi.dev/docs/reference/sessions.md.

**Simulation.** Every transaction is simulated against a fork of the live chain before signing. Multi-step batches (approve → swap) are simulated together so state-dependent steps validate correctly. Run `aomi tx simulate tx-1 tx-2` before `aomi tx sign tx-1 tx-2`. Read https://aomi.dev/docs/reference/simulation.md.

**Account abstraction.** Signing defaults to AA via a zero-config Alchemy proxy. Falls through to user-side BYOK if Alchemy or Pimlico keys are configured. `--eoa` skips AA entirely. Read https://aomi.dev/docs/trade/execution.md.

**Non-custodial.** Aomi never holds private keys. The agent constructs transactions; the user's wallet signs them locally through wagmi-compatible connectors (or via the AA flow on supported chains).

## Full corpus

For one-fetch ingestion of every Aomi doc plus both skill files: https://aomi.dev/llms-full.txt

For the curated index of all `.md` URLs: https://aomi.dev/llms.txt

## Source

- Widget + landing repo: https://github.com/aomi-labs/aomi-widget
- Skills repo: https://github.com/aomi-labs/skills
- npm: https://www.npmjs.com/package/@aomi-labs/client
