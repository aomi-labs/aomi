import { createBackendProxy } from "@aomi-labs/account/server";

import { buildFailures } from "@/server/bff/failures";
import { backendUrl, deployConfig } from "@/server/env";

/** Build forwards only the GitHub App install start, anonymously. */
export const { GET, POST, PUT, PATCH, DELETE } = createBackendProxy({
  allowedRoutes: [
    {
      pattern: /^\/api\/integrations\/github-app\/oauth\/start$/,
      methods: new Set(["GET"]),
      auth: "optional",
    },
  ],
  upstreamBaseUrl: backendUrl(),
  applyDefaults: (upstreamUrl) => {
    if (!upstreamUrl.searchParams.get("platform"))
      upstreamUrl.searchParams.set("platform", deployConfig().platform);
  },
  resolveCanonicalUserId: async () => null,
  observeFailure: (failure) => {
    buildFailures.handle({ source: "proxy", failure });
  },
});
