"use client";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useUser, ExtUserProvider } from "@aomi-labs/react";
import { AomiWalletKitContextProvider } from "../../../../../apps/shadcn-registry/src/lib/wallet-kit/context";
import type { AomiWalletKit } from "../../../../../apps/shadcn-registry/src/lib/wallet-kit/types";

afterEach(() => {
  cleanup();
});

function UserStateProbe() {
  const { user } = useUser();
  return <pre data-testid="user-state">{JSON.stringify(user)}</pre>;
}

function connectedAdapter(
  overrides: Partial<AomiWalletKit["identity"]> = {},
): AomiWalletKit {
  return {
    identity: {
      status: "connected",
      isConnected: true,
      address: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      ...overrides,
    },
    isReady: true,
    isSwitchingChain: false,
    canConnect: false,
    canOpenAccountUI: false,
    canDisconnect: false,
    accounts: [],
    selectAccount: async () => undefined,
    connect: async () => undefined,
  };
}

function renderWithAdapter(adapter: AomiWalletKit) {
  return render(
    <ExtUserProvider>
      <AomiWalletKitContextProvider value={adapter}>
        <UserStateProbe />
      </AomiWalletKitContextProvider>
    </ExtUserProvider>,
  );
}

describe("AomiWalletKitContextProvider user sync", () => {
  it("publishes wallet provider and owner/chain, never backend-authority aa/sponsorship", async () => {
    renderWithAdapter(
      connectedAdapter({
        sessionProvider: "baseAccount",
        walletKind: "smart-account",
      }),
    );

    await waitFor(() => {
      const state = JSON.parse(screen.getByTestId("user-state").textContent!);
      expect(state).toMatchObject({
        connection: {
          is_connected: true,
          provider: "baseAccount",
        },
        evm: {
          address: "0x1111111111111111111111111111111111111111",
          chain_id: 8453,
        },
      });
      // AA / sponsorship are backend authority and are never published here.
      expect(state.evm?.aa).toBeUndefined();
      expect(state.evm?.sponsorship).toBeUndefined();
    });
  });

  it("clears wallet provider metadata when no verified provider is available", async () => {
    const { rerender } = renderWithAdapter(
      connectedAdapter({
        sessionProvider: "baseAccount",
        walletKind: "smart-account",
      }),
    );

    await waitFor(() => {
      const state = JSON.parse(screen.getByTestId("user-state").textContent!);
      expect(state).toMatchObject({
        connection: {
          provider: "baseAccount",
        },
      });
    });

    rerender(
      <ExtUserProvider>
        <AomiWalletKitContextProvider value={connectedAdapter()}>
          <UserStateProbe />
        </AomiWalletKitContextProvider>
      </ExtUserProvider>,
    );

    await waitFor(() => {
      const state = JSON.parse(screen.getByTestId("user-state").textContent!);
      expect(state.connection.provider).toBeNull();
      expect(state.evm?.sponsorship).toBeUndefined();
    });
  });

  it("publishes Para as wallet provider and auth method", async () => {
    renderWithAdapter(
      connectedAdapter({
        sessionProvider: "para",
        walletKind: "eoa",
        authMethod: "google",
      }),
    );

    await waitFor(() => {
      const state = JSON.parse(screen.getByTestId("user-state").textContent!);
      expect(state).toMatchObject({
        connection: {
          provider: "para",
          auth_method: "google",
        },
      });
      expect(state.evm?.sponsorship).toBeUndefined();
    });
  });

  it("publishes empty SVM capabilities instead of null for EVM-only identity", async () => {
    renderWithAdapter(connectedAdapter());

    await waitFor(() => {
      const state = JSON.parse(screen.getByTestId("user-state").textContent!);
      expect(state.svm.capabilities).toEqual([]);
    });
  });
});
