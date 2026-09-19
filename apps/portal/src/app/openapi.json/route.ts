import { proxyAgentApiDiscovery } from "@portal/server/agent-api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return proxyAgentApiDiscovery(request);
}
