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
  item("chain", "Base Sepolia", { testnet: true }),
  item("chain", "Solana Devnet", { testnet: true }),
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
      ["Chains", ["Ethereum", "Base"]],
    ]);
  });

  it("puts a chain named by the query before apps and skills", () => {
    expect(labels("base")).toEqual([
      ["Chains", ["Base"]],
      ["Apps", ["Aerodrome", "Uniswap"]],
      ["Skills", ["Bridge"]],
    ]);
  });

  it("shows test networks only when searched for", () => {
    expect(labels("sepolia")).toEqual([["Chains", ["Base Sepolia"]]]);
    expect(labels("devnet")).toEqual([["Chains", ["Solana Devnet"]]]);
  });

  it("keeps the usual order when no chain is named", () => {
    expect(labels("uni").map(([label]) => label)).toEqual(["Apps"]);
  });
});
