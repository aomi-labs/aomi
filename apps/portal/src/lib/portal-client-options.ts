/**
 * The portal's runtime fetch stack, extracted from the frame shell so the
 * component file stays presentational.
 *
 * The routed fetch handles debug logging and locked-agent query scoping. The
 * x402 signer is passed separately so the shared client owns payment retries.
 * Requests are same-origin: the Edge attaches the account credential.
 */

import { type AomiClientOptions } from "@aomi-labs/client";
import { useEffect, useMemo, useState } from "react";
import {
  createWidgetX402Client,
  useAomiWalletKit,
} from "@aomi-labs/widget/host-composition";

export type RequestedAgentConfig = { agent: string | null; locked: boolean };

export function getRequestedAgentConfig(search: string): RequestedAgentConfig {
  const params = new URLSearchParams(search);
  return {
    agent: params.get("agent")?.trim() || null,
    locked: params.get("lock_agent") === "1",
  };
}

export function useRequestedAgentConfig(): RequestedAgentConfig {
  const [config, setConfig] = useState<RequestedAgentConfig>({
    agent: null,
    locked: false,
  });
  useEffect(() => {
    setConfig(getRequestedAgentConfig(window.location.search));
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

export function usePortalClientOptions():
  | Omit<AomiClientOptions, "baseUrl">
  | undefined {
  const nativeFetch = useMemo(() => globalThis.fetch.bind(globalThis), []);
  const {
    identity,
    signTypedData,
    switchChain: switchWalletChain,
  } = useAomiWalletKit();

  const paymentClient = useMemo(
    () =>
      createWidgetX402Client({
        identity,
        signTypedData,
        switchChain: switchWalletChain,
      }),
    [identity, signTypedData, switchWalletChain],
  );

  return useMemo(() => {
    const rawFetch = withDebugLogging("native.fetch", nativeFetch);
    return {
      fetch: rawFetch,
      x402: paymentClient,
    };
  }, [nativeFetch, paymentClient]);
}
