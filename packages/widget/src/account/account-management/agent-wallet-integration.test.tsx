import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AomiAccountWallet, AomiClient } from "@aomi-labs/client";
import type { AccountWallet } from "@/wallet/account/types";
import { AomiWalletKitComposer } from "@/wallet/composer/aomi-wallet-kit-composer";
import { createInitialState } from "@/wallet/registry/reducer";
import { useAomiWalletKit } from "@/wallet/context";
import { AgentWalletGroup } from "./agent-wallet-group";

const runtime = vi.hoisted(() => ({
  createThread: vi.fn(async () => "withdrawal-thread"),
}));
const setUser = vi.hoisted(() => vi.fn());
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useUser: () => ({ setUser }),
  useOptionalAomiRuntime: () => runtime,
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const address = `0x${"7a".repeat(20)}`;
const agent = {
  id: "w_12",
  kind: "agent",
  family: "evm",
  address,
  label: "Agent wallet",
  is_default: true,
  status: "ready",
  merged: false,
  pinned_telegram: false,
  created_at: 1,
  rule: { mode: "ask", rule_version: 0, instant: [] },
} as AomiAccountWallet;

it("creates, selects and withdraws with the refreshed account and real wallet kit", async () => {
  let serverWallets: AomiAccountWallet[] = [];
  const setThreadWallet = vi.fn(async () => ({
    active_wallet: { evm: "w_12" },
  }));
  const createAgentWallets = vi.fn(async () => {
    serverWallets = [agent];
    return { wallets: serverWallets, created: [agent.id], failed: [] };
  });
  const client = {
    account: {
      wallets: {
        listWallets: async () => serverWallets,
        createAgentWallets,
        setThreadWallet,
        walletBalance: async () => ({ id: agent.id, chains: [], as_of: 1 }),
      },
    },
  } as unknown as AomiClient;
  const errors: string[] = [];
  function Group() {
    const kit = useAomiWalletKit();
    return (
      <AgentWalletGroup
        client={client}
        rows={kit.wallets}
        pending={null}
        onActivate={(row) => {
          void kit.activateWallet!(row.key);
        }}
        run={async (_, action) => {
          try {
            await action();
            return true;
          } catch (e) {
            errors.push(String(e));
            return false;
          }
        }}
      />
    );
  }
  const refresh = vi.fn();
  function Host() {
    const [wallets, setWallets] = useState<AccountWallet[]>([]);
    return (
      <AomiWalletKitComposer
        auth={{
          provider: "para",
          status: "authenticated",
          canOpenModal: false,
          methods: [],
        }}
        account={{
          status: "ready",
          user: { id: "created-agent-owner" },
          linkedAccounts: [],
          wallets,
          refresh: async () => {
            refresh();
            setWallets(
              serverWallets.map((w) => ({
                id: w.id.slice(2),
                family: w.family,
                address: w.address,
                kind: "agent",
                provider: "para",
                linkedVia: "para",
              })),
            );
          },
        }}
        evm={
          {
            registryStore: { dispatch: vi.fn() },
            registryState: { ...createInitialState(), phase: "stable" },
            identity: () => ({}),
            accounts: () => [],
            options: [],
          } as never
        }
        execution={{ evm: { chainsById: {} } } as never}
        supportedChains={[]}
      >
        <Group />
      </AomiWalletKitComposer>
    );
  }
  render(<Host />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create agent wallet" }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: /Actions for/ }));
  });
  fireEvent.click(screen.getByText("Use this wallet"));
  await waitFor(() =>
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_pick: { evm: "w_12", svm: null } }),
    ),
  );
  // The menu closes after selection; open it again for the explicit withdrawal.
  fireEvent.click(screen.getByRole("button", { name: /Actions for/ }));
  fireEvent.click(screen.getByText("Withdraw to…"));
  await waitFor(() =>
    expect(setThreadWallet).toHaveBeenCalledWith("withdrawal-thread", "w_12"),
  );
  expect(runtime.createThread).toHaveBeenCalledOnce();
  expect(errors).toEqual([]);
});

it("shows an inline error and opens no withdrawal when the explicit wallet cannot activate", async () => {
  const client = {
    account: {
      wallets: {
        listWallets: async () => [agent],
        walletBalance: async () => ({ id: agent.id, chains: [], as_of: 1 }),
      },
    },
  } as unknown as AomiClient;
  function Host() {
    const [error, setError] = useState<string>();
    return (
      <>
        {error && <p role="alert">{error}</p>}
        <AgentWalletGroup
          client={client}
          rows={[]}
          pending={null}
          run={async (_, action) => {
            try {
              await action();
              return true;
            } catch (cause) {
              setError((cause as Error).message);
              return false;
            }
          }}
        />
      </>
    );
  }
  render(<Host />);
  fireEvent.click(await screen.findByRole("button", { name: /Actions for/ }));
  fireEvent.click(screen.getByText("Withdraw to…"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Wallet unavailable",
  );
  expect(runtime.createThread).not.toHaveBeenCalled();
});
