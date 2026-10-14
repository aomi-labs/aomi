import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletAuthPublisherContext } from "@/wallet/providers/auth-store";
import { createInitialState } from "@/wallet/registry/reducer";
import type { AomiWalletKit } from "@/wallet/types";
import type { AccountWallet } from "@/wallet/account/types";
import { AomiWalletKitComposer } from "./aomi-wallet-kit-composer";
import type { AomiWalletKitComposerProps, AuthRuntime } from "./types";

vi.mock("@aomi-labs/react", () => ({ useUser: () => ({ setUser: vi.fn() }) }));
afterEach(cleanup);

function connectedSigner(family: "evm" | "svm") {
  const address =
    family === "evm" ? `0x${"11".repeat(20)}` : "ExternalSolanaWallet";
  const account = {
    id: "external-wallet",
    family,
    address,
    walletName: family === "evm" ? "Rabby" : "Phantom",
    active: true,
    walletKind: "eoa" as const,
  };
  const registryState = createInitialState();
  registryState.phase = "stable";
  registryState.activeByFamily[family] = { family, address };
  const sign = vi.fn(async () => ({ signature: "external-signature" }));
  const props = {
    evm: {
      registryStore: { dispatch: vi.fn() },
      registryState,
      identity: () => (family === "evm" ? { address } : {}),
      accounts: () => (family === "evm" ? [account] : []),
      options: [],
    } as unknown as AomiWalletKitComposerProps["evm"],
    svm:
      family === "svm"
        ? ({
            identity: () => ({ address, walletName: "Phantom" }),
            accounts: () => [account],
            options: [],
            supportedNetworks: [],
            execution: { signSolanaMessage: sign },
          } as unknown as AomiWalletKitComposerProps["svm"])
        : undefined,
    execution: {
      evm: { chainsById: {}, signMessage: sign } as unknown as NonNullable<
        AomiWalletKitComposerProps["execution"]
      >["evm"],
    },
    supportedChains: [],
  } satisfies Omit<AomiWalletKitComposerProps, "auth" | "children">;
  return { props, address, sign };
}

it.each([
  ["privy", "evm"],
  ["para", "evm"],
  ["privy", "svm"],
  ["para", "svm"],
] as const)(
  "waits for %s login readiness while preserving the connected %s signer",
  async (provider, family) => {
    const { props, address, sign } = connectedSigner(family);
    const login = vi.fn(async () => undefined);
    const auth: AuthRuntime = {
      provider,
      sessionProvider: provider,
      status: "booting",
      canOpenModal: true,
      methods: [],
      login,
    };
    let kit: AomiWalletKit | undefined;
    const publish = (next: AomiWalletKit) => {
      kit = next;
    };
    function tree(currentAuth: AuthRuntime) {
      return (
        <WalletAuthPublisherContext.Provider value={publish}>
          <AomiWalletKitComposer {...props} auth={currentAuth}>
            connected chat
          </AomiWalletKitComposer>
        </WalletAuthPublisherContext.Provider>
      );
    }
    const view = render(tree(auth));
    expect(kit!.isReady).toBe(true);
    expect(kit!.identity).toMatchObject({
      isConnected: true,
      sessionProvider: provider,
      ...(family === "evm" ? { address } : { svmAddress: address }),
    });
    expect(kit!.connectSocial).toBeUndefined();
    expect(login).not.toHaveBeenCalled();
    if (family === "evm") await kit!.signMessage!({ signer: address } as never);
    else await kit!.signSolanaMessage!({ signer: address } as never);
    expect(sign).toHaveBeenCalledOnce();

    view.rerender(tree({ ...auth, status: "unauthenticated" }));
    await kit!.connectSocial!(provider);
    expect(login).toHaveBeenCalledExactlyOnceWith(`social-login:${provider}`);
    expect(kit!.identity.isConnected).toBe(true);
  },
);

it("does not publish social login when the selected provider has no login callback", () => {
  const { props } = connectedSigner("evm");
  let kit: AomiWalletKit | undefined;
  render(
    <WalletAuthPublisherContext.Provider
      value={(next) => {
        kit = next;
      }}
    >
      <AomiWalletKitComposer
        {...props}
        auth={{
          provider: "para",
          sessionProvider: "para",
          status: "unauthenticated",
          canOpenModal: false,
          methods: [],
        }}
      >
        connected chat
      </AomiWalletKitComposer>
    </WalletAuthPublisherContext.Provider>,
  );
  expect(kit!.isReady).toBe(true);
  expect(kit!.identity.isConnected).toBe(true);
  expect(kit!.connectSocial).toBeUndefined();
});

it("preserves a ready custom social login that does not use a modal", async () => {
  const { props } = connectedSigner("evm");
  const login = vi.fn(async () => undefined);
  let kit: AomiWalletKit | undefined;
  render(
    <WalletAuthPublisherContext.Provider
      value={(next) => {
        kit = next;
      }}
    >
      <AomiWalletKitComposer
        {...props}
        auth={{
          provider: "privy",
          sessionProvider: "privy",
          status: "unauthenticated",
          canOpenModal: false,
          methods: [],
          login,
        }}
      >
        connected chat
      </AomiWalletKitComposer>
    </WalletAuthPublisherContext.Provider>,
  );
  await kit!.connectSocial!("privy");
  expect(login).toHaveBeenCalledExactlyOnceWith("social-login:privy");
});

it.each(["privy", "para"] as const)(
  "records account link intent when the sheet starts %s login",
  async (provider) => {
    const { props } = connectedSigner("evm");
    const login = vi.fn();
    const loginProvider = vi.fn();
    let kit: AomiWalletKit | undefined;
    render(
      <WalletAuthPublisherContext.Provider
        value={(next) => {
          kit = next;
        }}
      >
        <AomiWalletKitComposer
          {...props}
          account={{
            status: "ready",
            user: { id: "account-1" },
            linkedAccounts: [],
            wallets: [],
            refresh: vi.fn(),
            loginProvider,
          }}
          auth={{
            provider,
            sessionProvider: provider,
            status: "unauthenticated",
            canOpenModal: true,
            methods: [],
            login,
          }}
        >
          connected chat
        </AomiWalletKitComposer>
      </WalletAuthPublisherContext.Provider>,
    );
    await kit!.connectSocial!(provider);
    expect(loginProvider).toHaveBeenCalledExactlyOnceWith(
      `social-login:${provider}`,
    );
    expect(login).not.toHaveBeenCalled();
  },
);

it("stops offering Verify for an address the user removed", async () => {
  const { props, address } = connectedSigner("evm");
  const unlinkWallet = vi.fn(async () => undefined);
  let kit: AomiWalletKit | undefined;
  const tree = (wallets: AccountWallet[]) => (
    <WalletAuthPublisherContext.Provider
      value={(next) => {
        kit = next;
      }}
    >
      <AomiWalletKitComposer
        {...props}
        account={{
          status: "ready",
          user: { id: "user-1" },
          linkedAccounts: [],
          wallets,
          unlinkWallet,
          refresh: async () => undefined,
        }}
        auth={{
          provider: "privy",
          sessionProvider: "privy",
          status: "unauthenticated",
          canOpenModal: false,
          methods: [],
        }}
      >
        connected chat
      </AomiWalletKitComposer>
    </WalletAuthPublisherContext.Provider>
  );
  const view = render(
    tree([{ id: "w1", family: "evm", address, linkedVia: "siwe" }]),
  );
  expect(kit!.unlinkedWallet).toBeUndefined();
  await act(async () => kit!.unlinkLinkedWallet!("w1"));
  view.rerender(tree([]));
  expect(unlinkWallet).toHaveBeenCalledWith("w1");
  expect(kit!.unlinkedWallet).toBeUndefined();
});
