import type { AomiRulesEnforcement } from "@aomi-labs/client";
import { describe, expect, it } from "vitest";
import type { PolicyCatalog } from "./policy-model";
import {
  exactAmount,
  holdingsLine,
  parseWithdrawAmount,
  shownAmount,
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
  it("names a vault from a MetaMask entry, its address and owner in lower case", () => {
    expect(vaultsOf([entry()])).toEqual([
      {
        key: `8453:${VAULT}`,
        address: VAULT,
        chainId: 8453,
        chain: { label: "Base", network: "eip155:8453" },
        owner: OWNER,
        explorer: `https://basescan.org/address/${VAULT}`,
      },
    ]);
    const signer = { family: "evm", address: upper(OWNER) } as const;
    expect(
      vaultsOf([entry({ account: upper(VAULT), signer })])[0],
    ).toMatchObject({ address: VAULT, owner: OWNER });
  });

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

  it("covers Ethereum, OP, Base and Base Sepolia", () => {
    const networks = [1, 10, 8453, 84532].map((id) => `eip155:${id}`);
    const vaults = vaultsOf(networks.map((network) => entry({ network })));
    expect(vaults.map((vault) => vault.chainId)).toEqual([1, 10, 8453, 84532]);
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

  it("offers ETH alone before the catalog is read, and on a chain it has no tokens for", () => {
    expect(vaultTokens(null, "eip155:8453")).toEqual([eth]);
    expect(vaultTokens(catalog, "eip155:84532")).toEqual([eth]);
  });
});

describe("amounts", () => {
  const ETH_98 = BigInt("980000000000000000");

  it("shows at least two decimals, at most six, and groups thousands", () => {
    expect(shownAmount(BigInt(95_000_000), 6)).toBe("95.00");
    expect(shownAmount(ETH_98, 18)).toBe("0.98");
    expect(shownAmount(BigInt("1250500000"), 6)).toBe("1,250.50");
    expect(shownAmount(BigInt("123456789000000000"), 18)).toBe("0.123456");
    expect(shownAmount(BigInt(1), 18)).toBe("<0.000001");
    expect(shownAmount(BigInt(7), 0)).toBe("7");
  });

  it("writes the exact balance for Max, with no rounding", () => {
    expect(exactAmount(BigInt("123456789012345678"), 18)).toBe(
      "0.123456789012345678",
    );
    expect(exactAmount(BigInt(95_000_000), 6)).toBe("95");
  });

  it("lists what the vault holds, leaving out what it has none of", () => {
    const line = (usdcRaw: number) =>
      holdingsLine([
        { token: usdc, raw: BigInt(usdcRaw) },
        { token: eth, raw: ETH_98 },
      ]);
    expect(line(95_000_000)).toBe("USDC 95.00 · ETH 0.98");
    expect(line(0)).toBe("ETH 0.98");
    expect(holdingsLine([{ token: usdc, raw: BigInt(0) }])).toBeNull();
  });

  it("parses an amount in base units up to the balance, refusing zero, more, or not a number", () => {
    const parse = (text: string) =>
      parseWithdrawAmount(text, usdc, BigInt(95_000_000));
    expect(parse("12.5")).toEqual({ amount: BigInt(12_500_000) });
    expect(parse("95")).toEqual({ amount: BigInt(95_000_000) });
    expect(parse(" 0.000001 ")).toEqual({ amount: BigInt(1) });
    const refused = {
      "The amount must be above 0.": "0|0.000000",
      "That is more than the vault holds of USDC.": "95.000001|95.01",
      // More decimals than the token has is not an amount it can hold.
      "Enter an amount, like 12.5.": "0.0000001|| |abc|1e3|-5|1.2.3|0x10|.",
    };
    for (const [error, texts] of Object.entries(refused))
      for (const text of texts.split("|"))
        expect(parse(text)).toEqual({ error });
  });
});
