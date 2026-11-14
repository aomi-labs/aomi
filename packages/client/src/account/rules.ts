/**
 * An agent wallet's rules: what the backend checks on every agent signature
 * (allowed apps, a daily limit per asset, an end date, sends only to your
 * wallets). A change that only takes power away applies at once; one that
 * gives power, or changes the admin, waits for the wallet's admin.
 *
 * Hand-written wire types until the generated client covers them:
 *   - `GET  /v1/account/agent-wallets/:id/rules`     -> `AomiWalletRules`
 *   - `POST /v1/account/agent-wallets/:id/rules`     -> `AomiRulesChangeResult`
 *   - `GET  /v1/account/rules/catalog`               -> `AomiRulesCatalog`
 *   - `GET  /v1/account/rule-changes/:id`            -> `AomiRuleChange`
 *   - `POST /v1/account/rule-changes/:id/approve`    -> `AomiWalletRules`
 *   - `POST /v1/account/rule-changes/:id/decline`    -> `AomiWalletRules`
 * Writes are for the owner's own session: the portal or a CLI login.
 */
import {
  asRecord,
  numberOrNull,
  responseReader,
  stringValue,
} from "../internal/record";
import type {
  AomiHttpMethod,
  AomiRequestOptions,
  AomiWalletFamily,
} from "../types";
import { walletRequest, type RequestResponse } from "./wallets";

/**
 * A spending limit on one asset per UTC day. `amount` is in base units, a
 * decimal string that can exceed 2^53. `symbol` and `decimals` are filled by
 * the server for display (`symbol` is null for a token it does not know); a
 * write does not send them.
 */
export type AomiRuleLimit = {
  /**
   * `eip155:<chainId>/native`, `eip155:<chainId>/erc20:<0x address>`,
   * `solana:mainnet-beta/native` or `solana:mainnet-beta/token:<mint>`.
   */
  asset: string;
  amount: string;
  symbol?: string | null;
  decimals?: number | null;
};

/** What the agent may sign with a wallet; each field is one rule. */
export type AomiRuleSet = {
  /** The apps the agent may use; null allows any app. */
  apps: string[] | null;
  /** A token with no limit can't be spent once any limit is set. */
  limits: AomiRuleLimit[];
  /** The agent may sign until then (unix seconds); null is no end date. */
  not_after: number | null;
  /** Sends only go to the account's own wallets. */
  owner_only: boolean;
};

/** False for a wallet whose every rule is off. */
export const hasRules = (rules: AomiRuleSet): boolean =>
  rules.apps !== null ||
  rules.limits.length > 0 ||
  rules.not_after !== null ||
  rules.owner_only;

/**
 * Who may loosen a wallet's rules. `aomi_managed`: the owner approves in the
 * portal, Telegram or the CLI. `wallet`: only that wallet's signature does.
 */
export type AomiRulesAdmin = { kind: "aomi_managed" } | AomiRulesAdminWallet;

export type AomiRulesAdminWallet = {
  kind: "wallet";
  family: AomiWalletFamily;
  address: string;
};

/** What a limited asset has spent in the current window, in base units. */
export type AomiRuleUsage = {
  asset: string;
  used: string;
  cap: string;
  symbol: string | null;
  decimals: number | null;
};

const CHANGE_STATES = [
  "awaiting_admin",
  "applied",
  "declined",
  "expired",
  "superseded",
] as const;

export type AomiRuleChangeState = (typeof CHANGE_STATES)[number];

/** One line of a change; `loosens` marks a line that gives the agent power. */
export type AomiRuleChangeLine = { text: string; loosens: boolean };

/** A filed rule change, waiting for the admin or already decided. */
export type AomiRuleChange = {
  id: string;
  agent_wallet_id: string;
  wallet_name: string;
  lines: AomiRuleChangeLine[];
  state: AomiRuleChangeState;
  /** `agent:<connection key>` when the agent filed it, else `portal` or `cli`. */
  proposed_by: string;
  /** Unix seconds. */
  expires_at: number;
  /** Set when only this wallet's signature approves the change. */
  signer: AomiRulesAdminWallet | null;
  /** The exact UTF-8 text `signer` signs. */
  sign_message: string | null;
};

const ENFORCEMENT_STATES = ["off", "on", "behind", "unverified"] as const;

/** The rules a provider holds. The rest stay with Aomi alone. */
export type AomiRulesCovers = {
  /** App ids. */
  apps: string[];
  /** Asset ids of the limits. */
  limits: string[];
  not_after: boolean;
  owner_only: boolean;
};

/**
 * One on-chain provider that can hold a wallet's rules, and whether it does.
 * A client shows it and signs what its steps hand back; it never needs to
 * know which provider it is.
 */
export type AomiRulesEnforcement = {
  /** The id the enforcement steps take. */
  provider: string;
  /** The name to show. */
  name: string;
  /**
   * `behind`: the chain holds something else than the rules ask for.
   * `unverified`: the chain could not be read.
   */
  state: (typeof ENFORCEMENT_STATES)[number];
  covers: AomiRulesCovers;
  /** What the chain will still let through, in base units by asset id. */
  left: Record<string, string>;
  /** Why the rules cannot go on chain, or what is wrong there. */
  note: string | null;
  /** There is something to sign: the first policy, or an update. */
  ready: boolean;
  /** The owner's wallet that signs; its address once the rules are on chain. */
  signer: { family: AomiWalletFamily; address: string | null };
};

/** A transaction the owner's wallet signs and sends. */
export type AomiRulesTransaction = {
  family: AomiWalletFamily;
  network: string;
  unsigned_base64: string;
};

export type AomiRulesEnforceRequest = {
  /** The rules' revision as the owner saw them. */
  revision: number;
  /** The owner's wallet that signs; needed the first time only. */
  owner?: string;
  /** Take the rules off the chain. */
  remove?: boolean;
};

export type AomiWalletRules = {
  agent_wallet_id: string;
  wallet_name: string;
  /** 0: the wallet never had rules. */
  revision: number;
  rules: AomiRuleSet;
  /** The rules as sentences, in the server's order. */
  sentences: string[];
  admin: AomiRulesAdmin;
  /** Unix seconds while the agent stopped the wallet for today. */
  stopped_until: number | null;
  usage: AomiRuleUsage[];
  /** Unix seconds: when the daily windows reset (the next 00:00 UTC). */
  window_ends_at: number | null;
  pending: AomiRuleChange | null;
  /** The on-chain providers that can hold these rules; Aomi always checks. */
  enforcement: AomiRulesEnforcement[];
  /** The account's own wallets that may become the admin. */
  admin_wallets: AomiRulesAdminWallet[];
};

/** A field left out keeps its current value. `rules` is the full new set. */
export type AomiRulesChangeRequest = {
  rules?: AomiRuleSet;
  admin?: AomiRulesAdmin;
  /** Connection keys to make Instant on this wallet. */
  instant?: string[];
};

/** `waiting`: the change is in `rules.pending` until the admin approves. */
export type AomiRulesChangeResult = {
  status: "applied" | "waiting" | "unchanged";
  rules: AomiWalletRules;
};

export type AomiRulesCatalogApp = {
  id: string;
  label: string;
  /** CAIP-2 chain ids the app runs on. */
  chains: string[];
};

export type AomiRulesCatalogToken = {
  asset: string;
  symbol: string;
  decimals: number;
  /** The chain's display name. */
  chain: string;
};

/** The apps and tokens a rule can name. */
export type AomiRulesCatalog = {
  apps: AomiRulesCatalogApp[];
  tokens: AomiRulesCatalogToken[];
};

export const RULES_ERROR_CODES = {
  appUnknown: "rules_app_unknown",
  assetInvalid: "rules_asset_invalid",
  amountInvalid: "rules_amount_invalid",
  duplicate: "rules_duplicate",
  adminWalletNotLinked: "rules_admin_wallet_not_linked",
  connectionInvalid: "rules_connection_invalid",
  walletNotFound: "agent_wallet_not_found",
  changeNotFound: "rules_change_not_found",
  /** The change was already approved, declined, replaced or expired. */
  changeNotOpen: "rules_change_not_open",
  /** The rules moved since they were read: read again and retry. */
  changed: "rules_changed",
  /** The chain does not show the signed transaction yet: confirm again. */
  chainNotSettled: "chain_not_settled",
  changePending: "rules_change_pending",
  /** The admin is a wallet: only its signature approves. */
  signatureRequired: "rules_signature_required",
  signatureInvalid: "rules_signature_invalid",
  /** A portal approval without a wallet signature needs a recent sign-in. */
  loginStale: "login_stale",
} as const;

export const rulesPaths = {
  wallet: (id: string) =>
    `/v1/account/agent-wallets/${encodeURIComponent(id)}/rules`,
  enforcement: (id: string, provider: string, step: "prepare" | "confirm") =>
    `/v1/account/agent-wallets/${encodeURIComponent(id)}/rules/enforcement/${encodeURIComponent(provider)}/${step}`,
  catalog: "/v1/account/rules/catalog",
  change: (id: string) => `/v1/account/rule-changes/${encodeURIComponent(id)}`,
  approve: (id: string) =>
    `/v1/account/rule-changes/${encodeURIComponent(id)}/approve`,
  decline: (id: string) =>
    `/v1/account/rule-changes/${encodeURIComponent(id)}/decline`,
} as const;

const { invalid, family, list, text } = responseReader("rules");

const DIGITS = /^[0-9]+$/;

/** A base-unit amount: a decimal string, never a JSON number. */
function amount(value: unknown, field: string): string {
  const digits = text(value, field);
  if (!DIGITS.test(digits)) throw invalid(`${field} must be a decimal string`);
  return digits;
}

function unixSeconds(value: unknown, field: string): number {
  if (typeof value !== "number") throw invalid(`${field} must be a number`);
  return value;
}

const decimalsOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

function parseAdminWallet(value: unknown): AomiRulesAdminWallet {
  const record = asRecord(value);
  return {
    kind: "wallet",
    family: family(record?.family),
    address: text(record?.address, "admin.address"),
  };
}

function parseAdmin(value: unknown): AomiRulesAdmin {
  const kind = asRecord(value)?.kind;
  if (kind === "aomi_managed") return { kind };
  if (kind === "wallet") return parseAdminWallet(value);
  throw invalid(`unsupported admin: ${String(kind)}`);
}

const RULE_FIELDS = ["apps", "limits", "not_after", "owner_only"];

/**
 * The rule set; a missing one reads as no rules. A field this SDK does not
 * know fails: it must not be dropped from a write.
 */
export function parseRuleSet(value: unknown): AomiRuleSet {
  const record = value === undefined || value === null ? {} : asRecord(value);
  if (!record) throw invalid("rules must be an object");
  const unknown = Object.keys(record).find(
    (field) => !RULE_FIELDS.includes(field),
  );
  if (unknown) throw invalid(`unsupported rule: ${unknown}`);
  const { apps, not_after, owner_only } = record;
  if (owner_only !== undefined && typeof owner_only !== "boolean")
    throw invalid("rules.owner_only must be a boolean");
  return {
    apps:
      apps === undefined || apps === null
        ? null
        : list(apps, "rules.apps").map((app) => text(app, "rules.apps")),
    limits: list(record.limits, "rules.limits").map((entry) => {
      const limit = asRecord(entry);
      return {
        asset: text(limit?.asset, "limit.asset"),
        amount: amount(limit?.amount, "limit.amount"),
        symbol: stringValue(limit?.symbol) ?? null,
        decimals: decimalsOf(limit?.decimals),
      };
    }),
    not_after:
      not_after === undefined || not_after === null
        ? null
        : unixSeconds(not_after, "rules.not_after"),
    owner_only: owner_only === true,
  };
}

export function parseRuleChange(value: unknown): AomiRuleChange {
  const record = asRecord(value);
  if (!record) throw invalid("change must be an object");
  const state = CHANGE_STATES.find((known) => known === record.state);
  if (!state)
    throw invalid(`unsupported change state: ${String(record.state)}`);
  return {
    id: text(record.id, "change.id"),
    agent_wallet_id: text(record.agent_wallet_id, "change.agent_wallet_id"),
    wallet_name: text(record.wallet_name, "change.wallet_name"),
    lines: list(record.lines, "change.lines").map((entry) => {
      const line = asRecord(entry);
      return {
        text: text(line?.text, "line.text"),
        loosens: line?.loosens === true,
      };
    }),
    state,
    proposed_by: stringValue(record.proposed_by) ?? "",
    expires_at: unixSeconds(record.expires_at, "change.expires_at"),
    signer: asRecord(record.signer) ? parseAdminWallet(record.signer) : null,
    sign_message: stringValue(record.sign_message) ?? null,
  };
}

function parseEnforcement(value: unknown): AomiRulesEnforcement {
  const record = asRecord(value);
  const covers = asRecord(record?.covers);
  const signer = asRecord(record?.signer);
  const state = ENFORCEMENT_STATES.find((known) => known === record?.state);
  if (!state)
    throw invalid(`unsupported enforcement state: ${String(record?.state)}`);
  const names = (entries: unknown, field: string) =>
    list(entries ?? [], field).map((entry) => text(entry, field));
  return {
    provider: text(record?.provider, "enforcement.provider"),
    name: text(record?.name, "enforcement.name"),
    state,
    covers: {
      apps: names(covers?.apps, "enforcement.covers.apps"),
      limits: names(covers?.limits, "enforcement.covers.limits"),
      not_after: covers?.not_after === true,
      owner_only: covers?.owner_only === true,
    },
    left: Object.fromEntries(
      Object.entries(asRecord(record?.left) ?? {}).map(([asset, left]) => [
        asset,
        amount(left, "enforcement.left"),
      ]),
    ),
    note: stringValue(record?.note) ?? null,
    ready: record?.ready === true,
    signer: {
      family: family(signer?.family),
      address: stringValue(signer?.address) ?? null,
    },
  };
}

export function parseWalletRules(value: unknown): AomiWalletRules {
  const record = asRecord(value);
  if (!record) throw invalid("rules must be an object");
  return {
    agent_wallet_id: text(record.agent_wallet_id, "agent_wallet_id"),
    wallet_name: text(record.wallet_name, "wallet_name"),
    revision: unixSeconds(record.revision, "revision"),
    rules: parseRuleSet(record.rules),
    sentences: list(record.sentences, "sentences").map((sentence) =>
      text(sentence, "sentences"),
    ),
    admin: parseAdmin(record.admin),
    stopped_until: numberOrNull(record.stopped_until),
    usage: list(record.usage, "usage").map((entry) => {
      const usage = asRecord(entry);
      return {
        asset: text(usage?.asset, "usage.asset"),
        used: amount(usage?.used, "usage.used"),
        cap: amount(usage?.cap, "usage.cap"),
        symbol: stringValue(usage?.symbol) ?? null,
        decimals: decimalsOf(usage?.decimals),
      };
    }),
    window_ends_at: numberOrNull(record.window_ends_at),
    pending: asRecord(record.pending) ? parseRuleChange(record.pending) : null,
    // A backend from before on-chain providers sends none.
    enforcement: list(record.enforcement ?? [], "enforcement").map(
      parseEnforcement,
    ),
    admin_wallets: list(record.admin_wallets, "admin_wallets").map(
      parseAdminWallet,
    ),
  };
}

export function parseRulesCatalog(value: unknown): AomiRulesCatalog {
  const record = asRecord(value);
  return {
    apps: list(record?.apps, "apps").map((entry) => {
      const app = asRecord(entry);
      const id = text(app?.id, "app.id");
      return {
        id,
        label: stringValue(app?.label) ?? id,
        chains: list(app?.chains, "app.chains").map((chain) =>
          text(chain, "app.chains"),
        ),
      };
    }),
    tokens: list(record?.tokens, "tokens").map((entry) => {
      const token = asRecord(entry);
      const decimals = decimalsOf(token?.decimals);
      if (decimals === null) throw invalid("token.decimals must be a number");
      return {
        asset: text(token?.asset, "token.asset"),
        symbol: text(token?.symbol, "token.symbol"),
        decimals,
        chain: stringValue(token?.chain) ?? "",
      };
    }),
  };
}

/** The rule set as a write sends it: no server-filled display fields. */
const wireRules = (rules: AomiRuleSet): AomiRuleSet => ({
  apps: rules.apps,
  limits: rules.limits.map(({ asset, amount }) => ({ asset, amount })),
  not_after: rules.not_after,
  owner_only: rules.owner_only,
});

/** An agent wallet's rules, the catalog they pick from, and rule changes. */
export class AccountRulesTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  /** The wallet's rules, today's usage, its admin and any waiting change. */
  async get(
    agentWalletId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiWalletRules> {
    return parseWalletRules(
      await this.request("GET", rulesPaths.wallet(agentWalletId), options),
    );
  }

  /**
   * Change the rules, the admin or which connections are Instant. A change
   * that only takes power away answers `applied`; one that gives power or
   * changes the admin answers `waiting` with the change in `rules.pending`.
   */
  async change(
    agentWalletId: string,
    request: AomiRulesChangeRequest,
  ): Promise<AomiRulesChangeResult> {
    const record = asRecord(
      await this.request("POST", rulesPaths.wallet(agentWalletId), {
        body: {
          ...request,
          ...(request.rules ? { rules: wireRules(request.rules) } : {}),
        },
      }),
    );
    const status = record?.status;
    if (status !== "applied" && status !== "waiting" && status !== "unchanged")
      throw invalid(`unsupported status: ${String(status)}`);
    return { status, rules: parseWalletRules(record?.rules) };
  }

  /** The apps and tokens a rule can name. */
  async catalog(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiRulesCatalog> {
    return parseRulesCatalog(
      await this.request("GET", rulesPaths.catalog, options),
    );
  }

  /** One rule change by id, open or decided. */
  async getChange(
    changeId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiRuleChange> {
    return parseRuleChange(
      await this.request("GET", rulesPaths.change(changeId), options),
    );
  }

  /**
   * Approve a waiting change. When the change names a `signer`, pass that
   * wallet's signature over `sign_message`: EIP-191 hex for EVM, base58 or
   * base64 for Solana. Without one, a portal session must have signed in
   * within the last 10 minutes (403 `login_stale`).
   */
  async approveChange(
    changeId: string,
    options: { signature?: string } = {},
  ): Promise<AomiWalletRules> {
    return parseWalletRules(
      await this.request("POST", rulesPaths.approve(changeId), {
        body: options.signature ? { signature: options.signature } : {},
      }),
    );
  }

  /** Decline a waiting change; the rules stay as they are. */
  async declineChange(changeId: string): Promise<AomiWalletRules> {
    return parseWalletRules(
      await this.request("POST", rulesPaths.decline(changeId), { body: {} }),
    );
  }

  /**
   * The transaction the owner's wallet signs to put the rules on chain with
   * `provider`, to update them there, or to `remove` them. Null when the
   * chain already holds them: confirm without a signature.
   */
  async prepareEnforcement(
    agentWalletId: string,
    provider: string,
    request: AomiRulesEnforceRequest,
  ): Promise<AomiRulesTransaction | null> {
    const record = asRecord(
      await this.request(
        "POST",
        rulesPaths.enforcement(agentWalletId, provider, "prepare"),
        { body: request },
      ),
    );
    const transaction = asRecord(record?.transaction);
    return transaction
      ? {
          family: family(transaction.family),
          network: text(transaction.network, "transaction.network"),
          unsigned_base64: text(
            transaction.unsigned_base64,
            "transaction.unsigned_base64",
          ),
        }
      : null;
  }

  /**
   * Have the backend read the chain after the owner's wallet sent the
   * prepared transaction. Answers the rules with the provider's new state;
   * `chain_not_settled` means its node does not show the transaction yet.
   */
  async confirmEnforcement(
    agentWalletId: string,
    provider: string,
    request: AomiRulesEnforceRequest & { transaction_signature?: string },
  ): Promise<AomiWalletRules> {
    const record = asRecord(
      await this.request(
        "POST",
        rulesPaths.enforcement(agentWalletId, provider, "confirm"),
        { body: request },
      ),
    );
    return parseWalletRules(record?.rules);
  }

  private request(
    method: AomiHttpMethod,
    path: string,
    options?: AomiRequestOptions,
  ): Promise<unknown> {
    return walletRequest(this.requestResponse, method, path, options);
  }
}
