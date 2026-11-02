import type { Chain, Hex } from "viem";

// ---------------------------------------------------------------------------
// Enums / Literal Types
// ---------------------------------------------------------------------------

export type AAMode = "4337" | "7702";
export type AASponsorship = "disabled" | "optional" | "required";

// ---------------------------------------------------------------------------
// Call Types
// ---------------------------------------------------------------------------

export type AAWalletCall = {
  to: Hex;
  value: bigint;
  data?: Hex;
  chainId: number;
};

/** The subset of AAWalletCall passed to wallet send methods (chainId already resolved). */
export type AACallPayload = Omit<AAWalletCall, "chainId">;

export type WalletCapabilities = {
  atomic?: {
    status?: string;
  };
  paymasterService?: {
    supported?: boolean;
  };
  [key: string]: unknown;
};

export type WalletAtomicCapability = WalletCapabilities;

// ---------------------------------------------------------------------------
// Execution Params / Results
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  txHash: string;
  txHashes: string[];
  executionKind: string;
  batched: boolean;
  /**
   * Whether gas was paid by a paymaster.
   *
   * - `true`: paymaster paid, verified by the protocol
   *   (`sponsorship.mode === "required"` fails the tx if the paymaster
   *   rejects).
   * - `false`: no paymaster was attached (EOA path, or sendCalls fallback
   *   to sequential after sponsored-batch error).
   * - `undefined`: paymaster config was passed but the wallet may have
   *   silently fallen back to user-paid (Base Account with
   *   `sponsorship.mode === "optional"`). We cannot tell post-hoc without
   *   decoding the userOp logs.
   */
  sponsored: boolean | undefined;
}

/** A sequential executor confirmed a prefix before a later call failed. */
export type PartialWalletExecution = {
  completedTxHashes: string[];
  failedCallIndex: number;
  failureReason: string;
};

export interface AtomicBatchArgs {
  calls: AACallPayload[];
  chainId?: number;
  /** The reviewed signer; without it a connector sends from its first account. */
  account?: Hex;
  connector?: unknown;
  capabilities?: {
    atomic?: {
      required?: boolean;
      optional?: boolean;
    };
    paymasterService?: {
      context?: Record<string, unknown>;
      optional?: boolean;
      url: string;
    };
    [key: string]: unknown;
  };
  forceAtomic?: boolean;
  /** Persist the wallet bundle identity before waiting for its result. */
  onAccepted?: (callsId: string) => void;
  pollingInterval?: number;
  status?: (status: unknown) => boolean;
  throwOnFailure?: boolean;
  timeout?: number;
  version?: string;
}

export type NativeWalletSponsorship =
  | {
      mode: "disabled";
    }
  | {
      mode: "optional";
      paymasterServiceUrl?: string;
      paymasterServiceContext?: SponsorshipPaymasterServiceContext;
    }
  | {
      mode: "required";
      paymasterServiceUrl?: string;
      paymasterServiceContext?: SponsorshipPaymasterServiceContext;
    };

export type SponsorshipPaymasterServiceContext = Record<string, unknown> & {
  erc20?: never;
  paymasterAddress?: never;
};

export interface NativeWalletExecutionPolicy {
  executionKind?: string;
  requiresAtomicForBatch?: boolean;
  sendCallsTimeoutMs?: number;
  sendCallsVersion?: string;
  sponsorship?: NativeWalletSponsorship;
}

export interface ExecuteWalletCallsParams {
  callList: AAWalletCall[];
  onAccepted?: (callsId: string) => void;
  currentChainId: number | undefined;
  capabilities: Record<string, WalletCapabilities> | undefined;
  localPrivateKey: `0x${string}` | null;
  nativeWalletExecution?: NativeWalletExecutionPolicy;
  /** Send the calls with one `wallet_sendCalls`, even a single call, whatever
   * the capabilities say; atomicity is required only for several calls. They
   * go one by one only when the wallet refuses the bundle before sending
   * anything: 5700, 5760, -32601 or 4200. */
  bundle?: boolean;
  /** A failure after the wallet answered a call id carries that `callsId`
   * (on it or a cause): the calls may be out, so they are never sent again. */
  sendCallsSyncAsync: (args: AtomicBatchArgs) => Promise<unknown>;
  sendTransactionAsync: (args: {
    chainId: number;
    to: Hex;
    value: bigint;
    data?: Hex;
  }) => Promise<string>;
  switchChainAsync: (params: { chainId: number }) => Promise<unknown>;
  chainsById: Record<number, Chain>;
  getPreferredRpcUrl: (chain: Chain) => string;
}
