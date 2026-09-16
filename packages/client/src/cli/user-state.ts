import {
  CLIENT_TYPE_TS_CLI,
  UserState,
  type UserStateEvm,
} from "../user-state";

export function buildCliUserState(
  evmAddress?: string,
  chainId?: number,
  options?: {
    /** Solana public key (base58). When present, sets svm.address. */
    svmAddress?: string;
    /** Solana cluster. Callers resolve it via `CliSession.resolvedSvmCluster`;
     * this builder never defaults it. */
    svmCluster?: "solana:mainnet" | "solana:devnet" | "solana:testnet";
  },
): UserState {
  // Each wallet family is emitted iff its address is explicitly configured.
  // Account-abstraction is backend authority and no longer carried in
  // user_state. The CLI's `--aa` preference is applied per-transaction via the
  // execution payload, not persisted here.
  const userState: UserState = {};

  if (evmAddress !== undefined) {
    const evm: UserStateEvm = { address: evmAddress };
    if (chainId !== undefined) {
      evm.chain_id = chainId;
    }
    userState.evm = evm;
  }

  if (options?.svmAddress !== undefined) {
    userState.svm = { address: options.svmAddress };
    if (options.svmCluster !== undefined) {
      userState.svm.cluster = options.svmCluster;
    }
  }

  if (userState.evm || userState.svm) {
    userState.connection = {
      is_connected: true,
    };
  }
  return UserState.withExt(userState, "client_type", CLIENT_TYPE_TS_CLI);
}

export function walletSnapshotFromUserState(
  userState: UserState | null | undefined,
): {
  publicKey?: string;
  chainId?: number;
} {
  const address = UserState.address(userState);
  const isConnected = UserState.isConnected(userState);

  return {
    publicKey: isConnected === false ? undefined : address,
    chainId: UserState.chainId(userState),
  };
}
