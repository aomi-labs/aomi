import type { AAMode } from "../aa/types";
import type { AomiInferenceFundingSource } from "../agent/types";

export type CliExecutionMode = "aa" | "eoa";
export type CliAAProvider = "alchemy" | "pimlico";
export type CliPaymentMethod = "coinbase";

export type CliConfig = {
  baseUrl?: string;
  apiKey?: string;
  json?: boolean;
  verbose?: boolean;
  accountBearer?: string;
  app?: string;
  applicationId?: string;
  /** Hosted app discovery platform; execution is deferred until Phase 10. */
  appPlatform?: string;
  model?: string;
  freshSession?: boolean;
  publicKey?: string;
  privateKey?: string;
  /**
   * Solana keypair secret. Accepts:
   *  - base58 of the 64-byte secret key (Phantom / Solflare export format)
   *  - JSON array of bytes (`[1,2,...,64]`, the `solana-keygen` format)
   * EVM-only sessions can leave this unset — `aomi tx sign` only requires it
   * when the targeted pending tx is `solana_sign` kind.
   */
  solanaPrivateKey?: string;
  /**
   * Solana cluster override. Accepts the short form used by the CLI
   * ("mainnet-beta", "devnet", "testnet") or the CAIP-2 form
   * ("solana:mainnet", "solana:devnet", "solana:testnet").
   * Defaults to "solana:mainnet" when a Solana address is present.
   */
  svmCluster?: "solana:mainnet" | "solana:devnet" | "solana:testnet";
  chainRpcUrl?: string;
  chain?: number;
  secrets: Record<string, string>;
  /**
   * undefined = auto (local execution is always EOA). "aa" records an AA
   * execution request, which the CLI rejects locally — AA runs in the
   * backend lane. aaProvider/aaMode are preferences synced to user_state
   * so the backend routes accordingly; they never drive local execution.
   */
  execution?: CliExecutionMode;
  aaProvider?: CliAAProvider;
  aaMode?: AAMode;
  paymentMethod?: CliPaymentMethod;
  /** Explicit inference funding lane selected for chat. */
  inferenceFunding?: AomiInferenceFundingSource;
};
