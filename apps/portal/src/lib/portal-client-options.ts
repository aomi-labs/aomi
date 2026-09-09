"use client";

/**
 * The portal's runtime fetch stack, extracted from the frame shell so the
 * component file stays presentational.
 *
 * The routed fetch handles debug logging and locked-app query scoping. The
 * x402 signer and AccountBearer provider are passed separately so the shared
 * client owns payment retries and recovery probes.
 */

import { useEffect, useMemo, useState } from "react";
import { type AomiClientOptions } from "@aomi-labs/react";
import type { AomiInferenceFundingSource } from "@aomi-labs/client";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import { createPortalAccountBearerProvider } from "@portal/lib/account-bearer";
import { createPortalX402Client } from "@portal/lib/payment-fetch";

export type RequestedAppConfig = {
  app: string | null;
  applicationId: string | null;
  locked: boolean;
  inferenceFunding: AomiInferenceFundingSource | undefined;
};

export function getRequestedAppConfig(search: string): RequestedAppConfig {
  const params = new URLSearchParams(search);
  let app: string | null = null;

  for (const key of ["aomi_app", "app"] as const) {
    const value = params.get(key)?.trim();
    if (value) {
      app = value;
      break;
    }
  }

  return {
    app,
    applicationId:
      params.get("application_id")?.trim() ||
      params.get("applicationId")?.trim() ||
      null,
    locked:
      params.get("lock_app") === "1" ||
      params.get("lock_app") === "true" ||
      params.get("app_locked") === "1" ||
      params.get("app_locked") === "true",
    inferenceFunding: parseInferenceFunding(
      params.get("inference_funding") ?? params.get("funding"),
    ),
  };
}

function parseInferenceFunding(
  value: string | null,
): AomiInferenceFundingSource | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "user_byok" ? normalized : undefined;
}

export function useRequestedAppConfig(): RequestedAppConfig {
  const [config, setConfig] = useState<RequestedAppConfig>({
    app: null,
    applicationId: null,
    locked: false,
    inferenceFunding: undefined,
  });

  useEffect(() => {
    setConfig(getRequestedAppConfig(window.location.search));
  }, []);

  return config;
}

export function withDebugLogging(
  fetchName: string,
  fetchImpl: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const normalizeLocalhostUrl = (value: string) => {
      try {
        // Keep requests same-origin as the page. Rewriting the host (e.g.
        // localhost → 127.0.0.1) drops the httpOnly `aomi_session` cookie,
        // which is host-scoped to wherever the user logged in — so the proxy
        // can't inject the AccountBearer and session routes 401.
        return new URL(value, window.location.href).toString();
      } catch {
        return value;
      }
    };
    const url = normalizeLocalhostUrl(rawUrl);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const startedAt = Date.now();
    console.debug("[aomi][portal-fetch] start", {
      fetchName,
      method,
      url,
    });

    const pendingWarning = setTimeout(() => {
      console.debug("[aomi][portal-fetch] still pending", {
        fetchName,
        method,
        url,
        pendingMs: Date.now() - startedAt,
      });
    }, 5000);

    try {
      // Request inputs pass through untouched: their URL is already absolute,
      // and rebuilding via `new Request(url, request)` treats the Request as
      // a RequestInit — the buffered body comes back as a ReadableStream,
      // which Chrome only sends over HTTP/2 (plain-http localhost fails ALPN
      // and intercepted bodies read as empty).
      const normalizedInput =
        typeof input === "string"
          ? url
          : input instanceof URL
            ? new URL(url)
            : input;
      const response = await fetchImpl(normalizedInput, init);
      clearTimeout(pendingWarning);
      console.debug("[aomi][portal-fetch] response", {
        fetchName,
        method,
        url,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      clearTimeout(pendingWarning);
      console.error("[aomi][portal-fetch] failed", {
        fetchName,
        method,
        url,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  };
}

function parseUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") {
      return new URL(input, window.location.href);
    }
    if (input instanceof URL) {
      return input;
    }
    return new URL(input.url, window.location.href);
  } catch {
    return null;
  }
}

/** Pin `?app=` / `?application_id=` on the send-path routes of a locked app. */
export async function applyLockedAppScope(
  input: RequestInfo | URL,
  lockedApp: string | null,
  lockedApplicationId: string | null,
): Promise<RequestInfo | URL> {
  if (!lockedApp) {
    return input;
  }
  const url = parseUrl(input);
  if (!url || !["/v1/agent/chat", "/api/thread/model"].includes(url.pathname)) {
    return input;
  }
  url.searchParams.set("app", lockedApp);
  if (lockedApplicationId) {
    url.searchParams.set("application_id", lockedApplicationId);
  }
  if (typeof input === "string") {
    return url.toString();
  }
  if (input instanceof URL) {
    return url;
  }
  // Rebuild the Request on the pinned URL field by field: `new Request(url,
  // request)` would treat the Request as a RequestInit and turn its buffered
  // body into a ReadableStream (see the normalizedInput note above).
  return new Request(url, {
    method: input.method,
    headers: input.headers,
    body: input.body ? await input.clone().arrayBuffer() : undefined,
    mode: input.mode === "navigate" ? undefined : input.mode,
    credentials: input.credentials,
    cache: input.cache,
    redirect: input.redirect,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    integrity: input.integrity,
    keepalive: input.keepalive,
    signal: input.signal,
  });
}

export function usePortalClientOptions(
  lockedApp: string | null,
  lockedApplicationId: string | null,
): Omit<AomiClientOptions, "baseUrl"> | undefined {
  const nativeFetch = useMemo(() => globalThis.fetch.bind(globalThis), []);
  const {
    getAccountCredential,
    identity,
    signTypedData,
    switchChain: switchWalletChain,
  } = useAomiWalletKit();

  const accountAccessTokenProvider = useMemo(() => {
    return createPortalAccountBearerProvider(getAccountCredential, {
      fetch: nativeFetch,
    });
  }, [getAccountCredential, nativeFetch]);

  useEffect(
    () => () => {
      accountAccessTokenProvider?.dispose();
    },
    [accountAccessTokenProvider],
  );

  const paymentClient = useMemo(
    () =>
      createPortalX402Client({
        identity,
        signTypedData,
        switchChain: switchWalletChain,
      }),
    [identity, signTypedData, switchWalletChain],
  );

  return useMemo(() => {
    const rawFetch = withDebugLogging("native.fetch", nativeFetch);
    const routedFetch: typeof fetch = async (input, init) => {
      return rawFetch(
        await applyLockedAppScope(input, lockedApp, lockedApplicationId),
        init,
      );
    };

    return {
      fetch: routedFetch,
      x402: paymentClient,
      getAccountBearer: accountAccessTokenProvider ?? undefined,
    };
  }, [
    accountAccessTokenProvider,
    lockedApp,
    lockedApplicationId,
    nativeFetch,
    paymentClient,
  ]);
}
