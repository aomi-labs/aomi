import "server-only";

import { portalService } from "@aomi-labs/account";
import { BackendClient } from "@aomi-labs/deploy";
import { backendUrl } from "@/server/env";

async function mintServiceBearer(): Promise<string> {
  const { accessToken } = await portalService().mint({
    role: "service",
    subject: "aomi-bff",
    audience: "aomi-backend",
  });
  return accessToken;
}

export async function backendClient(): Promise<BackendClient> {
  const activationToken = await mintServiceBearer();
  return new BackendClient({
    aomi: { backendUrl: backendUrl(), activationToken },
  });
}
