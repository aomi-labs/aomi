import {
  createPublicClient,
  erc20Abi,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import { base, baseSepolia, mainnet, optimism } from "viem/chains";
import type { VaultHolding, VaultToken } from "./vault-model";

/**
 * What the Withdraw row reads from a chain: whether the vault exists yet, and
 * what it holds. It sends nothing. Tests and the fixture pass a fake.
 */
export type VaultReader = {
  /** The vault has code: it is created with its owner's first trade. */
  hasCode: (chainId: number, vault: string) => Promise<boolean>;
  /**
   * `tokens` the vault holds, each with its balance (zero included). A token
   * that could not be read is left out; every read failing throws.
   */
  balances: (
    chainId: number,
    vault: string,
    tokens: readonly VaultToken[],
  ) => Promise<VaultHolding[]>;
};

const KNOWN: readonly Chain[] = [mainnet, optimism, base, baseSepolia];

/**
 * The page's own EVM read path: a viem public client per chain over the
 * chain's default RPC, the same as the checkout reads USDC with. The wallet
 * kit's chains win over viem's when it lists them, so a host's own RPC is
 * used. ERC-20 reads go out as one multicall where the chain has one.
 */
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
