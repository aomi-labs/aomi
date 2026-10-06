import {
  AomiClient,
  type AomiHttpMethod,
  type GetAccountBearer,
  apiErrorFields,
} from "@aomi-labs/client";
import type { AomiAccountCredential } from "../types";
import type { SvmCluster } from "../types";
import type {
  AccountConflictSignal,
  AccountRuntime,
  AccountWallet,
} from "./types";

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
      getAuthorization: GetAccountBearer;
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

export class AomiAccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly signalType: AccountConflictSignal | null = null,
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
  const fetchImpl = input.fetch ?? fetch;
  const endpoints = { ...DEFAULT_ENDPOINTS, ...(input.endpoints ?? {}) };
  const auth = input.auth ?? { credentials: "include" as const };
  // The client's auth layer attaches the widget token and retries a 401 once
  // with a refreshed one.
  const client = new AomiClient({
    baseUrl: input.baseUrl?.replace(/\/+$/, "") ?? "",
    guest: false,
    fetch: (url, init) =>
      fetchImpl(url, { ...init, credentials: auth.credentials ?? "include" }),
    getAccountBearer:
      auth.credentials === "omit"
        ? Object.assign(
            (options?: Parameters<GetAccountBearer>[0]) =>
              auth.getAuthorization(options),
            { required: true as const },
          )
        : undefined,
  });
  const send = async (method: AomiHttpMethod, path: string, body?: unknown) => {
    const response = await client.requestResponse(method, path, {
      body,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const { code, message } = apiErrorFields(error);
      throw new AomiAccountRequestError(
        response.status,
        code ?? message ?? null,
        extractConflictSignal(error),
      );
    }
    return response;
  };
  // Endpoints that always answer with JSON; an empty success is a broken contract.
  const request = async <T>(
    method: AomiHttpMethod,
    path: string,
    body?: unknown,
  ) => {
    const response = await send(method, path, body);
    const text =
      response.status === 204 || response.status === 205
        ? ""
        : await response.text();
    if (!text.trim()) throw new Error("Account request returned no content");
    return JSON.parse(text) as T;
  };
  const requestVoid = async (
    method: AomiHttpMethod,
    path: string,
    body?: unknown,
  ) => {
    await send(method, path, body);
  };

  return {
    getAccount: () =>
      request<AomiBackendAccountResponse>("GET", endpoints.accountPath),
    updateAccount: (body: {
      displayName?: string | null;
      avatarUrl?: string | null;
    }) =>
      request<AomiBackendAccountResponse>("PATCH", endpoints.accountPath, body),
    deleteAccount: () =>
      request<AomiBackendDeleteAccountResponse>(
        "DELETE",
        endpoints.accountPath,
      ),
    signOut: () => requestVoid("POST", endpoints.signOutPath, {}),
    exchangeProviderCredential: (
      credential: AomiAccountCredential,
      options: { hasAccount: boolean },
    ) =>
      request<AomiBackendProviderExchangeResponse>(
        "POST",
        options.hasAccount
          ? endpoints.existingSessionProviderExchangePath
          : endpoints.newSessionProviderExchangePath,
        credential,
      ),
    getWalletLinkNonce: (input: { address: string; chainId: number }) =>
      request<AomiBackendNonceResponse>(
        "GET",
        `${endpoints.walletLinkPath}?${new URLSearchParams({
          address: input.address,
          chainId: String(input.chainId),
        })}`,
      ),
    linkWallet: (body: unknown) =>
      request<AomiBackendLinkWalletResponse>(
        "POST",
        endpoints.walletLinkPath,
        body,
      ),
    updateWallet: (walletId: string, body: { label?: string | null }) =>
      requestVoid("PATCH", endpoints.walletPath(walletId), body),
    updateAuthIdentity: (
      identityId: string,
      body: { displayLabel?: string | null },
    ) => requestVoid("PATCH", endpoints.identityPath(identityId), body),
    unlinkWallet: (walletId: string) =>
      requestVoid("DELETE", endpoints.walletPath(walletId)),
    unlinkAuthIdentity: (identityId: string) =>
      requestVoid("DELETE", endpoints.identityPath(identityId)),
    createSiweNonce: () =>
      request<AomiBackendNonceResponse>("POST", endpoints.siweNoncePath, {}),
    verifySiwe: (body: { message: string; signature: string }) =>
      requestVoid("POST", endpoints.siweVerifyPath, body),
    createSiwsNonce: (body: {
      walletAddress: string;
      chainId: SvmCluster;
      intent: "sign-in" | "link";
    }) =>
      request<AomiBackendNonceResponse>("POST", endpoints.siwsNoncePath, body),
    verifySiws: (body: {
      message: string;
      signature: string;
      walletAddress: string;
      chainId: SvmCluster;
      intent: "sign-in" | "link";
      label?: string;
    }) => requestVoid("POST", endpoints.siwsVerifyPath, body),
  };
}

function extractConflictSignal(error: unknown): AccountConflictSignal | null {
  if (!error || typeof error !== "object" || !("signalType" in error)) {
    return null;
  }
  const value = (error as { signalType: unknown }).signalType;
  return value === "wallet" || value === "identity" || value === "email"
    ? value
    : null;
}

const CONFLICT_MESSAGES: Record<AccountConflictSignal, string> = {
  wallet:
    "This wallet belongs to another Aomi account. Sign in another way to open that account, then unlink the wallet there.",
  identity:
    "This sign-in method belongs to another Aomi account. Sign in another way to open that account.",
  email:
    "This email belongs to another Aomi account. Sign in another way to open that account.",
};

function formatAccountRequestError(
  status: number,
  code: string | null,
  signalType: AccountConflictSignal | null,
): string {
  if (status === 409 && code === "already_linked_to_another_account") {
    return (
      (signalType ? CONFLICT_MESSAGES[signalType] : undefined) ??
      "This wallet or sign-in method belongs to another Aomi account. Sign in another way to open that account."
    );
  }
  return code ?? `Request failed: ${status}`;
}
