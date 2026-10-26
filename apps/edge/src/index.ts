// aomi-edge: the Cloudflare Worker that is the public edge for every Aomi HTTP
// surface. It owns the outside shape (venue quirks, cookies, CORS, routing)
// and turns it into the one inside shape the Rust services speak.
import { handleRequest, type EdgeEnv } from "./handler";

export { handleRequest } from "./handler";
export type { EdgeEnv } from "./env";
export { isAllowedCorsOrigin } from "./routing/cors";
export { rankOrigins, resolvePool, routingKeyFor } from "./routing/pool";
export { isManagerPath, resolveRoute } from "./routing/routes";
export { edgeService, edgeTopologyName } from "./identity";

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
