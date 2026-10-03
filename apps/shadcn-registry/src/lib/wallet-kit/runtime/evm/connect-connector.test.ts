import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, createConnector, http } from "wagmi";
import { connect, disconnect, switchAccount } from "wagmi/actions";
import { mainnet } from "viem/chains";
import { connectEvmConnector } from "./connect-connector";

const saved = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";

function fixture() {
  let accounts: readonly `0x${string}`[] = [saved];
  const getAccounts = vi.fn(async () => accounts);
  const connectorConnect = vi.fn(async () => {
    accounts = [saved];
    return { accounts, chainId: 1 };
  });
  const config = createConfig({
    chains: [mainnet],
    connectors: [
      createConnector(() => ({
        id: "rabby",
        name: "Rabby",
        type: "injected",
        connect: connectorConnect as never,
        disconnect: async () => undefined,
        getAccounts,
        getChainId: async () => 1,
        getProvider: async () => ({ isRabby: true }),
        isAuthorized: async () => accounts.length > 0,
        onAccountsChanged: () => undefined,
        onChainChanged: () => undefined,
        onDisconnect: () => undefined,
      })),
    ],
    storage: null,
    multiInjectedProviderDiscovery: false,
    transports: { [mainnet.id]: http() },
  });
  const connector = config.connectors[0]!;
  const input = {
    isConnected: () => config.state.connections.has(connector.uid),
    connector,
    connect: () => connect(config, { connector }),
    disconnect: () => disconnect(config, { connector }),
    switchAccount: () => switchAccount(config, { connector }),
    expectedAddress: saved,
  };
  return {
    config,
    connector,
    input,
    connectorConnect,
    getAccounts,
    select: (next: readonly `0x${string}`[]) => {
      accounts = next;
    },
  };
}

afterEach(() => vi.restoreAllMocks());
describe("restored EVM connector recovery", () => {
  it("reuses an already-current connector on repeated attempts", async () => {
    const f = fixture();
    await f.input.connect();
    await expect(f.input.connect()).rejects.toMatchObject({
      name: "ConnectorAlreadyConnectedError",
    });
    await expect(connectEvmConnector(f.input)).resolves.toMatchObject({
      accounts: [saved],
    });
    await expect(connectEvmConnector(f.input)).resolves.toMatchObject({
      accounts: [saved],
    });
    expect(f.connectorConnect).toHaveBeenCalledTimes(1);
  });
  it("guides a mismatched selected address and reconciles a silent extension change on retry", async () => {
    const f = fixture();
    await f.input.connect();
    f.select([other]);
    await expect(connectEvmConnector(f.input)).rejects.toThrow(
      "Select 0x1111…1111 in Rabby, then click Connect again",
    );
    expect(f.config.state.connections.get(f.connector.uid)?.accounts).toEqual([
      other,
    ]);
    f.select([saved]);
    await connectEvmConnector(f.input);
    expect(f.config.state.connections.get(f.connector.uid)?.accounts).toEqual([
      saved,
    ]);
    expect(f.connectorConnect).toHaveBeenCalledTimes(1);
  });
  it("detaches stale authorization and connects again without signing out", async () => {
    const f = fixture();
    await f.input.connect();
    f.select([]);
    await connectEvmConnector(f.input);
    expect(f.config.state.current).toBe(f.connector.uid);
    expect(f.connectorConnect).toHaveBeenCalledTimes(2);
  });
  it("clears interrupted requests so a later attempt can recover", async () => {
    const f = fixture();
    f.connectorConnect.mockRejectedValueOnce(new Error("User canceled"));
    await expect(connectEvmConnector(f.input)).rejects.toThrow("User canceled");
    await connectEvmConnector(f.input);
    expect(f.config.state.current).toBe(f.connector.uid);
  });
  it("joins overlapping attempts but validates each requested address", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.connectorConnect.mockImplementationOnce(async () => {
      await gate;
      return { accounts: [saved], chainId: 1 };
    });
    const first = connectEvmConnector(f.input);
    const second = connectEvmConnector({ ...f.input, expectedAddress: other });
    release();
    await first;
    await expect(second).rejects.toThrow("Select 0x2222…2222 in Rabby");
    expect(f.connectorConnect).toHaveBeenCalledTimes(1);
  });
  it("recovers when automatic reconnect wins the race", async () => {
    const f = fixture();
    await connectEvmConnector({
      ...f.input,
      connect: async () => {
        await f.input.connect();
        return f.input.connect();
      },
    });
    expect(f.config.state.current).toBe(f.connector.uid);
    expect(f.getAccounts).toHaveBeenCalledTimes(1);
  });
  it("validates the saved address on a fresh connection too", async () => {
    const f = fixture();
    await expect(
      connectEvmConnector({ ...f.input, expectedAddress: other }),
    ).rejects.toThrow("Select 0x2222…2222 in Rabby");
  });
});
