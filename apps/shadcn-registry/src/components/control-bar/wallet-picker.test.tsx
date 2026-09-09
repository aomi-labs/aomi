import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Type-side registration of the jest-dom matchers the root vitest.setup.ts
// installs at runtime; the app tsconfig doesn't load the augmentation globally.
import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AomiRuntimeApiProvider, ExtUserProvider } from "@aomi-labs/react";
import type { AomiWalletKit } from "@/lib/wallet-kit";
import { AomiWalletKitContextProvider } from "@/lib/wallet-kit";
import { AomiWalletNetworkPreferencesProvider } from "@/lib/wallet-kit/network-preferences";
import { registerWalletProvider } from "@/lib/wallet-kit/providers/plugin-registry";
import { WalletPickerProvider, useWalletPicker } from "./wallet-picker-context";
import { WalletPicker } from "./wallet-picker";

afterEach(cleanup);

// The account-access model derives the provider-auth set from the plugin
// registry (a plugin with an `authMode`). Register minimal stand-ins so these
// tests classify "para"/"privy" accounts without importing the full providers.
beforeAll(() => {
  registerWalletProvider({ id: "para", authMode: "additive" });
  registerWalletProvider({ id: "privy", authMode: "additive" });
});

const evmChains = [
  {
    id: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://eth.example"] } },
  },
] as const;
const solanaNetworks = [
  {
    id: "solana-mainnet",
    label: "Mainnet",
    cluster: "solana:mainnet",
    rpcHttpUrl: "https://m.example",
    isDefault: true,
  },
] as const;

function makeAdapter(overrides: Partial<AomiWalletKit> = {}): AomiWalletKit {
  const adapter: AomiWalletKit = {
    identity: {
      status: "connected",
      isConnected: true,
      address: "0xAAAAAAAA",
      chainId: 1,
      svmAddress: "9xQpubKey",
      authProvider: "google",
      walletProvider: "para",
      primaryLabel: "0xAAA..AA",
    },
    isReady: true,
    isSwitchingChain: false,
    canConnect: true,
    canOpenAccountUI: true,
    canDisconnect: true,
    accounts: [
      {
        id: "mm",
        family: "evm",
        address: "0xAAAAAAAA",
        walletName: "MetaMask",
        chainId: 1,
        active: true,
      },
      {
        id: "phantom",
        family: "svm",
        address: "9xQpubKey",
        walletName: "Phantom",
        active: true,
      },
    ],
    selectAccount: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    evmWallets: [
      {
        id: "metamask",
        label: "MetaMask",
        family: "evm",
        kind: "evm",
        status: "installed",
        ready: true,
        installed: true,
      },
      {
        id: "rabby",
        label: "Rabby",
        family: "evm",
        kind: "evm",
        status: "installed",
        ready: true,
        installed: true,
      },
      {
        id: "walletconnect",
        label: "WalletConnect",
        family: "multichain",
        kind: "walletconnect",
        status: "qr",
        ready: true,
      },
    ],
    connectEvmWallet: vi.fn(async () => undefined),
    socialLoginOptions: [
      {
        id: "google",
        label: "Email or Google",
        family: "multichain",
        kind: "social",
        status: "available",
        ready: true,
        description: "Fast account sign-in",
      },
    ],
    connectSocial: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    openAccountUI: vi.fn(async () => undefined),
    supportedNetworks: { evm: evmChains, solana: solanaNetworks },
    ...overrides,
  };
  if (!overrides.walletModalRows) {
    adapter.walletModalRows = [
      ...adapter.accounts.map((account) => ({
        id: account.id,
        family: account.family,
        address: account.address,
        chainId: account.chainId,
        label: account.label ?? account.address,
        walletName: account.walletName,
        source: "live" as const,
        status: account.active ? ("active" as const) : ("connected" as const),
        linkedVia: account.linkedVia,
        manageable: account.manageable,
        actions: account.actions?.map((action) => ({
          kind: action.kind,
          label:
            action.label ??
            (action.kind === "manage"
              ? "Manage"
              : action.kind === "signout"
                ? "Sign out"
                : "Disconnect"),
        })) ?? [
          account.manageable
            ? ({ kind: "manage" as const, label: "Manage" } as const)
            : ({
                kind: "disconnect" as const,
                label: "Disconnect",
              } as const),
        ],
      })),
      ...(adapter.evmWallets ?? []).map((wallet) => ({
        id: wallet.id,
        family: wallet.family === "svm" ? ("svm" as const) : ("evm" as const),
        label: wallet.label,
        walletName: wallet.label,
        iconUrl: wallet.iconUrl,
        kind: wallet.kind,
        source: "option" as const,
        status:
          wallet.status === "unavailable"
            ? ("unavailable" as const)
            : ("available" as const),
        provider: wallet.connectorId,
        actions: [{ kind: "connect" as const, label: "Connect" }],
      })),
      ...(adapter.solanaWallets ?? []).map((wallet) => ({
        id: wallet.name,
        family: "svm" as const,
        label: wallet.name,
        walletName: wallet.name,
        iconUrl: wallet.iconUrl,
        kind: "solana" as const,
        source: "option" as const,
        status:
          wallet.ready === false
            ? ("unavailable" as const)
            : ("available" as const),
        actions: [{ kind: "connect" as const, label: "Connect" }],
      })),
      ...(adapter.socialLoginOptions ?? []).map((option) => ({
        id: option.id,
        family: "evm" as const,
        label: option.label,
        walletName: option.label,
        kind: "social" as const,
        source: "option" as const,
        status:
          option.status === "unavailable"
            ? ("unavailable" as const)
            : ("available" as const),
        actions: [{ kind: "authenticate" as const, label: "Sign in" }],
      })),
    ];
  }
  return adapter;
}

function OpenAndRender() {
  const { openPicker } = useWalletPicker();
  useEffect(() => {
    openPicker();
  }, [openPicker]);
  return <WalletPicker />;
}

function renderPicker(adapter: AomiWalletKit, hasBlockingActions = false) {
  const runtime = {
    hasBlockingActions,
    showNotification: vi.fn(),
  };
  return render(
    <ExtUserProvider>
      <AomiRuntimeApiProvider value={runtime as never}>
        <AomiWalletKitContextProvider value={adapter}>
          <AomiWalletNetworkPreferencesProvider
            storageKey="test"
            evmChains={evmChains}
            solanaNetworks={solanaNetworks}
          >
            <WalletPickerProvider>
              <OpenAndRender />
            </WalletPickerProvider>
          </AomiWalletNetworkPreferencesProvider>
        </AomiWalletKitContextProvider>
      </AomiRuntimeApiProvider>
    </ExtUserProvider>,
  );
}

// When connected, the add-wallet options live behind a collapsed expander.
function openAddWallets() {
  const trigger = screen.queryByRole("button", { name: "Add another wallet" });
  if (trigger) fireEvent.click(trigger);
}

describe("WalletPicker", () => {
  it("uses the shared light blurred backdrop", () => {
    renderPicker(makeAdapter());

    const backdrop = screen.getAllByRole("button", { name: "Close" })[0];
    expect(backdrop).toHaveAttribute("data-slot", "modal-backdrop");
    expect(backdrop.className).toContain("bg-black/20");
    expect(backdrop.className).toContain("backdrop-blur-[3px]");
    openAddWallets();
    expect(
      screen.getByRole("button", { name: "Link Rabby" }).className,
    ).toContain("w-full");
  });

  it("quietly handles a rejected or unfinished wallet connection", async () => {
    const connectEvmWallet = vi.fn(async () => {
      throw Object.assign(
        new Error(
          "User rejected the request. Details: Connection request reset. Please try again.",
        ),
        { code: 4001 },
      );
    });
    renderPicker(
      makeAdapter({
        identity: {
          status: "disconnected",
          isConnected: false,
          walletProvider: "para",
        },
        accounts: [],
        connectEvmWallet,
      }),
    );

    const walletConnect = screen.getByRole("button", {
      name: "Connect WalletConnect",
    });
    fireEvent.click(walletConnect);

    await waitFor(() => expect(connectEvmWallet).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(walletConnect.hasAttribute("disabled")).toBe(false),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still surfaces actionable wallet connection failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const connectEvmWallet = vi.fn(async () => {
      throw new Error("Wallet relay unavailable");
    });
    renderPicker(
      makeAdapter({
        identity: {
          status: "disconnected",
          isConnected: false,
          walletProvider: "para",
        },
        accounts: [],
        connectEvmWallet,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Connect WalletConnect" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Wallet relay unavailable",
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("renders connected accounts with family tags and a collapsible add-wallet list", () => {
    renderPicker(makeAdapter());
    expect(screen.getByText("Finish signing in")).toBeTruthy();
    const connectedLabel = screen.getByText("Connected on this device");
    const addLabel = screen.getByRole("button", { name: "Add another wallet" });
    // Para isn't connected here (MetaMask + Phantom), so the Para sign-in row
    // stays available under "Other ways to sign in".
    const quickSignInLabel = screen.getByText("Other ways to sign in");
    // Order is Connected -> other sign-in methods -> Add another wallet.
    expect(
      connectedLabel.compareDocumentPosition(quickSignInLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      quickSignInLabel.compareDocumentPosition(addLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Manage your account" }),
    ).toBeNull();
    expect(screen.queryByText(/^ETH$/)).toBeNull();
    expect(screen.queryByText(/^SOL$/)).toBeNull();
    // EVM rows keep the family badge and put the network in the subtitle.
    expect(screen.getAllByText("EVM").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ethereum/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("SVM").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("MetaMask").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Phantom").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MetaMask").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Phantom").length).toBeGreaterThan(0);
    expect(screen.getByText("Email or Google")).toBeTruthy();

    // Add-wallet options stay collapsed (hidden from the a11y tree) until expanded.
    expect(addLabel.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Link Rabby" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Link WalletConnect" }),
    ).toBeNull();
    fireEvent.click(addLabel);
    expect(addLabel.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Link Rabby" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Link WalletConnect" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Link Browser wallet" }),
    ).toBeTruthy();
    // An already-connected brand (MetaMask) is not offered as an add option.
    expect(screen.queryByRole("button", { name: "Link MetaMask" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /connect with para/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect Para" })).toBeNull();
  });

  it("keeps linked wallet records out of the add-wallet picker", async () => {
    const connectEvmWallet = vi.fn(async () => undefined);
    const walletModalRows: NonNullable<AomiWalletKit["walletModalRows"]> = [
      {
        id: "para-evm",
        family: "evm",
        address: "0xe77a600000000000000000000000000000000000",
        chainId: 1,
        label: "0xe77...a6",
        walletName: "Para",
        source: "live",
        status: "active",
        linked: true,
        actions: [{ kind: "manage", label: "Manage" }],
      },
      {
        id: "stored-rabby",
        family: "evm",
        address: "0xda60000000000000000000000000000000000000",
        label: "Rabby 1",
        walletName: "Rabby 1",
        source: "stored",
        status: "stored",
        provider: "siwe",
        linked: true,
        actions: [{ kind: "connect", label: "Connect" }],
      },
      {
        id: "stored-walletconnect",
        family: "evm",
        address: "0x71f0000000000000000000000000000000000000",
        label: "WalletConnect 1",
        walletName: "WalletConnect 1",
        source: "stored",
        status: "stored",
        provider: "siwe",
        linked: true,
        actions: [{ kind: "connect", label: "Connect" }],
      },
      {
        id: "stored-coinbase",
        family: "evm",
        address: "0x67f0000000000000000000000000000000000000",
        label: "Coinbase Wallet 1",
        walletName: "Coinbase Wallet 1",
        source: "stored",
        status: "stored",
        provider: "siwe",
        linked: true,
        actions: [{ kind: "connect", label: "Connect" }],
      },
      {
        id: "metamask",
        family: "evm",
        label: "MetaMask",
        walletName: "MetaMask",
        kind: "evm",
        source: "option",
        status: "available",
        actions: [{ kind: "connect", label: "Connect" }],
      },
      {
        id: "rabby",
        family: "evm",
        label: "Rabby",
        walletName: "Rabby",
        kind: "evm",
        source: "option",
        status: "available",
        actions: [{ kind: "connect", label: "Connect" }],
      },
      {
        id: "coinbase",
        family: "evm",
        label: "Coinbase Wallet",
        walletName: "Coinbase Wallet",
        kind: "evm",
        source: "option",
        status: "available",
        actions: [{ kind: "connect", label: "Connect" }],
      },
      {
        id: "walletconnect",
        family: "evm",
        label: "WalletConnect",
        walletName: "WalletConnect",
        kind: "walletconnect",
        source: "option",
        status: "available",
        actions: [{ kind: "connect", label: "Connect" }],
      },
    ];

    renderPicker(
      makeAdapter({
        connectEvmWallet,
        accounts: [
          {
            id: "para-evm",
            family: "evm",
            address: "0xe77a600000000000000000000000000000000000",
            walletName: "Para",
            chainId: 1,
            active: true,
            linked: true,
            manageable: true,
          },
        ],
        walletModalRows,
      }),
    );

    openAddWallets();

    expect(screen.getByRole("button", { name: "Link Rabby" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Link Coinbase Wallet" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Link WalletConnect" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Link Rabby 1" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Link Coinbase Wallet 1" }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link Rabby" }));
    });
    expect(connectEvmWallet).toHaveBeenCalledWith("rabby");
  });

  it("renders inactive connected EVM wallets and can make one active", async () => {
    const selectAccount = vi.fn(async () => undefined);
    // The adapter dedupes same-address connectors, so the picker receives one
    // row per distinct address. Two genuinely different addresses stay distinct.
    renderPicker(
      makeAdapter({
        selectAccount,
        accounts: [
          {
            id: "rb-active",
            family: "evm",
            address: "0xBBBBBBBB",
            label: "0xBBB..BB",
            walletName: "Rabby Wallet",
            active: true,
          },
          {
            id: "mm-other",
            family: "evm",
            address: "0xCCCCCCCC",
            label: "0xCCC..CC",
            walletName: "MetaMask",
            active: false,
          },
        ],
      }),
    );

    expect(screen.getAllByText("Rabby Wallet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MetaMask").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Disconnect Ethereum wallet")).toHaveLength(
      2,
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Make MetaMask active"));
    });
    expect(selectAccount).toHaveBeenCalledWith("mm-other");
  });

  it("does not offer activation for provider-promoted read-only wallets", () => {
    const selectAccount = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        selectAccount,
        identity: {
          status: "connected",
          isConnected: true,
          address: "0xBBBBBBBB",
          chainId: 1,
          sessionProvider: "privy",
          embeddedProvider: "privy",
          walletProvider: "privy",
        },
        accounts: [
          {
            id: "coinbase-active",
            family: "evm",
            address: "0xBBBBBBBB",
            label: "0xBBB..BB",
            walletName: "Coinbase Wallet",
            active: true,
          },
        ],
        accountWallets: [
          {
            id: "e09bb7a8-19a1-46ca-9ccd-cd4213fcb697",
            family: "evm",
            address: "0xCCCCCCCC",
            kind: "embedded",
            provider: "privy",
            linkedVia: "privy",
            label: "0xCCC..CC",
            capability: "read",
          },
        ],
      }),
    );

    expect(screen.getAllByText("Privy").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Make Privy active")).toBeNull();
    expect(selectAccount).not.toHaveBeenCalled();
  });

  it("orders quick sign-in above the wallet list when disconnected", () => {
    renderPicker(
      makeAdapter({
        identity: { status: "disconnected", isConnected: false },
        accounts: [],
      }),
    );
    expect(screen.queryByText("Connected")).toBeNull();
    const quickSignInLabel = screen.getByText("Other ways to sign in");
    const walletsLabel = screen.getByText("Choose a wallet");
    expect(
      quickSignInLabel.compareDocumentPosition(walletsLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the connected section when only stale inactive accounts exist", () => {
    renderPicker(
      makeAdapter({
        identity: {
          status: "disconnected",
          isConnected: false,
        },
        accounts: [
          {
            id: "mm",
            family: "evm",
            address: "0xAAAAAAAA",
            walletName: "MetaMask",
            active: false,
          },
        ],
      }),
    );

    expect(screen.queryByText("Connected")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Select MetaMask wallet" }),
    ).toBeNull();
  });

  it("disconnects the active EVM account from the connected summary", async () => {
    const adapter = makeAdapter({
      accounts: [
        {
          id: "mm",
          family: "evm",
          address: "0xAAAAAAAA",
          walletName: "MetaMask",
          active: true,
        },
      ],
    });
    renderPicker(adapter);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Disconnect Ethereum wallet"));
    });
    expect(adapter.disconnect).toHaveBeenCalledWith({ accountId: "mm" });
  });

  it("blocks wallet connection while an Action is unresolved", () => {
    const adapter = makeAdapter({
      connectEvmWallet: vi.fn(async () => undefined),
      accounts: [
        {
          id: "mm",
          family: "evm",
          address: "0xAAAAAAAA",
          walletName: "Rabby",
          active: true,
        },
      ],
    });
    renderPicker(adapter, true);
    openAddWallets();
    fireEvent.click(screen.getByRole("button", { name: "Link MetaMask" }));
    expect(adapter.connectEvmWallet).not.toHaveBeenCalled();
  });

  it("connects an explicitly selected EVM wallet", async () => {
    const connectEvmWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accounts: [],
        identity: {
          status: "disconnected",
          isConnected: false,
        },
        connectEvmWallet,
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));
    });
    expect(connectEvmWallet).toHaveBeenCalledWith("metamask");
  });

  it("dedupes configured wallet aliases in the EVM wallet list", () => {
    renderPicker(
      makeAdapter({
        evmWallets: [
          {
            id: "rabby",
            label: "Rabby",
            family: "evm",
            kind: "evm",
            status: "installed",
            ready: true,
            installed: true,
          },
          {
            id: "rabby-wallet",
            label: "Rabby Wallet",
            family: "evm",
            kind: "evm",
            status: "installed",
            ready: true,
            installed: true,
          },
        ],
      }),
    );
    openAddWallets();
    expect(screen.getAllByRole("button", { name: /Link Rabby/ })).toHaveLength(
      1,
    );
  });

  it("connects an explicitly selected Solana wallet", async () => {
    const connectSolanaWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        solanaWallets: [{ name: "Solflare", installed: true, ready: true }],
        connectSolanaWallet,
      }),
    );
    openAddWallets();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link Solflare" }));
    });
    expect(connectSolanaWallet).toHaveBeenCalledWith("Solflare");
  });

  it("routes social sign-in through the adapter social action", async () => {
    const connectSocial = vi.fn(async () => undefined);
    // Social sign-in shows only in the disconnected onboarding state.
    renderPicker(
      makeAdapter({
        connectSocial,
        identity: { status: "disconnected", isConnected: false },
        accounts: [],
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Email or Google" }));
    });
    expect(connectSocial).toHaveBeenCalledWith("google");
  });

  it("shows the account ownership conflict without identifying the other account", () => {
    renderPicker(
      makeAdapter({
        accountError:
          "This wallet or sign-in method is already linked to another Aomi account. Sign in to that account, unlink it there, then return here and link it.",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign in to that account, unlink it there, then return here and link it",
    );
    expect(screen.getByRole("alert").textContent).not.toMatch(
      /user-|email|address/i,
    );
  });

  it("presents social auth as a first-class sign-in method", () => {
    renderPicker(
      makeAdapter({
        identity: {
          status: "disconnected",
          isConnected: false,
          walletProvider: "para",
        },
        accounts: [],
      }),
    );
    const socialRow = screen.getByRole("button", { name: "Email or Google" });
    expect(within(socialRow).getByText("Email or Google")).toBeTruthy();
    expect(within(socialRow).getByText("Fast account sign-in")).toBeTruthy();
  });

  it("falls back to the method label when no account provider brand exists", () => {
    renderPicker(
      makeAdapter({
        identity: { status: "disconnected", isConnected: false },
        accounts: [],
      }),
    );
    const socialRow = screen.getByRole("button", { name: "Email or Google" });
    expect(within(socialRow).queryByTitle("Para")).toBeNull();
  });

  it("stays open without a success popup after a direct wallet link", async () => {
    const connectEvmWallet = vi.fn(async () => undefined);
    renderPicker(makeAdapter({ connectEvmWallet }));
    openAddWallets();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Link Rabby" }));
    });
    expect(connectEvmWallet).toHaveBeenCalledWith("rabby");
    // No success banner, and the picker stays open (the new wallet just lands
    // in the connected list).
    expect(screen.queryByText("Wallet connected")).toBeNull();
    expect(screen.getByText("Finish signing in")).toBeTruthy();
  });

  it("uses the new finish-sign-in panel and closes after a successful link", async () => {
    const linkWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accounts: [
          {
            id: "rabby-account",
            family: "evm",
            address: "0xBBBBBBBB",
            walletName: "Rabby Wallet",
            chainId: 1,
            active: true,
          },
        ],
        accountWallets: [],
        linkWallet,
        walletModalRows: [
          {
            id: "rabby-account",
            family: "evm",
            address: "0xBBBBBBBB",
            walletName: "Rabby Wallet",
            label: "0xBBBBBBBB",
            chainId: 1,
            source: "live",
            status: "active",
            actions: [{ kind: "link", label: "Link wallet" }],
          },
        ],
      }),
    );

    expect(screen.getByText("Connected wallet")).toBeTruthy();
    expect(screen.getByText("Connected now")).toBeTruthy();
    expect(document.querySelector('[data-wallet-brand="rabby"]')).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Link wallet and sign in" }),
      );
    });

    expect(linkWallet).toHaveBeenCalledWith({
      accountId: "rabby-account",
      family: "evm",
      address: "0xBBBBBBBB",
      chainId: 1,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disconnects without linking from the finish-sign-in panel", async () => {
    const disconnect = vi.fn(async () => undefined);
    const linkWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accounts: [
          {
            id: "rabby-account",
            family: "evm",
            address: "0xBBBBBBBB",
            walletName: "Rabby Wallet",
            chainId: 1,
            active: true,
          },
        ],
        accountWallets: [],
        disconnect,
        linkWallet,
        walletModalRows: [
          {
            id: "rabby-account",
            family: "evm",
            address: "0xBBBBBBBB",
            walletName: "Rabby Wallet",
            label: "0xBBBBBBBB",
            chainId: 1,
            source: "live",
            status: "active",
            actions: [{ kind: "link", label: "Link wallet" }],
          },
        ],
      }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Disconnect Ethereum wallet" }),
      );
    });

    expect(disconnect).toHaveBeenCalledWith({ accountId: "rabby-account" });
    expect(linkWallet).not.toHaveBeenCalled();
  });

  it("auto-links the first connected EVM wallet for an empty account", async () => {
    const linkWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accountUser: { id: "user-1", displayName: "Ada Account" },
        accountWallets: [],
        linkWallet,
      }),
    );

    await waitFor(() => expect(linkWallet).toHaveBeenCalledTimes(1));
    expect(linkWallet).toHaveBeenCalledWith({
      accountId: "mm",
      family: "evm",
      address: "0xAAAAAAAA",
      chainId: 1,
    });
  });

  it("auto-links a connected external Solana wallet for an empty account", async () => {
    const linkWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        identity: {
          status: "connected",
          isConnected: true,
          svmAddress: "9xQpubKey",
          svmCluster: "solana:mainnet",
          svmWalletName: "Phantom",
          svmTransport: "extension",
        },
        accounts: [
          {
            id: "phantom",
            family: "svm",
            address: "9xQpubKey",
            walletName: "Phantom",
            active: true,
          },
        ],
        accountUser: { id: "user-1", displayName: "Ada Account" },
        accountWallets: [],
        linkWallet,
      }),
    );

    await waitFor(() => expect(linkWallet).toHaveBeenCalledTimes(1));
    expect(linkWallet).toHaveBeenCalledWith({
      accountId: "phantom",
      family: "svm",
      address: "9xQpubKey",
      chainId: undefined,
    });
  });

  it("does not auto-link additional connected wallets", async () => {
    const linkWallet = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accountUser: { id: "user-1", displayName: "Ada Account" },
        accountWallets: [
          {
            id: "wallet-1",
            family: "evm",
            address: "0xBBBBBBBB",
            kind: "external",
            linkedVia: "siwe",
          },
        ],
        linkWallet,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(linkWallet).not.toHaveBeenCalled();
  });

  it("keeps a dual-chain wallet connectable on both families", () => {
    renderPicker(
      makeAdapter({
        identity: { status: "disconnected", isConnected: false },
        accounts: [],
        evmWallets: [
          {
            id: "phantom-evm",
            label: "Phantom",
            family: "evm",
            kind: "evm",
            status: "installed",
            ready: true,
            installed: true,
          },
        ],
        solanaWallets: [{ name: "Phantom", installed: true, ready: true }],
      }),
    );
    // Family-scoped dedup keeps Phantom reachable as both EVM and Solana.
    expect(
      screen.getAllByRole("button", { name: "Connect Phantom" }),
    ).toHaveLength(2);
  });

  it("keeps a SIWE-verified external wallet's own brand, not 'siwe'", () => {
    renderPicker(
      makeAdapter({
        accountUser: undefined,
        walletModalRows: [
          {
            id: "mm-1",
            family: "evm",
            address: "0xDA6000000000000000000000000000000000000f0",
            chainId: 1,
            label: "0xDA6..f0",
            walletName: "MetaMask",
            source: "live",
            status: "active",
            // A SIWE verification stamps provider="siwe"; that is a method, not
            // a wallet brand, so the row must NOT collapse/rebrand to "siwe".
            provider: "siwe",
            linked: true,
            linkedVia: "siwe",
            actions: [{ kind: "disconnect", label: "Disconnect" }],
          },
        ],
      }),
    );

    expect(screen.getByText("MetaMask")).toBeTruthy();
    expect(screen.queryByText("siwe")).toBeNull();
    expect(screen.getByText("EVM")).toBeTruthy();
  });

  it("shows a per-row manage action only for manageable wallets", async () => {
    const openAccountUI = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accountUser: { id: "user-1", displayName: "Ada Account" },
        openAccountUI,
        accounts: [
          {
            id: "para",
            family: "evm",
            address: "0xAAAAAAAA",
            walletName: "Para",
            active: true,
            manageable: true,
          },
          {
            id: "phantom",
            family: "svm",
            address: "9xQpubKey",
            walletName: "Phantom",
            active: true,
          },
        ],
      }),
    );

    // Para is manageable -> a manage button; Phantom isn't -> none.
    expect(screen.getByRole("button", { name: "Manage Para" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Disconnect Ethereum wallet" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage Phantom" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Manage Para" }));
    });

    expect(openAccountUI).toHaveBeenCalledWith({ family: "evm" });
  });

  it("uses the Para brand mark for manageable Para accounts with generic names", () => {
    renderPicker(
      makeAdapter({
        identity: {
          status: "connected",
          isConnected: true,
          walletProvider: "para",
          sessionProvider: "para",
        },
        accounts: [
          {
            id: "embedded-session",
            family: "evm",
            address: "0xAAAAAAAA",
            walletName: "Embedded wallet",
            active: true,
            manageable: true,
          },
        ],
      }),
    );

    expect(
      screen
        .getAllByTitle("Embedded wallet")
        .some((node) => node.getAttribute("data-wallet-brand") === "para"),
    ).toBe(true);
  });

  it("hides the social sign-in row when the Para account is connected", () => {
    renderPicker(
      makeAdapter({
        accounts: [
          {
            id: "para",
            family: "evm",
            address: "0xAAAAAAAA",
            walletName: "Para",
            active: true,
            manageable: true,
          },
        ],
      }),
    );

    expect(screen.queryByText("Email or Google")).toBeNull();
    expect(screen.queryByText("Link additional accounts")).toBeNull();
    expect(screen.queryByText("Quick sign-in")).toBeNull();
  });

  it("hides the provider sign-in row when a Privy session is connected", () => {
    const disconnect = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accountUser: { id: "user-1", displayName: "Privy Account" },
        canOpenAccountUI: false,
        openAccountUI: undefined,
        disconnect,
        identity: {
          status: "connected",
          isConnected: true,
          walletProvider: "privy",
          sessionProvider: "privy",
          walletProviderSubject: "did:privy:user",
          primaryLabel: "privy@example.com",
        },
        accounts: [
          {
            id: "privy-solana",
            family: "svm",
            address: "9xQpubKey",
            walletName: "Privy Solana",
            active: true,
            linkedVia: "privy",
            actions: [{ kind: "signout", label: "Sign out" }],
          },
        ],
        socialLoginOptions: [
          {
            id: "privy",
            label: "Email, wallet, or social",
            family: "multichain",
            kind: "social",
            status: "available",
            ready: true,
          },
        ],
      }),
    );

    expect(screen.queryByText("Email, wallet, or social")).toBeNull();
    expect(screen.queryByText("Quick sign-in")).toBeNull();
    // Account management belongs to the host settings surface, not this picker.
    expect(
      screen.queryByRole("button", { name: "Manage your account" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("uses full account sign-out from a provider connected-row sign-out", async () => {
    const signOutAccount = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    renderPicker(
      makeAdapter({
        accountUser: { id: "user-1", displayName: "Privy Account" },
        signOutAccount,
        canOpenAccountUI: false,
        openAccountUI: undefined,
        disconnect,
        identity: {
          status: "connected",
          isConnected: true,
          walletProvider: "privy",
          sessionProvider: "privy",
          walletProviderSubject: "did:privy:user",
          primaryLabel: "privy@example.com",
        },
        accounts: [
          {
            id: "privy-solana",
            family: "svm",
            address: "9xQpubKey",
            walletName: "Privy Solana",
            active: true,
            linkedVia: "privy",
            actions: [{ kind: "signout", label: "Sign out" }],
          },
        ],
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });

    expect(signOutAccount).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith({ family: "all" });
    expect(disconnect).not.toHaveBeenCalledWith({
      accountId: "privy-solana",
      providerSignOut: true,
    });
  });

  it("shows one Privy sign-in row beside external wallets before provider sign-in", () => {
    renderPicker(
      makeAdapter({
        identity: {
          status: "connected",
          isConnected: true,
          address: "0xAAAAAAAA",
          chainId: 1,
          walletProvider: "privy",
          primaryLabel: "0xAAA..AA",
        },
        socialLoginOptions: [
          {
            id: "privy",
            label: "Email, wallet, or social",
            family: "multichain",
            kind: "social",
            status: "available",
            ready: true,
          },
        ],
      }),
    );

    const socialRow = screen.getByRole("button", {
      name: "Email, wallet, or social",
    });
    expect(
      within(socialRow).getByText("Email, wallet, or social"),
    ).toBeTruthy();
    expect(within(socialRow).getByText("Fast account sign-in")).toBeTruthy();
  });

  it("dedupes stored embedded wallets behind the provider quick sign-in row", () => {
    renderPicker(
      makeAdapter({
        accountUser: { id: "user-1", displayName: "Linked account" },
        accountLinkedAccounts: [
          {
            id: "identity-privy",
            provider: "privy",
            subject: "did:privy:user",
            linkedAt: Date.now(),
            lastSeenAt: Date.now(),
          },
        ],
        accountWallets: [
          {
            id: "stored-privy-svm",
            family: "svm",
            address: "AG6eZtiXAhp8uzaXabn7eSZfaXBWrMYtvBH5dTzww18E",
            kind: "embedded",
            provider: "privy",
            linkedVia: "privy",
            verifiedAt: Date.now(),
            lastSeenAt: Date.now(),
          },
        ],
        identity: {
          status: "connected",
          isConnected: true,
          address: "0xAAAAAAAA",
          chainId: 1,
          walletProvider: "privy",
          primaryLabel: "0xAAA..AA",
        },
        walletModalRows: [
          {
            id: "rabby",
            family: "evm",
            address: "0xAAAAAAAA",
            chainId: 1,
            label: "Rabby",
            walletName: "Rabby",
            source: "live",
            status: "active",
            linked: true,
            actions: [{ kind: "disconnect", label: "Disconnect" }],
          },
          {
            id: "google",
            family: "evm",
            label: "Email or Google",
            walletName: "Privy",
            kind: "social",
            source: "option",
            status: "available",
            actions: [{ kind: "authenticate", label: "Sign in" }],
          },
          {
            id: "stored-privy-svm",
            family: "svm",
            address: "AG6eZtiXAhp8uzaXabn7eSZfaXBWrMYtvBH5dTzww18E",
            label: "AG6eZtiXAhp8uzaXabn7eSZfaXBWrMYtvBH5dTzww18E",
            walletName: "Privy",
            source: "stored",
            status: "stored",
            provider: "privy",
            linked: true,
            actions: [{ kind: "authenticate", label: "Sign in" }],
          },
        ],
        socialLoginOptions: [],
      }),
    );

    const socialRow = screen.getByRole("button", {
      name: "Email or Google",
    });
    expect(within(socialRow).getByText("Fast account sign-in")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Email or Google" }),
    ).toHaveLength(1);
    expect(
      screen.queryByText("AG6eZtiXAhp8uzaXabn7eSZfaXBWrMYtvBH5dTzww18E"),
    ).toBeNull();
  });

  it("shows the Para sign-in row when only external wallets are connected", () => {
    // Default harness connects MetaMask + Phantom (no Para account), so Para
    // stays reachable to (re)connect above "Add another wallet".
    renderPicker(makeAdapter());
    expect(screen.getByText("Email or Google")).toBeTruthy();
    expect(screen.getByText("Other ways to sign in")).toBeTruthy();
  });

  it("hides the per-row manage action when the adapter can't open account UI", () => {
    renderPicker(
      makeAdapter({
        canOpenAccountUI: false,
        accounts: [
          {
            id: "para",
            family: "evm",
            address: "0xAAAAAAAA",
            walletName: "Para",
            active: true,
            manageable: true,
          },
        ],
      }),
    );

    expect(screen.queryByRole("button", { name: "Manage Para" })).toBeNull();
  });
});
