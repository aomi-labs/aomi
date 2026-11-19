import {
  createPublicClient,
  erc20Abi,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import { base, baseSepolia, mainnet, optimism } from "viem/chains";
import type { VaultHolding, VaultToken } from "./vault-model";

/** Read-only chain access for the Withdraw row; tests pass a fake. */
export type VaultReader = {
  /** The vault has code: it is created with its owner's first trade. */
  hasCode: (chainId: number, vault: string) => Promise<boolean>;
  /** Zero balances included; unreadable tokens left out; throws if all fail. */
  balances: (
    chainId: number,
    vault: string,
    tokens: readonly VaultToken[],
  ) => Promise<VaultHolding[]>;
};

const KNOWN: readonly Chain[] = [mainnet, optimism, base, baseSepolia];

/** A viem client per chain; the wallet kit's chains win, so a host's RPC is used. */
export function viemVaultReader(
  supportedChains: readonly Chain[] = [],
): VaultReader {
  const clients = new Map<number, PublicClient>();
  const clientOf = (chainId: number) => {
    const held = clients.get(chainId);
    if (held) return held;
    const chain = [...supportedChains, ...KNOWN].find(
      (entry) => entry.id === chainId,
    );
    if (!chain) throw new Error(`Chain ${chainId} is not available here.`);
    const made = createPublicClient({
      chain,
      transport: http(),
      batch: { multicall: true },
    }) as PublicClient;
    clients.set(chainId, made);
    return made;
  };
  return {
    hasCode: async (chainId, vault) => {
      const code = await clientOf(chainId).getCode({
        address: vault as `0x${string}`,
      });
      return code !== undefined && code !== "0x";
    },
    balances: async (chainId, vault, tokens) => {
      const client = clientOf(chainId);
      const address = vault as `0x${string}`;
      const reads = await Promise.allSettled(
        tokens.map(({ asset }) =>
          "erc20" in asset
            ? client.readContract({
                address: asset.erc20 as `0x${string}`,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [address],
              })
            : client.getBalance({ address }),
        ),
      );
      const held: VaultHolding[] = [];
      reads.forEach((read, index) => {
        if (read.status === "fulfilled")
          held.push({ token: tokens[index]!, raw: read.value });
      });
      const failed = reads.find((read) => read.status === "rejected");
      if (held.length === 0 && failed)
        throw (failed as PromiseRejectedResult).reason;
      return held;
    },
  };
}
