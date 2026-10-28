// aomi-edge: the Cloudflare Worker that is the public edge for every Aomi HTTP
// surface. It owns the outside shape (venue quirks, cookies, CORS, routing)
// and turns it into the one inside shape the Rust services speak.
import { setAccountInternalFailureObserver } from "@aomi-labs/account/observability";
import { setBetterAuthFailureObserver } from "@aomi-labs/account/better-auth";
import * as Sentry from "@sentry/cloudflare";

import { handleRequest, type EdgeEnv } from "./handler";

export { handleRequest } from "./handler";

export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };
export type { EdgeEnv } from "./env";

// Account failures that never reach a response still reach Sentry.
setAccountInternalFailureObserver(({ kind, error }) => {
  Sentry.captureException(error, { tags: { kind } });
});
setBetterAuthFailureObserver(({ error, status }) => {
  if (status === undefined || status >= 500) Sentry.captureException(error, { tags: { kind: "better_auth" } });
});

/** Errors go to Sentry when SENTRY_DSN is set; without it the SDK stays off. */
export default Sentry.withSentry(
  (env: EdgeEnv) => ({
    dsn: env.SENTRY_DSN,
    environment: env.EDGE_TOPOLOGY,
    release: env.CF_VERSION_METADATA?.id,
  }),
  {
    async fetch(request: Request, env: EdgeEnv, ctx: WaitUntil): Promise<Response> {
      return handleRequest(request, env, undefined, undefined, (promise) => ctx.waitUntil(promise));
    },
  },
);
