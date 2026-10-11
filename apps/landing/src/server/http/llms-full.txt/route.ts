import "@tanstack/react-start/server-only";
import { readAgentFile } from "../../assets";

const SKILL_FILES = [
  "skills/aomi-transact/SKILL.md",
  "skills/aomi-transact/references/account-abstraction.md",
  "skills/aomi-transact/references/apps.md",
  "skills/aomi-transact/references/examples.md",
  "skills/aomi-transact/references/session.md",
  "skills/aomi-transact/references/troubleshooting.md",
  "skills/aomi-build/SKILL.md",
  "skills/aomi-build/references/aomi-sdk-patterns.md",
  "skills/aomi-build/references/spec-to-tools.md",
];

function section(title: string): string {
  const bar = "=".repeat(78);
  return `\n\n${bar}\n${title}\n${bar}\n\n`;
}

export async function GET() {
  const parts: string[] = [];

  parts.push(
    `# Aomi — full agent corpus\n\n` +
      `Generated from https://aomi.dev. ` +
      `This file concatenates the agent onboarding page ` +
      `and the canonical aomi-labs/skills SKILL.md files for one-fetch ingestion. ` +
      `The full documentation corpus lives at https://aomi.dev/docs/llms-full.txt.\n\n` +
      `Safety mantra: Read by default. Simulate before sign. Credentials never round-trip.\n`,
  );

  parts.push(section("AGENT ONBOARDING — /agents.md"));
  parts.push(readAgentFile("agents.md"));

  parts.push(section("FAQ — /faq.md"));
  parts.push(readAgentFile("faq.md"));

  parts.push(section("SKILLS — github.com/aomi-labs/skills"));
  for (const rel of SKILL_FILES) {
    const body = readAgentFile(rel);
    parts.push(`<!-- source: github.com/aomi-labs/skills:${rel} -->\n\n`);
    parts.push(body);
    parts.push("\n");
  }

  const body = parts.join("");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
