import type { AomiRulesEnforcement, AomiRulesVault } from "@aomi-labs/client";
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
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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

const listed = (extra: Partial<AomiRulesVault> = {}): AomiRulesVault => ({
  provider: "metamask",
  network: "eip155:8453",
  address: VAULT,
  owner: OWNER,
  ...extra,
});

/** Vaults from enforcement entries alone: a backend from before `vaults`. */
const fromEntries = (enforcement: AomiRulesEnforcement[]) =>
  vaultsOf({ vaults: [], enforcement });

describe("vaultsOf", () => {
  it("keeps a listed vault once its last grant is revoked and no entry names it", () => {
    expect(vaultsOf({ vaults: [listed()], enforcement: [] })).toEqual([
      {
        key: `8453:${VAULT}`,
        address: VAULT,
        chainId: 8453,
        chain: { label: "Base", network: "eip155:8453" },
        owner: OWNER,
        explorer: `https://basescan.org/address/${VAULT}`,
      },
    ]);
  });

  it("names a vault both lists and entries name once, listed ones first", () => {
    const vaults = vaultsOf({
      vaults: [
        listed({ network: "eip155:10" }),
        listed({ address: VAULT.toUpperCase().replace("0X", "0x") }),
      ],
      enforcement: [entry(), entry({ rule: "b", state: "behind" })],
    });
    expect(vaults.map((vault) => vault.key)).toEqual([
      `10:${VAULT}`,
      `8453:${VAULT}`,
    ]);
    // An entry still names a vault the list leaves out.
    expect(
      vaultsOf({
        vaults: [listed()],
        enforcement: [entry({ network: "eip155:1" })],
      }).map((vault) => vault.key),
    ).toEqual([`8453:${VAULT}`, `1:${VAULT}`]);
  });

  it("checks a listed vault as it checks an entry", () => {
    expect(
      vaultsOf({
        vaults: [
          listed({ provider: "swig" }),
          listed({ network: "eip155:42161" }),
          listed({ network: "solana:mainnet-beta" }),
          listed({ address: OWNER }),
          listed({ owner: "not an address" }),
          listed({ address: "" }),
        ],
        enforcement: [],
      }),
    ).toEqual([]);
  });

  it("names a vault from a MetaMask entry: its address, chain and owner", () => {
    expect(fromEntries([entry()])).toEqual([
      {
        key: `8453:${VAULT}`,
        address: VAULT,
        chainId: 8453,
        chain: { label: "Base", network: "eip155:8453" },
        owner: OWNER,
        explorer: `https://basescan.org/address/${VAULT}`,
      },
    ]);
  });

  it("counts removed entries too, and names each distinct vault and chain once", () => {
    const rules = fromEntries([
      entry({ rule: "a" }),
      // The same vault under a removed rule and in another case.
      entry({
        rule: "b",
        state: "behind",
        account: VAULT.toUpperCase().replace("0X", "0x"),
      }),
      // Another chain is another row; so is another owner's vault.
      entry({ rule: "c", network: "eip155:10" }),
      entry({
        rule: "d",
        account: "0x1111111111111111111111111111111111111111",
      }),
    ]);
    expect(rules.map((vault) => vault.key)).toEqual([
      `8453:${VAULT}`,
      `10:${VAULT}`,
      "8453:0x1111111111111111111111111111111111111111",
    ]);
  });

  it("names none for another provider, an unsupported chain, no vault yet, no EVM owner or the owner's own account", () => {
    expect(
      fromEntries([
        entry({ provider: "swig", network: "solana:mainnet-beta" }),
        entry({ provider: "swig" }),
        entry({ network: "eip155:42161" }),
        entry({ network: "eip155:137" }),
        entry({ account: null }),
        entry({ signer: { family: "evm", address: null } }),
        entry({ signer: { family: "svm", address: OWNER } }),
        entry({ account: OWNER }),
        entry({ account: "not an address" }),
      ]),
    ).toEqual([]);
  });

  it("keeps the vault and the owner in lower case, whatever case the entry writes", () => {
    const [vault] = fromEntries([
      entry({
        account: "0x7C4C1F0A2B3D4E5F60718293A4B5C6D7E8F9E079",
        signer: {
          family: "evm",
          address: "0x3E14A1B2C3D4E5F60718293A4B5C6D7E8F906DDE",
        },
      }),
    ]);
    expect(vault).toMatchObject({ address: VAULT, owner: OWNER });
  });

  it("covers Ethereum, OP, Base and Base Sepolia", () => {
    expect(
      fromEntries(
        ["eip155:1", "eip155:10", "eip155:8453", "eip155:84532"].map(
          (network) => entry({ network }),
        ),
      ).map((vault) => vault.chainId),
    ).toEqual([1, 10, 8453, 84532]);
  });
});

describe("vaultTokens", () => {
  const catalog: PolicyCatalog = {
    apps: [],
    tokens: [
      {
        symbol: "USDC",
        chains: [
          {
            chain: { label: "Base", network: "eip155:8453" },
            asset: `eip155:8453/erc20:${BASE_USDC}`,
            decimals: 6,
            address: BASE_USDC,
          },
          {
            chain: { label: "OP", network: "eip155:10" },
            asset: "eip155:10/erc20:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
            decimals: 6,
            address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
          },
          {
            chain: { label: "Solana", network: "solana:mainnet-beta" },
            asset: "solana:mainnet-beta/token:EPjFWdd5",
            decimals: 6,
            address: "EPjFWdd5",
          },
        ],
      },
      {
        symbol: "ETH",
        chains: [
          {
            chain: { label: "Base", network: "eip155:8453" },
            asset: "eip155:8453/native",
            decimals: 18,
          },
        ],
      },
    ],
  };

  it("is the catalog's ERC-20 tokens on that chain, then native ETH", () => {
    expect(vaultTokens(catalog, "eip155:8453")).toEqual([
      {
        symbol: "USDC",
        decimals: 6,
        asset: { erc20: BASE_USDC.toLowerCase() },
      },
      { symbol: "ETH", decimals: 18, asset: { native: true } },
    ]);
  });

  it("offers ETH alone before the catalog is read, and on a chain the catalog has no tokens for", () => {
    const eth = [{ symbol: "ETH", decimals: 18, asset: { native: true } }];
    expect(vaultTokens(null, "eip155:8453")).toEqual(eth);
    expect(vaultTokens(catalog, "eip155:84532")).toEqual(eth);
  });
});

describe("amounts", () => {
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

  it("shows at least two decimals, at most six, and groups thousands", () => {
    expect(shownAmount(BigInt(95_000_000), 6)).toBe("95.00");
    expect(shownAmount(BigInt("980000000000000000"), 18)).toBe("0.98");
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
    expect(
      holdingsLine([
        { token: usdc, raw: BigInt(95_000_000) },
        { token: eth, raw: BigInt("980000000000000000") },
      ]),
    ).toBe("USDC 95.00 · ETH 0.98");
    expect(
      holdingsLine([
        { token: usdc, raw: BigInt(0) },
        { token: eth, raw: BigInt("980000000000000000") },
      ]),
    ).toBe("ETH 0.98");
    expect(holdingsLine([{ token: usdc, raw: BigInt(0) }])).toBeNull();
  });

  it("parses a withdrawal amount in base units, up to what the vault holds", () => {
    const held = BigInt(95_000_000);
    expect(parseWithdrawAmount("12.5", usdc, held)).toEqual({
      amount: BigInt(12_500_000),
    });
    expect(parseWithdrawAmount("95", usdc, held)).toEqual({ amount: held });
    expect(parseWithdrawAmount(" 0.000001 ", usdc, held)).toEqual({
      amount: BigInt(1),
    });
  });

  it("refuses zero, more than the balance, and anything that is not a number", () => {
    const held = BigInt(95_000_000);
    const error = (text: string) =>
      (parseWithdrawAmount(text, usdc, held) as { error: string }).error;
    expect(error("0")).toBe("The amount must be above 0.");
    expect(error("0.000000")).toBe("The amount must be above 0.");
    // More decimals than the token has is not an amount it can hold.
    expect(error("0.0000001")).toBe("Enter an amount, like 12.5.");
    expect(error("95.000001")).toBe(
      "That is more than the vault holds of USDC.",
    );
    expect(error("95.01")).toBe("That is more than the vault holds of USDC.");
    for (const text of ["", " ", "abc", "1e3", "-5", "1.2.3", "0x10", "."])
      expect(error(text)).toBe("Enter an amount, like 12.5.");
  });
});
