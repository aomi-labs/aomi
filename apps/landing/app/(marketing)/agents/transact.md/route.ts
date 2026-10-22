import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

const SKILL_DIR = ["content", "agents", "skills", "aomi-transact"];
const FILES = [
  { rel: "SKILL.md", heading: "## Operating procedure — the aomi-transact skill" },
  { rel: "references/account-abstraction.md", heading: "## Account abstraction (signing internals)" },
  { rel: "references/apps.md", heading: "## Apps catalog and per-app usage" },
  { rel: "references/examples.md", heading: "## End-to-end example flows" },
  { rel: "references/session.md", heading: "## Sessions and local storage" },
  { rel: "references/troubleshooting.md", heading: "## Troubleshooting" },
];

const PREAMBLE = `---
title: Transact with Aomi — for agents
description: Self-contained guide for an AI agent told "swap 1 ETH for USDC" or "send 0.1 ETH to vitalik.eth". Inlines the aomi-transact skill, AA signing internals, app catalog, end-to-end examples, session model, and troubleshooting. One fetch — everything an agent needs to drive the aomi CLI.
source: https://aomi.dev/agents/transact.md
---

# Transact with Aomi

This page is for an AI agent that has been told something like *"swap 1 ETH for USDC"* or *"send 0.1 ETH to vitalik.eth"*. Read it once — it contains the full operating procedure for the \`aomi\` CLI, including signing, simulation, sessions, and troubleshooting.

> If the agent has access to the canonical \`aomi-transact\` skill at [github.com/aomi-labs/skills](https://github.com/aomi-labs/skills/tree/main/aomi-transact), prefer that — same content, kept in sync. To install: \`npx skills add aomi-labs/skills\`.

## Install the CLI

\`\`\`bash
# Recommended for repeated use
npm install -g @aomi-labs/client

# Or run on demand (no install)
npx @aomi-labs/client --version
\`\`\`

Throughout this guide, commands are written as \`aomi <command>\`. If \`aomi\` is not on PATH, substitute \`npx @aomi-labs/client\` everywhere.

## Quick verification

\`\`\`bash
aomi --version            # Must be >= 0.1.30
aomi --prompt "what is the price of ETH?"
\`\`\`

If that returns a price quote, the install works and you can proceed.

## Hard rules (these always apply)

- **Never invent or guess credentials.** Pass through only what the user gave you in this turn. Never echo a credential value back after using it.
- **Always simulate before signing multi-step batches.** \`approve → swap\`, \`approve → deposit\`, etc. are state-dependent — simulate them together with \`aomi tx simulate tx-1 tx-2\` before \`aomi tx sign\`.
- **Default to \`--new-session\`** on the first command of a fresh task so old session state doesn't bleed in.
- **Only call \`aomi tx sign\` after \`aomi tx list\` shows a pending tx.** Don't sweep queues; sign only what the user asked for.
- **Match the signing RPC to the pending tx's chain.** \`--chain\` (session context) and \`--rpc-url\` (signing transport) are independent — keep them aligned.

`;

const TAIL = `

## Deeper reference (fetch only if needed)

- CLI command reference: <https://aomi.dev/docs/reference/cli.md>
- Simulation internals: <https://aomi.dev/docs/reference/simulation.md>
- Architecture: <https://aomi.dev/docs/reference/architecture.md>
- SDK reference (React, for embedding): <https://aomi.dev/docs/reference/sdk.md>
- Wallet integration (for embedding the widget): <https://aomi.dev/docs/build/services/wallet-integration.md>

## Source

- Skills repo (canonical): <https://github.com/aomi-labs/skills>
- npm package: <https://www.npmjs.com/package/@aomi-labs/client>
- Full corpus (every doc + both skills): <https://aomi.dev/llms-full.txt>
`;

function stripFrontmatter(src: string): string {
  if (!src.startsWith("---\n")) return src;
  const end = src.indexOf("\n---\n", 4);
  if (end === -1) return src;
  return src.slice(end + "\n---\n".length).replace(/^\n+/, "");
}

export async function GET() {
  const parts: string[] = [PREAMBLE];

  for (const { rel, heading } of FILES) {
    const file = path.join(process.cwd(), ...SKILL_DIR, rel);
    const body = await fs.readFile(file, "utf-8");
    const stripped = stripFrontmatter(body)
      .replace(/^#\s.+\n+/, "");
    parts.push(`${heading}\n\n`);
    parts.push(`<!-- source: github.com/aomi-labs/skills:aomi-transact/${rel} -->\n\n`);
    parts.push(stripped);
    parts.push("\n");
  }

  parts.push(TAIL);

  return new Response(parts.join(""), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
