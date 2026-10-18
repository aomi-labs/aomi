import { mainnet } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());

// Stand in for WalletConnect's provider import; the real connector logic stays.
vi.mock("wagmi/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi/connectors")>();
  return {
    ...actual,
    walletConnect: () =>
      actual.injected({
        target: () => ({
          id: "walletConnect",
          name: "WalletConnect",
          provider: init,
        }),
      }),
  };
});

import { createAomiEvmConfig } from "./evm-connector-catalog";

function walletConnectConnector(persistConnections: boolean, appName: string) {
  const config = createAomiEvmConfig({
    chains: [mainnet],
    wallets: ["walletconnect"],
    walletConnectProjectId: "test-project",
    persistConnections,
    appName,
  });
  const connector = config.connectors.find(
    (candidate) => candidate.id === "walletConnect",
  );
  if (!connector) throw new Error("WalletConnect connector missing");
  return { config, connector };
}

describe("deferred WalletConnect", () => {
  beforeEach(() => {
    init.mockReset();
    init.mockReturnValue({ on: vi.fn(), request: vi.fn() });
    localStorage.clear();
  });

  it("does not load the provider for a visitor with no WalletConnect session", async () => {
    const { connector } = walletConnectConnector(false, "guest");
    await expect(connector.getProvider()).rejects.toThrow();
    expect(await connector.isAuthorized()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("stays asleep after a WalletConnect disconnect left only the recent id", async () => {
    const { config, connector } = walletConnectConnector(true, "disconnected");
    await config.storage?.setItem("recentConnectorId", "walletConnect");
    await expect(connector.getProvider()).rejects.toThrow();
    expect(init).not.toHaveBeenCalled();
  });

  it("restores the provider when a WalletConnect connection is stored", async () => {
    const { config, connector } = walletConnectConnector(true, "returning");
    await config.storage?.setItem("store", {
      state: {
        connections: new Map([
          [
            connector.uid,
            {
              accounts: ["0x0000000000000000000000000000000000000001"],
              chainId: mainnet.id,
              connector: { id: "walletConnect" },
            },
          ],
        ]),
      },
    });
    await expect(connector.getProvider()).resolves.toBeDefined();
    expect(init).toHaveBeenCalled();
  });
});
