export interface EvmWalletCall {
  to: string;
  data?: string;
  value?: string;
}

export type WalletTransactionResult =
  | string
  | {
      hash?: string;
      transactionHash?: string;
      hashes?: string[];
      transactionHashes?: string[];
      signature?: string;
      signedTransaction?: string;
    };

export interface EvmWallet {
  address: string;
  preparePreparedTransaction?: (
    payload: Extract<
      import("../commits").SignableCommit,
      { kind: "evm_transaction" }
    >,
  ) => Promise<void>;
  sendPreparedTransaction?: (
    payload: Extract<
      import("../commits").SignableCommit,
      { kind: "evm_transaction" }
    >,
    onPhase?: (
      phase: Exclude<import("../commits").CommitSubmissionPhase, "preparing">,
    ) => void,
  ) => Promise<string>;
  /** Send a prepared commit bundle with EIP-5792 `wallet_sendCalls`;
   * answers every landed transaction hash in order. */
  sendPreparedCalls?: (
    payload: import("../commits").WalletCallsCommit,
    onPhase?: (
      phase: Exclude<import("../commits").CommitSubmissionPhase, "preparing">,
    ) => void,
  ) => Promise<string[]>;
  /** Wait for a transaction's receipt on the wallet's own public client (one
   * confirmation). Display only: the Commit Service still settles the commit. */
  waitForReceipt?: (input: {
    chainId: number;
    hash: string;
  }) => Promise<{ status?: string }>;
  /** Sign a message commit's payload: typed data with
   * `eth_signTypedData_v4`, ERC-191 bytes with `personal_sign` (`0x` hex
   * as-is, text as its UTF-8 bytes). Answers the signature. */
  signPreparedMessage?: (
    payload: import("../commits").EvmMessageCommit,
  ) => Promise<string>;
  /** The wallet may be asked to bundle on the chain: it is not known to lack
   * EIP-5792 batching there. */
  supportsAtomicBatch?: (chainId: number) => boolean;
  signTransaction?: (
    payload: Extract<
      import("../commits").SignableCommit,
      { kind: "evm_transaction" }
    >,
  ) => Promise<string>;
  broadcastTransaction?: (
    signedTransaction: string,
    chainId: number,
  ) => Promise<string>;
  chainId?: number | (() => number | undefined);
  sendCalls?: (input: {
    chainId: number;
    calls: EvmWalletCall[];
  }) => Promise<WalletTransactionResult>;
  sendTransaction?: (
    input: EvmWalletCall & { chainId: number },
  ) => Promise<WalletTransactionResult>;
  signMessage?: (input: {
    message: string;
    chainId?: number;
  }) => Promise<string | { signature: string }>;
  signTypedData?: (input: {
    typedData: Record<string, unknown>;
    chainId?: number;
  }) => Promise<string | { signature: string }>;
  switchChain?: (chainId: number) => Promise<unknown>;
}

export interface SvmWallet {
  address: string;
  broadcastTransaction?: (
    signedTransaction: string,
    cluster: string,
  ) => Promise<string>;
  cluster?: string | (() => string | undefined);
  signTransaction?: (input: {
    transactionBase64: string;
    cluster?: string;
  }) => Promise<string | { signedTransaction?: string; signature?: string }>;
  sendTransaction?: (input: {
    transactionBase64: string;
    cluster?: string;
  }) => Promise<WalletTransactionResult>;
  signAndSendTransaction?: (input: {
    transactionBase64: string;
    cluster?: string;
  }) => Promise<string | { signature?: string; signedTransaction?: string }>;
  signMessage?: (input: {
    messageBase64: string;
    cluster?: string;
  }) => Promise<string | { signature: string }>;
  switchCluster?: (cluster: string) => Promise<unknown>;
}

export interface Wallets {
  evm?: EvmWallet;
  svm?: SvmWallet;
}
