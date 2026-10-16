/**
 * The account's wallet list, agent wallets, balances and the thread's active
 * wallet (Agent Wallets v1, step 3).
 *
 * HAND-WRITTEN WIRE TYPES, matching notes/step3-contract.md §4–§5. Until the
 * generated agent API (packages/client/src/generated/agent-v1) is regenerated
 * from the step 3 backend, everything the frontend knows about these routes
 * lives in this one file:
 *   - `GET  /v1/account/wallets`              -> `AomiAccountWallet[]`
 *   - `POST /v1/account/wallets/agent`        -> `AomiAgentWalletsCreated`
 *   - `GET  /v1/account/wallets/:id/balance`  -> `AomiWalletBalance`
 *   - `PUT  /api/thread/wallet`               -> `AomiThreadWallet`
 *   - `GET  /v1/account/agent-rule`           -> `AomiAgentRule`
 *   - `PUT  /v1/account/agent-rule`           <- `AomiAgentRule`
 *   - `UserState` fields `wallet_pick`, `wallet_presence`, `active_wallet`
 *     (`UserStateWalletFields`) and `EventPage.active_wallet`.
 * After `pnpm generate:agent-api`, alias the `UserState` fields and the
 * GET shapes to `components["schemas"]` (keeping these names). The paths,
 * error codes and parsing stay hand-written.
 */
import { AomiApiError, apiErrorFields } from "../api-error";
import { asRecord, stringValue } from "../internal/record";
import type {
  AomiHttpMethod,
  AomiRequestOptions,
  AomiWalletFamily,
} from "../types";

/** `agent`: an Aomi agent wallet. `browser` / `embedded`: a linked wallet that asks in its own app. */
export type AomiAccountWalletKind = "agent" | "browser" | "embedded";

/** Agent wallets are `ready`; every other wallet is `linked`. */
export type AomiAccountWalletStatus = "ready" | "linked";

/**
 * The account's one signing rule. Locked: no agent wallet signs anything,
 * Instant or approved. Writes carry the version that was read.
 */
export type AomiAgentRule = { locked: boolean; version: number };

/** One entry of `GET /v1/account/wallets`, in the server's fixed order. */
export type AomiAccountWallet = {
  /** `w_<public key id>`; stable across account merges. */
  id: string;
  kind: AomiAccountWalletKind;
  family: AomiWalletFamily;
  address: string;
  /** The display name: the user's own name, else a server default. */
  label: string;
  /** The user's own name, when set. */
  custom_label: string | null;
  /** The wallet app a browser wallet was linked from, e.g. "Rabby". */
  wallet_app: string | null;
  provider: string | null;
  /** The account's default agent wallet for its family. */
  is_default: boolean;
  status: AomiAccountWalletStatus;
  /** Moved in by an account merge. */
  merged: boolean;
  /** Unix seconds. */
  created_at: number | null;
};

export type AomiWalletAmount = { amount: string; usd: string | null };

export type AomiWalletTokenBalance = {
  symbol: string;
  address: string;
  amount: string;
  usd: string | null;
};

export type AomiWalletChainBalance = {
  /** EVM chain id as a string, or the Solana cluster. */
  chain: string;
  name: string;
  native_symbol: string;
  /** `indexed` (portfolio API) or `rpc`. */
  source: "indexed" | "rpc" | (string & {});
  native: AomiWalletAmount | null;
  tokens: AomiWalletTokenBalance[];
  /** `unavailable` when this chain could not be read; the rest still return. */
  error: string | null;
};

/** `GET /v1/account/wallets/:id/balance`. Cached 30 s per wallet by the server. */
export type AomiWalletBalance = {
  id: string;
  family: AomiWalletFamily;
  address: string;
  /** Unix seconds. */
  as_of: number;
  /** Sum of the known USD values, or null when none is known. */
  total_usd: string | null;
  chains: AomiWalletChainBalance[];
};

/** `POST /v1/account/wallets/agent`. Idempotent: a repeat has `created: []`. */
export type AomiAgentWalletsCreated = {
  /** The default agent wallet of each requested family that exists now. */
  wallets: AomiAccountWallet[];
  /** Ids created by this call. */
  created: string[];
  /** Families that failed at the provider; safe to retry. */
  failed: { family: AomiWalletFamily; error: string }[];
};

/** A thread's active wallet id per family. */
export type AomiActiveWallet = Partial<Record<AomiWalletFamily, string>>;

/** `PUT /api/thread/wallet`. */
export type AomiThreadWallet = { active_wallet: AomiActiveWallet };

/**
 * Step 3 `UserState` fields. `wallet_pick` and `wallet_presence` go out with
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
  threadBusy: "thread_busy",
  ruleVersionConflict: "rule_version_conflict",
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
  agent: "/v1/account/wallets/agent",
  balance: (id: string) =>
    `/v1/account/wallets/${encodeURIComponent(id)}/balance`,
  agentRule: "/v1/account/agent-rule",
  threadWallet: "/api/thread/wallet",
} as const;

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** The wallet list, agent wallet creation, balances and the thread switch. */
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

  /**
   * Create the account's default EVM and SVM agent wallets where missing.
   * Portal sessions only. Per-family provider failures come back in `failed`;
   * the call throws only when every family failed.
   */
  async createAgentWallets(): Promise<AomiAgentWalletsCreated> {
    const body = asRecord(await this.request("POST", walletPaths.agent));
    if (!body) throw invalid("body must be an object");
    return {
      wallets: arrayOf(body.wallets, "wallets").map(parseAccountWallet),
      created: arrayOf(body.created, "created").map((id) =>
        requiredString(id, "created[]"),
      ),
      failed: arrayOf(body.failed, "failed").map((entry) => {
        const record = asRecord(entry);
        return {
          family: family(record?.family),
          error: requiredString(record?.error, "failed[].error"),
        };
      }),
    };
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

  /** The account's lock. No rule yet reads as unlocked, version 0. */
  async agentRule(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAgentRule> {
    return parseAgentRule(
      await this.request("GET", walletPaths.agentRule, options),
    );
  }

  /**
   * Lock or unlock at the version that was read. Portal sessions only; a
   * newer rule answers 409 `rule_version_conflict`.
   */
  async setAgentRule(rule: AomiAgentRule): Promise<AomiAgentRule> {
    return parseAgentRule(
      await this.request("PUT", walletPaths.agentRule, {
        body: { locked: rule.locked, version: rule.version },
      }),
    );
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
  const status = requiredString(record.status, "wallet.status");
  if (status !== "ready" && status !== "linked")
    throw invalid(`unsupported wallet status: ${status}`);
  return {
    id,
    kind,
    family: family(record.family),
    address: requiredString(record.address, "wallet.address"),
    label: requiredString(record.label, "wallet.label"),
    custom_label: stringValue(record.custom_label) ?? null,
    wallet_app: stringValue(record.wallet_app) ?? null,
    provider: stringValue(record.provider) ?? null,
    is_default: record.is_default === true,
    status,
    merged: record.merged === true,
    created_at:
      typeof record.created_at === "number" ? record.created_at : null,
  };
}

export function parseAgentRule(value: unknown): AomiAgentRule {
  const record = asRecord(value);
  if (!record || typeof record.version !== "number")
    throw invalid("agent rule must carry a version");
  return { locked: record.locked === true, version: record.version };
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
        source: stringValue(chain.source) ?? "rpc",
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
                    amount: stringValue(token.amount) ?? "0",
                    usd: stringValue(token.usd) ?? null,
                  },
                ]
              : [];
          },
        ),
        error: stringValue(chain.error) ?? null,
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
