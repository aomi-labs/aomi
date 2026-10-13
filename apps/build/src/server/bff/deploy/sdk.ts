import "@tanstack/react-start/server-only";

import { backendClient } from "@/server/bff/backend";
import { buildFailures } from "@/server/bff/failures";
import { backendUrl } from "@/server/env";
import { timedManagerRead, deployErrorContext, readCache } from "./shared";

export async function sdkStatusRoute(req: Request) {
  try {
    const client = await backendClient();
    const status = await readCache.serverTags.get(["server_tags"], () =>
      timedManagerRead("server_tags", () => client.serverTags()),
    );
    const requiredVersion = status.sdkVersion;
    return Response.json({
      ok: true,
      serverTags: status.serverTags,
      sdkStatus: {
        requiredVersion,
        status: requiredVersion ? "unknown" : "missing",
        fixCommand: requiredVersion
          ? `aomi-build sdk fix --backend ${backendUrl()}`
          : null,
      },
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "launch.sdk_status"),
    }).response;
  }
}
