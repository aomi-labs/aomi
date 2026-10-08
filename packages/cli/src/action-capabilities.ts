import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  TransactionNotFoundError,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";
import { clusterApiUrl, Connection } from "@solana/web3.js";

import type { ActionCapabilities } from "@aomi-labs/client";
import { walletCapabilities } from "@aomi-labs/client";
import type { EvmWallet, SvmWallet, Wallets } from "@aomi-labs/client";
import {
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
} from "@aomi-labs/client";
import type { CliSession } from "./cli-session";
import {
  parseSolanaKeypairSecret,
  signSolanaMessage,
  signSolanaTransaction,
} from "./solana-signer";
import type { CliConfig } from "./types";

/** Local keys are CLI capabilities; the ActionHandler still owns execution. */
export function cliActionCapabilities(
  cli: CliSession,
  config?: Partial<CliConfig>,
): ActionCapabilities {
  return walletCapabilities(cliWallets(cli, config));
}

/** The CLI's one local-key wallet set serves both Actions and durable commits. */
export function cliWallets(
  cli: CliSession,
  config?: Partial<CliConfig>,
): Wallets {
  const wallets: Wallets = {};
  const privateKey = config?.privateKey ?? cli.privateKey;
  if (privateKey) wallets.evm = evmWallet(privateKey, cli.chainId, config);

  const solanaKey = cli.resolvedSvmPrivateKey(config?.solanaPrivateKey);
  if (solanaKey) {
    wallets.svm = svmWallet(
      solanaKey,
      cli.resolvedSvmCluster(config?.svmCluster),
    );
  }
  return wallets;
}

function evmWallet(
  privateKey: string,
  initialChainId: number | undefined,
  config: Partial<CliConfig> | undefined,
): EvmWallet {
  if (!isHex(privateKey) || privateKey.length !== 66) {
    throw new Error("EVM private key must be a 32-byte hex value");
  }
  const account = privateKeyToAccount(privateKey);
  let activeChainId = initialChainId;
  const chain = (chainId: number) => resolveChain(chainId, config?.chainRpcUrl);
  const client = (chainId: number) =>
    createWalletClient({
      account,
      chain: chain(chainId),
      transport: http(config?.chainRpcUrl),
    });

  return {
    address: account.address,
    chainId: () => activeChainId,
    switchChain: async (chainId) => {
      activeChainId = chainId;
    },
    sendTransaction: async ({ chainId, to, data, value }) => {
      if (!isAddress(to) || (data !== undefined && !isHex(data))) {
        throw new Error("Action contains an invalid EVM transaction");
      }
      const hash = await client(chainId).sendTransaction({
        account,
        chain: chain(chainId),
        to: getAddress(to),
        data,
        value: value === undefined ? undefined : BigInt(value),
      });
      const receipt = await createPublicClient({
        chain: chain(chainId),
        transport: http(config?.chainRpcUrl),
      }).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      return hash;
    },
    signTransaction: async (payload) => {
      if (payload.signer.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(
          "Prepared commit signer does not match the local EVM key",
        );
      }
      const tx = payload.transaction;
      if (!isAddress(tx.to) || !isHex(tx.data)) {
        throw new Error("Commit contains an invalid EVM transaction");
      }
      return account.signTransaction({
        chainId: payload.chain_id,
        type: "eip1559",
        nonce: payload.nonce,
        to: getAddress(tx.to),
        data: tx.data,
        value: BigInt(tx.value),
        gas: BigInt(tx.gas_limit),
        maxFeePerGas: BigInt(tx.max_fee_per_gas),
        maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
      });
    },
    broadcastTransaction: (signedTransaction, chainId) =>
      broadcastPreparedTransaction(
        createPublicClient({
          chain: chain(chainId),
          transport: http(config?.chainRpcUrl),
        }),
        signedTransaction,
      ),
    signMessage: async ({ message, chainId }) => {
      const args = toViemSignMessageArgs({ non_typed_data: message });
      if (!args) throw new Error("Action contains an invalid EVM message");
      return client(chainId ?? activeChainId ?? 1).signMessage({
        account,
        ...args,
      });
    },
    signTypedData: async ({ typedData, chainId }) => {
      const args = toViemSignTypedDataArgs({ typed_data: typedData });
      if (!args?.message) throw new Error("Action contains invalid typed data");
      const { message, ...request } = args;
      return client(chainId ?? activeChainId ?? 1).signTypedData({
        account,
        ...request,
        message,
      });
    },
  };
}

type RawTransactionClient = {
  getTransaction: (args: {
    hash: `0x${string}`;
  }) => Promise<{ hash: `0x${string}` }>;
  sendRawTransaction: (args: {
    serializedTransaction: `0x${string}`;
  }) => Promise<`0x${string}`>;
};

/** A raw EVM transaction has a deterministic hash. Probe before and after an
 * ambiguous send error so a retry never blindly rebroadcasts known bytes. */
export async function broadcastPreparedTransaction(
  client: RawTransactionClient,
  signedTransaction: string,
): Promise<`0x${string}`> {
  if (!isHex(signedTransaction)) {
    throw new Error("Signed EVM transaction must be hex bytes");
  }
  const raw = signedTransaction as `0x${string}`;
  const expectedHash = keccak256(raw);
  const isKnown = async () => {
    try {
      const transaction = await client.getTransaction({ hash: expectedHash });
      if (transaction.hash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error("RPC returned a different transaction for the hash");
      }
      return true;
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return false;
      throw error;
    }
  };
  if (await isKnown()) return expectedHash;
  try {
    const hash = await client.sendRawTransaction({
      serializedTransaction: raw,
    });
    if (hash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error("RPC returned a different transaction hash");
    }
    return expectedHash;
  } catch (error) {
    try {
      if (await isKnown()) return expectedHash;
    } catch {
      // The original send error remains authoritative without chain proof.
    }
    throw error;
  }
}

function svmWallet(privateKey: string, initialCluster: string): SvmWallet {
  const keypair = parseSolanaKeypairSecret(privateKey);
  let activeCluster = initialCluster;
  return {
    address: keypair.publicKey.toBase58(),
    cluster: () => activeCluster,
    switchCluster: async (cluster) => {
      activeCluster = cluster;
    },
    signTransaction: async ({ transactionBase64 }) => ({
      signedTransaction: signSolanaTransaction(transactionBase64, keypair)
        .signedTxBase64,
    }),
    broadcastTransaction: (signedTransaction, cluster) =>
      new Connection(solanaRpc(cluster)).sendRawTransaction(
        Buffer.from(signedTransaction, "base64"),
      ),
    signAndSendTransaction: async ({ transactionBase64, cluster }) => {
      const { signedTxBase64 } = signSolanaTransaction(
        transactionBase64,
        keypair,
      );
      const connection = new Connection(solanaRpc(cluster ?? activeCluster));
      const signature = await connection.sendRawTransaction(
        Buffer.from(signedTxBase64, "base64"),
      );
      await connection.confirmTransaction(signature, "confirmed");
      return { signature, signedTransaction: signedTxBase64 };
    },
    signMessage: async ({ messageBase64 }) => ({
      signature: signSolanaMessage(messageBase64, keypair).signatureBase64,
    }),
  };
}

function resolveChain(chainId: number, rpcUrl?: string): Chain {
  const known = Object.values(viemChains).find((value) => value.id === chainId);
  return (
    known ?? {
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
    }
  );
}

function solanaRpc(cluster: string): string {
  if (cluster === "solana:devnet") return clusterApiUrl("devnet");
  if (cluster === "solana:testnet") return clusterApiUrl("testnet");
  return clusterApiUrl("mainnet-beta");
}
