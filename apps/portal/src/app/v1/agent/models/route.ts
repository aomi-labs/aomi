import { proxyAgentApiDiscovery } from "@portal/server/agent-api-proxy";
import {
  applyWidgetCors,
  widgetCorsPreflight,
} from "@portal/server/widget-auth/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return applyWidgetCors(request, await proxyAgentApiDiscovery(request));
  } catch {
    return applyWidgetCors(
      request,
      Response.json(
        {
          error: {
            code: "upstream_unavailable",
            message: "Model catalog unavailable",
          },
        },
        { status: 502 },
      ),
    );
  }
}

export const OPTIONS = (request: Request): Response =>
  widgetCorsPreflight(request, ["GET", "OPTIONS"]);
