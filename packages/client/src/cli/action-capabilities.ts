import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";
import { clusterApiUrl, Connection } from "@solana/web3.js";

import type { ActionCapabilities } from "../actions";
import { walletCapabilities } from "../wallet/capabilities";
import type { EvmWallet, SvmWallet, Wallets } from "../wallet/types";
import {
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
} from "../wallet-utils";
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
  return walletCapabilities(wallets);
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
