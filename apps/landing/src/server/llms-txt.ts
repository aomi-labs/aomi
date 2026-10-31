import "@tanstack/react-start/server-only";
import { readAgentFile } from "./assets";

export async function GET() {
  const body = readAgentFile("llms.txt");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
