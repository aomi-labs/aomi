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
