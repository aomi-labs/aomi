import type { AomiOAuthTokenProvider } from "./authorization";
import type { GuestSessionProvider } from "./guest-auth";
import type { x402Client, x402HTTPClient } from "@x402/core/client";
import type { AomiInferenceFundingSource } from "./agent/types";

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
  /** Base URL of the Aomi backend (e.g. "https://api.aomi.dev" or "/" for same-origin proxying) */
  baseUrl: string;
  /** Optional fetch implementation for payment-aware browser transports and tests. */
  fetch?: typeof fetch;
  /** Default API key for non-default apps */
  apiKey?: string;
  /** Optional x402 signer used by the bounded payment retry transport. */
  x402?: x402Client | x402HTTPClient;
  /** Default inference funding lane used by high-level Agent sessions. */
  inferenceFunding?: AomiInferenceFundingSource;
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

/** Stable id of a hosted app; null/empty means "not app-scoped". */
export type ApplicationId = number | string | null;

export type AomiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AomiRequestOptions {
  /** Thread id for thread-scoped routes. Kept as sessionId for SDK compatibility. */
  sessionId?: string;
  /** App key for app-key checked routes; defaults to the client's apiKey. */
  apiKey?: string;
  /** Query params appended to the request URL. */
  query?: Record<string, AomiRequestQueryValue>;
  /** JSON request payload. */
  body?: unknown;
  /** Extra request headers. */
  headers?: HeadersInit;
  /** Use the native fetch path instead of a custom payment-aware fetch wrapper. */
  raw?: boolean;
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
  result: {
    batch_success: boolean;
    stateful: boolean;
    from: string;
    network: string;
    total_gas?: number;
    fee?: AomiSimulateFee;
    steps: Array<{
      step: number;
      label: string;
      success: boolean;
      result?: string | null;
      revert_reason?: string | null;
      gas_used?: number;
      tx: { to: string; value_wei: string; value_eth: string; data: string };
    }>;
  };
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
  apps: string[];
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
  mode: "auto" | "manual" | "client_auto" | "denied";
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

export interface AomiBeginAccountAuthResponse {
  state_token: string;
  auth_url: string;
  expires_at: number;
}

export type AomiWalletFamily = "evm" | "svm";
export type AomiAuthWalletFamily = "evm" | "solana";
/** Provider login intent. Linking ownership never implies delegated signing. */
export type AomiAuthPurpose = "link_wallet" | "delegate_signing";

/** GET/POST/DELETE /api/account/model-keys. */
export interface AomiByokKeyEntry {
  provider: string;
  key_prefix: string;
  label?: string | null;
  is_active: boolean;
}

export interface AomiListByokKeysResponse {
  keys: AomiByokKeyEntry[];
}

export interface AomiSaveByokKeyResponse {
  key: AomiByokKeyEntry;
}

export interface AomiDeleteByokKeyResponse {
  deleted: boolean;
}

/**
 * POST /api/secrets
 * Ingests secrets for a client, returns opaque handles
 */
export interface AomiIngestSecretsResponse {
  handles: Record<string, string>;
}

/**
 * DELETE /api/secrets
 * Clears all secrets for a client
 */
export interface AomiClearSecretsResponse {
  cleared: boolean;
}

/**
 * DELETE /api/secrets/:name
 * Removes a single secret for a client
 */
export interface AomiDeleteSecretResponse {
  deleted: boolean;
}

/**
 * GET /api/secrets
 * Per-app slot names currently filled for the session's client. The
 * backend never returns raw values; only the names.
 */
export interface AomiListSecretsResponse {
  /** Client-scoped handle names (`BYOK:*`, `PAYMENT:*`). */
  names?: string[];
  /**
   * Retired. Per-user app-scoped secrets no longer exist — an application's
   * Environment belongs to its Builder. A backend that predates that change
   * still answers with this shape, and the one that follows it sends an empty
   * object for a release so pre-deploy browser tabs do not throw, so keep
   * reading it until every deployed backend is past the cutover.
   */
  by_app?: Record<string, string[]>;
}

/**
 * One per-app secret slot declared by a plugin manifest. Surfaced via
 * `AomiAppDescriptor.secrets` so the frontend can render input rows and
 * gate app load on `required` slots being filled.
 */
export interface AomiSecretSlot {
  name: string;
  description: string;
  required: boolean;
}

/** Hosted application artifact availability reported by the backend catalog. */
export type AomiArtifactStatus = "ready" | "pending" | "fetch_backoff";

/**
 * GET /api/thread/apps
 * One entry per app the user can use. `secrets` is empty for apps that
 * declare no slots.
 */
export interface AomiAppDescriptor {
  name: string;
  applicationId?: number | string | null;
  platform?: string | null;
  label?: string | null;
  appReleaseTag?: string | null;
  isActive?: boolean | null;
  isPublic?: boolean | null;
  artifactReady?: boolean | null;
  artifactStatus?: AomiArtifactStatus | null;
  secrets?: AomiSecretSlot[];
  /** Exact EVM chain IDs declared by the official app release. */
  chainIds?: number[];
}
