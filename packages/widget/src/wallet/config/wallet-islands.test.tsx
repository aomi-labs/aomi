import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
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

function Adapter({ provider }: { provider: string }) {
  const publish = useWalletAuthPublisher();
  useLayoutEffect(() => {
    publish?.({
      ...AOMI_BOOTING_WALLET_KIT,
      isReady: true,
      identity: {
        ...AOMI_BOOTING_WALLET_KIT.identity,
        sessionProvider: provider,
      },
    });
  }, [publish, provider]);
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
