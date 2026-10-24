import "server-only";

import { mintDelegatedBearer } from "@aomi-labs/account";
import { forward, AGENT_API_HEADERS } from "@aomi-labs/account/forward";
import { authorize } from "./auth";
import { backendUrl } from "@/server/env";

/** GitHub is the builder identity; the Payment service resolves its canonical owner. */
export async function credits(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const suffix = url.pathname.slice("/v1/builder/credits".length);
  const read = request.method === "GET";
  const allowed = read
    ? /^(?:|\/methods|\/ledger|\/funding-events\/[^/]+)$/
    : /^(?:\/funding-events|\/funding-events\/[^/]+\/cancel)$/;
  if (!allowed.test(suffix) || (!read && request.method !== "POST"))
    return new Response(null, { status: 404 });
  const auth = await authorize(request, { write: !read });
  if ("response" in auth) return auth.response;
  const scopes = [`builder:credits:${read ? "read" : "fund"}`];
  if (request.headers.has("payment-signature")) scopes.push("payments:submit");
  const { bearer } = await mintDelegatedBearer(String(auth.session.githubUserId), "aomi-payment", {
    scope: scopes.join(" "), resource: `${url.origin}/v1/builder`,
    principal_class: "user", auth_source: "session", sid: "session-bound",
  });
  return forward({ request, url: new URL(url.pathname + url.search, backendUrl()), policy: AGENT_API_HEADERS, bearer });
}
