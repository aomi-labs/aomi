import type { AomiAccountCredential } from "../types";
import type { SvmCluster } from "../types";
import type { AccountRuntime, AccountWallet } from "./types";

export type AomiBackendAccountResponse = {
  /** A temporary Better Auth guest. It is intentionally not an account owner. */
  guest?: boolean;
  user: AccountRuntime["user"] | null;
  linkedAccounts: AccountRuntime["linkedAccounts"];
  wallets: AccountWallet[];
  session:
    | {
        carrier: "better_auth";
        betterAuthUserId: string;
        expiresAt?: number;
      }
    | {
        carrier: "widget";
        expiresAt: number;
        authMethod: string;
      }
    | null;
};

export type AomiBackendAccountAuth =
  | { credentials?: "include" }
  | {
      credentials: "omit";
      getAuthorization: import("@aomi-labs/client").GetAccountBearer;
    };

export type AomiBackendProviderExchangeResponse = {
  status: "linked" | "noop";
  account?: AomiBackendAccountResponse;
};

export type AomiBackendLinkWalletResponse = {
  status: "linked" | "noop";
  account?: AomiBackendAccountResponse;
};

export type AomiBackendDeleteAccountResponse = {
  status: "deactivated";
  revokedIdentities: number;
  revokedWallets: number;
};

export type AomiBackendNonceResponse = {
  nonce: string;
  domain?: string;
  uri?: string;
};

/** Which signal the backend refused to move between accounts. */
export type AomiAccountConflictSignal = "wallet" | "identity" | "email";

export class AomiAccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly signalType: AomiAccountConflictSignal | null = null,
  ) {
    super(formatAccountRequestError(status, code, signalType));
    this.name = "AomiAccountRequestError";
  }
}

export type AomiBackendAccountEndpointConfig = Partial<{
  accountPath: string;
  signOutPath: string;
  existingSessionProviderExchangePath: string;
  newSessionProviderExchangePath: string;
  walletLinkPath: string;
  walletPath: (walletId: string) => string;
  identityPath: (identityId: string) => string;
  siweNoncePath: string;
  siweVerifyPath: string;
  siwsNoncePath: string;
  siwsVerifyPath: string;
}>;

const DEFAULT_ENDPOINTS = {
  accountPath: "/v1/account",
  signOutPath: "/api/auth/sign-out",
  existingSessionProviderExchangePath: "/v1/account/provider/exchange",
  newSessionProviderExchangePath: "/api/auth/aomi/provider/exchange",
  walletLinkPath: "/v1/account/wallets/link",
  walletPath: (walletId: string) =>
    `/v1/account/wallets/${encodeURIComponent(walletId)}`,
  identityPath: (identityId: string) =>
    `/v1/account/identities/${encodeURIComponent(identityId)}`,
  siweNoncePath: "/api/auth/siwe/nonce",
  siweVerifyPath: "/api/auth/siwe/verify",
  siwsNoncePath: "/api/auth/siws/nonce",
  siwsVerifyPath: "/api/auth/siws/verify",
} satisfies Required<AomiBackendAccountEndpointConfig>;

export function createAomiBackendAccountClient(input: {
  baseUrl?: string;
  endpoints?: AomiBackendAccountEndpointConfig;
  fetch?: typeof fetch;
  auth?: AomiBackendAccountAuth;
}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fetchImpl = input.fetch ?? fetch;
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(input.endpoints ?? {}) };
  const auth = input.auth ?? { credentials: "include" as const };

  const urlFor = (path: string) => `${baseUrl}${path}`;
  // `request` is for endpoints that always return a JSON body; `requestVoid` is
  // for no-content mutations. Keeping them separate lets each return an honest
  // type instead of casting an empty response to `T`.
  const request = <T>(path: string, init: RequestInit) =>
    fetchJson<T>(fetchImpl, urlFor(path), init, auth);
  const requestVoid = (path: string, init: RequestInit) =>
    fetchVoid(fetchImpl, urlFor(path), init, auth);

  return {
    getAccount: () =>
      request<AomiBackendAccountResponse>(endpoints.accountPath, {
        method: "GET",
      }),
    updateAccount: (body: {
      displayName?: string | null;
      avatarUrl?: string | null;
    }) =>
      request<AomiBackendAccountResponse>(endpoints.accountPath, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deleteAccount: () =>
      request<AomiBackendDeleteAccountResponse>(endpoints.accountPath, {
        method: "DELETE",
      }),
    signOut: () =>
      requestVoid(endpoints.signOutPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    exchangeProviderCredential: (
      credential: AomiAccountCredential,
      options: { hasAccount: boolean },
    ) =>
      request<AomiBackendProviderExchangeResponse>(
        options.hasAccount
          ? endpoints.existingSessionProviderExchangePath
          : endpoints.newSessionProviderExchangePath,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credential),
        },
      ),
    getWalletLinkNonce: (input: { address: string; chainId: number }) => {
      const params = new URLSearchParams({
        address: input.address,
        chainId: String(input.chainId),
      });
      return request<AomiBackendNonceResponse>(
        `${endpoints.walletLinkPath}?${params.toString()}`,
        { method: "GET" },
      );
    },
    linkWallet: (body: unknown) =>
      request<AomiBackendLinkWalletResponse>(endpoints.walletLinkPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateWallet: (walletId: string, body: { label?: string | null }) =>
      requestVoid(endpoints.walletPath(walletId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateAuthIdentity: (
      identityId: string,
      body: { displayLabel?: string | null },
    ) =>
      requestVoid(endpoints.identityPath(identityId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    unlinkWallet: (walletId: string) =>
      requestVoid(endpoints.walletPath(walletId), { method: "DELETE" }),
    unlinkAuthIdentity: (identityId: string) =>
      requestVoid(endpoints.identityPath(identityId), { method: "DELETE" }),
    createSiweNonce: () =>
      request<AomiBackendNonceResponse>(endpoints.siweNoncePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    verifySiwe: (body: { message: string; signature: string }) =>
      requestVoid(endpoints.siweVerifyPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    createSiwsNonce: (body: {
      walletAddress: string;
      chainId: SvmCluster;
      intent: "sign-in" | "link";
    }) =>
      request<AomiBackendNonceResponse>(endpoints.siwsNoncePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    verifySiws: (body: {
      message: string;
      signature: string;
      walletAddress: string;
      chainId: SvmCluster;
      intent: "sign-in" | "link";
      label?: string;
    }) =>
      requestVoid(endpoints.siwsVerifyPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

async function sendAccountRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  auth: AomiBackendAccountAuth,
): Promise<Response> {
  const execute = async (forceRefresh: boolean) => {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (auth.credentials === "omit") {
      const authorization = await auth.getAuthorization({ forceRefresh });
      if (!authorization)
        throw new Error("Widget authorization is unavailable");
      headers.set("Authorization", `Bearer ${authorization}`);
    }
    return fetchImpl(url, {
      ...init,
      credentials: auth.credentials ?? "include",
      headers,
    });
  };
  let response = await execute(false);
  if (response.status === 401 && auth.credentials === "omit") {
    response = await execute(true);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const code = extractErrorCode(error);
    throw new AomiAccountRequestError(
      response.status,
      code,
      extractConflictSignal(error),
    );
  }
  return response;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  auth: AomiBackendAccountAuth,
): Promise<T> {
  const response = await sendAccountRequest(fetchImpl, url, init, auth);
  // These endpoints always return a JSON body on success; an empty response is
  // a contract violation, so surface it instead of casting `undefined` to `T`.
  if (response.status === 204 || response.status === 205) {
    throw new Error("Account request returned no content");
  }
  const body = await response.text();
  if (!body.trim()) {
    throw new Error("Account request returned an empty body");
  }
  return JSON.parse(body) as T;
}

async function fetchVoid(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  auth: AomiBackendAccountAuth,
): Promise<void> {
  await sendAccountRequest(fetchImpl, url, init, auth);
}

function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if ("error" in error && error.error) return String(error.error);
  if ("message" in error && error.message) return String(error.message);
  return null;
}

function extractConflictSignal(
  error: unknown,
): AomiAccountConflictSignal | null {
  if (!error || typeof error !== "object" || !("signalType" in error)) {
    return null;
  }
  const value = (error as { signalType: unknown }).signalType;
  return value === "wallet" || value === "identity" || value === "email"
    ? value
    : null;
}

const CONFLICT_MESSAGES: Record<AomiAccountConflictSignal, string> = {
  wallet:
    "This wallet address is already linked to another Aomi account. Sign in to that account, unlink the wallet there, then return here and link it.",
  identity:
    "This sign-in method is already linked to another Aomi account. Sign in to that account, unlink it there, then return here and link it.",
  email:
    "This email is already linked to another Aomi account. Sign in to that account, unlink it there, then return here and link it.",
};

function formatAccountRequestError(
  status: number,
  code: string | null,
  signalType: AomiAccountConflictSignal | null,
): string {
  if (status === 409 && code === "already_linked_to_another_account") {
    return (
      (signalType ? CONFLICT_MESSAGES[signalType] : undefined) ??
      "This wallet or sign-in method is already linked to another Aomi account. Sign in to that account, unlink it there, then return here and link it."
    );
  }
  return code ?? `Request failed: ${status}`;
}

function normalizeBaseUrl(baseUrl?: string): string {
  return baseUrl?.replace(/\/+$/, "") ?? "";
}
