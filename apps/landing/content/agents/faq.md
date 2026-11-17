---
title: Aomi FAQ
description: Frequently asked questions about Aomi — how it differs from general personal agents, building on Aomi, security guarantees, and signing.
source: https://aomi.dev/faq.md
---

# Aomi FAQ

Markdown mirror of the FAQ section on aomi.dev. Four questions covering the two main personas (using Aomi from a personal agent, building on Aomi as a developer) plus the security and signing model.

## OpenClaw, Claude Code, or Cursor can already trade on-chain. How is Aomi different?

Your personal agent can absolutely send transactions on its own. A bare-metal OpenClaw asked to swap on Uniswap will pull the ABI, read on-chain state, write a script, run via bash, and hope the calldata is right — a dozen tool calls and tens of thousands of tokens per operation, with no safety floor. Aomi compresses that loop into one call: "Swap 100 USDC for ETH on Uniswap" becomes a single CLI invocation returning a resolved, simulated, signable transaction. We don't replace your agent — Aomi is the tool it reaches for when the task crosses on-chain. Think of us as Claude Code for EVM: same _gather context → build → validate_ shape, native to chain, with simulation as the security floor.

## Why build on Aomi instead of OpenAI SDK, Claude Code SDK, or LangChain?

OpenAI SDK, Claude Code SDK, and LangChain give you the LLM call — you bring everything else: the server, the tool execution layer, chat thread management, simulation, wallet plumbing. Aomi builds and hosts the agent for you. Wrap your API as Aomi tools, define the system prompt, ship it. The runtime handles LLM orchestration, multi-chain execution, transaction simulation, session state, and concurrency — when 100 users hit your chat surface at once, Aomi keeps threads isolated and streams fast. The blockchain harness comes free: every tool call inherits simulation-first execution and non-custodial signing automatically. You bring the API; we bring the harness.

## How do you prevent AI hallucinations from causing bad transactions?

Every transaction the AI builds is simulated against a forked chain before it can be signed. Malformed calldata, failed approvals, and unexpected reverts are caught before they reach the user's wallet. The Aomi runtime shows exact token changes, gas costs, and contract calls; you verify and sign locally. Read by default, simulate before sign, credentials never round-trip.

## How does signing work? How do I secure my wallet?

Aomi never touches your wallet or your keys. Signing is the existing human-in-the-loop checkpoint every chain already has — you hit "Sign" to confirm the exact payload before broadcast, same as today. In the CLI, `aomi tx sign` calls [viem](https://viem.sh) — the same open-source library most wallets use under the hood — and runs locally on your machine. Typing `aomi tx sign` is functionally identical to clicking the Sign button in your wallet UI; if an agent runs it, the agent is hitting Sign with whatever keys it manages. Layer additional security as needed — a TEE on your device or your agent's server can safeguard the key material — but the trust model doesn't change: the key never reaches Aomi's runtime, only the constructed transaction does.

## See also

- [Agent onboarding](https://aomi.dev/agents.md) — routes user intent to the right install path
- [Transact with Aomi](https://aomi.dev/agents/transact.md) — execute on-chain operations through the Aomi CLI
- [Build an Aomi package](https://aomi.dev/agents/build.md) — turn an API, SDK, or repo into an Aomi package
- [Full corpus](https://aomi.dev/llms-full.txt) — every Aomi doc plus both skill files concatenated
- [Skills repo](https://github.com/aomi-labs/skills) — the canonical operating procedures (`aomi-transact`, `aomi-build`)
