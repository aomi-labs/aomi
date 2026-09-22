import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_SESSION_TTL_MS,
  fetchPortalAccount,
  joinUrl,
  normalizeBaseUrl,
  parseExpiresAt,
  requestJson,
} from "./auth";
import type { AccountGraphProviderExchangeResponse } from "./account-graph";
import type { CliAuthSession } from "./state";

export type DeviceAuthProvider = "privy" | "para";

export type DeviceProviderAuthOptions = {
  baseUrl: string;
  provider?: DeviceAuthProvider;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  openBrowser?: (url: string) => void | Promise<void>;
  randomBytes?: (size: number) => Buffer;
};

export type DeviceProviderAuthResult = {
  auth: CliAuthSession;
  provider?: DeviceAuthProvider;
};

export type DeviceProviderCredentialResult = {
  provider?: DeviceAuthProvider;
} & AccountGraphProviderExchangeResponse;

type ExchangeResponse = {
  sessionToken?: unknown;
  expiresAt?: unknown;
  betterAuthUserId?: unknown;
  provider?: unknown;
};

type LinkIntentResponse = {
  linkIntent?: unknown;
  state?: unknown;
  redirectUri?: unknown;
  provider?: unknown;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function deviceAuthPortalUrl(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  if (url.hostname === "api.aomi.dev") url.hostname = "chat.aomi.dev";
  if (url.hostname === "api-staging.aomi.dev") {
    url.hostname = "chat-staging.aomi.dev";
  }
  return normalizeBaseUrl(url.toString());
}

export async function signInWithDeviceProvider({
  baseUrl,
  provider,
  fetch: fetchImpl = fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  openBrowser = openUrlInBrowser,
  randomBytes: randomBytesImpl = randomBytes,
}: DeviceProviderAuthOptions): Promise<DeviceProviderAuthResult> {
  const portalUrl = deviceAuthPortalUrl(baseUrl);
  const state = base64Url(randomBytesImpl(32));
  const verifier = base64Url(randomBytesImpl(32));
  const codeChallenge = sha256Base64Url(verifier);
  const { server, redirectUri, callback } = await createLoopbackCallback({
    state,
    timeoutMs,
  });

  try {
    const authUrl = buildDeviceAuthUrl({
      portalUrl,
      state,
      codeChallenge,
      redirectUri,
      provider,
    });
    console.log(`Opening browser for Aomi account login: ${authUrl}`);
    await openBrowser(authUrl);
    console.log("Waiting for browser authentication...");
    const { code } = await callback;
    const exchange = await requestJson<ExchangeResponse>(
      fetchImpl,
      joinUrl(portalUrl, "/v1/account/device-auth/exchange"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          state,
          codeVerifier: verifier,
          redirectUri,
        }),
      },
      "Device auth exchange",
    );
    const sessionToken =
      typeof exchange.sessionToken === "string" ? exchange.sessionToken : "";
    if (!sessionToken) {
      throw new Error("Device auth exchange is missing session token");
    }
    const accountInfo = await fetchPortalAccount(
      fetchImpl,
      portalUrl,
      sessionToken,
    );
    return {
      provider:
        exchange.provider === "privy" || exchange.provider === "para"
          ? exchange.provider
          : provider,
      auth: {
        sessionToken,
        expiresAt:
          parseExpiresAt(exchange.expiresAt) ??
          parseExpiresAt(accountInfo?.session?.expiresAt) ??
          now() + DEFAULT_SESSION_TTL_MS,
        betterAuthUserId:
          typeof accountInfo?.session?.betterAuthUserId === "string"
            ? accountInfo.session.betterAuthUserId
            : typeof exchange.betterAuthUserId === "string"
              ? exchange.betterAuthUserId
              : undefined,
      },
    };
  } finally {
    await closeServer(server);
  }
}

export async function getDeviceProviderCredential({
  baseUrl,
  provider,
  sessionToken,
  fetch: fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  openBrowser = openUrlInBrowser,
  randomBytes: randomBytesImpl = randomBytes,
}: Pick<
  DeviceProviderAuthOptions,
  "baseUrl" | "provider" | "fetch" | "timeoutMs" | "openBrowser" | "randomBytes"
> & {
  sessionToken: string;
}): Promise<DeviceProviderCredentialResult> {
  if (!sessionToken) {
    throw new Error("Device auth provider linking requires an account session");
  }
  const portalUrl = deviceAuthPortalUrl(baseUrl);
  const state = base64Url(randomBytesImpl(32));
  const verifier = base64Url(randomBytesImpl(32));
  const codeChallenge = sha256Base64Url(verifier);
  const { server, redirectUri, callback } = await createLoopbackCallback({
    state,
    timeoutMs,
  });

  try {
    const intent = await requestJson<LinkIntentResponse>(
      fetchImpl,
      joinUrl(portalUrl, "/v1/account/device-auth/link-intent"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          state,
          codeChallenge,
          redirectUri,
          provider,
        }),
      },
      "Device auth link intent",
    );
    if (
      typeof intent.linkIntent !== "string" ||
      intent.state !== state ||
      intent.redirectUri !== redirectUri
    ) {
      throw new Error("Device auth link intent response is invalid");
    }
    const authUrl = buildDeviceAuthUrl({
      portalUrl,
      state,
      codeChallenge,
      redirectUri,
      provider,
      mode: "link",
      linkIntent: intent.linkIntent,
    });
    console.log(
      `Opening browser to link ${provider ?? "provider"}: ${authUrl}`,
    );
    await openBrowser(authUrl);
    console.log("Waiting for browser authentication...");
    const { code } = await callback;
    const exchange = await requestJson<DeviceProviderCredentialResult>(
      fetchImpl,
      joinUrl(portalUrl, "/v1/account/device-auth/exchange"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          state,
          codeVerifier: verifier,
          redirectUri,
        }),
      },
      "Device auth link exchange",
    );
    return {
      ...exchange,
      provider:
        exchange.provider === "privy" || exchange.provider === "para"
          ? exchange.provider
          : provider,
    };
  } finally {
    await closeServer(server);
  }
}

export function buildDeviceAuthUrl(input: {
  portalUrl: string;
  state: string;
  codeChallenge: string;
  redirectUri: string;
  provider?: DeviceAuthProvider;
  mode?: "login" | "link";
  linkIntent?: string;
}): string {
  const url = new URL(joinUrl(input.portalUrl, "/device-auth"));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("redirect_uri", input.redirectUri);
  if (input.provider) url.searchParams.set("provider", input.provider);
  if (input.mode && input.mode !== "login") {
    url.searchParams.set("mode", input.mode);
  }
  if (input.linkIntent) url.searchParams.set("link_intent", input.linkIntent);
  return url.toString();
}

async function createLoopbackCallback(input: {
  state: string;
  timeoutMs: number;
}): Promise<{
  server: Server;
  redirectUri: string;
  callback: Promise<{ code: string }>;
}> {
  let settle!: (value: { code: string }) => void;
  let fail!: (reason?: unknown) => void;
  const callback = new Promise<{ code: string }>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      fail(new Error("Timed out waiting for browser authentication"));
    }
  }, input.timeoutMs);

  const server = createServer((req, res) => {
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error");
      if (error) {
        throw new Error(error);
      }
      if (state !== input.state) {
        throw new Error("Invalid browser auth state");
      }
      if (!code) {
        throw new Error("Missing browser auth code");
      }
      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          "<!doctype html><title>Aomi CLI login complete</title><body>Authentication complete. You can close this window.</body>",
        );
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        settle({ code });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth failed";
      res
        .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        .end(message);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fail(error);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    callback,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function openUrlInBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}
