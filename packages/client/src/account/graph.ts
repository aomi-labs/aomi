import { AomiApiError, apiErrorFields } from "../api-error";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

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
  /** `agent`: an Aomi agent wallet (signs on the server under its rule). */
  kind?: "external" | "embedded" | "smart_account" | "agent";
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

/** Account graph operations use the same authenticated transport as chat. */
export class AccountGraphTransport {
  constructor(private readonly transport: RequestResponse) {}
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

  protected async request<T>(path: string, init: RequestInit): Promise<T> {
    const method = (init.method ?? "GET") as AomiHttpMethod;
    const headers = new Headers(init.headers);
    if (!["GET", "HEAD", "OPTIONS"].includes(method))
      headers.set("X-Aomi-CSRF", "1");
    const response = await this.transport(method, path, {
      headers: Object.fromEntries(headers.entries()),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new AccountGraphApiError(
        response.status,
        body,
        text,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return body as T;
  }
}

/** A link that proved a sign-in method of another account: `merge(ticket)` moves it in. */
export type AccountMergeOffer = {
  ticket: string;
  other: {
    name: string;
    created_at: string;
    chats: number;
    wallets: number;
    credits: string;
    /** What the other account loses because this one already has it. */
    dropped: string[];
  };
};

export class AccountGraphApiError extends AomiApiError {
  override name = "AccountGraphApiError";

  constructor(
    status: number,
    readonly body: unknown,
    detail: string,
    /** Seconds to wait before retrying, from `Retry-After`. */
    readonly retryAfter?: number,
  ) {
    super(
      status,
      apiErrorFields(body).code ?? "account_request_failed",
      detail || `Account request failed: HTTP ${status}`,
    );
  }

  /** Set on `account_merge_available`. */
  get mergeOffer(): AccountMergeOffer | undefined {
    const { ticket, other } = (this.body ?? {}) as Partial<AccountMergeOffer>;
    return this.code === "account_merge_available" &&
      typeof ticket === "string" &&
      other
      ? { ticket, other }
      : undefined;
  }
}
