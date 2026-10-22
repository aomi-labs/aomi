import { backendUrlFromEnv } from "@aomi-labs/account/backend-url";

// Public deployment/configuration identity. Never include environment values
// other than these public URLs and Vercel's source/deployment identifiers.
export function GET(): Response {
  const backend = new URL(backendUrlFromEnv(process.env));
  if (backend.username || backend.password)
    return new Response(null, { status: 503 });
  return Response.json(
    {
      kind: "frontend_runtime",
      source_sha: process.env.VERCEL_GIT_COMMIT_SHA,
      deployment_host: process.env.VERCEL_URL,
      server_api_origin: backend.origin,
      browser_api_base: process.env.NEXT_PUBLIC_BACKEND_URL,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
