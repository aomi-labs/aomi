/**
 * Builder credits: GitHub is the builder identity; the Payment service resolves
 * its canonical owner. Ported from the Build BFF's `server/bff/credits.ts`.
 */
import { edgeService } from "../identity";
import { cookieWriteAllowed } from "../portal/csrf";
import { mintBearer } from "../portal/errors";
import { AGENT_API_HEADERS, UpstreamUnreachableError, forward } from "../portal/forward";
import type { BuildContext } from "./context";
import { githubSessionOf } from "./github-auth";

export const BUILDER_CREDITS_PREFIX = "/v1/builder/credits";
const CREDITS_BEARER_TTL_SECONDS = 15 * 60;
const READ_PATHS = /^(?:|\/methods|\/ledger|\/funding-events\/[^/]+)$/;
const WRITE_PATHS = /^(?:\/funding-events|\/funding-events\/[^/]+\/cancel)$/;

export async function credits(request: Request, ctx: BuildContext): Promise<Response> {
  const url = new URL(request.url);
  const suffix = url.pathname.slice(BUILDER_CREDITS_PREFIX.length);
  const read = request.method === "GET";
  const allowed = read ? READ_PATHS : WRITE_PATHS;
  if (!allowed.test(suffix) || (!read && request.method !== "POST")) return new Response(null, { status: 404 });
  if (!read && !cookieWriteAllowed(request, ctx.trustedOrigins))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const session = await githubSessionOf(request, ctx);
  if (!session) return Response.json({ error: "not signed in with GitHub" }, { status: 401 });
  const payment = (ctx.env.PAYMENT_ORIGIN ?? "").trim();
  if (!payment) throw new UpstreamUnreachableError(new Error("payment origin is not configured"));
  const scopes = [`builder:credits:${read ? "read" : "fund"}`];
  if (request.headers.has("payment-signature")) scopes.push("payments:submit");
  const { accessToken } = await mintBearer(() =>
    edgeService(ctx.env, url.host).mint({
      role: "user",
      subject: session.githubUserId,
      audience: "aomi-payment",
      ttlSeconds: CREDITS_BEARER_TTL_SECONDS,
      delegated: {
        scope: scopes.join(" "),
        resource: `${url.origin}/v1/builder`,
        principal_class: "user",
        auth_source: "session",
        sid: "session-bound",
      },
    }),
  );
  return forward({
    request,
    url: new URL(`${url.pathname}${url.search}`, payment),
    policy: AGENT_API_HEADERS,
    bearer: accessToken,
    fetchImpl: ctx.fetchImpl,
  });
}
