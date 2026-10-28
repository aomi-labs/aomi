import { AomiError } from "../api-error";
import { AccountTransport } from "../account/credits";
import type {
  AccountGraphLinkedAccount,
  AccountGraphResponse,
} from "../account/graph";
import type { AomiAgentWalletBalances } from "../account/agent-wallets";
import {
  AccountWalletsTransport,
  type AomiAccountWallet,
} from "../account/wallets";
import { normalizeAppDescriptor } from "../app-descriptor";
import {
  TransactionSafetyTransport,
  type TransactionSafetyMode,
  type TransactionSafetyPolicy,
} from "../transaction-safety";
import type {
  AomiAccountAppMutationResponse,
  AomiAppDescriptor,
  AomiClearAppSecretsResponse,
  AomiDeleteSecretResponse,
  AomiHttpMethod,
  AomiRequestOptions,
  AomiUserAppSecrets,
} from "../types";

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** One page of priced usage, newest first. */
export type AomiAccountStatement = {
  entries: unknown[];
  next_cursor: string | null;
};

/** The account's wallets: every one the model can use, agent wallets first. */
export class AomiAccountWallets extends AccountWalletsTransport {
  list(options: { signal?: AbortSignal } = {}): Promise<AomiAccountWallet[]> {
    return this.listWallets(options);
  }

  /** An agent wallet's balances per network (`id` from `list()`). */
  async balance(id: string): Promise<AomiAgentWalletBalances> {
    const wallet = (await this.listWallets()).find((entry) => entry.id === id);
    if (!wallet?.agent_wallet_id)
      throw new AomiError(
        "not_agent_wallet",
        `${id} is not an agent wallet; only agent wallets have balances here`,
      );
    return this.agentWalletBalances(wallet.agent_wallet_id, wallet.family);
  }
}

type AccountRequest = <T>(path: string, init: RequestInit) => Promise<T>;

/** An app by name, or by its application id. */
type AppRef = string | number;

/** Installed apps by name, and each app's per-account credentials. */
export class AomiAccountApps {
  constructor(private readonly request: AccountRequest) {}

  /** Every app the account can see, with `isInstalled`. */
  async list(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAppDescriptor[]> {
    const rows = await this.request<unknown>("/v1/account/apps", {
      method: "GET",
      signal: options.signal,
    });
    return (Array.isArray(rows) ? rows : []).flatMap(
      (row) => normalizeAppDescriptor(row) ?? [],
    );
  }

  async install(app: AppRef): Promise<AomiAccountAppMutationResponse> {
    return this.request(await this.path(app), { method: "POST" });
  }

  async uninstall(app: AppRef): Promise<AomiAccountAppMutationResponse> {
    return this.request(await this.path(app), { method: "DELETE" });
  }

  /** The credential slots `app` declares (never their values), and setting them. */
  credentials(app: AppRef) {
    const secrets = async () => `${await this.path(app)}/secrets`;
    const save = async (
      values: Record<string, string>,
    ): Promise<AomiUserAppSecrets> =>
      this.request(await secrets(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secrets: values }),
      });
    return {
      list: async (): Promise<AomiUserAppSecrets> =>
        this.request(await secrets(), { method: "GET" }),
      set: (key: string, value: string) => save({ [key]: value }),
      /** Set several slots at once; the others stay as they are. */
      save,
      remove: async (key: string): Promise<AomiDeleteSecretResponse> =>
        this.request(`${await secrets()}/${encodeURIComponent(key)}`, {
          method: "DELETE",
        }),
      /** Remove every value the account stored for the app. */
      clear: async (): Promise<AomiClearAppSecretsResponse> =>
        this.request(await secrets(), { method: "DELETE" }),
    };
  }

  /** `/v1/account/apps/:id` takes the application id, so look a name up. */
  private async path(app: AppRef): Promise<string> {
    const id =
      typeof app === "number"
        ? app
        : (await this.list()).find((entry) => entry.name === app)
            ?.applicationId;
    if (id == null)
      throw new AomiError("app_not_found", `No app named ${app}`, 404);
    return `/v1/account/apps/${encodeURIComponent(String(id))}`;
  }
}

/** Transaction safety, for the account or one thread. */
export class AomiGuard {
  constructor(private readonly transport: TransactionSafetyTransport) {}

  get(options: { thread?: string } = {}): Promise<TransactionSafetyPolicy> {
    return options.thread
      ? this.transport.getThread(options.thread)
      : this.transport.getAccountDefault();
  }

  /**
   * Set the mode at `revision`, or at the current one. A stale `revision`
   * fails instead of overwriting a change made elsewhere. Account defaults
   * cannot be `unrestricted`.
   */
  async set(input: {
    mode: TransactionSafetyMode;
    thread?: string;
    revision?: number;
  }): Promise<TransactionSafetyPolicy> {
    const revision = input.revision ?? (await this.get(input)).revision;
    if (input.thread)
      return this.transport.setThread(input.thread, input.mode, revision);
    if (input.mode === "unrestricted")
      throw new AomiError(
        "invalid_mode",
        "The account default cannot be unrestricted; set it on a thread",
      );
    return this.transport.setAccountDefault(input.mode, revision);
  }
}

/**
 * `aomi.account`: the signed-in account. Everything here is `/v1`. Profile,
 * logins and merge need a portal or CLI sign-in; OAuth apps get 401 there.
 */
export class AomiAccount extends AccountTransport {
  declare readonly wallets: AomiAccountWallets;
  readonly apps: AomiAccountApps;
  readonly guard: AomiGuard;
  /** The sign-in methods linked to the account. */
  readonly logins: {
    list(): Promise<AccountGraphLinkedAccount[]>;
    /** Link a wallet by its signed SIWE message (nonce from `getWalletLinkNonce`).
     * A wallet of another account fails with `account_merge_available`;
     * the error's `mergeOffer` carries the ticket for `merge()`. */
    link: AccountTransport["linkWallet"];
    remove(id: string): Promise<unknown>;
  };

  constructor(requestResponse: RequestResponse) {
    super(requestResponse);
    this.wallets = new AomiAccountWallets(requestResponse);
    this.apps = new AomiAccountApps((path, init) => this.request(path, init));
    this.guard = new AomiGuard(new TransactionSafetyTransport(requestResponse));
    this.logins = {
      list: async () => (await this.getAccount()).linkedAccounts,
      link: (body) => this.linkWallet(body),
      remove: (id) => this.unlinkIdentity(id),
    };
  }

  me(): Promise<AccountGraphResponse> {
    return this.getAccount();
  }

  statement(
    {
      signal,
      ...options
    }: {
      limit?: number;
      cursor?: string;
      from?: number;
      to?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<AomiAccountStatement> {
    const query = new URLSearchParams(
      Object.entries(options).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, String(value)]],
      ),
    ).toString();
    return this.request(`/v1/account/statement${query ? `?${query}` : ""}`, {
      method: "GET",
      signal,
    });
  }

  /** Sign this browser in to the other account (a merge offer's ticket) instead of merging. */
  async switchTo(ticket: string): Promise<void> {
    await this.request("/v1/account/merge/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
  }

  /** Move the other account (from a merge offer's ticket) into this one. */
  merge(ticket: string): Promise<{
    moved: { chats: number; wallets: number };
    account: AccountGraphResponse;
  }> {
    return this.request("/v1/account/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
  }
}
