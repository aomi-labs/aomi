import "@tanstack/react-start/server-only";

const SITE = "https://aomi.dev";

const AGENT_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Applebot",
  "CCBot",
  "Bytespider",
  "DuckAssistBot",
  "MistralAI-User",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
];

export function GET() {
  const body =
    AGENT_BOTS.map((agent) => `User-Agent: ${agent}\nAllow: /\n\n`).join("") +
    `User-Agent: *\nAllow: /\nDisallow: /api/\n\n` +
    `Host: ${SITE}\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/docs/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
