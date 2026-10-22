const BRIEF_URL = "https://scrum.aomi.dev/marketing/llms.txt?scope=public";

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
    const res = await fetch(BRIEF_URL, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    body = await res.text();
  } catch {
    body = FALLBACK;
  }
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
