import { aomiBffUrl } from "@/app/config";

export function GET(): Response {
  const bff = new URL(aomiBffUrl);
  if (bff.username || bff.password) return new Response(null, { status: 503 });
  return Response.json(
    {
      kind: "frontend_runtime",
      source_sha: process.env.VERCEL_GIT_COMMIT_SHA,
      deployment_host: process.env.VERCEL_URL,
      bff_origin: bff.origin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
