import { privateKeyToAccount } from "viem/accounts";
import { joinUrl, normalizeBaseUrl, safeResponseText } from "./auth";
import type { CliSession } from "./cli-session";
import { fatal } from "./errors";
import type { CliConfig } from "./types";
import { AccountCreditsTransport } from "../account/credits";
import type { AomiRequestOptions } from "../types";

export type AccountGraphUser = {
  id: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

export type AccountGraphLinkedAccount = {
  id: string;
  provider: string;
  subject: string;
  email?: string;
  displayLabel?: string;
  linkedAt?: number;
  lastSeenAt?: number;
};

export type AccountGraphWallet = {
  id: string;
  family: "evm" | "svm";
  address: string;
  kind?: "external" | "embedded" | "smart_account";
  provider?: string;
  providerWalletId?: string;
  chainScope?: string;
  chainId?: number;
  linkedVia: string;
  label?: string;
  verifiedAt?: number;
  lastSeenAt?: number;
};

export type AccountGraphResponse =
  | {
      user: AccountGraphUser;
      linkedAccounts: AccountGraphLinkedAccount[];
      wallets: AccountGraphWallet[];
      session: {
        betterAuthUserId: string;
        expiresAt?: number;
        fresh?: boolean;
      };
    }
  | {
      user: null;
      linkedAccounts: [];
      wallets: [];
      session: null;
    };

export type AccountGraphLinkWalletResponse = {
  status: "linked" | "noop";
  account?: AccountGraphResponse;
};

export type AccountGraphProviderExchangeResponse =
  | { status: "linked"; account?: AccountGraphResponse }
  | {
      status: "noop" | "conflict";
      reason?: string;
      signalType?: string;
      error?: string;
    };

export type AccountGraphDeleteResponse = {
  status: "deactivated";
  revokedIdentities: number;
  revokedWallets: number;
};

export type ResolvedAccountLink =
  | { kind: "identity"; id: string; link: AccountGraphLinkedAccount }
  | { kind: "wallet"; id: string; link: AccountGraphWallet };

export class AccountGraphClient {
  readonly credits: AccountCreditsTransport;
  private readonly baseUrl: string;
  private readonly sessionToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: {
    baseUrl: string;
    sessionToken: string;
    fetch?: typeof fetch;
  }) {
    this.baseUrl = normalizeBaseUrl(input.baseUrl);
    this.sessionToken = input.sessionToken;
    this.fetchImpl = input.fetch ?? fetch;
    this.credits = new AccountCreditsTransport(
      (method, path, options) =>
        this.requestResponse(
          path,
          {
            method,
            headers: options?.headers,
            body:
              options?.body === undefined
                ? undefined
                : JSON.stringify(options.body),
          },
          options?.query,
        ),
      "/v1/account/credits",
    );
  }

  getAccount(): Promise<AccountGraphResponse> {
    return this.request<AccountGraphResponse>("/v1/account", {
      method: "GET",
    });
  }

  updateAccount(body: {
    displayName?: string | null;
    avatarUrl?: string | null;
  }): Promise<AccountGraphResponse> {
    return this.request<AccountGraphResponse>("/v1/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  deleteAccount(): Promise<AccountGraphDeleteResponse> {
    return this.request<AccountGraphDeleteResponse>("/v1/account", {
      method: "DELETE",
    });
  }

  signOut(): Promise<unknown> {
    return this.request("/api/auth/sign-out", { method: "POST" });
  }

  async getWalletLinkNonce(input: {
    address: string;
    chainId: number;
  }): Promise<{ nonce: string; domain?: string; uri?: string }> {
    const params = new URLSearchParams({
      address: input.address,
      chainId: String(input.chainId),
    });
    return this.request(`/v1/account/wallets/link?${params.toString()}`, {
      method: "GET",
    });
  }

  linkWallet(body: {
    family: "evm";
    address: string;
    chainId: number;
    nonce: string;
    message: string;
    signature: string;
    label?: string | null;
  }): Promise<AccountGraphLinkWalletResponse> {
    return this.request<AccountGraphLinkWalletResponse>(
      "/v1/account/wallets/link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  exchangeProviderCredential(
    credential: unknown,
  ): Promise<AccountGraphProviderExchangeResponse> {
    return this.request<AccountGraphProviderExchangeResponse>(
      "/v1/account/provider/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      },
    );
  }

  updateIdentity(
    identityId: string,
    body: { displayLabel?: string | null },
  ): Promise<AccountGraphResponse> {
    return this.request<AccountGraphResponse>(
      `/v1/account/identities/${encodeURIComponent(identityId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  unlinkIdentity(identityId: string): Promise<unknown> {
    return this.request(
      `/v1/account/identities/${encodeURIComponent(identityId)}`,
      {
        method: "DELETE",
      },
    );
  }

  updateWallet(
    walletId: string,
    body: { label?: string | null },
  ): Promise<AccountGraphResponse> {
    return this.request<AccountGraphResponse>(
      `/v1/account/wallets/${encodeURIComponent(walletId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  unlinkWallet(walletId: string): Promise<unknown> {
    return this.request(`/v1/account/wallets/${encodeURIComponent(walletId)}`, {
      method: "DELETE",
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.requestResponse(path, init);
    if (!response.ok) {
      throw new Error(
        formatAccountGraphError(
          response.status,
          await response.json().catch(() => null),
          await safeResponseText(response).catch(() => ""),
        ),
      );
    }
    return (await response.json().catch(() => ({}))) as T;
  }

  private requestResponse(
    path: string,
    init: RequestInit,
    query?: AomiRequestOptions["query"],
  ): Promise<Response> {
    const url = new URL(joinUrl(this.baseUrl, path));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return this.fetchImpl(url, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.sessionToken}`,
        ...(init.headers ?? {}),
      },
    });
  }
}

export function requireAccountGraphClient(
  cli: CliSession,
  fetchImpl?: typeof fetch,
): AccountGraphClient {
  const sessionToken = cli.accountBearer ?? cli.auth?.sessionToken;
  if (!sessionToken) {
    fatal(
      "No account session. Run `aomi account login` first or pass `--account-bearer`.",
    );
  }
  return new AccountGraphClient({
    baseUrl: cli.baseUrl,
    sessionToken: sessionToken!,
    fetch: fetchImpl,
  });
}

export function resolveAccountPrivateKey(
  cli: CliSession,
  config: CliConfig,
): `0x${string}` {
  const privateKey = config.privateKey ?? cli.privateKey;
  if (!privateKey) {
    fatal(
      "No EVM private key configured.\n" +
        "Run `aomi wallet set <evm-private-key>` or pass `--private-key`.",
    );
  }
  return privateKey as `0x${string}`;
}

export function buildWalletLinkMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
  domain?: string;
  uri?: string;
  baseUrl: string;
  issuedAt?: Date;
}): string {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const domain = input.domain ?? new URL(baseUrl).host;
  const uri = input.uri ?? baseUrl;
  return `${domain} wants to link this wallet to your Aomi account:
${input.address}

Sign in to Aomi.

URI: ${uri}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${(input.issuedAt ?? new Date()).toISOString()}`;
}

export async function buildSignedWalletLink(input: {
  cli: CliSession;
  config: CliConfig;
  label?: string | null;
}): Promise<{
  family: "evm";
  address: string;
  chainId: number;
  nonce: string;
  message: string;
  signature: string;
  label?: string | null;
}> {
  const client = requireAccountGraphClient(input.cli);
  const privateKey = resolveAccountPrivateKey(input.cli, input.config);
  const account = privateKeyToAccount(privateKey);
  const chainId = input.config.chain ?? input.cli.chainId ?? 1;
  const nonce = await client.getWalletLinkNonce({
    address: account.address,
    chainId,
  });
  const message = buildWalletLinkMessage({
    address: account.address,
    chainId,
    nonce: nonce.nonce,
    domain: nonce.domain,
    uri: nonce.uri,
    baseUrl: input.cli.baseUrl,
  });
  const signature = await account.signMessage({ message });
  return {
    family: "evm",
    address: account.address,
    chainId,
    nonce: nonce.nonce,
    message,
    signature,
    label: input.label ?? null,
  };
}

export function resolveAccountLink(
  account: AccountGraphResponse,
  selector: string,
): ResolvedAccountLink | null {
  if (!account.user) return null;
  const raw = selector.trim();
  const separator = raw.indexOf(":");
  const [kindPrefix, idFromPrefix] =
    separator >= 0
      ? [raw.slice(0, separator), raw.slice(separator + 1)]
      : ["", ""];
  const wantedKind =
    kindPrefix === "identity" || kindPrefix === "wallet"
      ? kindPrefix
      : undefined;
  const id = wantedKind ? idFromPrefix : raw;
  if (!id) return null;

  const identity = account.linkedAccounts.find((link) => link.id === id);
  const wallet = account.wallets.find((link) => link.id === id);
  if (wantedKind === "identity") {
    return identity ? { kind: "identity", id, link: identity } : null;
  }
  if (wantedKind === "wallet") {
    return wallet ? { kind: "wallet", id, link: wallet } : null;
  }
  if (identity && wallet) {
    fatal(
      `Link id "${id}" is ambiguous. Use "identity:${id}" or "wallet:${id}".`,
    );
  }
  if (identity) return { kind: "identity", id, link: identity };
  if (wallet) return { kind: "wallet", id, link: wallet };
  return null;
}

function formatAccountGraphError(
  status: number,
  body: unknown,
  fallback: string,
): string {
  const code = extractErrorCode(body);
  if (status === 401) {
    return "Session expired; run `aomi account login`";
  }
  if (status === 409 && code === "cannot_unlink_last_login_factor") {
    return "Cannot unlink the last login method. Link another account method first.";
  }
  if (status === 409 && code === "already_linked_to_another_account") {
    return "This login method is already linked to another Aomi account.";
  }
  if (status === 403 && code === "protected_identity") {
    return "This login identity is protected and cannot be edited directly.";
  }
  return code ?? fallback ?? `Request failed: HTTP ${status}`;
}

function extractErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as Record<string, unknown>).message === "string"
  ) {
    return (record.error as Record<string, string>).message;
  }
  return null;
}
