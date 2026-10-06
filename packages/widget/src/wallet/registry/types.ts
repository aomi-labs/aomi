import type { WalletFamily, WalletSource } from "../types";

/** Runtime id vs stable id: wagmi connector `uid` is regenerated every page load;
 * `connector.id` (e.g. hosted SDK ids, "io.metamask", "metaMaskSDK", "walletConnect") is stable
 * across loads. Persist stable ids + addresses; resolve uids at runtime.
 */
export type RegistryConnection = {
  key: string;
  family: WalletFamily;
  uid: string;
  stableId: string;
  kind: "embedded-session" | "external-evm" | "walletconnect" | "svm";
  address: string;
  addresses: string[];
  chainId?: number;
  walletName?: string;
  providerId?: string;
};

export type RegistryConnectionOrderItem = {
  family: WalletFamily;
  stableId: string;
  address: string;
};

export type ActiveRef = {
  family: WalletFamily;
  address: string;
  uid?: string;
  stableId?: string;
};

export type RegistryPhase = "booting" | "settling" | "stable" | "rebuilding";

export type EvmGraceState = {
  last: {
    address: string;
    chainId?: number;
    connectorId?: string;
    walletName?: string;
    walletSource?: WalletSource;
  } | null;
  disconnectedAt: number | null;
};

export type EmbeddedSessionState = {
  up: boolean;
  providerId: string | null;
  uid: string | null;
  stableId: string | null;
  walletName: string | null;
  embeddedEvmAddress: string | null;
  chainId: number | null;
};

export type AuthFlowSuppressionReason =
  | "provider-social-login"
  | "provider-auth-modal"
  | "provider-evm-connect-fallback"
  | "provider-account-modal"
  | (string & {});

export type WalletRegistryState = {
  phase: RegistryPhase;
  connections: RegistryConnection[];
  connectionOrder: RegistryConnectionOrderItem[];
  activeByFamily: Partial<Record<WalletFamily, ActiveRef>>;
  intents: {
    droppedAddresses: string[];
    providerSessionDetached: boolean;
    explicitFamilyDisconnect: Partial<Record<WalletFamily, boolean>>;
    pendingSvmWallet: string | null;
    preferEmbeddedOnConnect: boolean;
  };
  heal: {
    expected: Array<{ stableId: string; address: string }>;
    reattachBudget: number;
    suppressedUntil: number | null;
    suppressionReason: AuthFlowSuppressionReason | null;
  };
  evmGrace: EvmGraceState;
  embeddedSession: EmbeddedSessionState;
};

export type RegistryEvent =
  | { type: "boot/init"; persisted: PersistedRegistryV1 | null; now: number }
  | {
      type: "wagmi/connections-changed";
      connections: Array<Omit<RegistryConnection, "key" | "kind">>;
      now: number;
    }
  | { type: "wagmi/config-rebuilt"; now: number }
  | { type: "wagmi/brands-changed"; brands: Record<string, string> }
  | { type: "wagmi/settled"; now: number }
  | {
      type: "provider/embedded-session-changed";
      up: boolean;
      providerId: string;
      uid: string;
      stableId: string;
      walletName: string;
      embeddedEvmAddress: string | null;
      chainId?: number | null;
      now: number;
    }
  | {
      type: "provider/auth-flow-started";
      reason: AuthFlowSuppressionReason;
      now: number;
    }
  | {
      type: "svm/changed";
      publicKey: string | null;
      uid?: string;
      stableId?: string;
      kind?: Extract<RegistryConnection["kind"], "embedded-session" | "svm">;
      providerId?: string;
      walletName: string | null;
      now: number;
    }
  | { type: "svm/connect-requested"; walletName: string; now: number }
  | { type: "svm/connect-settled"; walletName: string; now: number }
  | {
      type: "user/select-active";
      family: WalletFamily;
      address: string;
      uid: string;
      stableId: string;
      now: number;
    }
  | {
      type: "user/connect-succeeded";
      family: WalletFamily;
      address: string;
      uid: string;
      stableId: string;
      now: number;
    }
  | { type: "user/provider-reconnect-requested"; now: number }
  | {
      type: "user/disconnect-account";
      address: string;
      uids: string[];
      isProviderOwnedAccount: boolean;
      othersRemain: boolean;
      markDroppedAddress?: boolean;
      now: number;
    }
  | {
      type: "user/disconnect-family";
      family: WalletFamily | "all";
      now: number;
    };

export type RegistryCommand =
  | { kind: "wagmi/reconnect"; stableIds: string[] }
  | { kind: "wagmi/connect"; stableId: string }
  | { kind: "wagmi/disconnect"; uid: string }
  | { kind: "svm/connect"; walletName: string }
  | { kind: "svm/disconnect" }
  | { kind: "provider/logout" }
  | { kind: "persist" }
  | { kind: "debug"; event: string; data?: Record<string, unknown> };

export type PersistedRegistryV1 = {
  version: 1;
  active: Partial<Record<WalletFamily, { address: string; stableId?: string }>>;
  order?: RegistryConnectionOrderItem[];
  droppedAddresses: string[];
  providerSessionDetached: boolean;
};

/** Public address projection from the canonical `GET /api/account` response. */
export type WalletLink = {
  address: string;
  family: WalletFamily;
  linkedVia: "para" | "privy" | "challenge" | (string & {});
  subject: string;
  verifiedAt: number;
};

export const REGISTRY_STORAGE_KEY = "aomi.wallet.registry.v1";
export const POPUP_REATTACH_BUDGET = 2;
export const REATTACH_SUPPRESSION_MS = 300_000;
export const SETTLE_QUIET_MS = 1_200;
export const AUTH_FLOW_RECONNECT_SETTLE_MS = 8_000;
export const EVM_IDENTITY_GRACE_MS = 1_800;
