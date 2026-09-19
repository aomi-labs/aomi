import { AomiClient } from "../client";
import type { GetAccountBearer } from "../types";
import type { CliConfig } from "./types";

export const DEFAULT_CLI_BASE_URL = "https://chat.aomi.dev";

type CliClientOverrides = {
  apiKey?: string;
  baseUrl?: string;
};

export function resolveCliBaseUrl(config: Pick<CliConfig, "baseUrl">): string {
  return config.baseUrl ?? DEFAULT_CLI_BASE_URL;
}

export function createCliGetAccountBearer(
  config: CliConfig,
): GetAccountBearer | undefined {
  // A static `--account-bearer` is the explicit escape hatch (CI / power users)
  // and wins when set.
  if (config.accountBearer) {
    const bearer = config.accountBearer;
    return async () => bearer;
  }

  // The normal path: present the SIWE-established BFF session as the credential.
  // The CLI points at a BFF, so it sends the session as `Authorization: Bearer
  // <BetterAuth session>` (matching BetterAuth's bearer plugin) and the proxy mints the
  // short-lived backend bearer from it per request — no client-side `/token`
  // round-trip or refresh needed (the proxy re-mints on every call).

  return undefined;
}

export function createCliClient(
  config: CliConfig,
  overrides: CliClientOverrides = {},
): AomiClient {
  const mergedConfig: CliConfig = {
    ...config,
    baseUrl: overrides.baseUrl ?? config.baseUrl,
    apiKey: overrides.apiKey ?? config.apiKey,
  };

  return new AomiClient({
    baseUrl: resolveCliBaseUrl(mergedConfig),
    apiKey: mergedConfig.apiKey,
    getAccountBearer: createCliGetAccountBearer(mergedConfig),
  });
}
