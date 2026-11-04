import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One goal for the AI tester, taken from an existing Playwright journey title. */
export type Flow = { id: string; source: string; goal: string };

const E2E_DIR = fileURLToPath(new URL("..", import.meta.url));

// Journeys whose intent a real, signed-in ChatRC session can show. The others
// need the fake agent's controls, an embedding page, a funded wallet or a
// payment, so the advisory tester leaves them to the scripted suites.
const SKIPPED_JOURNEYS = new Set([
  "embed-cross-origin", // needs a third-party embedding page
  "notifications", // needs a durable notice injected by the fake backend
  "payment-gate-x402", // real payment
  "tx-review-sign", // transaction signing
]);

// Literal test titles only: a title built from a template is a parameterised
// case, and the advisory run takes its plain cases.
const TITLE = /\btest\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*,/g;

function titles(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(TITLE)].map((match) =>
    match[2].replace(/\\(["'\\])/g, "$1"),
  );
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Every advisory flow: the journey titles plus the hosted session journey. */
export function loadFlows(filter?: string): Flow[] {
  const journeyDir = join(E2E_DIR, "journeys");
  const flows: Flow[] = [];
  for (const name of readdirSync(journeyDir).sort()) {
    if (!name.endsWith(".spec.ts")) continue;
    const stem = basename(name, ".spec.ts");
    if (SKIPPED_JOURNEYS.has(stem)) continue;
    for (const goal of titles(join(journeyDir, name))) {
      flows.push({
        id: `${stem}--${slug(goal)}`,
        source: `journeys/${name}`,
        goal,
      });
    }
  }
  // The hosted wallet journeys, as one signed-in session flow. Their scripted
  // titles are parameterised by wallet family, and the transfer case needs a
  // funded wallet.
  flows.push({
    id: "hosted--signed-in-session",
    source: "hosted-wallet-journeys.spec.ts",
    goal: "an EVM wallet signs in, gets a settled reply, keeps its session and chat history across a reload, and sign-out ends both",
  });
  if (!filter) return flows;
  const pattern = new RegExp(filter, "i");
  return flows.filter(
    (flow) => pattern.test(flow.id) || pattern.test(flow.goal),
  );
}
