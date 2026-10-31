// The local development entry (`wrangler dev --env dev`): the production
// Worker plus the E2E wallet harness, which the deployed bundle never includes.
import worker, { type WaitUntil } from "./index";
import { handleE2ERequest } from "./dev/e2e-routes";
import type { EdgeEnv } from "./env";

export default {
  async fetch(request: Request, env: EdgeEnv, ctx: WaitUntil): Promise<Response> {
    return (await handleE2ERequest(request)) ?? worker.fetch!(request, env, ctx);
  },
};
