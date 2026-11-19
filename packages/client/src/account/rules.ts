/**
 * An agent wallet's rules: what the backend checks on every agent signature.
 * A mode (whitelist or blacklist), a list of rules (a token, a total amount,
 * where it may go and until when), and a switch for sends only to your linked
 * wallets. A change that only takes power away applies at once; one that
 * gives power, or changes the admin, waits for the wallet's admin.
 *
 * Hand-written wire types until the generated client covers them:
 *   - `GET  /v1/account/agent-wallets/:id/rules`     -> `AomiWalletRules`
 *   - `POST /v1/account/agent-wallets/:id/rules`     -> `AomiRulesChangeResult`
 *   - `GET  /v1/account/rules/catalog`               -> `AomiRulesCatalog`
 *   - `GET  /v1/account/rule-changes/:id`            -> `AomiRuleChange`
 *   - `POST /v1/account/rule-changes/:id/approve`    -> `AomiWalletRules`
 *   - `POST /v1/account/rule-changes/:id/decline`    -> `AomiWalletRules`
 *   - `POST /v1/account/agent-wallets/:id/rules/enforcement/:provider/prepare`
 *     -> `AomiRulesAction | null`
 *   - `POST /v1/account/agent-wallets/:id/rules/enforcement/:provider/confirm`
 *     -> `AomiWalletRules`
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

/** Where a rule's money goes. */
export type AomiRuleTo =
  /** Any listed app on the asset's chain. Never a plain send. */
  | { kind: "any_protocol" }
  /** One app, by its catalog id. */
  | { kind: "protocol"; id: string }
  /** A plain send to this address. */
  | { kind: "address"; address: string };

/**
 * At most `amount` of `asset` may go to `to` in total; `"0"` blocks it. The
 * total never resets. `amount` is in base units, a decimal string that can
 * exceed 2^53. `id`, `active_from`, `symbol` and `decimals` are filled by the
 * server (`symbol` is null for a token it does not know); a write does not
 * send them.
 */
export type AomiRule = {
  /** The rule's key, `<asset>@<to>`. */
  id?: string;
  /**
   * `eip155:<chainId>/native`, `eip155:<chainId>/erc20:<0x address>`,
   * `solana:mainnet-beta/native` or `solana:mainnet-beta/token:<mint>`.
   */
  asset: string;
  amount: string;
  to: AomiRuleTo;
  /** Unix seconds: when the rule took effect. Set by the server. */
  active_from?: number;
  /**
   * Unix seconds: when the rule ends. Left out, it is always on. A rule past
   * its end stays in the list; compare this with the clock.
   */
  active_until?: number;
  symbol?: string | null;
  decimals?: number | null;
};

const MODES = ["whitelist", "blacklist"] as const;

/**
 * `blacklist`: everything may be spent, except as a rule caps it.
 * `whitelist`: only what a rule lists may be spent.
 */
export type AomiRulesMode = (typeof MODES)[number];

/** What the agent may sign with a wallet. */
export type AomiRuleSet = {
  mode: AomiRulesMode;
  rules: AomiRule[];
  /** Sends only go to the account's own linked wallets. */
  linked_only: boolean;
};

/** False for a wallet that is unrestricted. */
export const hasRules = (rules: AomiRuleSet): boolean =>
  rules.mode === "whitelist" || rules.rules.length > 0 || rules.linked_only;

/** A rule's key as the server writes it: `<asset>@<to>`. */
export function ruleKey(rule: Pick<AomiRule, "asset" | "to">): string {
  const { to } = rule;
  const where =
    to.kind === "any_protocol"
      ? "any"
      : to.kind === "protocol"
        ? `protocol:${to.id}`
        : `address:${to.address.startsWith("0x") ? to.address.toLowerCase() : to.address}`;
  return `${rule.asset}@${where}`;
}

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

/**
 * One on-chain provider's hold on one rule: a rule is one deployment, with
 * its own total and its own end. A client shows it and signs what its steps
 * hand back; it never needs to know which provider it is. A rule no provider
 * can hold has no entry; a rule that was removed while its deployment is
 * still on chain keeps one under its old id.
 */
export type AomiRulesEnforcement = {
  /** The rule's key (`AomiRule.id`) the entry is about. */
  rule: string;
  /** The id the enforcement steps take. */
  provider: string;
  /** The name to show. */
  name: string;
  /**
   * The chain it holds the rule on, as the rules' asset ids write it
   * (`solana:mainnet-beta`, `eip155:8453`). A provider on several chains has
   * one entry per rule and chain.
   */
  network: string;
  /**
   * `off`: not on chain. `on`: the chain holds the rule as it stands.
   * `behind`: the chain holds something else (an earlier version, a rule that
   * was removed or has ended). `unverified`: the chain could not be read.
   */
  state: (typeof ENFORCEMENT_STATES)[number];
  /**
   * There is something to do: deploy the rule, replace what the chain holds,
   * or take it off.
   */
  ready: boolean;
  /**
   * What the chain will still let through of the rule's total, a decimal
   * string in base units of the rule's asset; null when nothing is on chain.
   */
  left: string | null;
  /**
   * Unix seconds at which the deployment stops signing on chain, for a rule
   * with an end. An estimate, a little later than the rule's own end.
   */
  expires_at: number | null;
  /** The address that holds the funds the rule spends; null before any. */
  account: string | null;
  /**
   * What the owner's wallet returned for the deployment, when it was
   * reported. Null for a rule held by a signed grant: nothing is deployed.
   */
  deployment_tx: string | null;
  /** Why the provider cannot hold the rule, or what is wrong. */
  note: string | null;
  /** The owner's wallet that signs; its address once a rule is on chain. */
  signer: { family: AomiWalletFamily; address: string | null };
};

/**
 * One on-chain provider on one network that this deployment has switched on
 * and that could hold the wallet's rules there, whether or not any rule is on
 * it yet. A picker reads it before a rule exists, when `enforcement` has no
 * entry to learn from. In blacklist mode providers hold nothing; they are
 * still listed.
 */
export type AomiRulesProvider = {
  /** The id the enforcement steps take. */
  provider: string;
  /** The name to show. */
  name: string;
  /** The chain, as `AomiRulesEnforcement.network` writes it. */
  network: string;
  /**
   * What a rule it can hold gets on chain, at least. `total_and_period`: the
   * total and the end, with where the money goes checked by Aomi only.
   * `total_period_and_destination`: those and where it may go. `note` says
   * where a kind of rule is held further.
   */
  holds: "total_and_period" | "total_period_and_destination";
  /** What else it holds, or what it leaves to Aomi. */
  note: string | null;
};

/** The EIP-712 data an owner's EVM wallet signs. */
export type AomiRulesTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  /**
   * Numbers above 2^53 arrive as decimal strings: convert the fields the
   * types declare as integers before signing.
   */
  message: Record<string, unknown>;
};

/**
 * What the owner's wallet does next, tagged by `kind`. A kind this client
 * does not know fails to parse rather than being guessed at; so does an
 * action whose `network` is not the one asked for.
 */
export type AomiRulesAction =
  /** Sign this transaction and send it; `confirm` then reads the chain. */
  | {
      kind: "transaction";
      /** The entry's `network`; its chain family says how the bytes are encoded. */
      network: string;
      unsigned_base64: string;
    }
  /** Sign this EIP-712 data and send nothing; `confirm` takes the signature. */
  | {
      kind: "typed_data";
      /** `eip155:<chainId>`, the entry's `network`. */
      network: string;
      typed_data: AomiRulesTypedData;
    }
  /** Send this plain EVM transaction from the owner's wallet and pay its gas; `confirm` takes no signature. */
  | {
      kind: "evm_transaction";
      /** `eip155:<chainId>`, the entry's `network`. */
      network: string;
      /** The 20-byte address the transaction goes to, `0x` hex. */
      to: string;
      /** The calldata, `0x` hex. */
      data: string;
      /** The value in wei, a `0x` hex quantity. */
      value: string;
    };

/** What a step asks of a provider, for one rule. */
export type AomiRulesEnforceRequest = {
  /** The entry's `network`. */
  network: string;
  /** The entry's `rule`: the rule to put on chain, update there, or remove. */
  rule: string;
  /** The rules' revision as the owner saw them. */
  revision: number;
  /** The owner's wallet that signs; needed for the wallet's first rule only. */
  owner?: string;
  /** Take a rule that is still in force off the chain. */
  remove?: boolean;
};

/**
 * `confirm`'s body. For a `typed_data` action `signature` is the signed data
 * (0x hex) and the provider cannot confirm without it. For a `transaction`
 * action the chain proves the step, so it is optional and only recorded. An
 * `evm_transaction` action takes none. `confirm` answers the rules as they
 * stand; while the chain does not show the sent transaction yet they come
 * back unchanged, so ask again.
 */
export type AomiRulesConfirmRequest = AomiRulesEnforceRequest & {
  signature?: string;
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
  pending: AomiRuleChange | null;
  /** Who enforces each rule, by rule key: `Aomi` first, then each provider. */
  enforced_by: Record<string, string[]>;
  /** The on-chain providers that can hold these rules; Aomi always checks. */
  enforcement: AomiRulesEnforcement[];
  /**
   * The providers switched on for this deployment that could hold this
   * wallet's rules, one per provider and network, rule or not. Empty from a
   * backend that does not send it.
   */
  providers: AomiRulesProvider[];
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
  /** A rule's address is not one of its asset's chain. */
  addressInvalid: "rules_address_invalid",
  duplicate: "rules_duplicate",
  /** A new or changed rule's `active_until` is not in the future. */
  periodInvalid: "rules_period_invalid",
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
  /** The provider cannot hold the rule (`note` on its entry says why). */
  notEnforceable: "rules_not_enforceable",
  /** A step's `rule` is neither a rule of the wallet nor on chain. */
  ruleNotFound: "rule_not_found",
  /** A removal for a rule that has nothing on chain. */
  bindingNotFound: "binding_not_found",
  /** No provider by that id and `network` holds this wallet's rules. */
  providerNotFound: "policy_provider_not_found",
  /** The rule needs more programs than one transaction can carry. */
  deploymentTooLarge: "deployment_too_large",
  /** `confirm` for a `typed_data` action came without its `signature`. */
  stepSignatureRequired: "signature_required",
  /** The `signature` is not the owner wallet's over exactly what `prepare` returned. */
  stepSignatureInvalid: "signature_invalid",
  /** A `signature` came for a `transaction` action that cannot take one. */
  stepSignatureUnexpected: "signature_unexpected",
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

const RULE_FIELDS = ["mode", "rules", "linked_only"];

/** A rule's optional unix-seconds field: left out when the server sent none. */
function period<Field extends "active_from" | "active_until">(
  value: unknown,
  field: Field,
): Partial<Record<Field, number>> {
  if (value === undefined || value === null) return {};
  return { [field]: unixSeconds(value, `rule.${field}`) } as Record<
    Field,
    number
  >;
}

function parseTo(value: unknown): AomiRuleTo {
  const record = asRecord(value);
  const kind = record?.kind;
  if (kind === "any_protocol") return { kind };
  if (kind === "protocol") return { kind, id: text(record?.id, "rule.to.id") };
  if (kind === "address")
    return { kind, address: text(record?.address, "rule.to.address") };
  throw invalid(`unsupported rule destination: ${String(kind)}`);
}

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
  const { mode, linked_only } = record;
  if (mode !== undefined && !MODES.some((known) => known === mode))
    throw invalid(`unsupported mode: ${String(mode)}`);
  if (linked_only !== undefined && typeof linked_only !== "boolean")
    throw invalid("rules.linked_only must be a boolean");
  return {
    mode: mode === "whitelist" ? "whitelist" : "blacklist",
    rules: list(record.rules ?? [], "rules.rules").map((entry) => {
      const rule = asRecord(entry);
      const parsed: AomiRule = {
        asset: text(rule?.asset, "rule.asset"),
        amount: amount(rule?.amount, "rule.amount"),
        to: parseTo(rule?.to),
        ...period(rule?.active_from, "active_from"),
        ...period(rule?.active_until, "active_until"),
        symbol: stringValue(rule?.symbol) ?? null,
        decimals: decimalsOf(rule?.decimals),
      };
      return { ...parsed, id: stringValue(rule?.id) ?? ruleKey(parsed) };
    }),
    linked_only: linked_only === true,
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

/** A number of unix seconds, or null when the server sent none. */
function optionalSeconds(value: unknown, field: string): number | null {
  return value === undefined || value === null
    ? null
    : unixSeconds(value, field);
}

function parseEnforcement(value: unknown): AomiRulesEnforcement {
  const record = asRecord(value);
  const signer = asRecord(record?.signer);
  const state = ENFORCEMENT_STATES.find((known) => known === record?.state);
  if (!state)
    throw invalid(`unsupported enforcement state: ${String(record?.state)}`);
  return {
    rule: text(record?.rule, "enforcement.rule"),
    provider: text(record?.provider, "enforcement.provider"),
    name: text(record?.name, "enforcement.name"),
    network: text(record?.network, "enforcement.network"),
    state,
    ready: record?.ready === true,
    left:
      record?.left === undefined || record.left === null
        ? null
        : amount(record.left, "enforcement.left"),
    expires_at: optionalSeconds(record?.expires_at, "enforcement.expires_at"),
    account: stringValue(record?.account) ?? null,
    deployment_tx: stringValue(record?.deployment_tx) ?? null,
    note: stringValue(record?.note) ?? null,
    signer: {
      family: family(signer?.family),
      address: stringValue(signer?.address) ?? null,
    },
  };
}

function parseProvider(value: unknown): AomiRulesProvider {
  const record = asRecord(value);
  const holds = record?.holds;
  if (holds !== "total_and_period" && holds !== "total_period_and_destination")
    throw invalid(`unsupported provider holds: ${String(holds)}`);
  return {
    provider: text(record?.provider, "providers.provider"),
    name: text(record?.name, "providers.name"),
    network: text(record?.network, "providers.network"),
    holds,
    note: stringValue(record?.note) ?? null,
  };
}

function parseTypedData(value: unknown): AomiRulesTypedData {
  const record = asRecord(value);
  const types = asRecord(record?.types);
  const domain = asRecord(record?.domain);
  const message = asRecord(record?.message);
  if (!record || !types || !domain || !message)
    throw invalid("action.typed_data needs a domain, types and a message");
  return {
    domain,
    types: Object.fromEntries(
      Object.entries(types).map(([name, fields]) => [
        name,
        list(fields, `action.typed_data.types.${name}`).map((entry) => {
          const field = asRecord(entry);
          return {
            name: text(field?.name, "action.typed_data field name"),
            type: text(field?.type, "action.typed_data field type"),
          };
        }),
      ]),
    ),
    primaryType: text(record.primaryType, "action.typed_data.primaryType"),
    message,
  };
}

const EVM_NETWORK = /^eip155:[1-9][0-9]*$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const HEX_QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

function hex(value: unknown, field: string, pattern: RegExp, what: string) {
  const found = text(value, field);
  if (!pattern.test(found)) throw invalid(`${field} must be ${what}`);
  return found;
}

function parseEvmTransaction(
  action: Record<string, unknown>,
  network: string,
): Extract<AomiRulesAction, { kind: "evm_transaction" }> {
  if (!EVM_NETWORK.test(network))
    throw invalid("action.network must be eip155:<chain id>");
  return {
    kind: "evm_transaction",
    network,
    to: hex(action.to, "action.to", EVM_ADDRESS, "a 20-byte 0x address"),
    data: hex(action.data, "action.data", HEX_DATA, "0x hex bytes"),
    value: hex(action.value, "action.value", HEX_QUANTITY, "a 0x hex quantity"),
  };
}

function parseAction(value: unknown): AomiRulesAction {
  const action = asRecord(value);
  const kind = action?.kind;
  if (
    !action ||
    (kind !== "transaction" &&
      kind !== "typed_data" &&
      kind !== "evm_transaction")
  )
    throw invalid(`unsupported action: ${String(kind)}`);
  const network = text(action.network, "action.network");
  if (kind === "evm_transaction") return parseEvmTransaction(action, network);
  return kind === "transaction"
    ? {
        kind,
        network,
        unsigned_base64: text(action.unsigned_base64, "action.unsigned_base64"),
      }
    : { kind, network, typed_data: parseTypedData(action.typed_data) };
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
    pending: asRecord(record.pending) ? parseRuleChange(record.pending) : null,
    enforced_by: Object.fromEntries(
      Object.entries(asRecord(record.enforced_by) ?? {}).map(
        ([rule, names]) => [
          rule,
          list(names, "enforced_by").map((name) => text(name, "enforced_by")),
        ],
      ),
    ),
    // A backend from before on-chain providers sends none.
    enforcement: list(record.enforcement ?? [], "enforcement").map(
      parseEnforcement,
    ),
    // A backend from before the picker's hint sends none.
    providers: list(record.providers ?? [], "providers").map(parseProvider),
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

/**
 * The rule set as a write sends it: no server-filled fields. A rule's end
 * goes along; its start is the server's.
 */
const wireRules = (rules: AomiRuleSet): AomiRuleSet => ({
  mode: rules.mode,
  rules: rules.rules.map(({ asset, amount, to, active_until }) => ({
    asset,
    amount,
    to,
    ...(typeof active_until === "number" ? { active_until } : {}),
  })),
  linked_only: rules.linked_only,
});

/** An agent wallet's rules, the catalog they pick from, and rule changes. */
export class AccountRulesTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  /** The wallet's rules, its admin and any waiting change. */
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
   * What the owner's wallet does to put one rule (`request.rule`) on chain
   * with `provider`, to replace what the chain holds for it, or to `remove`
   * it. Null when the chain already shows what was asked: confirm straight
   * away.
   */
  async prepareEnforcement(
    agentWalletId: string,
    provider: string,
    request: AomiRulesEnforceRequest,
  ): Promise<AomiRulesAction | null> {
    const record = asRecord(
      await this.request(
        "POST",
        rulesPaths.enforcement(agentWalletId, provider, "prepare"),
        { body: request },
      ),
    );
    return asRecord(record?.action) ? parseAction(record?.action) : null;
  }

  /**
   * Have the backend read the chain after the owner's wallet did what
   * `prepareEnforcement` answered. For a `typed_data` action pass the
   * wallet's `signature`; for a transaction (`transaction`, `evm_transaction`)
   * the chain is the proof. Answers the rules with the provider's new state;
   * `chain_not_settled` means its node does not show the transaction yet:
   * confirm again. After a sent `evm_transaction` the rules also come back
   * unchanged until the node shows it, so ask again.
   */
  async confirmEnforcement(
    agentWalletId: string,
    provider: string,
    request: AomiRulesConfirmRequest,
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
