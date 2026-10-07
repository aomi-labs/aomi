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

/** A link proved a sign-in method of another account; confirming merges it in. */
export type MergeOffer = {
  ticket: string;
  other: {
    name: string;
    createdAt: string;
    chats: number;
    wallets: number;
    credits: string;
    /** What the other account loses because this one already has it. */
    dropped: string[];
  };
};

export type AomiBackendMergeResponse = {
  moved: { chats: number; wallets: number };
  account: AomiBackendAccountResponse;
};

export class AomiAccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly signalType: AccountConflictSignal | null = null,
    readonly mergeOffer: MergeOffer | null = null,
  ) {
    super(formatAccountRequestError(status, code, signalType));
    this.name = "AomiAccountRequestError";
  }
}

/** The merge offer carried by a failed link or provider exchange, if any. */
export function mergeOfferFrom(error: unknown): MergeOffer | null {
  return error instanceof AomiAccountRequestError ? error.mergeOffer : null;
}

export type AomiBackendAccountEndpointConfig = Partial<{
  accountPath: string;
  signOutPath: string;
  existingSessionProviderExchangePath: string;
  newSessionProviderExchangePath: string;
  walletLinkPath: string;
  mergePath: string;
  mergeSwitchPath: string;
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
  mergePath: "/v1/account/merge",
  mergeSwitchPath: "/v1/account/merge/switch",
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
        extractMergeOffer(error),
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
    /** EVM passes a numeric chain id, SVM its cluster. */
    getWalletLinkNonce: (input: {
      address: string;
      chainId: number | SvmCluster;
    }) =>
      request<AomiBackendNonceResponse>(
        "GET",
        `${endpoints.walletLinkPath}?${new URLSearchParams({
          address: input.address,
          chainId: String(input.chainId),
        })}`,
      ),
    /** A 409 here may carry a merge offer; read it with mergeOfferFrom. */
    linkWallet: (
      body:
        | WalletLinkProof<"evm", number, `0x${string}` | string>
        | WalletLinkProof<"svm", SvmCluster, string>,
    ) =>
      request<AomiBackendLinkWalletResponse>(
        "POST",
        endpoints.walletLinkPath,
        body,
      ),
    renameWallet: (walletId: string, label: string | null) =>
      requestVoid("PATCH", endpoints.walletPath(walletId), { label }),
    mergeAccount: (ticket: string) =>
      request<AomiBackendMergeResponse>("POST", endpoints.mergePath, {
        ticket,
      }),
    /** Signs this browser in to the other account instead of merging. */
    switchToMergeSource: (ticket: string) =>
      requestVoid("POST", endpoints.mergeSwitchPath, { ticket }),
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
    verifySiwe: (body: {
      message: string;
      signature: string;
      walletApp?: string;
    }) => requestVoid("POST", endpoints.siweVerifyPath, body),
    createSiwsNonce: (body: { walletAddress: string; chainId: SvmCluster }) =>
      request<AomiBackendNonceResponse>("POST", endpoints.siwsNoncePath, body),
    verifySiws: (body: {
      message: string;
      signature: string;
      walletAddress: string;
      chainId: SvmCluster;
      walletApp?: string;
    }) => requestVoid("POST", endpoints.siwsVerifyPath, body),
  };
}

type WalletLinkProof<Family, ChainId, Address> = {
  family: Family;
  address: Address;
  chainId: ChainId;
  nonce: string;
  message: string;
  signature: string;
  walletApp?: string;
};

function extractMergeOffer(error: unknown): MergeOffer | null {
  if (!error || typeof error !== "object") return null;
  const body = error as {
    error?: unknown;
    ticket?: unknown;
    other?: Record<string, unknown>;
  };
  if (body.error !== "account_merge_available") return null;
  if (typeof body.ticket !== "string" || !body.other) return null;
  const other = body.other;
  return {
    ticket: body.ticket,
    other: {
      name: String(other.name ?? ""),
      createdAt: String(other.created_at ?? ""),
      chats: Number(other.chats ?? 0),
      wallets: Number(other.wallets ?? 0),
      credits: String(other.credits ?? "0"),
      dropped: Array.isArray(other.dropped) ? other.dropped.map(String) : [],
    },
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

// Links that hit another account return a merge offer instead; these remain
// for sign-ins that match two accounts at once.
const CONFLICT_MESSAGES: Record<AccountConflictSignal, string> = {
  wallet: "This wallet already signs in to another Aomi account.",
  identity: "This sign-in method already opens another Aomi account.",
  email: "This email already belongs to another Aomi account.",
};

function formatAccountRequestError(
  status: number,
  code: string | null,
  signalType: AccountConflictSignal | null,
): string {
  if (status === 409 && code === "account_merge_available") {
    return "This wallet or sign-in method already opens another Aomi account.";
  }
  if (status === 409 && code === "already_linked_to_another_account") {
    return (
      (signalType ? CONFLICT_MESSAGES[signalType] : undefined) ??
      "This wallet or sign-in method already opens another Aomi account."
    );
  }
  return code ?? `Request failed: ${status}`;
}
