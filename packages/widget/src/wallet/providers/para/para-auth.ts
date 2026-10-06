"use client";

import {
  useAccount as useParaAccount,
  useClient as useParaClient,
  useLogout,
  useModal,
  type TOAuthMethod,
} from "@getpara/react-sdk";
import type ParaWeb from "@getpara/react-sdk";
import type {
  AomiAccountCredential,
  AomiAccountCredentialOptions,
  AomiLoginMethod,
} from "../../types";

export type ParaAccountShape = {
  isLoading: boolean;
  isConnected: boolean;
  /** Kept for Para SDK versions that still expose the deprecated top-level id. */
  userId?: string;
  embedded: {
    userId?: string;
    email?: string;
    farcasterUsername?: string;
    telegramUserId?: string;
    authMethods?: Set<unknown>;
    wallets?: Array<{
      id?: string;
      address?: string;
      chainId?: number | string;
      type?: string;
      walletType?: string;
      isExternal?: boolean;
    }>;
  };
  external: {
    evm?: {
      address?: string;
      chainId?: number | string;
    };
    solana?: {
      publicKey?: unknown;
      address?: string;
      name?: string;
    };
  };
};

export const DISCONNECTED_PARA_ACCOUNT: ParaAccountShape = {
  isLoading: false,
  isConnected: false,
  embedded: {},
  external: {},
};

export const defaultOAuthMethods: TOAuthMethod[] = ["GOOGLE"];
const ISSUE_JWT_FAILURE_COOLDOWN_MS = 30_000;

type ParaJwtClient = {
  userId?: string;
  issueJwt: (args?: { keyIndex?: number }) => Promise<{
    token?: string;
    keyId?: string;
  }>;
};

/**
 * Resolve the stable Para subject used as the widget-session cache-partition
 * key (`${provider}:${subject}`).
 *
 * Tradeoff: when this returns `undefined` (the SDK reports a connected session
 * but has not yet surfaced a stable user id), the widget-session provider in
 * `@aomi-labs/client` falls back to the coarse `${provider}:authenticated-session`
 * fingerprint. On a shared browser that coarse key can briefly collide across
 * users if a previous SDK session expires without an explicit `signOut`. That
 * window is bounded — the Portal re-verifies the provider credential before
 * issuing any widget session, so a stale fingerprint never grants access — but
 * we prefer a real subject whenever the SDK exposes one. `embedded.userId` is
 * the current SDK field; `account.userId`/`paraClient.userId` cover older SDKs.
 */
export function resolveParaSubject(
  account: ParaAccountShape,
  paraClient: Pick<ParaJwtClient, "userId"> | null,
): string | undefined {
  const value =
    account.embedded.userId ?? account.userId ?? paraClient?.userId ?? "";
  return value.trim() || undefined;
}

export function useSafeParaAccount(): ParaAccountShape {
  try {
    return useParaAccount() as ParaAccountShape;
  } catch {
    return DISCONNECTED_PARA_ACCOUNT;
  }
}

export function useSafeParaModal(): {
  openModal: (args?: { step?: string }) => void;
} | null {
  try {
    return useModal() as { openModal: (args?: { step?: string }) => void };
  } catch {
    return null;
  }
}

export function useSafeParaClient(): ParaWeb | null {
  try {
    return useParaClient() ?? null;
  } catch {
    return null;
  }
}

export function createParaCredentialGetter(
  paraClient: ParaJwtClient | null,
):
  | ((
      options?: AomiAccountCredentialOptions,
    ) => Promise<AomiAccountCredential | null>)
  | null {
  if (!paraClient || typeof paraClient.issueJwt !== "function") return null;
  // Cooldown/in-flight state is scoped to this getter (one per plugin/adapter
  // instance) instead of module-level, so several widget instances mounted on
  // the same page each keep their own JWT-issuance backoff and never share or
  // clobber one another's cooldown window.
  //
  // The cooldown protects polling widgets. A one-shot login handoff passes
  // `fresh: true` to ask Para again right away: right after the modal reports
  // authentication `issueJwt` can 403 for a few seconds, and a 30-second
  // backoff there would outlast the handoff page's own deadline.
  let issueJwtUnavailableUntil = 0;
  let issueJwtInFlight: Promise<AomiAccountCredential | null> | null = null;
  return async (options) => {
    const now = Date.now();
    if (!options?.fresh && now < issueJwtUnavailableUntil) {
      return null;
    }
    if (issueJwtInFlight) {
      return issueJwtInFlight;
    }
    issueJwtInFlight = (async () => {
      let result: { token?: string; keyId?: string } | null | undefined;
      try {
        result = await paraClient.issueJwt({});
      } catch (error) {
        if (isParaJwtUnavailableError(error)) {
          issueJwtUnavailableUntil = Date.now() + ISSUE_JWT_FAILURE_COOLDOWN_MS;
          return null;
        }
        throw error;
      } finally {
        issueJwtInFlight = null;
      }
      const token = result?.token?.trim();
      return token
        ? {
            provider: "para",
            tokenKind: "session_jwt",
            providerToken: token,
            keyId: result?.keyId,
          }
        : null;
    })();
    return issueJwtInFlight;
  };
}

/**
 * Single discriminator for "Para could not issue a JWT right now, back off"
 * (auth not established / transient transport failure) versus a real error that
 * should propagate. Prefer robust signals first — an HTTP 401/403 status or the
 * SDK's `ParaApiError` class name. The message-substring matching below is a
 * deliberate last resort: the Para SDK surfaces some transport failures as a
 * bare `Error` with only a message string and no status/code, so this is the
 * only available signal for those. Keep all such sniffing isolated here.
 */
function isParaJwtUnavailableError(error: unknown): boolean {
  const candidate = error as
    | {
        name?: unknown;
        message?: unknown;
        status?: unknown;
        response?: { status?: unknown };
      }
    | undefined;
  const status = candidate?.status ?? candidate?.response?.status;
  if (status === 401 || status === 403) return true;
  if (candidate?.name === "ParaApiError") return true;
  const message = String(candidate?.message ?? "").toLowerCase();
  return (
    message.includes("unknown error") ||
    message.includes("network error") ||
    message.includes("failed to fetch") ||
    message.includes("cors")
  );
}

export function useSafeLogout(): (() => Promise<void>) | null {
  try {
    const { logoutAsync } = useLogout();
    return async () => {
      await logoutAsync();
    };
  } catch {
    return null;
  }
}

export function resolveParaAuthValue(
  embedded: ParaAccountShape["embedded"],
  authMethod: AomiLoginMethod | undefined,
): string | undefined {
  if (authMethod === "telegram") {
    return embedded.telegramUserId;
  }
  if (authMethod === "farcaster") {
    return embedded.farcasterUsername;
  }
  if (!authMethod || authMethod === "wagmi") {
    return undefined;
  }
  return embedded.email;
}
