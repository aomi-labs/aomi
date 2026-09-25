import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

const SKILL_DIR = ["content", "agents", "skills", "aomi-build"];
const FILES = [
  { rel: "SKILL.md", heading: "## Procedure — the aomi-build skill" },
  { rel: "references/aomi-sdk-patterns.md", heading: "## SDK patterns" },
  { rel: "references/spec-to-tools.md", heading: "## Spec to tools" },
];

const PREAMBLE = `---
title: Build an Aomi app — for agents
description: Self-contained guide for an AI agent told "build an Aomi app for our API". Inlines the aomi-build skill, SDK patterns, spec-to-tools rubric, and how to wire up a chat frontend. Read this once and you have everything to scaffold an Aomi SDK crate end-to-end.
source: https://aomi.dev/agents/build.md
---

# Build an Aomi app

This page is for an AI agent that has been told something like *"build an Aomi app for our REST API at api.acme.com"*. Read it once — it contains the full build procedure, SDK patterns, and how to add a chat frontend on top.

> If the agent has access to the canonical \`aomi-build\` skill at [github.com/aomi-labs/skills](https://github.com/aomi-labs/skills/tree/main/aomi-build), prefer that — same content, kept in sync. To install: \`npx skills add aomi-labs/skills\`.

## Quick orientation

An **Aomi App** is a Rust crate built on \`aomi-sdk\` that exposes an external service (REST, GraphQL, JSON-RPC, gRPC, or any callable surface) as a small set of intent-shaped tools the Aomi agent can invoke during a conversation. The standard file split is:

- \`lib.rs\` — manifest, preamble, tool registration
- \`client.rs\` — HTTP client, auth, typed models, response normalization
- \`tool.rs\` — \`DynAomiTool\` implementations

The procedure below converts a spec or repo into that shape.

`;

const FRONTEND_SECTION = `

## Adding a chat frontend

If the user also asked for a chat UI to interact with the app you just built, you have two options.

### Option A — Packaged widget (fastest, "ChatGPT-style" out of the box)

Install the published widget package:

\`\`\`bash
npm install @aomi-labs/widget-lib
\`\`\`

Then render it in a client component:

\`\`\`tsx
"use client";

import { AomiWidget } from "@aomi-labs/widget-lib";
import "@aomi-labs/widget-lib/styles.css";

export default function AssistantPage() {
  return (
    <AomiWidget
      apiUrl={process.env.NEXT_PUBLIC_AOMI_API_URL!}
      applicationId={process.env.NEXT_PUBLIC_AOMI_APPLICATION_ID!}
      auth={{ kind: "browser_wallet" }}
      height="100dvh"
    />
  );
}
\`\`\`

Set \`NEXT_PUBLIC_AOMI_API_URL=https://chat.aomi.dev\` and the deployed App's canonical \`NEXT_PUBLIC_AOMI_APPLICATION_ID\` in \`.env.local\`. The Application ID selects an activated App; it is not an API key. Browser-wallet mode uses an origin-bound session, and users approve wallet actions explicitly.

Full quickstart with wallet integration: <https://aomi.dev/docs/build/quickstart.md>

### Option B — Headless React library (custom UI, your own components)

When the user wants a sidebar layout, embedded inline chat, or non-chat UI shapes, install the headless library and wire your own components on top:

\`\`\`bash
pnpm install @aomi-labs/react
\`\`\`

Then read:
- <https://aomi.dev/docs/build/ui/headless/install.md> — runtime setup
- <https://aomi.dev/docs/build/ui/headless/runtime-provider.md> — provider that holds backend connection, session, tool state
- <https://aomi.dev/docs/build/ui/headless/hooks.md> — React hooks for chat, tools, sessions
- <https://aomi.dev/docs/build/ui/headless/build-custom-ui.md> — composer / message-list / tool-view patterns

### When to pick which

| Need | Use |
|---|---|
| Working chat in <30 min | Bundled widget (Option A) |
| Branded but ChatGPT-shaped | Bundled widget + theming overrides |
| Sidebar / inline / non-chat layout | Headless library (Option B) |
| Replace specific UI parts only | Bundled widget + override individual sub-components |

## Deeper reference (fetch these only if you need them)

- API reference (HTTP backend): <https://aomi.dev/docs/build/services/api-reference.md>
- Building apps overview: <https://aomi.dev/docs/build/services/building-apps.md>
- Namespaces and tool naming: <https://aomi.dev/docs/build/namespaces.md>
- SDK reference (React): <https://aomi.dev/docs/reference/sdk.md>
- Architecture: <https://aomi.dev/docs/reference/architecture.md>
- Account abstraction (for execution apps): <https://aomi.dev/docs/reference/account-abstraction.md>
- Sessions and state: <https://aomi.dev/docs/build/services/sessions.md>

## Verification

After scaffolding the app:

\`\`\`bash
# From the aomi-sdk root, with the new app at apps/<name>/
cargo build --manifest-path apps/<name>/Cargo.toml
cargo run -p xtask -- build-aomi --app <name>
\`\`\`

If \`build-aomi\` reports zero built plugins for a brand-new app, the manifest is probably untracked by git — \`build-aomi\` uses \`git ls-files\` for discovery. \`cargo build --manifest-path apps/<name>/Cargo.toml\` is the fastest direct compile signal until that's fixed.

## Source

- Skills repo (canonical): <https://github.com/aomi-labs/skills>
- Widget + landing repo: <https://github.com/aomi-labs/aomi-widget>
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
      // Drop the file's own H1 — we provide section headings instead.
      .replace(/^#\s.+\n+/, "");
    parts.push(`${heading}\n\n`);
    parts.push(
      `<!-- source: github.com/aomi-labs/skills:aomi-build/${rel} -->\n\n`,
    );
    parts.push(stripped);
    parts.push("\n");
  }

  parts.push(FRONTEND_SECTION);

  return new Response(parts.join(""), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
