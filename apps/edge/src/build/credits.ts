/**
 * Builder credits: GitHub is the builder identity; the Payment service resolves
 * its canonical owner. Ported from the Build BFF's `server/bff/credits.ts`.
 */
import { edgeService } from "../identity";
import { config } from "../kernel/config";
import { cookieWriteAllowed } from "../kernel/csrf";
import { EdgeError, minted, unreachable } from "../kernel/errors";
import { proxy, target } from "../kernel/proxy";
import { AGENT_API_HEADERS } from "../portal/headers";
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
  if (!read && !cookieWriteAllowed(request, ctx.trustedOrigins)) throw new EdgeError(403, "forbidden");
  const session = await githubSessionOf(request, ctx);
  if (!session) throw new EdgeError(401, "unauthenticated");
  const payment = config(ctx.env).payment;
  if (!payment) throw unreachable(new Error("payment origin is not configured"));
  const scopes = [`builder:credits:${read ? "read" : "fund"}`];
  if (request.headers.has("payment-signature")) scopes.push("payments:submit");
  const { accessToken } = await minted(() =>
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
  return proxy(request, target(payment, url.pathname, url.search), {
    fetchImpl: ctx.fetchImpl,
    headers: AGENT_API_HEADERS,
    bearer: accessToken,
  });
}
