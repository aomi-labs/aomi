import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isHex,
  keccak256,
  TransactionNotFoundError,
  type Hex,
  type SignTypedDataParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Wallets } from "@aomi-labs/client";

export function createViemWalletFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Wallets | undefined {
  const rawPrivateKey = env.AOMI_PRIVATE_KEY?.trim();
  const rpcUrl = env.EVM_RPC_URL?.trim();
  const rawChainId = env.EVM_CHAIN_ID?.trim();

  if (!rawPrivateKey && !rpcUrl && !rawChainId) return undefined;
  if (!rawPrivateKey || !rpcUrl || !rawChainId) {
    throw new Error(
      "AOMI_PRIVATE_KEY, EVM_RPC_URL, and EVM_CHAIN_ID must be set together",
    );
  }
  if (!isHex(rawPrivateKey) || rawPrivateKey.length !== 66) {
    throw new Error("AOMI_PRIVATE_KEY must be a 32-byte 0x-prefixed hex value");
  }

  const chainId = Number(rawChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("EVM_CHAIN_ID must be a positive integer");
  }

  const account = privateKeyToAccount(rawPrivateKey);
  const chain = defineChain({
    id: chainId,
    name: `Configured chain ${chainId}`,
    nativeCurrency: { name: "Native token", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  return {
    evm: {
      address: account.address,
      chainId,
      sendTransaction: async ({
        chainId: requestedChainId,
        to,
        data,
        value,
      }) => {
        if (requestedChainId !== chainId) {
          throw new Error(
            `Wallet is configured for chain ${chainId}, not ${requestedChainId}`,
          );
        }
        return wallet.sendTransaction({
          account,
          chain,
          to: getAddress(to),
          data: data as Hex | undefined,
          value: BigInt(value ?? "0"),
        });
      },
      signTransaction: async (payload) => {
        if (payload.chain_id !== chainId) {
          throw new Error(
            `Wallet is configured for chain ${chainId}, not ${payload.chain_id}`,
          );
        }
        return account.signTransaction({
          chainId,
          type: "eip1559",
          to: getAddress(payload.transaction.to),
          data: payload.transaction.data as Hex,
          value: BigInt(payload.transaction.value),
          nonce: payload.nonce,
          gas: BigInt(payload.transaction.gas_limit),
          maxFeePerGas: BigInt(payload.transaction.max_fee_per_gas),
          maxPriorityFeePerGas: BigInt(
            payload.transaction.max_priority_fee_per_gas,
          ),
        });
      },
      broadcastTransaction: (signedTransaction, requestedChainId) => {
        if (requestedChainId !== chainId) {
          throw new Error(
            `Wallet is configured for chain ${chainId}, not ${requestedChainId}`,
          );
        }
        return broadcastWithReplay(
          signedTransaction as Hex,
          async (hash) => {
            try {
              const transaction = await publicClient.getTransaction({ hash });
              return transaction.hash.toLowerCase() === hash.toLowerCase();
            } catch (error) {
              if (error instanceof TransactionNotFoundError) return false;
              throw error;
            }
          },
          (serializedTransaction) =>
            publicClient.sendRawTransaction({ serializedTransaction }),
        );
      },
      signMessage: ({ message }) =>
        account.signMessage({
          message: isHex(message) ? { raw: message as Hex } : message,
        }),
      signTypedData: ({ typedData }) =>
        account.signTypedData(typedData as SignTypedDataParameters),
    },
  };
}

/** Resolve ambiguous RPC send failures by checking the exact signed bytes. */
export async function broadcastWithReplay(
  signedTransaction: Hex,
  exists: (hash: Hex) => Promise<boolean>,
  send: (signedTransaction: Hex) => Promise<Hex>,
): Promise<Hex> {
  const hash = keccak256(signedTransaction);
  if (await exists(hash)) return hash;
  try {
    const returned = await send(signedTransaction);
    if (returned.toLowerCase() !== hash.toLowerCase()) {
      throw new Error(
        "RPC returned a transaction hash that differs from the signed bytes",
      );
    }
    return hash;
  } catch (error) {
    try {
      if (await exists(hash)) return hash;
    } catch {
      // Keep the original send error when the follow-up read is unavailable.
    }
    throw error;
  }
}
