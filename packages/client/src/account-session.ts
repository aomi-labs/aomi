import type { GetAccountBearer } from "./types";
import type { ProviderCredential } from "./widget-session";
import { joinUrl } from "./internal/url";
import { decodeBase64Url } from "./internal/encoding";

/**
 * Structurally identical to {@link ProviderCredential}; aliased so the widget
 * and account credential shapes cannot drift within `@aomi-labs/client`.
 */
export type AccountCredentialProvider = () => Promise<ProviderCredential>;

export class AccountCredentialUnavailableError extends Error {
  constructor(message = "Account credential is not available yet") {
    super(message);
    this.name = "AccountCredentialUnavailableError";
  }
}

export type AccountSessionExchangeResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_at: number;
  user_id: string;
};

export type BetterAuthTokenResponse = {
  /** Aomi AccountBearer shape from /v1/account/bearer. */
  bearer?: string;
  expires_at?: number;
  expiresAt?: number;
  user_id?: string;
  userId?: string;
};

export type BetterAuthAccountTokenSourceOptions = {
  /** Portal/auth origin. Defaults to `baseUrl` when omitted. */
  baseUrl?: string;
  /**
   * When enabled, a missing Better Auth cookie can be created by exchanging the
   * connected wallet provider credential. Disable this when another account
   * runtime already owns provider exchange to avoid duplicate wallet prompts.
   */
  providerExchange?: boolean;
};

export type AccountBearerProviderOptions = {
  baseUrl: string;
  getProviderCredential?: AccountCredentialProvider;
  betterAuthToken?: BetterAuthAccountTokenSourceOptions;
  fetch?: typeof fetch;
  now?: () => number;
  refreshBeforeExpiryMs?: number;
};

export type AccountBearerProvider = GetAccountBearer & {
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

const DEFAULT_REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const CREDENTIAL_UNAVAILABLE_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;
const EXPIRES_AT_MILLISECONDS_THRESHOLD = 100_000_000_000;
const DEFAULT_BETTER_AUTH_TOKEN_PATH = "/v1/account/bearer";
const DEFAULT_BETTER_AUTH_PROVIDER_EXCHANGE_PATH =
  "/api/auth/aomi/provider/exchange";

/** Cache and refresh the short-lived Aomi bearer used for backend requests. */
export function createAccountBearerProvider({
  baseUrl,
  getProviderCredential,
  betterAuthToken,
  fetch: fetchImpl = fetch,
  now = Date.now,
  refreshBeforeExpiryMs = DEFAULT_REFRESH_BEFORE_EXPIRY_MS,
}: AccountBearerProviderOptions): AccountBearerProvider {
  let cached: AccountSessionExchangeResponse | null = null;
  let pending: Promise<AccountSessionExchangeResponse | null> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let failedAt: number | null = null;
  let credentialUnavailableRetryAfter = 0;
  let credentialUnavailableRetryCount = 0;
  const listeners = new Set<() => void>();

  const scheduleRefresh = (session: AccountSessionExchangeResponse) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const refreshAt = session.expires_at * 1000 - refreshBeforeExpiryMs;
    refreshTimer = setTimeout(
      () => {
        void getAccountBearer({ forceRefresh: true }).catch(() => undefined);
      },
      Math.max(refreshAt - now(), 1000),
    );
  };

  const fetchBetterAuthToken =
    async (): Promise<AccountSessionExchangeResponse | null> => {
      const response = await fetchImpl(
        joinUrl(
          betterAuthToken?.baseUrl ?? baseUrl,
          DEFAULT_BETTER_AUTH_TOKEN_PATH,
        ),
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as BetterAuthTokenResponse;
      return normalizeBetterAuthTokenResponse(body);
    };

  const exchangeBetterAuthProviderCredential =
    async (): Promise<AccountSessionExchangeResponse | null> => {
      if (
        betterAuthToken?.providerExchange === false ||
        !getProviderCredential
      ) {
        return null;
      }
      const credential = await getProviderCredential();
      const response = await fetchImpl(
        joinUrl(
          betterAuthToken?.baseUrl ?? baseUrl,
          DEFAULT_BETTER_AUTH_PROVIDER_EXCHANGE_PATH,
        ),
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(credential),
        },
      );
      if (!response.ok) return null;
      return fetchBetterAuthToken();
    };

  const exchange = async (): Promise<AccountSessionExchangeResponse> => {
    const betterAuthJwt = await fetchBetterAuthToken();
    if (betterAuthJwt) return betterAuthJwt;
    const exchangedBetterAuthJwt = await exchangeBetterAuthProviderCredential();
    if (exchangedBetterAuthJwt) return exchangedBetterAuthJwt;
    throw new Error("Failed to exchange Better Auth provider credential");
  };

  const getAccountBearer: AccountBearerProvider = async ({
    forceRefresh = false,
  } = {}) => {
    const refreshAt = cached
      ? cached.expires_at * 1000 - refreshBeforeExpiryMs
      : 0;
    if (!forceRefresh && cached && now() < refreshAt) {
      return cached.access_token;
    }
    // The account bearer is optional/additive. When the wallet provider can't
    // mint a credential yet (e.g. Para before biometric/external-wallet
    // verification 403s on issueJwt) or the exchange fails, resolve to no token
    // so the caller's request proceeds unauthenticated instead of erroring.
    // A short cooldown prevents every backend poll from re-triggering a failing
    // exchange. Callers may still force-refresh after a 401.
    if (
      failedAt !== null &&
      now() - failedAt < FAILURE_COOLDOWN_MS &&
      !forceRefresh
    ) {
      return undefined;
    }
    if (!forceRefresh && now() < credentialUnavailableRetryAfter) {
      return undefined;
    }
    if (!pending) {
      pending = exchange()
        .then((next) => {
          failedAt = null;
          credentialUnavailableRetryAfter = 0;
          credentialUnavailableRetryCount = 0;
          const previous = cached;
          cached = next;
          scheduleRefresh(next);
          if (
            previous &&
            (previous.access_token !== next.access_token ||
              previous.expires_at !== next.expires_at)
          ) {
            for (const listener of listeners) listener();
          }
          return next;
        })
        .catch((error) => {
          if (error instanceof AccountCredentialUnavailableError) {
            const retryDelay =
              CREDENTIAL_UNAVAILABLE_RETRY_DELAYS_MS[
                credentialUnavailableRetryCount
              ];
            if (retryDelay === undefined) {
              failedAt = now();
              credentialUnavailableRetryAfter = 0;
            } else {
              credentialUnavailableRetryCount += 1;
              credentialUnavailableRetryAfter = now() + retryDelay;
            }
          } else {
            failedAt = now();
            credentialUnavailableRetryAfter = 0;
            credentialUnavailableRetryCount = 0;
          }
          return null;
        })
        .finally(() => {
          pending = null;
        });
    }
    return (await pending)?.access_token;
  };

  getAccountBearer.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  getAccountBearer.dispose = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    listeners.clear();
  };
  return getAccountBearer;
}

function normalizeBetterAuthTokenResponse(
  response: BetterAuthTokenResponse,
): AccountSessionExchangeResponse {
  const token =
    typeof response.bearer === "string" && response.bearer
      ? response.bearer
      : "";
  if (!token) {
    throw new Error("Better Auth token response is missing token");
  }
  let payload: Record<string, unknown> | null = null;
  const getPayload = () => {
    payload ??= decodeJwtPayload(token);
    return payload;
  };
  const expiresAt = Number(
    response.expires_at ?? response.expiresAt ?? getPayload().exp,
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error("Better Auth token is missing a valid exp claim");
  }
  if (expiresAt > EXPIRES_AT_MILLISECONDS_THRESHOLD) {
    throw new Error("Better Auth token expires_at must be seconds, not ms");
  }
  const getPayloadUserId = () => {
    const claims = getPayload();
    if (typeof claims.aomi_user_id === "string" && claims.aomi_user_id) {
      return claims.aomi_user_id;
    }
    return typeof claims.sub === "string" ? claims.sub : "";
  };
  const userId =
    typeof response.user_id === "string" && response.user_id
      ? response.user_id
      : typeof response.userId === "string" && response.userId
        ? response.userId
        : getPayloadUserId();
  if (!userId) {
    throw new Error("Better Auth token is missing a user id claim");
  }
  return {
    access_token: token,
    token_type: "Bearer",
    expires_at: expiresAt,
    user_id: userId,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Better Auth token is not a JWT");
  return JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
}
