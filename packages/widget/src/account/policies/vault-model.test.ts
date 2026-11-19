import type { AomiRulesEnforcement } from "@aomi-labs/client";
import { describe, expect, it } from "vitest";
import type { PolicyCatalog } from "./policy-model";
import {
  exactAmount,
  vaultTokens,
  vaultsOf,
  type VaultToken,
} from "./vault-model";

const OWNER = "0x3e14a1b2c3d4e5f60718293a4b5c6d7e8f906dde";
const VAULT = "0x7c4c1f0a2b3d4e5f60718293a4b5c6d7e8f9e079";
const OTHER = `0x${"1".repeat(40)}`;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const usdc: VaultToken = {
  symbol: "USDC",
  decimals: 6,
  asset: { erc20: BASE_USDC.toLowerCase() },
};
const eth: VaultToken = {
  symbol: "ETH",
  decimals: 18,
  asset: { native: true },
};
const upper = (address: string) => `0x${address.slice(2).toUpperCase()}`;

const entry = (extra: Partial<AomiRulesEnforcement> = {}) =>
  ({
    rule: "eip155:8453/native@any_protocol",
    provider: "metamask",
    name: "MetaMask",
    network: "eip155:8453",
    state: "on",
    ready: false,
    left: null,
    expires_at: null,
    account: VAULT,
    deployment_tx: null,
    note: null,
    signer: { family: "evm", address: OWNER },
    ...extra,
  }) as AomiRulesEnforcement;

describe("vaultsOf", () => {
  it("counts removed entries too, and names each distinct vault and chain once", () => {
    const vaults = vaultsOf([
      entry({ rule: "a" }),
      entry({ rule: "b", state: "behind", account: upper(VAULT) }),
      entry({ rule: "c", network: "eip155:10" }),
      entry({ rule: "d", account: OTHER }),
    ]);
    expect(vaults.map((vault) => vault.key)).toEqual([
      `8453:${VAULT}`,
      `10:${VAULT}`,
      `8453:${OTHER}`,
    ]);
  });

  it("names none for another provider, an unsupported chain, no vault, no EVM owner or the owner's own account", () => {
    expect(
      vaultsOf([
        entry({ provider: "swig", network: "solana:mainnet-beta" }),
        entry({ provider: "swig" }),
        entry({ network: "eip155:42161" }),
        entry({ account: null }),
        entry({ signer: { family: "evm", address: null } }),
        entry({ signer: { family: "svm", address: OWNER } }),
        entry({ account: OWNER }),
        entry({ account: "not an address" }),
      ]),
    ).toEqual([]);
  });
});

describe("vaultTokens", () => {
  const on = (network: string, label: string, address?: string) => ({
    chain: { label, network },
    asset: address ? `${network}/erc20:${address}` : `${network}/native`,
    decimals: address ? 6 : 18,
    address,
  });
  const catalog = {
    apps: [],
    tokens: [
      {
        symbol: "USDC",
        chains: [
          on("eip155:8453", "Base", BASE_USDC),
          on("eip155:10", "OP", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
          on("solana:mainnet-beta", "Solana", "EPjFWdd5"),
        ],
      },
      { symbol: "ETH", chains: [on("eip155:8453", "Base")] },
    ],
  } as PolicyCatalog;

  it("is the catalog's ERC-20 tokens on that chain, then native ETH", () => {
    expect(vaultTokens(catalog, "eip155:8453")).toEqual([usdc, eth]);
  });
});

describe("amounts", () => {
  it("writes the exact balance for Max, with no rounding", () => {
    expect(exactAmount(BigInt("123456789012345678"), 18)).toBe(
      "0.123456789012345678",
    );
    expect(exactAmount(BigInt(95_000_000), 6)).toBe("95");
  });
});
