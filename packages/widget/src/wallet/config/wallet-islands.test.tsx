import {
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AomiWalletKitProvider } from "./aomi-wallet-kit-provider";
import {
  getWalletProvider,
  registerWalletProvider,
} from "@/wallet/providers/plugin-registry";
import { MissingWalletSdkError } from "@/wallet/providers/sdk-loaders";
import { AOMI_BOOTING_WALLET_KIT, useAomiWalletKit } from "@/wallet/context";
import { useWalletAuthPublisher } from "@/wallet/providers/auth-store";
import { base, mainnet } from "wagmi/chains";
import { NetworkSelect } from "@/controls/network-select";
import { WalletSignInOptionsContext } from "@/wallet/picker/wallet-picker-context";

// Keep these tests about instance/lifecycle behavior; provider signing adapters
// have independent SDK-facing tests.
vi.mock("@/wallet/composer/aomi-wallet-kit-composer", () => ({
  AomiWalletKitComposer: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/wallet/runtime/evm/wallet-runtime", () => ({
  useEvmWalletRuntime: () => ({}),
}));
vi.mock("@/wallet/runtime/svm/wallet-runtime", () => ({
  useSafeSvmWallet: () => ({}),
}));
vi.mock("@/wallet/catalog/evm-connector-catalog", () => ({
  createAomiEvmConfig: () => ({}),
}));
vi.mock("@/wallet/runtime/evm/provider", () => ({
  AomiEvmRuntimeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/wallet/full-testnet-wallet-routing", async (original) => ({
  ...(await original<typeof import("@/wallet/full-testnet-wallet-routing")>()),
  WalletChainRouter: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/wallet/account/use-resolved-account-runtime", () => ({
  useResolvedAccountRuntime: () => ({}),
}));
vi.mock("@/wallet/execution/execution-runtime", () => ({
  buildEvmExecutionRuntime: () => ({}),
}));
vi.mock("@/wallet/context", async (original) => {
  const actual = await original<typeof import("@/wallet/context")>();
  return {
    ...actual,
    AomiWalletKitContextProvider: ({
      value,
      children,
    }: {
      value: typeof AOMI_BOOTING_WALLET_KIT;
      children: ReactNode;
    }) => (
      <actual.AomiWalletKitContextProvider value={value}>
        {children}
      </actual.AomiWalletKitContextProvider>
    ),
  };
});

function Adapter({
  provider,
  connectSocial,
}: {
  provider: string;
  connectSocial?: (id: string) => Promise<void>;
}) {
  const publish = useWalletAuthPublisher();
  useLayoutEffect(() => {
    publish?.({
      ...AOMI_BOOTING_WALLET_KIT,
      isReady: true,
      identity: {
        ...AOMI_BOOTING_WALLET_KIT.identity,
        sessionProvider: provider,
      },
      connectSocial,
    });
  }, [connectSocial, publish, provider]);
  return null;
}
const wallets = { solana: false as const };
it("renders configured networks while the wallet island is still booting", () => {
  function Status() {
    const kit = useAomiWalletKit();
    return (
      <span>
        {kit.identity.status}:{String(kit.isReady)}:{kit.accounts.length}
      </span>
    );
  }
  render(
    <AomiWalletKitProvider
      initializing
      wallets={{ evm: { chains: [mainnet, base] }, solana: false }}
    >
      <Status />
      <NetworkSelect />
    </AomiWalletKitProvider>,
  );
  expect(screen.getByText("booting:false:0")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Supported networks" }),
  ).toBeTruthy();
});

it("keeps the chat mounted while a delayed SDK loads and while switching providers", async () => {
  let mounts = 0;
  let resolveFirst!: (
    plugin: Parameters<typeof registerWalletProvider>[0],
  ) => void;
  const load = vi.fn(
    () =>
      new Promise<Parameters<typeof registerWalletProvider>[0]>((resolve) => {
        resolveFirst = resolve;
      }),
  );
  registerWalletProvider({ id: "first-island", load });
  registerWalletProvider({
    id: "second-island",
    renderComposer: () => <Adapter provider="second-island" />,
  });
  function Chat() {
    const kit = useAomiWalletKit();
    useEffect(() => {
      mounts++;
    }, []);
    return <div>{kit.identity.sessionProvider ?? "loading"}</div>;
  }
  const view = render(
    <AomiWalletKitProvider
      auth={{ provider: "first-island" }}
      wallets={wallets}
    >
      <Chat />
    </AomiWalletKitProvider>,
  );
  expect(screen.getByText("loading")).toBeTruthy();
  expect(mounts).toBe(1);
  await act(async () => {
    resolveFirst({
      id: "first-island",
      renderComposer: () => <Adapter provider="first-island" />,
    });
  });
  await waitFor(() => expect(screen.getByText("first-island")).toBeTruthy());
  view.rerender(
    <AomiWalletKitProvider
      auth={{ provider: "second-island" }}
      wallets={wallets}
    >
      <Chat />
    </AomiWalletKitProvider>,
  );
  await waitFor(() => expect(screen.getByText("second-island")).toBeTruthy());
  expect(mounts).toBe(1);
  expect(load).toHaveBeenCalledTimes(1);
});
it("keeps independent auth state for two widget instances", async () => {
  registerWalletProvider({
    id: "alice-island",
    renderComposer: () => <Adapter provider="alice-island" />,
  });
  registerWalletProvider({
    id: "bob-island",
    renderComposer: () => <Adapter provider="bob-island" />,
  });
  function Label() {
    return <span>{useAomiWalletKit().identity.sessionProvider}</span>;
  }
  render(
    <>
      <AomiWalletKitProvider
        auth={{ provider: "alice-island" }}
        wallets={wallets}
      >
        <Label />
      </AomiWalletKitProvider>
      <AomiWalletKitProvider
        auth={{ provider: "bob-island" }}
        wallets={wallets}
      >
        <Label />
      </AomiWalletKitProvider>
    </>,
  );
  await waitFor(() => {
    expect(screen.getByText("alice-island")).toBeTruthy();
    expect(screen.getByText("bob-island")).toBeTruthy();
  });
});

function AccountError() {
  return <span>{useAomiWalletKit().accountError ?? "no-error"}</span>;
}

it.each([
  {
    name: "a provider whose SDK package is missing",
    setup: () =>
      registerWalletProvider({
        id: "missing-sdk",
        load: () =>
          Promise.reject(
            new MissingWalletSdkError("Missing", ["missing-sdk"], undefined),
          ),
      }),
    provider: "missing-sdk",
    message: /Missing sign-in needs missing-sdk/,
  },
  {
    name: "an unknown provider id",
    setup: () => undefined,
    provider: "not-a-provider",
    message: /Unknown wallet provider "not-a-provider"/,
  },
  {
    name: "a provider that throws while rendering",
    setup: () =>
      registerWalletProvider({
        id: "throws-on-render",
        renderComposer: () => {
          throw new Error("SDK exploded");
        },
      }),
    provider: "throws-on-render",
    message: /Couldn’t start the wallet provider/,
  },
])(
  "keeps the host page and reports $name inside the wallet kit",
  async ({ setup, provider, message }) => {
    setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AomiWalletKitProvider auth={{ provider }} wallets={wallets}>
        <span>chat</span>
        <AccountError />
      </AomiWalletKitProvider>,
    );
    expect(screen.getByText("chat")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
  },
);

it.each(["privy", "para"])(
  "resolves auth provider %s without importing its provider entry",
  (provider) => {
    expect(getWalletProvider(provider)?.load).toBeTypeOf("function");
  },
);

it("keeps a warmed provider SDK mounted and opens login through the active runtime", async () => {
  const sdkMounts: Record<string, number> = {};
  const login = vi.fn(async (_id: string) => undefined);
  function Sdk({ id, children }: { id: string; children: ReactNode }) {
    useEffect(() => {
      sdkMounts[id] = (sdkMounts[id] ?? 0) + 1;
    }, [id]);
    return <>{children}</>;
  }
  for (const id of ["warm-a", "warm-b"]) {
    registerWalletProvider({
      id,
      wrap: (props) => <Sdk id={id} {...props} />,
      renderComposer: () => <Adapter provider={id} connectSocial={login} />,
    });
  }
  const chosen: string[] = [];
  function Host() {
    const [provider, setProvider] = useState<string | undefined>();
    const options = ["warm-a", "warm-b"].map((id) => ({
      id,
      label: id,
      family: "multichain" as const,
      kind: "social" as const,
      status: "available" as const,
      connect: async () => {
        chosen.push(id);
        setProvider(id);
      },
    }));
    return (
      <WalletSignInOptionsContext.Provider value={options}>
        <AomiWalletKitProvider
          auth={provider ? { provider } : false}
          wallets={wallets}
        >
          <Sheet />
        </AomiWalletKitProvider>
      </WalletSignInOptionsContext.Provider>
    );
  }
  function Sheet() {
    const options = useContext(WalletSignInOptionsContext);
    const kit = useAomiWalletKit();
    return (
      <>
        <span>active:{kit.identity.sessionProvider ?? "none"}</span>
        <button onClick={() => options.forEach((option) => option.preload?.())}>
          open sheet
        </button>
        {options.map((option) => (
          <button key={option.id} onClick={() => void option.connect()}>
            {option.id}
          </button>
        ))}
      </>
    );
  }
  render(<Host />);
  fireEvent.click(screen.getByText("open sheet"));
  await waitFor(() => expect(sdkMounts).toEqual({ "warm-a": 1, "warm-b": 1 }));

  // Opens once the host has made it active and its runtime is up.
  fireEvent.click(screen.getByText("warm-a"));
  await waitFor(() => expect(screen.getByText("active:warm-a")).toBeTruthy());
  await waitFor(() => expect(login).toHaveBeenLastCalledWith("warm-a"));

  // The active provider opens inside the click.
  fireEvent.click(screen.getByText("warm-a"));
  expect(login).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByText("warm-b"));
  await waitFor(() => expect(screen.getByText("active:warm-b")).toBeTruthy());
  await waitFor(() => expect(login).toHaveBeenLastCalledWith("warm-b"));
  expect(sdkMounts).toEqual({ "warm-a": 1, "warm-b": 1 });
  expect(chosen).toEqual(["warm-a", "warm-a", "warm-b"]);
});

it("reports a provider whose SDK never offers login inside the widget", async () => {
  vi.useFakeTimers();
  registerWalletProvider({
    id: "never-ready",
    wrap: ({ children }) => <>{children}</>,
    renderComposer: () => <Adapter provider="never-ready" />,
  });
  function Sheet() {
    const [option] = useContext(WalletSignInOptionsContext);
    return <button onClick={() => void option!.connect()}>never-ready</button>;
  }
  render(
    <WalletSignInOptionsContext.Provider
      value={[
        {
          id: "never-ready",
          label: "Never ready",
          family: "multichain",
          kind: "social",
          status: "available",
          connect: async () => undefined,
        },
      ]}
    >
      <AomiWalletKitProvider wallets={wallets}>
        <Sheet />
        <AccountError />
      </AomiWalletKitProvider>
    </WalletSignInOptionsContext.Provider>,
  );
  fireEvent.click(screen.getByText("never-ready"));
  await act(async () => {
    vi.advanceTimersByTime(15_000);
  });
  vi.useRealTimers();
  expect(screen.getByText(/Couldn’t open never-ready/)).toBeTruthy();
});
