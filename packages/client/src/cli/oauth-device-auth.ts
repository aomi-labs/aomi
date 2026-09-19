import type { AomiOAuthResource, AomiOAuthTokenSet } from "../authorization";
import { joinUrl, normalizeBaseUrl, requestJson } from "./auth";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type RegistrationResponse = { client_id: string };
type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

export async function signInWithOAuthDevice(input: {
  baseUrl: string;
  resource: AomiOAuthResource;
  scopes: readonly string[];
  clientId?: string;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void | Promise<void>;
  now?: () => number;
}): Promise<AomiOAuthTokenSet & { clientId: string }> {
  const fetchImpl = input.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const client = input.clientId
    ? { client_id: input.clientId }
    : await requestJson<RegistrationResponse>(
        fetchImpl,
        joinUrl(baseUrl, "/api/auth/oauth2/register"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_name: "Aomi CLI",
            token_endpoint_auth_method: "none",
            grant_types: [DEVICE_GRANT, "refresh_token"],
            resources: [input.resource],
            scope: input.scopes.join(" "),
          }),
        },
        "OAuth client registration",
      );
  const code = await requestForm<DeviceCodeResponse>(
    fetchImpl,
    joinUrl(baseUrl, "/api/auth/device/code"),
    {
      client_id: client.client_id,
      scope: input.scopes.join(" "),
      resource: input.resource,
    },
  );
  const verification = code.verification_uri_complete ?? code.verification_uri;
  console.log(`Open ${verification} and enter code ${code.user_code}`);
  await (input.openBrowser ?? openUrl)(verification);
  const expiresAt = (input.now ?? Date.now)() + code.expires_in * 1000;
  let interval = Math.max(code.interval ?? 5, 1) * 1000;
  while ((input.now ?? Date.now)() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const response = await fetchImpl(
      joinUrl(baseUrl, "/api/auth/oauth2/token"),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: DEVICE_GRANT,
          device_code: code.device_code,
          client_id: client.client_id,
          resource: input.resource,
        }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      if (body.error === "slow_down") {
        interval += 5_000;
        continue;
      }
      if (body.error === "authorization_pending") continue;
      throw new Error(
        `OAuth device login failed: ${String(body.error ?? response.status)}`,
      );
    }
    return {
      clientId: client.client_id,
      accessToken: String(body.access_token),
      refreshToken:
        typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      expiresAt:
        (input.now ?? Date.now)() + Number(body.expires_in ?? 300) * 1000,
      resource: input.resource,
      scopes: String(body.scope ?? input.scopes.join(" "))
        .split(/\s+/)
        .filter(Boolean),
      tokenType: body.token_type === "DPoP" ? "DPoP" : "Bearer",
    };
  }
  throw new Error("OAuth device login expired before approval");
}

async function requestForm<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
) {
  return requestJson<T>(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    },
    "OAuth device authorization",
  );
}

async function openUrl(url: string) {
  const { spawn } = await import("node:child_process");
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}
