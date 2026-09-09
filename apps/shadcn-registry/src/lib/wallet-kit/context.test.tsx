import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AomiWalletKitContextProvider } from "./context";
import { AOMI_SESSION_DISCONNECTED_IDENTITY } from "./identity";
import type { AomiWalletKit } from "./types";

const setUser = vi.hoisted(() => vi.fn());
vi.mock("@aomi-labs/react", () => ({ useUser: () => ({ setUser }) }));

describe("connector facts versus selected transaction account", () => {
  it("preserves an agent selection during network refresh, but resets it on a wallet switch or reconnect", () => {
    const wallet = {
      identity: {
        ...AOMI_SESSION_DISCONNECTED_IDENTITY,
        isConnected: true,
        address: "0xLogin",
        chainId: 1,
      },
    } as AomiWalletKit;
    const view = render(
      <AomiWalletKitContextProvider value={wallet}>
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].evm.address).toBe("0xLogin");
    const network = {
      ...wallet,
      identity: { ...wallet.identity, chainId: 8453 },
    };
    view.rerender(
      <AomiWalletKitContextProvider value={network}>
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].evm).toEqual({ chain_id: 8453 });
    // A chain-only refresh carries no is_connected, so a session-local
    // transaction account selection survives it.
    expect(setUser.mock.lastCall?.[0].connection).not.toHaveProperty(
      "is_connected",
    );
    const switched = {
      ...network,
      identity: { ...network.identity, address: "0xOther" },
    };
    view.rerender(
      <AomiWalletKitContextProvider value={switched}>
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].evm.address).toBe("0xOther");
    view.rerender(
      <AomiWalletKitContextProvider
        value={{
          ...switched,
          identity: { ...switched.identity, isConnected: false },
        }}
      >
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].connection.is_connected).toBe(false);
    view.rerender(
      <AomiWalletKitContextProvider value={switched}>
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].connection.is_connected).toBe(true);
    expect(setUser.mock.lastCall?.[0].evm.address).toBe("0xOther");
  });

  it("does not resend is_connected on an auth or cluster refresh while disconnected", () => {
    setUser.mockClear();
    const disconnected = {
      identity: { ...AOMI_SESSION_DISCONNECTED_IDENTITY },
    } as AomiWalletKit;
    const view = render(
      <AomiWalletKitContextProvider value={disconnected}>
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].connection.is_connected).toBe(false);
    view.rerender(
      <AomiWalletKitContextProvider
        value={{
          ...disconnected,
          identity: { ...disconnected.identity, svmCluster: "solana:devnet" },
        }}
      >
        {null}
      </AomiWalletKitContextProvider>,
    );
    expect(setUser.mock.lastCall?.[0].connection).not.toHaveProperty(
      "is_connected",
    );
    expect(setUser.mock.lastCall?.[0].svm.cluster).toBe("solana:devnet");
  });
});
