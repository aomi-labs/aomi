import { createFileRoute } from "@tanstack/react-router";

// Every /api/bff/* endpoint dispatches through one lazy route table
// (src/server/bff/route-table.ts); unknown paths fall through to the proxy.
async function serve(ctx: {
  request: Request;
  pathname: string;
  params: { _splat?: string };
}) {
  const { serveBff } = await import("@/server/bff/route-table");
  return serveBff(ctx.request, ctx.pathname, ctx.params._splat);
}

export const Route = createFileRoute("/api/bff/$")({
  server: { handlers: { ANY: serve, OPTIONS: serve } },
});
