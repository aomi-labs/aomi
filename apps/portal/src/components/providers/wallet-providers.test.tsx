import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const walletKit = vi.hoisted(() => ({
  auth: undefined as unknown,
  providerMounts: 0,
  privyDelegationMounts: 0,
  throwOnProviderMount: "",
  replace: vi.fn(),
  connectSocial: vi.fn(async () => undefined),
}));

const navigation = vi.hoisted(() => ({
  pathname: "/settings",
  search: "",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: walletKit.replace }),
}));

vi.mock("@aomi-labs/widget-lib", async () => {
  const React = await import("react");
  const ProviderOwner = React.createContext(false);
  const WalletSignInOptionsContext = React.createContext<
    readonly { id: string; connect: () => Promise<void> }[]
  >([]);
  return {
    WalletSignInOptionsContext,
    AOMI_BOOTING_WALLET_KIT: { isReady: false },
    AomiWalletKitContextProvider: ({ children }: { children: ReactNode }) =>
      children,
    AomiWalletNetworkPreferencesProvider: ({
      children,
    }: {
      children: ReactNode;
    }) => children,
    ExtUserProvider: ({ children }: { children: ReactNode }) => children,
    AomiWalletKitProvider: ({
      auth,
      children,
    }: {
      auth: unknown;
      children: ReactNode;
    }) => {
      if (React.useContext(ProviderOwner)) {
        throw new Error("Multiple PrivyProvider instances found");
      }
      if (walletKit.throwOnProviderMount) {
        throw new Error(walletKit.throwOnProviderMount);
      }
      walletKit.auth = auth;
      const choices = React.useContext(WalletSignInOptionsContext);
      React.useEffect(() => {
        walletKit.providerMounts += 1;
      }, []);
      return (
        <ProviderOwner.Provider value>
          <div data-testid="wallet-provider-root">
            {choices.map((choice) => (
              <button key={choice.id} onClick={() => void choice.connect()}>
                {choice.id}
              </button>
            ))}
            {children}
          </div>
        </ProviderOwner.Provider>
      );
    },
    FullTestnetWalletRouter: ({ children }: { children: ReactNode }) =>
      children,
    arcTestnet: { id: 5042002 },
    megaeth: { id: 4326 },
    monad: { id: 143 },
    monadTestnet: { id: 10143 },
    robinhood: { id: 46630 },
    useAomiWalletKit: () => ({
      isReady: true,
      connectSocial: walletKit.connectSocial,
      getAccountCredential: vi.fn(),
    }),
    useFullTestnet: (chains: unknown) => ({
      enabled: false,
      routedChains: chains,
      routedChainIds: new Set<number>(),
    }),
  };
});

vi.mock("@aomi-labs/widget-lib/providers/para", () => ({}));
vi.mock("@aomi-labs/widget-lib/providers/privy", () => ({
  PrivyDelegationProvider: ({ children }: { children: ReactNode }) => {
    walletKit.privyDelegationMounts += 1;
    return <div data-testid="privy-delegation-root">{children}</div>;
  },
}));
vi.mock("@aomi-labs/account/better-auth/client", () => ({
  authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@portal/components/providers/e2e-wallet-provider", () => ({
  E2EWalletProvider: ({ children }: { children: ReactNode }) => children,
}));

describe("WalletProviders Privy configuration", () => {
  afterEach(() => {
    window.localStorage.removeItem("aomi:wallet-provider");
    vi.unstubAllEnvs();
    vi.resetModules();
    walletKit.auth = undefined;
    walletKit.providerMounts = 0;
    walletKit.privyDelegationMounts = 0;
    walletKit.throwOnProviderMount = "";
    walletKit.replace.mockReset();
    walletKit.connectSocial.mockClear();
    navigation.pathname = "/settings";
    navigation.search = "";
  });

  it("serves children on the server without mounting an auth SDK", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    const { renderToString } = await import("react-dom/server");
    const { WalletProviders } = await import("./wallet-providers");
    const html = renderToString(
      <WalletProviders>
        <span>chat</span>
      </WalletProviders>,
    );
    expect(html).toContain("chat");
    expect(html).not.toContain("wallet-provider-root");
    expect(walletKit.auth).toBeUndefined();
    expect(walletKit.providerMounts).toBe(0);
  });

  it("keeps children mounted while the remembered provider is restored", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    window.localStorage.setItem("aomi:wallet-provider", "para");
    const { WalletProviders } = await import("./wallet-providers");
    render(
      <WalletProviders>
        <span>chat</span>
      </WalletProviders>,
    );
    expect(screen.getByText("chat")).toBeInTheDocument();
    await waitFor(() =>
      expect(walletKit.auth).toMatchObject({ provider: "para" }),
    );
    expect(walletKit.providerMounts).toBe(1);
    expect(walletKit.connectSocial).not.toHaveBeenCalled();
    expect(screen.getByText("chat")).toBeInTheDocument();
  });

  it("restores the selected provider after remount without opening login again", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    const { WalletProviders } = await import("./wallet-providers");
    const view = render(<WalletProviders>chat</WalletProviders>);
    fireEvent.click(screen.getByRole("button", { name: "para" }));
    await waitFor(() =>
      expect(walletKit.connectSocial).toHaveBeenCalledWith("para"),
    );
    view.unmount();
    walletKit.connectSocial.mockClear();
    walletKit.providerMounts = 0;
    render(<WalletProviders>chat</WalletProviders>);
    await waitFor(() =>
      expect(walletKit.auth).toMatchObject({ provider: "para" }),
    );
    expect(walletKit.connectSocial).not.toHaveBeenCalled();
    expect(walletKit.providerMounts).toBe(1);
  });

  it("leaves enabled login methods under Privy's authority", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    const { WalletProviders } = await import("./wallet-providers");

    const view = render(
      <WalletProviders>
        <span>child</span>
      </WalletProviders>,
    );

    expect(walletKit.auth).toEqual({ provider: "privy" });
    expect(view.getAllByTestId("wallet-provider-root")).toHaveLength(1);
    expect(view.getAllByTestId("privy-delegation-root")).toHaveLength(1);
  });

  it("offers both configured providers and opens only the selected provider", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    navigation.pathname = "/";
    const { WalletProviders } = await import("./wallet-providers");
    render(
      <WalletProviders>
        <span>chat</span>
      </WalletProviders>,
    );
    expect(screen.getByRole("button", { name: "privy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "para" })).toBeInTheDocument();
    expect(walletKit.connectSocial).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "para" }));
    await waitFor(() =>
      expect(walletKit.connectSocial).toHaveBeenLastCalledWith("para"),
    );
    expect(walletKit.auth).toEqual({
      provider: "para",
      methods: ["email", "google"],
    });
    expect(screen.getAllByTestId("wallet-provider-root")).toHaveLength(1);
    expect(screen.queryByTestId("privy-delegation-root")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "privy" }));
    await waitFor(() =>
      expect(walletKit.connectSocial).toHaveBeenLastCalledWith("privy"),
    );
    expect(walletKit.auth).toEqual({ provider: "privy" });
    expect(walletKit.connectSocial).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("wallet-provider-root")).toHaveLength(1);
  });

  it("mounts no auth SDK while a device route is choosing a provider", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    navigation.pathname = "/device-auth";
    const { WalletProviders } = await import("./wallet-providers");

    const view = render(
      <WalletProviders>
        <span>child</span>
      </WalletProviders>,
    );

    expect(walletKit.auth).toBe(false);
    expect(view.getAllByTestId("wallet-provider-root")).toHaveLength(1);
    expect(walletKit.privyDelegationMounts).toBe(0);
  });

  it("mounts exactly the Para auth SDK selected by a device route", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    navigation.pathname = "/oauth/device";
    navigation.search = "provider=para";
    const { WalletProviders } = await import("./wallet-providers");

    const view = render(
      <WalletProviders>
        <span>child</span>
      </WalletProviders>,
    );

    expect(walletKit.auth).toEqual({
      provider: "para",
      methods: ["email", "google"],
    });
    expect(view.getAllByTestId("wallet-provider-root")).toHaveLength(1);
    expect(walletKit.privyDelegationMounts).toBe(0);
  });

  it("does not mount a selected provider whose public config is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "");
    navigation.pathname = "/device-auth";
    navigation.search = "provider=para";
    const { WalletProviders } = await import("./wallet-providers");

    const view = render(
      <WalletProviders>
        <span>child</span>
      </WalletProviders>,
    );

    expect(walletKit.auth).toBe(false);
    expect(view.getAllByTestId("wallet-provider-root")).toHaveLength(1);
  });

  it.each([
    ["/device-auth", "para"],
    ["/device-auth", "privy"],
    ["/oauth/device", "para"],
    ["/oauth/device", "privy"],
  ])(
    "composes one provider owner for %s with %s selected",
    async (pathname, provider) => {
      vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-app");
      vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
      navigation.pathname = pathname;
      navigation.search =
        pathname === "/device-auth"
          ? `provider=${provider}&state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback`
          : `provider=${provider}&user_code=AOMI-1234`;
      const [{ WalletProviders }, page] = await Promise.all([
        import("./wallet-providers"),
        pathname === "/device-auth"
          ? import("@portal/app/device-auth/device-auth-client")
          : import("@portal/app/oauth/device/oauth-device-client"),
      ]);
      const Page =
        pathname === "/device-auth"
          ? (
              page as typeof import("@portal/app/device-auth/device-auth-client")
            ).DeviceAuthClient
          : (
              page as typeof import("@portal/app/oauth/device/oauth-device-client")
            ).OAuthDeviceClient;

      const view = render(
        <WalletProviders>
          <Page />
        </WalletProviders>,
      );

      expect(view.getAllByTestId("wallet-provider-root")).toHaveLength(1);
      expect(walletKit.providerMounts).toBe(1);
    },
  );

  it("contains an SDK mount failure behind a secret-safe provider code", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_PARA_API_KEY", "para-key");
    navigation.pathname = "/device-auth";
    navigation.search =
      "provider=para&state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback";
    walletKit.throwOnProviderMount = "origin rejected with private detail";
    const { WalletProviders } = await import("./wallet-providers");

    render(
      <WalletProviders>
        <span>child</span>
      </WalletProviders>,
    );

    expect(screen.getByText(/para_origin_rejected/)).toBeInTheDocument();
    expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "device_auth_provider_initialization_failed",
      { provider: "para", code: "para_origin_rejected" },
    );
  });
});
