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

  it("restores the provider when WalletConnect was the recent connector", async () => {
    const { config, connector } = walletConnectConnector(true, "returning");
    await config.storage?.setItem("recentConnectorId", "walletConnect");
    await expect(connector.getProvider()).resolves.toBeDefined();
    expect(init).toHaveBeenCalled();
  });
});
