import "@tanstack/react-start/server-only";
const BRIEF_URL = "https://scrum.aomi.dev/marketing/llms.txt?scope=public";
const REVALIDATE_MS = 3_600_000;
let cached: { body: string; expiresAt: number } | undefined;
let pending: Promise<string> | undefined;

function revalidate(): Promise<string> {
  pending ??= fetch(BRIEF_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const body = await response.text();
      cached = { body, expiresAt: Date.now() + REVALIDATE_MS };
      return body;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

function brief(): Promise<string> {
  if (!cached) return revalidate();
  if (cached.expiresAt <= Date.now()) {
    // Keep Next's public brief stale-while-revalidate behavior on refresh failure.
    void revalidate().catch(() => {});
  }
  return Promise.resolve(cached.body);
}

// Served if the generated brief is unreachable — a crawler should always get
// a 200 with real positioning, never a 5xx.
const FALLBACK = `# aomi

> Aomi Labs builds the native harness on blockchains.

Aomi turns natural language into real on-chain execution against arbitrary protocols and smart contracts, on any chain, from any wallet. Non-custodial (keys never leave the user), type-checked at compile time, simulated before signing, with account abstraction built in. Also a cloud host for agentic applications — trading bots, prediction-market agents, DeFi assistants — plus a React widget, Telegram & Discord integrations, a Rust SDK, and installable agent skills (\`npx skills add aomi-labs/skills\`). x402 pricing and MPP settlement come out of the box.

- Docs: https://aomi.dev/docs (machine index: https://aomi.dev/llms.txt)
- Live product: https://chat.aomi.dev
- Skills: https://github.com/aomi-labs/skills
`;

export async function GET() {
  let body: string;
  try {
    body = await brief();
  } catch {
    body = FALLBACK;
  }
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
