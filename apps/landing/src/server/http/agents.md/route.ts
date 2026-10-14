import "@tanstack/react-start/server-only";
import { readAgentFile } from "../../assets";

export async function GET() {
  const body = readAgentFile("agents.md");
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
