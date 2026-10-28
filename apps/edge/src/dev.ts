// The local development entry (`wrangler dev --env dev`): the production
// Worker plus the E2E wallet harness, which the deployed bundle never includes.
import worker from "./index";
import { handleE2ERequest } from "./dev/e2e-routes";
import type { EdgeEnv } from "./env";

export default {
  async fetch(request: Request, env: EdgeEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    return (await handleE2ERequest(request)) ?? worker.fetch(request, env, ctx);
  },
};
