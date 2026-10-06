import { describe, expect, it } from "vitest";
import { buildAccounts } from "./accounts";

describe("buildAccounts", () => {
  it("tags EVM connections and marks the active one", () => {
    const accounts = buildAccounts({
      evmConnections: [
        { id: "mm", walletName: "MetaMask", address: "0xAAA", chainId: 1 },
        { id: "rb", walletName: "Rabby", address: "0xBBB", chainId: 1 },
      ],
      activeEvmAddress: "0xbbb",
      svmConnections: [],
    });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      family: "evm",
      walletName: "MetaMask",
      active: false,
    });
    expect(accounts[1]).toMatchObject({
      family: "evm",
      walletName: "Rabby",
      active: true,
    });
  });

  it("collapses one EVM address exposed by multiple connectors into a single active row", () => {
    const accounts = buildAccounts({
      evmConnections: [
        { id: "mm", walletName: "MetaMask", address: "0xAAA", chainId: 1 },
        { id: "rb", walletName: "Rabby", address: "0xAAA", chainId: 1 },
      ],
      activeEvmAddress: "0xaaa",
      activeEvmConnectionId: "rb",
      svmConnections: [],
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      family: "evm",
      walletName: "Rabby",
      id: "rb",
      active: true,
    });
    expect(accounts[0].connectorIds).toEqual(["mm", "rb"]);
  });

  it("dedupes three connectors for the same address (Rabby/MetaMask impersonation)", () => {
    const accounts = buildAccounts({
      evmConnections: [
        { id: "rb1", walletName: "Rabby", address: "0xdA6", chainId: 8453 },
        { id: "mm", walletName: "MetaMask", address: "0xDA6", chainId: 8453 },
        { id: "rb2", walletName: "Rabby Wallet", address: "0xda6", chainId: 8453 },
      ],
      activeEvmAddress: "0xda6",
      activeEvmConnectionId: "mm",
      svmConnections: [],
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      walletName: "MetaMask",
      chainId: 8453,
      active: true,
    });
    expect(accounts[0].connectorIds).toEqual(["rb1", "mm", "rb2"]);
  });

  it("keeps genuinely distinct EVM addresses as separate rows", () => {
    const accounts = buildAccounts({
      evmConnections: [
        { id: "mm-a", walletName: "MetaMask", address: "0xAAA", chainId: 1 },
        { id: "mm-b", walletName: "MetaMask", address: "0xBBB", chainId: 1 },
      ],
      activeEvmAddress: "0xaaa",
      svmConnections: [],
    });
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.address)).toEqual(["0xAAA", "0xBBB"]);
  });

  it("prefers a real brand name over a generic injected label when no active connector is given", () => {
    const accounts = buildAccounts({
      evmConnections: [
        { id: "inj", walletName: "Injected", address: "0xAAA", chainId: 1 },
        { id: "rb", walletName: "Rabby", address: "0xAAA", chainId: 1 },
      ],
      activeEvmAddress: "0xaaa",
      svmConnections: [],
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ walletName: "Rabby", active: true });
  });

  it("adds connected Solana wallets and marks the selected address active", () => {
    const accounts = buildAccounts({
      evmConnections: [],
      activeEvmAddress: undefined,
      svmConnections: [
        { publicKey: "9xQpub", walletName: "Phantom" },
        { publicKey: "AbCpub", walletName: "Solflare" },
      ],
      activeSvmAddress: "AbCpub",
    });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      family: "svm",
      address: "9xQpub",
      active: false,
    });
    expect(accounts[1]).toMatchObject({
      family: "svm",
      address: "AbCpub",
      active: true,
    });
    expect(accounts[0].id).toBe("Phantom");
  });

  it("preserves Solana address case while matching the active wallet", () => {
    const accounts = buildAccounts({
      evmConnections: [],
      activeEvmAddress: undefined,
      svmConnections: [{ publicKey: "9xQpub" }],
      activeSvmAddress: "9XQPUB",
    });
    expect(accounts[0]).toMatchObject({
      family: "svm",
      id: "9xQpub",
      active: false,
    });
  });

  it("returns both families for a dual connection", () => {
    const accounts = buildAccounts({
      evmConnections: [
        { id: "mm", walletName: "MetaMask", address: "0xAAA", chainId: 1 },
      ],
      activeEvmAddress: "0xAAA",
      svmConnections: [{ publicKey: "9xQpub", walletName: "Phantom" }],
      activeSvmAddress: "9xQpub",
    });
    expect(accounts.filter((a) => a.family === "evm")).toHaveLength(1);
    expect(accounts.filter((a) => a.family === "svm")).toHaveLength(1);
  });

  it("returns empty when nothing is connected", () => {
    expect(
      buildAccounts({ evmConnections: [], activeEvmAddress: undefined }),
    ).toEqual([]);
  });
});
