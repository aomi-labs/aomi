import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useEffect, useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ExtUserProvider } from "@aomi-labs/react";
import type { AomiWalletKit } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { AomiAccountRequestError } from "@/wallet/account/aomi-backend-client";
import {
  AOMI_BOOTING_WALLET_KIT,
  AomiWalletKitContextProvider,
} from "@/wallet/context";
import {
  WalletPickerProvider,
  WalletSignInOptionsContext,
  useWalletPicker,
} from "./wallet-picker-context";
import { WalletPicker } from "./wallet-picker";
import { createSheetChannel, SheetChannelContext } from "./sheet-channel";

afterEach(cleanup);

const MAIN = "0xda65000000000000000000000000000000003cf0";
const NEW = "0x77c100000000000000000000000000000000a20e";

function rabbyRow(address: string, overrides: Partial<WalletRow> = {}) {
  return {
    key: `evm:${address}`,
    family: "evm",
    address,
    kind: "external",
    walletName: "Rabby",
    brand: "Rabby",
    connectionId: `rabby-uid#${address}`,
    state: "guest",
    connected: true,
    linked: false,
    operating: false,
    active: false,
    pendingStep: null,
    actions: [],
    ...overrides,
  } as WalletRow;
}

function baseKit(overrides: Partial<AomiWalletKit> = {}): AomiWalletKit {
  return {
    ...AOMI_BOOTING_WALLET_KIT,
    isReady: true,
    canConnect: true,
    evmWallets: [
      {
        id: "rabby-uid",
        label: "Rabby",
        family: "evm",
        kind: "evm",
        status: "available",
      },
      {
        id: "phantom-uid",
        label: "Phantom",
        family: "evm",
        kind: "evm",
        status: "available",
      },
      {
        id: "walletConnect",
        label: "WalletConnect",
        family: "evm",
        kind: "walletconnect",
        status: "qr",
      },
    ],
    solanaWallets: [{ name: "Phantom", installed: true, ready: true }],
    ...overrides,
  };
}

let setKit: (update: (kit: AomiWalletKit) => AomiWalletKit) => void;
const connectPrivy = vi.fn(async () => undefined);
const channel = createSheetChannel();

function Open() {
  const { openPicker } = useWalletPicker();
  useEffect(() => {
    openPicker();
  }, [openPicker]);
  return null;
}

function Harness({
  initial,
  open = true,
  children,
}: {
  initial: AomiWalletKit;
  open?: boolean;
  children?: ReactNode;
}) {
  const [kit, update] = useState(initial);
  setKit = update;
  return (
    <ExtUserProvider>
      <AomiWalletKitContextProvider value={kit}>
        <WalletSignInOptionsContext.Provider
          value={[
            {
              id: "privy",
              label: "Privy",
              description: "Email, Google, X or Apple",
              family: "multichain",
              kind: "social",
              status: "available",
              connect: connectPrivy,
            },
          ]}
        >
          <SheetChannelContext.Provider value={channel}>
            <WalletPickerProvider>
              {open ? <Open /> : null}
              <WalletPicker />
              {children}
            </WalletPickerProvider>
          </SheetChannelContext.Provider>
        </WalletSignInOptionsContext.Provider>
      </AomiWalletKitContextProvider>
    </ExtUserProvider>
  );
}

describe("wallet sheet", () => {
  it("lists social sign-in, detected wallets and more wallets, with Phantom once", () => {
    render(<Harness initial={baseKit()} />);
    expect(screen.getByText("Sign in to Aomi")).toBeInTheDocument();
    expect(screen.getByText("Social sign-in")).toBeInTheDocument();
    expect(screen.getByText("More wallets")).toBeInTheDocument();
    expect(screen.getAllByText("Phantom")).toHaveLength(1);
    expect(screen.getByText("EVM and SVM")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Phantom"));
    expect(
      screen.getByText("Which network do you want to use?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Solana")).toBeInTheDocument();
  });

  it("connects, asks for the signature at once, and falls back to Verify", async () => {
    const linkWallet = vi
      .fn()
      .mockRejectedValueOnce(new Error("User rejected the request."))
      .mockResolvedValueOnce(undefined);
    const connectEvmWallet = vi.fn(async () => {
      setKit((kit) => ({ ...kit, wallets: [rabbyRow(MAIN)] }));
    });
    render(<Harness initial={baseKit({ linkWallet, connectEvmWallet })} />);

    fireEvent.click(screen.getByText("Rabby"));
    await waitFor(() =>
      expect(linkWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          family: "evm",
          address: MAIN,
          accountId: `rabby-uid#${MAIN}`,
        }),
      ),
    );
    expect(connectEvmWallet).toHaveBeenCalledWith("rabby-uid");
    const sign = await screen.findByRole("button", { name: "Sign message" });
    expect(screen.getByText("Check Rabby")).toBeInTheDocument();

    fireEvent.click(sign);
    await waitFor(() => expect(linkWallet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Check Rabby")).not.toBeInTheDocument(),
    );
  });

  it("makes an address already in the account active without a signature", async () => {
    const linkWallet = vi.fn();
    const selectAccount = vi.fn(async () => undefined);
    const connectEvmWallet = vi.fn(async () => {
      setKit((kit) => ({
        ...kit,
        wallets: [rabbyRow(MAIN, { state: "ready", linked: true })],
      }));
    });
    render(
      <Harness
        initial={baseKit({
          accountUser: { id: "acct-1" },
          linkWallet,
          selectAccount,
          connectEvmWallet,
        })}
      />,
    );
    expect(screen.getByText("Add a wallet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rabby"));
    await waitFor(() =>
      expect(selectAccount).toHaveBeenCalledWith(`rabby-uid#${MAIN}`),
    );
    await waitFor(() =>
      expect(screen.queryByText("Add a wallet")).not.toBeInTheDocument(),
    );
    expect(linkWallet).not.toHaveBeenCalled();
  });

  it("reconnects an embedded address through its own provider", () => {
    const connectSocial = vi.fn(async () => undefined);
    const key = `evm:${MAIN}`;
    render(
      <Harness
        open={false}
        initial={baseKit({
          identity: {
            ...AOMI_BOOTING_WALLET_KIT.identity,
            embeddedProvider: "para",
          },
          connectSocial,
          wallets: [
            rabbyRow(MAIN, {
              kind: "embedded",
              provider: "privy",
              state: "offline",
              reason: "disconnected",
              linked: true,
              linkedWalletId: "w1",
            } as Partial<WalletRow>),
          ],
        })}
      />,
    );
    act(() => channel.request({ kind: "connect", key }));
    expect(connectPrivy).toHaveBeenCalledOnce();
    expect(connectSocial).not.toHaveBeenCalled();
  });

  it("offers a merge when the address signs in to another account", async () => {
    const linkWallet = vi.fn().mockRejectedValue(
      new AomiAccountRequestError(409, "account_merge_available", null, {
        ticket: "t1",
        other: {
          name: "0xdA65…3CF0",
          createdAt: "2026-09-12T00:00:00Z",
          chats: 12,
          wallets: 2,
          credits: "420",
          dropped: ["OpenAI model key"],
        },
      }),
    );
    const mergeAccount = vi.fn(async () => ({ chats: 12 }));
    const connectEvmWallet = vi.fn(async () => {
      setKit((kit) => ({ ...kit, wallets: [rabbyRow(MAIN)] }));
    });
    render(
      <Harness
        initial={baseKit({
          accountUser: { id: "acct-1" },
          linkWallet,
          mergeAccount,
          connectEvmWallet,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Rabby"));
    expect(await screen.findByText("Merge accounts")).toBeInTheDocument();
    expect(screen.getByText("OpenAI model key")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to that account instead" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Merge into this account" }),
    );
    await waitFor(() => expect(mergeAccount).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(screen.queryByText("Merge accounts")).not.toBeInTheDocument(),
    );
  });
});

describe("wallet app switching accounts", () => {
  const signedIn = (wallets: WalletRow[], extra: Partial<AomiWalletKit> = {}) =>
    baseKit({ accountUser: { id: "acct-1" }, wallets, ...extra });

  it("makes a linked address active without opening the sheet", async () => {
    const activateWallet = vi.fn(async () => "active" as const);
    render(
      <Harness
        open={false}
        initial={signedIn(
          [rabbyRow(MAIN, { state: "ready", linked: true, operating: true })],
          { activateWallet },
        )}
      />,
    );
    act(() =>
      setKit((kit) => ({
        ...kit,
        wallets: [rabbyRow(NEW, { state: "ready", linked: true })],
      })),
    );
    await waitFor(() =>
      expect(activateWallet).toHaveBeenCalledWith(`evm:${NEW}`),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the new-address sheet for an unlinked address", async () => {
    const linkWallet = vi.fn(async () => undefined);
    render(
      <Harness
        open={false}
        initial={signedIn(
          [rabbyRow(MAIN, { state: "ready", linked: true, operating: true })],
          { linkWallet },
        )}
      />,
    );
    act(() =>
      setKit((kit) => ({
        ...kit,
        wallets: [rabbyRow(NEW, { state: "unlinked" })],
      })),
    );
    expect(await screen.findByText("New address in Rabby")).toBeInTheDocument();
    expect(
      screen.getByText(/Until you verify, Aomi keeps using 0xda65…3cf0/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and add to account" }),
    );
    await waitFor(() =>
      expect(linkWallet).toHaveBeenCalledWith(
        expect.objectContaining({ address: NEW }),
      ),
    );
  });

  it("asks nothing when the wallet switches accounts while signed out", () => {
    const activateWallet = vi.fn(async () => "active" as const);
    const ready = { state: "ready", linked: true } as Partial<WalletRow>;
    render(
      <Harness
        open={false}
        initial={baseKit({ wallets: [rabbyRow(MAIN, ready)], activateWallet })}
      />,
    );
    act(() => setKit((kit) => ({ ...kit, wallets: [rabbyRow(NEW, ready)] })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(activateWallet).not.toHaveBeenCalled();
  });

  it("does not pop the new-address sheet again after Not now", async () => {
    const main = rabbyRow(MAIN, { state: "ready", linked: true });
    const added = rabbyRow(NEW, { state: "unlinked" });
    render(<Harness open={false} initial={signedIn([main])} />);
    act(() => setKit((kit) => ({ ...kit, wallets: [added] })));
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    act(() => setKit((kit) => ({ ...kit, wallets: [main] })));
    act(() => setKit((kit) => ({ ...kit, wallets: [added] })));
    expect(screen.queryByText("New address in Rabby")).not.toBeInTheDocument();
  });

  it("does not open anything when a wallet reconnects on page load", () => {
    render(<Harness open={false} initial={signedIn([])} />);
    act(() =>
      setKit((kit) => ({
        ...kit,
        wallets: [rabbyRow(NEW, { state: "unlinked" })],
      })),
    );
    expect(screen.queryByText("New address in Rabby")).not.toBeInTheDocument();
  });
});
