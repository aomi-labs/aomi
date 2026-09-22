import type { AomiInferenceFundingSource } from "../agent/types";

export type CliExecutionMode = "aa" | "eoa";
export type CliAgentMode = "auto" | "direct";
export type CliPaymentMethod = "coinbase";

export type CliConfig = {
  baseUrl?: string;
  apiKey?: string;
  json?: boolean;
  verbose?: boolean;
  accountBearer?: string;
  agentMode?: CliAgentMode;
  app?: string;
  applicationId?: string;
  /** Hosted app discovery platform; execution is deferred until Phase 10. */
  appPlatform?: string;
  model?: string;
  freshSession?: boolean;
  publicKey?: string;
  /** Exact Solana transaction account; Auto does not require its private key. */
  svmPublicKey?: string;
  privateKey?: string;
  /**
   * Solana keypair secret. Accepts:
   *  - base58 of the 64-byte secret key (Phantom / Solflare export format)
   *  - JSON array of bytes (`[1,2,...,64]`, the `solana-keygen` format)
   * EVM-only sessions can leave this unset — `aomi tx sign` only requires it
   * when the targeted Action requests SVM signing or execution.
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
   * Optional assertion on the already-prepared Action, never a routing
   * override. AA owner signatures use the same Action lifecycle as the UI.
   */
  execution?: CliExecutionMode;
  paymentMethod?: CliPaymentMethod;
  /** Explicit inference funding lane selected for chat. */
  inferenceFunding?: AomiInferenceFundingSource;
};
