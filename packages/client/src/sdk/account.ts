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
  type AomiThreadWallet,
} from "../account/wallets";
import {
  TransactionSafetyTransport,
  type TransactionSafetyMode,
  type TransactionSafetyPolicy,
} from "../transaction-safety";
import type {
  AomiHttpMethod,
  AomiPackage,
  AomiPackageCatalog,
  AomiPackageSecretStatus,
  AomiRequestOptions,
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

  /**
   * Make `id` the wallet `thread` trades with, for its family. A thread that
   * has not started yet takes its wallet from the first turn's
   * `userState.wallet_pick` instead.
   */
  use(id: string, options: { thread: string }): Promise<AomiThreadWallet> {
    return this.setThreadWallet(options.thread, id);
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

/**
 * The Library: every listed package with a live release and this account's
 * effective state for the thread's agent, the person's on/off choice, and the
 * person's own keys for a package's slots (status only, never values).
 */
export class AomiAccountPackages {
  constructor(private readonly request: AccountRequest) {}

  /** The rows for `threadId`'s agent, or for `aomi/main` without a thread. */
  list(
    options: { threadId?: string; signal?: AbortSignal } = {},
  ): Promise<AomiPackageCatalog> {
    const query = options.threadId
      ? `?thread_id=${encodeURIComponent(options.threadId)}`
      : "";
    return this.request(`/api/account/packages${query}`, {
      method: "GET",
      signal: options.signal,
    });
  }

  /** Switch a package on or off; an agent-listed package refuses off (409). */
  setChoice(packageId: number, enabled: boolean): Promise<AomiPackage> {
    return this.request(`${packagePath(packageId)}/choice`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  /** Drop the person's choice; the row goes back to its default. */
  clearChoice(packageId: number): Promise<AomiPackage> {
    return this.request(`${packagePath(packageId)}/choice`, {
      method: "DELETE",
    });
  }

  /** Store the person's own value for a `person` slot of the live release. */
  setSecret(
    packageId: number,
    slot: string,
    value: string,
  ): Promise<AomiPackageSecretStatus> {
    return this.request(secretPath(packageId, slot), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  }

  clearSecret(
    packageId: number,
    slot: string,
  ): Promise<AomiPackageSecretStatus> {
    return this.request(secretPath(packageId, slot), { method: "DELETE" });
  }
}

const packagePath = (packageId: number) =>
  `/api/account/packages/${encodeURIComponent(String(packageId))}`;
const secretPath = (packageId: number, slot: string) =>
  `${packagePath(packageId)}/secrets/${encodeURIComponent(slot)}`;

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
   * cannot be `yolo`.
   */
  async set(input: {
    mode: TransactionSafetyMode;
    thread?: string;
    revision?: number;
  }): Promise<TransactionSafetyPolicy> {
    const { mode } = input;
    const revision = input.revision ?? (await this.get(input)).revision;
    if (input.thread)
      return this.transport.setThread(input.thread, mode, revision);
    if (mode === "yolo")
      throw new AomiError(
        "invalid_mode",
        "The account default cannot be yolo; set it on a thread",
      );
    return this.transport.setAccountDefault(mode, revision);
  }
}

/**
 * `aomi.account`: the signed-in account. Everything here is `/v1`. Profile,
 * logins and merge need a portal or CLI sign-in; OAuth apps get 401 there.
 */
export class AomiAccount extends AccountTransport {
  declare readonly wallets: AomiAccountWallets;
  readonly packages: AomiAccountPackages;
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
    this.packages = new AomiAccountPackages((path, init) =>
      this.request(path, init),
    );
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

  statement({
    signal,
    ...options
  }: {
    limit?: number;
    cursor?: string;
    from?: number;
    to?: number;
    signal?: AbortSignal;
  } = {}): Promise<AomiAccountStatement> {
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
