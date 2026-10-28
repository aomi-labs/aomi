import { describe, expect, it } from "vitest";
import { pickerGroups, type PickerItem } from "./model";

const Icon = () => null;
const item = (
  kind: PickerItem["kind"],
  label: string,
  extra: Partial<PickerItem> = {},
): PickerItem => ({
  key: `${kind}:${label}`,
  kind,
  id: label,
  label,
  searchText: label,
  Icon,
  ...extra,
});

const items = [
  item("app", "Aerodrome", { searchText: "Aerodrome dex Base" }),
  item("app", "Uniswap", { searchText: "Uniswap dex Base Ethereum" }),
  item("skill", "Bridge", { searchText: "Bridge to Base" }),
  ...["One", "Two", "Three", "Four", "Five"].map((n) => item("skill", n)),
  item("chain", "Ethereum"),
  item("chain", "Base"),
  item("chain", "Solana", { searchText: "Solana solana svm mainnet" }),
  item("chain", "Base Sepolia", { testnet: true }),
  item("chain", "Solana Devnet", { testnet: true }),
  item("wallet", "Trading", { searchText: "Trading 0xAb12" }),
  item("wallet", "Base savings", { searchText: "Base savings 0xCd34" }),
];
const labels = (query: string) =>
  pickerGroups(items, query).map((group) => [
    group.label,
    group.items.map((i) => i.label),
  ]);

describe("pickerGroups", () => {
  it("previews every section on a bare @ without testnets", () => {
    expect(labels("")).toEqual([
      ["Apps", ["Aerodrome", "Uniswap"]],
      ["Skills", ["Bridge", "One", "Two", "Three"]],
      ["Chains", ["Ethereum", "Base", "Solana"]],
      ["Wallets", ["Trading", "Base savings"]],
    ]);
  });

  it("lists Solana mainnet as a chain", () => {
    expect(labels("sol")).toEqual([["Chains", ["Solana"]]]);
  });

  it("puts a chain named by the query before apps and skills", () => {
    expect(labels("ethereum")).toEqual([
      ["Chains", ["Ethereum"]],
      ["Apps", ["Uniswap"]],
    ]);
  });

  it("ranks a matching wallet above chains, apps and skills", () => {
    expect(labels("base")).toEqual([
      ["Wallets", ["Base savings"]],
      ["Chains", ["Base"]],
      ["Apps", ["Aerodrome", "Uniswap"]],
      ["Skills", ["Bridge"]],
    ]);
    expect(labels("trad")).toEqual([["Wallets", ["Trading"]]]);
  });

  it("shows test networks only when searched for", () => {
    expect(labels("sepolia")).toEqual([["Chains", ["Base Sepolia"]]]);
    expect(labels("devnet")).toEqual([["Chains", ["Solana Devnet"]]]);
  });

  it("finds a wallet by address", () => {
    expect(labels("0xcd34")).toEqual([["Wallets", ["Base savings"]]]);
  });

  it("keeps the usual order when no chain is named", () => {
    expect(labels("uni").map(([label]) => label)).toEqual(["Apps"]);
  });
});
