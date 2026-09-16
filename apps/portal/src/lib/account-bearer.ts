"use client";

import {
  AccountCredentialUnavailableError,
  createAccountBearerProvider,
  type AccountBearerProvider,
} from "@aomi-labs/client";
import type { AomiWalletKit } from "@aomi-labs/widget-lib";
import { getBackendUrl } from "./settings-api";

type GetAccountCredential = AomiWalletKit["getAccountCredential"];

/**
 * Build the client-side AccountBearer provider the portal attaches to backend
 * requests — but ONLY when the browser talks to the backend cross-origin
 * (direct-to-backend mode).
 *
 * In the same-origin BFF proxy configuration (`NEXT_PUBLIC_BACKEND_URL=/`, the
 * shipped default) the proxy mints the AccountBearer server-side from the
 * `better-auth.session_token` cookie and strips any incoming `Authorization`
 * header, so a client-side token provider is pure dead weight — it just adds
 * latency and spams `/v1/account/bearer` with 401s before sign-in completes.
 * There we return `null` and let the session cookie do the work.
 *
 * When the backend is a different origin the browser must carry the bearer
 * itself, so we return a real provider (minting via the same-origin
 * `/v1/account/bearer`, hence `betterAuthToken.baseUrl: ""`).
 */
export function createPortalAccountBearerProvider(
  getAccountCredential: GetAccountCredential,
  options?: { fetch?: typeof fetch },
): AccountBearerProvider | null {
  if (!isCrossOriginBackend()) {
    return null;
  }

  return createAccountBearerProvider({
    baseUrl: getBackendUrl(),
    betterAuthToken: { baseUrl: "" },
    ...(options?.fetch ? { fetch: options.fetch } : {}),
    getProviderCredential: async () => {
      if (!getAccountCredential) {
        throw new AccountCredentialUnavailableError();
      }
      const credential = await getAccountCredential();
      if (!credential) {
        throw new AccountCredentialUnavailableError(
          "Wallet provider is connected without an exchangeable credential",
        );
      }
      return credential;
    },
  });
}

/**
 * True only when the configured backend is a different origin than the page —
 * i.e. the browser bypasses the same-origin BFF proxy. Same-origin (`""`, `"/"`,
 * or a relative path) and SSR both resolve to `false`.
 */
function isCrossOriginBackend(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const backendUrl = getBackendUrl();
  if (!backendUrl || backendUrl === "/") {
    return false;
  }
  try {
    return (
      new URL(backendUrl, window.location.href).origin !==
      window.location.origin
    );
  } catch {
    return false;
  }
}
