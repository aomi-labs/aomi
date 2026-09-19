import { createBackendProxy, type AllowedRoute } from "@aomi-labs/account";
import { resolveCanonicalUserId } from "@portal/server/canonical-session";
import { widgetPreflight, widgetRoute } from "@portal/server/widget-auth/response";
import type { NextRequest } from "next/server";

// Better Auth owns /api/auth/*. This same-origin BFF supplies the trusted
// account bearer and thread header to the Rust delegation endpoint.
const ROUTES: AllowedRoute[] = [
  {
    pattern: /^\/api\/auth\/para\/begin$/,
    methods: new Set(["POST"]),
  },
];

const proxy = createBackendProxy({
  allowedRoutes: ROUTES,
  resolveCanonicalUserId,
});

export const POST = widgetRoute(
  (request: NextRequest) =>
    proxy.POST(request, {
      params: Promise.resolve({ slug: ["auth", "para", "begin"] }),
    }),
  "Para delegation begin",
);

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
