import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettings } from "@/account/account-settings";
import { AomiWalletKitComposer } from "@/wallet/composer/aomi-wallet-kit-composer";
import type { SvmWalletRuntime } from "@/wallet/composer/types";
import {
  readWalletSelection,
  writeWalletSelection,
} from "@/wallet/composer/wallet-selection";
import { preferenceStorage, useWidgetStorage } from "@/lib/widget-storage";
import { WalletAuthPublisherContext } from "@/wallet/providers/auth-store";
import { useEmbeddedSessionSource } from "@/wallet/providers/sources/embedded-session-source";
import type { WalletRegistryStore } from "@/wallet/registry/store";
import { selectAccounts } from "@/wallet/registry/selectors";
import type { AomiWalletKit } from "@/wallet/types";
import { evmAccountId } from "@/wallet/wallet-utils";
import { useEvmWalletRuntime } from "./wallet-runtime";

const FIRST = `0x${"11".repeat(20)}`;
const SECOND = `0x${"22".repeat(20)}`;
const EMBEDDED = `0x${"33".repeat(20)}`;
const AGENT = `0x${"aa".repeat(20)}`;
const SVM = "EmbeddedSolanaWallet";
const SVM_AGENT = "AgentSolanaWallet";
const fixture = vi.hoisted(() => ({
  switchAccount: vi.fn<() => Promise<unknown>>(),
  debug: vi.fn(),
  setUser: vi.fn(),
}));
vi.mock("@aomi-labs/react", () => ({
  useUser: () => ({ setUser: fixture.setUser }),
  useAomiDisplayCache: () => null,
  useDisplayQuery: () => ({ isPending: false }),
}));
vi.mock("@/wallet/wallet-debug", () => ({ walletDebug: fixture.debug }));
vi.mock("wagmi", () => {
  const config = {
    chains: [{ id: 1 }],
    connectors: [
      { uid: "first", id: "first" },
      { uid: "second", id: "second" },
    ],
  };
  return {
    useWalletClient: () => ({}),
    useSwitchChain: () => ({}),
    useDisconnect: () => ({}),
    useReconnect: () => ({}),
    useConnectors: () => [],
    useConnect: () => ({}),
    useSwitchAccount: () => ({ switchAccountAsync: fixture.switchAccount }),
    useSendTransaction: () => ({}),
    useSignTypedData: () => ({}),
    useSignMessage: () => ({}),
    useConfig: () => config,
  };
});
vi.mock("./wagmi-hooks", () => ({
  useWagmiConnections: () => [],
  useSendCallsSyncExecutor: () => undefined,
  useGetWalletClientFor: () => undefined,
  useWalletCapabilities: () => ({
    capabilities: undefined,
    refresh: async () => undefined,
  }),
}));
vi.mock("./brands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./brands")>()),
  useInstalledWalletFlags: () => ({}),
  dedupeWalletOptions: (options: unknown[]) => options,
}));
vi.mock("./registry-source", () => ({
  useWagmiRegistrySource: (store: WalletRegistryStore) => {
    useEffect(() => {
      store.dispatch({
        type: "wagmi/connections-changed",
        connections: [FIRST, SECOND].map((address, index) => ({
          family: "evm",
          uid: index ? "second" : "first",
          stableId: index ? "second" : "first",
          address,
          addresses: [address],
          chainId: 1,
        })),
        now: Date.now(),
      });
      store.dispatch({ type: "wagmi/settled", now: Date.now() });
    }, [store]);
  },
}));
vi.mock("@/account/transport", () => ({
  useShellTransport: () => ({}),
  useShellAomi: () => ({}),
  useAomi: () => ({}),
}));
vi.mock("@/ui/aomi/confirm-dialog", () => ({ useConfirmDialog: () => ({}) }));
vi.mock("@/account/account-management/account-management", () => ({
  AccountManagement: ({
    pending,
    onActivate,
  }: {
    pending: string | null;
    onActivate: (row: { key: string }) => void;
  }) => (
    <>
      <output data-testid="pending">{pending ?? "idle"}</output>
      <button onClick={() => void onActivate({ key: `evm:${FIRST}` })}>
        Use browser
      </button>
    </>
  ),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function useRuntime() {
  const [chain, setChain] = useState<number | undefined>(1);
  return useEvmWalletRuntime({
    selectedEvmChainId: chain,
    setSelectedEvmChainId: setChain,
    storageKey: "selection-test",
  });
}
beforeEach(() => {
  fixture.switchAccount.mockReset().mockResolvedValue(undefined);
  fixture.debug.mockClear();
  fixture.setUser.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("EVM cosmetic selection", () => {
  it.each(["resolved", "rejected", "pending"])(
    "completes on the registry with a %s cosmetic switch",
    async (settlement) => {
      const switching = deferred();
      fixture.switchAccount.mockReturnValue(switching.promise);
      const { result } = renderHook(useRuntime);
      await act(async () => {
        await result.current.selectAccount(evmAccountId("first", FIRST), {
          waitForCosmeticSwitch: false,
        });
      });
      expect(
        result.current.registryStore.getSnapshot().activeByFamily.evm,
      ).toMatchObject({ family: "evm", address: FIRST });
      expect(fixture.switchAccount).toHaveBeenCalledOnce();
      await act(async () => {
        if (settlement === "resolved") switching.resolve();
        if (settlement === "rejected")
          switching.reject(new Error("late failure"));
      });
      expect(
        fixture.debug.mock.calls.filter(
          ([event]) => event === "active-evm:cosmetic-switch-failed",
        ),
      ).toHaveLength(settlement === "rejected" ? 1 : 0);
    },
  );
  it.each(["resolve", "reject"])(
    "keeps default selection waiting until the connector settles (%s)",
    async (settlement) => {
      const switching = deferred();
      fixture.switchAccount.mockReturnValue(switching.promise);
      const { result } = renderHook(useRuntime);
      let done = false;
      let selecting!: Promise<void>;
      await act(async () => {
        selecting = result.current
          .selectAccount(evmAccountId("first", FIRST))
          .then(() => {
            done = true;
          });
      });
      expect(done).toBe(false);
      await act(async () => {
        if (settlement === "resolve") switching.resolve();
        else switching.reject(new Error("baseline failure"));
        await selecting;
      });
      expect(done).toBe(true);
    },
  );
  it("leaves a newer registry selection intact when the earlier cosmetic switch settles", async () => {
    const switching = deferred();
    fixture.switchAccount.mockReturnValueOnce(switching.promise);
    const { result } = renderHook(useRuntime);
    await act(async () => {
      await result.current.selectAccount(evmAccountId("first", FIRST), {
        waitForCosmeticSwitch: false,
      });
      await result.current.selectAccount(evmAccountId("second", SECOND));
      switching.resolve();
    });
    expect(
      result.current.registryStore.getSnapshot().activeByFamily.evm?.address,
    ).toBe(SECOND);
  });
});

let kit: AomiWalletKit;
let runtime: ReturnType<typeof useRuntime>;
let storage: ReturnType<typeof preferenceStorage>;
function Composer({
  provider = "privy",
  twoFamilies = false,
}: {
  provider?: "privy" | "para";
  twoFamilies?: boolean;
}) {
  const evm = useRuntime();
  runtime = evm;
  storage = preferenceStorage(useWidgetStorage());
  useEmbeddedSessionSource(evm.registryStore, {
    up: twoFamilies,
    providerId: provider,
    uid: "embedded",
    stableId: provider,
    walletName: provider,
    embeddedEvmAddress: twoFamilies ? EMBEDDED : null,
    chainId: 1,
  });
  useEffect(() => {
    if (!twoFamilies) return;
    evm.registryStore.dispatch({
      type: "svm/changed",
      uid: "svm",
      stableId: provider,
      publicKey: SVM,
      walletName: provider,
      kind: "embedded-session",
      providerId: provider,
      now: Date.now(),
    });
  }, [evm.registryStore, provider, twoFamilies]);
  const svm = twoFamilies
    ? ({
        accounts: (now: number) =>
          selectAccounts(evm.registryState, "svm", now).map((a) => ({
            ...a,
            walletKind: "embedded" as const,
            provider,
          })),
        identity: () => ({ address: SVM }),
        options: [],
        supportedNetworks: [],
        execution: { signSolanaMessage: svmSign },
        selectAccount: async () =>
          evm.registryStore.dispatch({
            type: "user/select-active",
            family: "svm",
            address: SVM,
            uid: "svm",
            stableId: provider,
            now: Date.now(),
          }),
      } as unknown as SvmWalletRuntime)
    : undefined;
  return (
    <WalletAuthPublisherContext.Provider
      value={(next) => {
        kit = next;
      }}
    >
      <AomiWalletKitComposer
        evm={evm}
        svm={svm}
        supportedChains={[]}
        auth={{
          provider,
          sessionProvider: provider,
          embeddedProvider: provider,
          status: "authenticated",
          canOpenModal: false,
          methods: [],
        }}
        execution={{
          canSignFor: () => true,
          evm: {
            chainsById: {},
            signTypedData: evmSign,
            sendTransaction: evmSend,
          } as never,
        }}
        account={{
          status: "ready",
          user: { id: "selection-account" },
          linkedAccounts: [],
          refresh: async () => undefined,
          wallets: [
            {
              id: "browser",
              family: "evm",
              address: twoFamilies ? EMBEDDED : FIRST,
              kind: twoFamilies ? "embedded" : "external",
              provider,
              linkedVia: provider,
            },
            {
              id: "agent",
              family: "evm",
              address: AGENT,
              kind: "agent",
              provider: "para",
              linkedVia: "para",
            },
            ...(twoFamilies
              ? [
                  {
                    id: "svm-browser",
                    family: "svm" as const,
                    address: SVM,
                    kind: "embedded" as const,
                    provider,
                    linkedVia: provider,
                  },
                  {
                    id: "svm-agent",
                    family: "svm" as const,
                    address: SVM_AGENT,
                    kind: "agent" as const,
                    provider: "para",
                    linkedVia: "para",
                  },
                ]
              : []),
          ],
        }}
      >
        <AccountSettings />
      </AomiWalletKitComposer>
    </WalletAuthPublisherContext.Provider>
  );
}
const evmSign = vi.fn();
const evmSend = vi.fn();
const svmSign = vi.fn();
function saveAgent(family: "evm" | "svm" = "evm") {
  // Use the same scoped preference store as the composer on first mount.
  const { result, unmount } = renderHook(() =>
    preferenceStorage(useWidgetStorage()),
  );
  writeWalletSelection(
    result.current,
    "selection-account",
    family,
    family === "evm" ? `evm:${AGENT}` : `svm:${SVM_AGENT}`,
  );
  unmount();
}
function picks() {
  return readWalletSelection(storage, "selection-account");
}

describe("composer selection with the EVM runtime and registry", () => {
  it("completes Settings activation and saves the exact browser key while its connector never resolves", async () => {
    fixture.switchAccount.mockReturnValue(new Promise(() => undefined));
    saveAgent();
    render(<Composer />);
    expect(kit.identity.address).toBe(AGENT);
    await act(async () => {
      fireEvent.click(screen.getByText("Use browser"));
    });
    expect(screen.getByTestId("pending").textContent).toBe("idle");
    expect(kit.identity.address).toBe(FIRST);
    expect(picks().evm).toBe(`evm:${FIRST}`);
    expect(
      runtime.registryStore.getSnapshot().activeByFamily.evm,
    ).toMatchObject({ family: "evm", address: FIRST });
  });
  it.each(["address", "family"])(
    "rejects a mismatched registry %s without persisting",
    async (mismatch) => {
      saveAgent();
      render(<Composer />);
      const dispatch = runtime.registryStore.dispatch.bind(
        runtime.registryStore,
      );
      vi.spyOn(runtime.registryStore, "dispatch").mockImplementation(
        (event) => {
          if (event.type === "user/select-active") {
            dispatch(
              mismatch === "family"
                ? event
                : {
                    ...event,
                    address: SECOND,
                    uid: "second",
                    stableId: "second",
                  },
            );
            if (mismatch === "family")
              runtime.registryStore.getSnapshot().activeByFamily.evm!.family =
                "svm";
          } else dispatch(event);
        },
      );
      const write = vi.spyOn(localStorage, "setItem");
      await act(async () => {
        await expect(kit.activateWallet!(`evm:${FIRST}`)).rejects.toThrow(
          "Couldn’t switch",
        );
      });
      expect(picks().evm).toBe(`evm:${AGENT}`);
      expect(
        write.mock.calls.filter(([key]) =>
          key.includes("aomi.wallet.operating"),
        ),
      ).toEqual([]);
    },
  );
  it("keeps a newer agent pick after a late connector settlement", async () => {
    const switching = deferred();
    fixture.switchAccount.mockReturnValue(switching.promise);
    saveAgent();
    render(<Composer />);
    await act(async () => {
      await kit.activateWallet!(`evm:${FIRST}`);
    });
    await act(async () => {
      await kit.activateWallet!(`evm:${AGENT}`);
    });
    await act(async () => {
      switching.resolve();
    });
    expect(kit.identity.address).toBe(AGENT);
    expect(picks().evm).toBe(`evm:${AGENT}`);
  });
  it.each(["privy", "para"] as const)(
    "round trips both %s families independently",
    async (provider) => {
      saveAgent();
      saveAgent("svm");
      render(<Composer provider={provider} twoFamilies />);
      const expected = { evm: `evm:${AGENT}`, svm: `svm:${SVM_AGENT}` };
      const backend = { evm: "w_agent", svm: "w_svm-agent" };
      for (const [family, address, id] of [
        ["evm", EMBEDDED, "browser"],
        ["evm", AGENT, "agent"],
        ["svm", SVM, "svm-browser"],
        ["svm", SVM_AGENT, "svm-agent"],
      ] as const) {
        fixture.setUser.mockClear();
        await act(async () => {
          await kit.activateWallet!(`${family}:${address}`);
        });
        expected[family] = `${family}:${address}`;
        backend[family] = `w_${id}`;
        expect(picks()).toEqual(expected);
        expect(
          kit.wallets
            .filter((w) => w.operating)
            .map((w) => w.key)
            .sort(),
        ).toEqual(Object.values(expected).sort());
        expect(kit.identity.address).toBe(expected.evm.slice(4));
        expect(kit.identity.svmAddress).toBe(expected.svm.slice(4));
        expect(kit.signTypedData).toBe(
          expected.evm === `evm:${AGENT}` ? undefined : evmSign,
        );
        expect(kit.sendTransaction).toBe(
          expected.evm === `evm:${AGENT}` ? undefined : evmSend,
        );
        expect(kit.signSolanaMessage).toBe(
          expected.svm === `svm:${SVM_AGENT}` ? undefined : svmSign,
        );
        const published = fixture.setUser.mock.calls
          .map(([value]) => value)
          .filter((value) => value.wallet_pick);
        expect(published).toEqual([
          {
            wallet_pick: backend,
            wallet_presence: ["w_browser", "w_svm-browser"],
          },
        ]);
      }
    },
  );
});
