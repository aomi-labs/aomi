/**
 * The account's wallet list, agent wallets, balances and the thread's active
 * wallet.
 *
 * `AomiAccountWallet` and `AomiWalletBalance` are the generated agent API
 * schemas (`generated/agent-v1`). The rest is hand-written wire types for
 * portal-session account routes outside the agent API spec:
 *   - `PUT  /api/thread/wallet`               -> `AomiThreadWallet`
 *   - `PUT  /v1/account/pause-all`            -> `{ pause_all }`
 *   - the agent wallet routes in `./agent-wallets`
 *   - `UserState` fields `wallet_pick`, `wallet_presence`, `active_wallet`
 *     (`UserStateWalletFields`) and `EventPage.active_wallet`.
 * The paths, error codes and parsing stay hand-written.
 */
import { AomiApiError, apiErrorFields } from "../api-error";
import { asRecord, stringValue } from "../internal/record";
import { laneOf } from "./lanes";
import {
  agentWalletPaths,
  parseAgentWallet,
  parseAgentWalletBalances,
  parseAgentWallets,
  type AomiAgentWallet,
  type AomiAgentWalletBalances,
  type AomiAgentWalletCreate,
  type AomiAgentWalletUpdate,
  type AomiAgentWalletWithdraw,
  type AomiAgentWallets,
} from "./agent-wallets";
import type { components } from "../generated/agent-v1/types";
import type {
  AomiHttpMethod,
  AomiRequestOptions,
  AomiWalletFamily,
} from "../types";

/** `agent`: an Aomi agent wallet. `browser` / `embedded`: a linked wallet that asks in its own app. */
export type AomiAccountWalletKind = AomiAccountWallet["kind"];

/** One entry of `GET /v1/account/wallets`, in the server's fixed order. */
export type AomiAccountWallet = components["schemas"]["AccountWallet"];

/** `GET /v1/account/wallets/:id/balance`. Cached 30 s per wallet by the server. */
export type AomiWalletBalance = components["schemas"]["WalletBalance"];

/** One chain of a balance; `error` is `unavailable` when it could not be read. */
export type AomiWalletChainBalance = AomiWalletBalance["chains"][number];

export type AomiWalletTokenBalance = AomiWalletChainBalance["tokens"][number];

export type AomiWalletAmount = NonNullable<AomiWalletChainBalance["native"]>;

/** A thread's active wallet id per family. */
export type AomiActiveWallet = Partial<Record<AomiWalletFamily, string>>;

/** `PUT /api/thread/wallet`. */
export type AomiThreadWallet = { active_wallet: AomiActiveWallet };

/**
 * The wallet fields of `UserState`. `wallet_pick` and `wallet_presence` go out with
 * every turn; `active_wallet` comes back from the backend.
 */
export type UserStateWalletFields = {
  /** This device's chosen wallet id per family; null clears a family. */
  wallet_pick?: Partial<Record<AomiWalletFamily, string | null>>;
  /** Ids of linked wallets that are connected on this device. */
  wallet_presence?: string[];
  /** The thread's active wallet id per family (backend-owned). */
  active_wallet?: AomiActiveWallet;
};

export const WALLET_ERROR_CODES = {
  invalidFamily: "invalid_family",
  guestAccount: "guest_account",
  agentWalletUnavailable: "agent_wallet_unavailable",
  agentWalletProviderError: "agent_wallet_provider_error",
  invalidWalletId: "invalid_wallet_id",
  walletNotFound: "wallet_not_found",
  balanceUnavailable: "balance_unavailable",
  walletSwitchPending: "wallet_switch_pending",
  walletSwitchUnavailable: "wallet_switch_unavailable",
  labelTooLong: "label_too_long",
  agentWalletNotRemovable: "agent_wallet_not_removable",
  agentWalletBusy: "agent_wallet_busy",
  threadBusy: "thread_busy",
  portalSessionRequired: "portal_session_required",
} as const;

export type AomiWalletErrorCode =
  | (typeof WALLET_ERROR_CODES)[keyof typeof WALLET_ERROR_CODES]
  | (string & {});

/** A failed wallet request. `code` is the server's `{"error":"<code>"}`. */
export class AomiWalletError extends AomiApiError {
  constructor(
    status: number,
    code: AomiWalletErrorCode,
    message: string,
    requestId?: string,
    details?: unknown,
  ) {
    super(status, code, message, undefined, requestId, details);
    this.name = "AomiWalletError";
  }
}

const WALLET_REF = /^w_([1-9][0-9]*)$/;

/** `w_12` for public key id 12. */
export function walletRef(publicKeyId: string | number): string {
  const id = String(publicKeyId);
  if (!/^[1-9][0-9]*$/.test(id)) throw new TypeError(`Not a wallet id: ${id}`);
  return `w_${id}`;
}

/** The public key id inside `w_12`, or undefined for anything else. */
export function parseWalletRef(value: string): string | undefined {
  return WALLET_REF.exec(value)?.[1];
}

export const walletPaths = {
  list: "/v1/account/wallets",
  balance: (id: string) =>
    `/v1/account/wallets/${encodeURIComponent(id)}/balance`,
  pauseAll: "/v1/account/pause-all",
  threadWallet: "/api/thread/wallet",
} as const;

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** The wallet list, agent wallets, balances and the thread switch. */
export class AccountWalletsTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  /** Every wallet the account owns, agent wallets first. */
  async listWallets(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAccountWallet[]> {
    const body = await this.request("GET", walletPaths.list, options);
    const wallets = asRecord(body)?.wallets;
    if (!Array.isArray(wallets)) throw invalid("wallets must be an array");
    return wallets.map(parseAccountWallet);
  }

  /** Native and token balances of one wallet, per chain. */
  async walletBalance(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiWalletBalance> {
    return parseWalletBalance(
      await this.request("GET", walletPaths.balance(id), options),
    );
  }

  /** Every agent wallet, archived ones included, most recently used first. */
  async agentWallets(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAgentWallets> {
    return parseAgentWallets(
      await this.request("GET", agentWalletPaths.list, options),
    );
  }

  /**
   * Create an agent wallet with both families unless `families` narrows it.
   * The connection that creates it (`connection_key`, else the portal) starts
   * with its default lane on it.
   */
  async createAgentWallet(
    input: AomiAgentWalletCreate,
  ): Promise<AomiAgentWallet> {
    return parseAgentWallet(
      await this.request("POST", agentWalletPaths.list, { body: input }),
    );
  }

  /**
   * Rename, pause or resume, archive or restore. Archiving a wallet with a
   * trade in flight answers 409 `agent_wallet_busy`.
   */
  async updateAgentWallet(
    id: string,
    update: AomiAgentWalletUpdate,
  ): Promise<AomiAgentWallet> {
    return parseAgentWallet(
      await this.request("PATCH", agentWalletPaths.wallet(id), {
        body: update,
      }),
    );
  }

  /** One family's balances per network, for withdrawing. */
  async agentWalletBalances(
    id: string,
    family: AomiWalletFamily,
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAgentWalletBalances> {
    return parseAgentWalletBalances(
      await this.request("GET", agentWalletPaths.balances(id), {
        ...options,
        query: { family },
      }),
    );
  }

  /**
   * Move funds out to `to`, even while the wallet is paused or archived. The
   * returned commit waits for approval: approve it with its `CommitHandle`.
   */
  async withdrawAgentWallet(
    id: string,
    input: AomiAgentWalletWithdraw,
  ): Promise<{ ref: string }> {
    const ref = stringValue(
      asRecord(
        await this.request("POST", agentWalletPaths.withdraw(id), {
          body: input,
        }),
      )?.ref,
    );
    if (!ref) throw invalid("withdraw must return a ref");
    return { ref };
  }

  /**
   * Pause or resume every agent wallet: none signs anything, Instant or
   * approved. Portal sessions only. The agent wallet list carries the
   * current value as `pause_all`.
   */
  async pauseAll(
    paused: boolean,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ pause_all: boolean }> {
    const record = asRecord(
      await this.request("PUT", walletPaths.pauseAll, {
        ...options,
        body: { paused },
      }),
    );
    if (typeof record?.pause_all !== "boolean")
      throw invalid("pause all must carry pause_all");
    return { pause_all: record.pause_all };
  }

  /** Make `id` the thread's active wallet for its family. */
  async setThreadWallet(
    threadId: string,
    id: string,
  ): Promise<AomiThreadWallet> {
    const body = asRecord(
      await this.request("PUT", walletPaths.threadWallet, {
        sessionId: threadId,
        body: { id },
      }),
    );
    return { active_wallet: activeWalletOf(body?.active_wallet) ?? {} };
  }

  private async request(
    method: AomiHttpMethod,
    path: string,
    options: AomiRequestOptions = {},
  ): Promise<unknown> {
    const headers = new Headers(options.headers);
    if (method !== "GET") headers.set("X-Aomi-CSRF", "1");
    const response = await this.requestResponse(method, path, {
      ...options,
      headers,
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) throw walletError(response.status, body);
    return body;
  }
}

/** Typed error for a failed wallet or connections response (`{"error":"<code>"}`, `{code}` or api-server's nested shape). */
export function walletError(status: number, body: unknown): AomiWalletError {
  const fields = apiErrorFields(body);
  // The portal's own account routes answer `{code, status}`.
  const code =
    fields.code ?? stringValue(asRecord(body)?.code) ?? `http_${status}`;
  return new AomiWalletError(
    status,
    code,
    fields.message ?? `Wallet request failed: ${code}`,
    fields.requestId,
    fields.details,
  );
}

/** The `active_wallet` map on an event page or user state, when present. */
export function activeWalletOf(value: unknown): AomiActiveWallet | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const active: AomiActiveWallet = {};
  for (const key of ["evm", "svm"] as const) {
    const id = stringValue(record[key]);
    if (id && parseWalletRef(id)) active[key] = id;
  }
  return active;
}

export function parseAccountWallet(value: unknown): AomiAccountWallet {
  const record = asRecord(value);
  if (!record) throw invalid("wallet must be an object");
  const id = requiredString(record.id, "wallet.id");
  if (!parseWalletRef(id)) throw invalid(`wallet.id is not a w_ id: ${id}`);
  const kind = requiredString(record.kind, "wallet.kind");
  if (kind !== "agent" && kind !== "browser" && kind !== "embedded")
    throw invalid(`unsupported wallet kind: ${kind}`);
  return {
    id,
    kind,
    family: family(record.family),
    address: requiredString(record.address, "wallet.address"),
    label: requiredString(record.label, "wallet.label"),
    custom_label: stringValue(record.custom_label) ?? null,
    browser_app: stringValue(record.browser_app) ?? null,
    provider: stringValue(record.provider) ?? null,
    created_at: typeof record.created_at === "number" ? record.created_at : 0,
    agent_wallet_id: stringValue(record.agent_wallet_id) ?? null,
    maker_app: stringValue(record.maker_app) ?? null,
    ...(record.lane === undefined ? {} : { lane: laneOf(record.lane) }),
  };
}

export function parseWalletBalance(value: unknown): AomiWalletBalance {
  const record = asRecord(value);
  if (!record) throw invalid("balance must be an object");
  return {
    id: requiredString(record.id, "balance.id"),
    family: family(record.family),
    address: requiredString(record.address, "balance.address"),
    as_of: typeof record.as_of === "number" ? record.as_of : 0,
    total_usd: stringValue(record.total_usd) ?? null,
    chains: arrayOf(record.chains, "chains").map((entry) => {
      const chain = asRecord(entry);
      if (!chain) throw invalid("chain must be an object");
      const native = asRecord(chain.native);
      return {
        chain: requiredString(chain.chain, "chain.chain"),
        name: stringValue(chain.name) ?? requiredString(chain.chain, "chain"),
        native_symbol: stringValue(chain.native_symbol) ?? "",
        source: chain.source === "indexed" ? "indexed" : "rpc",
        native: native
          ? {
              amount: stringValue(native.amount) ?? "0",
              usd: stringValue(native.usd) ?? null,
            }
          : null,
        tokens: (Array.isArray(chain.tokens) ? chain.tokens : []).flatMap(
          (item) => {
            const token = asRecord(item);
            const symbol = stringValue(token?.symbol);
            return token && symbol
              ? [
                  {
                    symbol,
                    address: stringValue(token.address) ?? "",
                    decimals:
                      typeof token.decimals === "number"
                        ? token.decimals
                        : null,
                    amount: stringValue(token.amount) ?? "0",
                    usd: stringValue(token.usd) ?? null,
                  },
                ]
              : [];
          },
        ),
        error: stringValue(chain.error) ? "unavailable" : null,
      };
    }),
  };
}

function family(value: unknown): AomiWalletFamily {
  if (value === "evm" || value === "svm") return value;
  throw invalid(`unsupported family: ${String(value)}`);
}

function arrayOf(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  const text = stringValue(value);
  if (text === undefined) throw invalid(`${field} must be a string`);
  return text;
}

function invalid(detail: string): TypeError {
  return new TypeError(`Invalid wallet response: ${detail}`);
}
