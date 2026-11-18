import type { AomiOAuthTokenProvider } from "./authorization";
import type { GuestSessionProvider } from "./guest-auth";
import type { x402Client, x402HTTPClient } from "@x402/core/client";

export { UserState } from "./user-state";
export type {
  UserStateConnection,
  UserStateEvm,
  UserStateSvm,
  AomiClientType,
} from "./user-state";
export { CLIENT_TYPE_TS_CLI, CLIENT_TYPE_WEB_UI } from "./user-state";

// =============================================================================
// Logger
// =============================================================================

/**
 * Optional logger for debug output. Pass `console` or any compatible object.
 */
export type Logger = {
  debug: (...args: unknown[]) => void;
};

// =============================================================================
// Client Options
// =============================================================================

export type AomiClientOptions = {
  /** Base URL of the public Aomi API (e.g. "https://aomi.chat" or "/" for same-origin proxying) */
  baseUrl: string;
  /** Optional fetch implementation for payment-aware browser transports and tests. */
  fetch?: typeof fetch;
  /** Agent key sent as `Aomi-Agent-Key`. Only private Agents need one; the Agent owner issues it. */
  apiKey?: string;
  /** Optional x402 signer used by the bounded payment retry transport. */
  x402?: x402Client | x402HTTPClient;
  /** Default inference funding lane used by high-level Agent sessions. */
  /** Supplies a short-lived Aomi account bearer for REST and SSE requests. */
  getAccountBearer?: GetAccountBearer;
  /** Resource-bound developer OAuth. Takes precedence over session/guest auth. */
  oauth?: AomiOAuthTokenProvider;
  /** Low-friction Better Auth anonymous session for `/v1` calls. Defaults on. */
  guest?: boolean | GuestSessionProvider;
  /** Optional logger for debug output (default: silent) */
  logger?: Logger;
};

export type GetAccountBearer = ((options?: {
  /** Force a refresh after an API 401. */
  forceRefresh?: boolean;
}) => Promise<string | null | undefined>) & {
  /**
   * When true, a throwing bearer source is fatal: the wrapped fetch rethrows
   * instead of proceeding unauthenticated. Providers that mint a required
   * (widget) session set this; additive account bearers leave it unset.
   */
  required?: boolean;
  /**
   * Notifies consumers when the bearer rotates or is revoked. AomiClient uses
   * this to reconnect live SSE streams with the new credential.
   *
   * The property is optional because API-key and cookie-backed integrations do
   * not own a refreshable account bearer. AccountSessionProvider always exposes
   * it. Wrappers around a widget provider must preserve this subscription or
   * provide their own stable forwarding subscription.
   */
  subscribe?: (listener: () => void) => () => void;
};

export type AomiRequestQueryValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]
  | null
  | undefined;

export type AomiPlatformFilter = string | readonly string[] | null | undefined;

export type AomiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AomiRequestOptions {
  /** Cancels the response body as well as the request. */
  signal?: AbortSignal;
  /** Thread id for thread-scoped routes. Kept as sessionId for SDK compatibility. */
  sessionId?: string;
  /** Agent key for agent-key checked routes; defaults to the client's apiKey. */
  apiKey?: string;
  /** Query params appended to the request URL. */
  query?: Record<string, AomiRequestQueryValue>;
  /** JSON request payload. */
  body?: unknown;
  /** Extra request headers. */
  headers?: HeadersInit;
  /** Use the native fetch path instead of a custom payment-aware fetch wrapper. */
  raw?: boolean;
  /** Request-local signer for an explicitly reviewed purchase. */
  x402?: x402Client | x402HTTPClient;
}

/**
 * POST /api/exec/simulate
 * Batch-simulate pending transactions atomically (snapshot → sequential send → revert).
 */
export interface AomiSimulateFee {
  /** Treasury address to receive the fee. */
  recipient: string;
  /** Fee amount in wei (decimal string). */
  amount_wei: string;
  /** Token type — always "native" for now. */
  token: "native";
}

export interface AomiSimulateResponse {
  result: SimReport;
  fee: AomiSimulateFee | null;
}

export interface SimulationCall {
  to: string;
  /** Decimal native atomic units; not display units or ERC-20 units. */
  value: string;
  data: string;
  gas_limit: number | null;
}

export interface SimContext {
  chain_id: number;
  sender: string;
  block_number: number;
  block_hash: string;
  engine: string;
  rules: string;
  balance_overrides: Array<{ address: string; amount: string }>;
}

export interface SimulationExecution {
  status:
    | { kind: "succeeded" | "reverted" | "failed" }
    | { kind: "halted"; reason: string };
  return_data: string;
  gas_used: number;
  logs: Array<{ address: string; topics: string[]; data: string }>;
  native_balance: { before: string; after: string } | null;
}

export interface SimStep {
  step: number;
  chain_id: number;
  label: string;
  call: SimulationCall;
  /** null means skipped after an earlier failure, not an unknown execution. */
  execution: SimulationExecution | null;
}

export interface SimReport {
  contexts: SimContext[];
  steps: SimStep[];
}

export interface SimulationError {
  code:
    | "invalid_input"
    | "unavailable"
    | "incomplete"
    | "fork_drift"
    | "world_needs_reopen";
  message: string;
  /** Diagnostic only: this report must never satisfy a simulation gate. */
  partial: SimReport;
  interrupted_step: number | null;
}

export type AomiAccountResponse = AomiAccountProfile;

/**
 * GET /api/account
 * The account bound to the authenticated request (resolved from the account
 * bearer). Returned only when the session is bound to a real user; an
 * anonymous session yields HTTP 400.
 */
export interface AomiUser {
  user_id: string;
  username: string | null;
  agents: string[];
  /** Exact hosted agent rows installed by this account. */
  agent_ids?: number[];
  tier: "anon" | "free" | "pro";
  verified_email: string | null;
  status: string;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

export type AomiChainKind = "evm" | "svm";
export type AomiAccountRecordStatus =
  | "provisioning"
  | "active"
  | "expired"
  | "revoked"
  | "unavailable";

export interface AomiOnchainAddress {
  chain: AomiChainKind;
  address: string;
}

export interface AomiAuthProvider {
  id: number;
  provider: string;
  method: string;
  verified_at: number | null;
  is_primary: boolean;
  created_at: number;
}

export interface AomiUserAccount {
  address: AomiOnchainAddress;
  auth_provider?: string | null;
  is_primary: boolean;
  provider_managed: boolean;
}

export interface AomiSigningPolicy {
  address: AomiOnchainAddress;
  mode: "auto" | "manual" | "denied";
  authorization_version: number;
  last_authorized_at: number | null;
  last_authorized_by: AomiOnchainAddress | null;
}

export interface AomiDelegatedAccount {
  id: number;
  address: AomiOnchainAddress;
  delegation_provider: string;
  kind: string;
  status: AomiAccountRecordStatus;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  revocation_reason: string | null;
}

export interface AomiOperatingAccount {
  id: number;
  owner: AomiOnchainAddress;
  operating: AomiOnchainAddress;
  chain_ref: string;
  provider: string;
  kind: string;
  status: AomiAccountRecordStatus;
  version: number;
  created_at: number;
  updated_at: number;
}

export type AomiPolicyWindow =
  | { unit: "slots"; value: number }
  | { unit: "blocks"; value: number }
  | { unit: "seconds"; value: number };

export type AomiOnchainPolicyRule =
  | { type: "allowed_call_target"; target: AomiOnchainAddress }
  | { type: "lifetime_native_asset_limit"; amount: string }
  | {
      type: "recurring_native_asset_limit";
      amount: string;
      window: AomiPolicyWindow;
    }
  | {
      type: "lifetime_token_asset_limit";
      mint: AomiOnchainAddress;
      amount: string;
    }
  | {
      type: "recurring_token_asset_limit";
      mint: AomiOnchainAddress;
      amount: string;
      window: AomiPolicyWindow;
    };

export interface AomiOnchainPolicy {
  version: number;
  rules: AomiOnchainPolicyRule[];
}

export type AomiProviderBinding = {
  provider: "swig";
  binding: { swig_account: AomiOnchainAddress; role_id: number };
};

export interface AomiOnchainPolicyBinding {
  id: number;
  owner: AomiOnchainAddress;
  delegate: AomiOnchainAddress;
  operating_account_id: number;
  policy: AomiOnchainPolicy;
  provider_binding: AomiProviderBinding;
  status: AomiAccountRecordStatus;
  created_at: number;
  updated_at: number;
  confirmed_at: number | null;
  revoked_at: number | null;
}

export interface AomiAccountProfile {
  user: AomiUser;
  auth_providers: AomiAuthProvider[];
  user_accounts: AomiUserAccount[];
  signing_policies: AomiSigningPolicy[];
  delegated_accounts: AomiDelegatedAccount[];
  operating_accounts: AomiOperatingAccount[];
  onchain_policy_bindings: AomiOnchainPolicyBinding[];
}

export type AomiWalletFamily = "evm" | "svm";

/**
 * POST /v1/account/keys
 * Ingests secrets for a client, returns opaque handles
 */
export interface AomiIngestSecretsResponse {
  handles: Record<string, string>;
}

/**
 * DELETE /v1/account/keys
 * Clears all secrets for a client
 */
export interface AomiClearSecretsResponse {
  cleared: boolean;
}

/**
 * DELETE /v1/account/keys/:name
 * Removes a single secret for a client
 */
export interface AomiDeleteSecretResponse {
  deleted: boolean;
}

/**
 * GET /v1/account/keys
 * Client slot names currently filled for the session's client. The
 * backend never returns raw values; only the names.
 */
export interface AomiListSecretsResponse {
  /** Client-scoped handle names (`BYOK:*`, `PAYMENT:*`). */
  names?: string[];
}

/** Why a package is on or off for the next turn (`GET /api/account/packages`). */
export type AomiPackageReason =
  | "agent_listed"
  | "verified_default"
  | "chosen_on"
  | "chosen_off"
  | "off_by_default";

/** A chain family a package works on. */
export type AomiPackageFamily = "evm" | "svm";

/** A secret slot of the live release: its owner and whether it holds a value. Never the value. */
export interface AomiPackageSlot {
  name: string;
  /** `person`: each account adds its own; `builder`: the publisher sets it. */
  owner: "person" | "builder";
  description: string;
  required: boolean;
  status: "ready" | "missing";
}

/** A typed-data or message signature the package may ask for. */
export interface AomiPackageSignature {
  kind: "evm-typed-data" | "evm-message" | "svm-message";
  domains: { chain_id: number; verifying_contract: string }[];
  primary_types: string[];
}

/** What the live release may reach; `hash` identifies it. */
export interface AomiPackageEnvelope {
  hash: string;
  hosts: string[];
  /** Families it may ask the person to approve transactions on. */
  transactions: AomiPackageFamily[];
  signatures: AomiPackageSignature[];
}

/**
 * A listed package as anyone may read it (`/api/public/catalog/packages`):
 * nothing tied to an account.
 */
export interface AomiPublicPackage {
  /** `publisher/name`. */
  id: string;
  display_name: string;
  description: string;
  icon_url: string | null;
  families: AomiPackageFamily[];
  tool_count: number;
  skills: { id: string; description: string }[];
  /** The live envelope is within the approved one. */
  verified: boolean;
}

/** One Library row: a package with a live release and this account's effective state. */
export interface AomiPackage extends AomiPublicPackage {
  package_id: number;
  live: { release: number; digest: string };
  listed: boolean;
  /** The agent lists it: always on, the switch is disabled. */
  agent_listed: boolean;
  /** The person's explicit choice; `null` means none. */
  choice: boolean | null;
  /** Effective state used by the runtime at the next turn. */
  enabled: boolean;
  reason: AomiPackageReason;
  envelope: AomiPackageEnvelope;
  slots: AomiPackageSlot[];
}

/** `GET /api/account/packages`: the thread's agent and every package row. */
export interface AomiPackageCatalog {
  agent: { id: string; display_name: string };
  packages: AomiPackage[];
}

/** `PUT|DELETE /api/account/packages/:package_id/secrets/:slot` */
export interface AomiPackageSecretStatus {
  slot?: string;
  status: "ready" | "missing";
}

/** A builtin tool surface available to the thread. */
export interface ToolsetCard {
  name: string;
  display_name: string;
}

/** The one live hosted agent resolved by an agent key. */
export interface AgentCard {
  agent_id: number;
  agent: string;
  display_name: string;
  metadata: Record<string, unknown>;
}

/** Account- and thread-scoped catalog, including effective Library state. */
export interface ThreadCatalog {
  toolsets: ToolsetCard[];
  packages: AomiPackage[];
}

export type AomiFeatureCategory =
  | "lending"
  | "cross-chain"
  | "staking"
  | "trading"
  | "research"
  | "wallets"
  | "developer";
