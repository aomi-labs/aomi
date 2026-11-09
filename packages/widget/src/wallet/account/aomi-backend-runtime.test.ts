import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountGraphApiError,
  buildSiweMessage,
  buildWalletLinkMessage,
  withBrowserSessionTransition,
} from "@aomi-labs/client";
import { useAomiBackendAccountRuntime } from "./aomi-backend-runtime";
import {
  messageConfigFromNonce,
  resolveAuthMessageConfig,
} from "./auth-message";
import {
  normalizeAccountWalletProvider,
  resolveLinkedWalletName,
  walletAppName,
} from "./wallet-labels";
import type { AomiAccountCredential } from "../types";

const mockState = vi.hoisted(() => ({
  accountClient: null as null | {
    getAccount: ReturnType<typeof vi.fn>;
    exchangeProviderCredential: ReturnType<typeof vi.fn>;
    siweNonce: ReturnType<typeof vi.fn>;
    verifySiwe: ReturnType<typeof vi.fn>;
    siwsNonce: ReturnType<typeof vi.fn>;
    verifySiws: ReturnType<typeof vi.fn>;
    getWalletLinkNonce: ReturnType<typeof vi.fn>;
    linkWallet: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
    updateAccount: ReturnType<typeof vi.fn>;
    updateWallet: ReturnType<typeof vi.fn>;
    updateIdentity: ReturnType<typeof vi.fn>;
    unlinkWallet: ReturnType<typeof vi.fn>;
    unlinkIdentity: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
    switchTo: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@aomi-labs/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/client")>()),
  Aomi: vi.fn(function () {
    return { account: mockState.accountClient };
  }),
}));

beforeEach(() => {
  sessionStorage.clear();
  mockState.accountClient = {
    getAccount: vi.fn().mockResolvedValue({
      user: null,
      linkedAccounts: [],
      wallets: [],
      session: null,
    }),
    exchangeProviderCredential: vi.fn(() => new Promise(() => undefined)),
    siweNonce: vi.fn(),
    verifySiwe: vi.fn(),
    siwsNonce: vi.fn(),
    verifySiws: vi.fn(),
    getWalletLinkNonce: vi.fn(),
    linkWallet: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
    updateAccount: vi.fn(),
    updateWallet: vi.fn(),
    updateIdentity: vi.fn(),
    unlinkWallet: vi.fn(),
    unlinkIdentity: vi.fn(),
    merge: vi.fn(),
    switchTo: vi.fn(),
  };
});

describe("useAomiBackendAccountRuntime", () => {
  it("keeps a provider-authenticated widget idle until the host signs in", async () => {
    const getCredential = vi.fn();

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3002",
        widgetAuth: {
          mode: "provider",
          provider: "para",
          environment: "BETA",
        },
        auth: {
          status: "unauthenticated",
          provider: "para",
          getCredential,
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockState.accountClient?.getAccount).not.toHaveBeenCalled();
    expect(getCredential).not.toHaveBeenCalled();
    expect(result.current.getAccountBearer).toBeUndefined();
    expect(result.current.user).toBeUndefined();
  });

  it("keeps a wallet-mode widget idle (no error) until a wallet connects", async () => {
    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3002",
        widgetAuth: { mode: "wallet" },
        auth: {
          status: "unauthenticated",
          provider: "wallet",
        } as never,
        // No active connection and no signer -> no usable widget credentials.
        evm: { accounts: () => [], activeEvmConnection: undefined } as never,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.status).not.toBe("error");
    expect(mockState.accountClient?.getAccount).not.toHaveBeenCalled();
    expect(result.current.getAccountBearer).toBeUndefined();
    expect(result.current.user).toBeUndefined();
  });

  it("fires a single GET /account on mount when the widget is ready", async () => {
    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3002",
        widgetAuth: { mode: "wallet" },
        auth: {
          status: "unauthenticated",
          provider: "wallet",
        } as never,
        evm: {
          accounts: () => [],
          activeAccount: undefined,
          activeEvmConnection: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 1,
          },
          signMessageAsync: vi.fn().mockResolvedValue("0xsig"),
        } as never,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    // Both mount effects call refresh; the in-flight guard coalesces them.
    expect(mockState.accountClient?.getAccount).toHaveBeenCalledTimes(1);
    expect(result.current.getAccountBearer).toBeUndefined();
  });

  it.each(["cookie", "widget-wallet", "widget-provider"] as const)(
    "only exposes account switching for a browser cookie session (%s)",
    async (session) => {
      mockState.accountClient!.getAccount.mockResolvedValue({
        user: { id: "current-account" },
        linkedAccounts: [],
        wallets: [],
        session: null,
      });
      const { result } = renderHook(() =>
        useAomiBackendAccountRuntime({
          enabled: true,
          widgetAuth:
            session === "widget-wallet"
              ? { mode: "wallet" }
              : session === "widget-provider"
                ? { mode: "provider", provider: "para", environment: "BETA" }
                : undefined,
          auth: {
            status: "authenticated",
            provider: "para",
            getCredential: vi.fn().mockResolvedValue(null),
          } as never,
          evm: {
            accounts: () => [],
            activeEvmConnection: {
              address: "0x1111111111111111111111111111111111111111",
              chainId: 1,
            },
            signMessageAsync: vi.fn(),
          } as never,
        }),
      );
      await waitFor(() =>
        expect(result.current.user?.id).toBe("current-account"),
      );
      if (session === "cookie")
        expect(result.current.switchToMergeSource).toBeTypeOf("function");
      else expect(result.current.switchToMergeSource).toBeUndefined();
    },
  );

  it("shares only confirmed guest session metadata and drops it when refresh fails", async () => {
    mockState.accountClient!.getAccount.mockResolvedValue({
      guest: true,
      user: { id: "temporary-guest" },
      linkedAccounts: [],
      wallets: [],
      session: { carrier: "better_auth", betterAuthUserId: "cookie-guest" },
    });
    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        auth: { status: "unauthenticated", provider: "wallet" } as never,
        evm: { accounts: () => [] } as never,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.guestUserId).toBe("cookie-guest");
    expect(result.current.user).toBeUndefined();
    expect(result.current.wallets).toEqual([]);
    expect(mockState.accountClient!.getAccount).toHaveBeenCalledTimes(1);
    mockState.accountClient!.getAccount.mockRejectedValue(
      new Error("Session revoked"),
    );
    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("error");
    expect(result.current.guestUserId).toBeUndefined();
  });

  it("keeps the guest session when signing in with an existing EVM wallet", async () => {
    const address = "0x1111111111111111111111111111111111111111" as const;
    mockState
      .accountClient!.getAccount.mockResolvedValueOnce({
        guest: true,
        // Defense in depth: even a stale server response that includes the
        // guest user must never make it an account owner.
        user: { id: "temporary-guest" },
        linkedAccounts: [],
        wallets: [],
        session: null,
      })
      .mockResolvedValue({
        user: { id: "existing-wallet-owner" },
        linkedAccounts: [],
        wallets: [],
        session: null,
      });
    mockState.accountClient!.signOut.mockResolvedValue(undefined);
    mockState.accountClient!.siweNonce.mockResolvedValue({
      nonce: "wallet-sign-in-nonce",
      domain: "localhost:3000",
      uri: "http://localhost:3000",
    });
    mockState.accountClient!.verifySiwe.mockResolvedValue(undefined);
    const signMessageAsync = vi.fn().mockResolvedValue("0xsig");

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: { status: "unauthenticated", provider: "wallet" } as never,
        evm: {
          accounts: () => [],
          activeEvmConnection: { address, chainId: 1 },
          signMessageAsync,
        } as never,
      }),
    );

    await waitFor(() => expect(result.current.guest).toBe(true));
    expect(result.current.user).toBeUndefined();
    expect(mockState.accountClient?.siweNonce).not.toHaveBeenCalled();

    let finishGuestTransition!: () => void;
    const guestTransition = withBrowserSessionTransition(
      () =>
        new Promise<void>((resolve) => {
          finishGuestTransition = resolve;
        }),
    );
    await Promise.resolve();
    let signIn!: Promise<void>;
    act(() => {
      signIn = result.current.linkWallet!({
        accountId: "rabby-1",
        family: "evm",
        address,
        chainId: 1,
      });
    });
    await Promise.resolve();
    expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
    expect(mockState.accountClient?.siweNonce).not.toHaveBeenCalled();

    finishGuestTransition();
    await guestTransition;
    await act(async () => signIn);
    await waitFor(() =>
      expect(result.current.user?.id).toBe("existing-wallet-owner"),
    );
    // The server merges the guest's chats in, so the guest cookie must reach
    // the sign-in.
    expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
    expect(mockState.accountClient?.siweNonce).toHaveBeenCalledTimes(1);
    expect(mockState.accountClient?.getWalletLinkNonce).not.toHaveBeenCalled();
  });
  it("ignores an old account response after the provider subject changes", async () => {
    let resolveOld!: (value: {
      user: { id: string };
      linkedAccounts: never[];
      wallets: never[];
      session: null;
    }) => void;
    const oldResponse = new Promise<{
      user: { id: string };
      linkedAccounts: never[];
      wallets: never[];
      session: null;
    }>((resolve) => {
      resolveOld = resolve;
    });
    const oldClient = mockState.accountClient!;
    oldClient.getAccount.mockReturnValue(oldResponse);
    const getCredential = vi.fn();

    const { result, rerender } = renderHook(
      ({ subject }: { subject: string }) =>
        useAomiBackendAccountRuntime({
          enabled: true,
          baseUrl: "http://localhost:3002",
          widgetAuth: {
            mode: "provider",
            provider: "para",
            environment: "BETA",
          },
          auth: {
            status: "authenticated",
            provider: "para",
            subject,
            getCredential,
          } as never,
          evm: { accounts: () => [] } as never,
        }),
      { initialProps: { subject: "user-a" } },
    );

    await waitFor(() => expect(oldClient.getAccount).toHaveBeenCalled());

    const newClient = {
      ...oldClient,
      getAccount: vi.fn().mockResolvedValue({
        user: { id: "user-b" },
        linkedAccounts: [],
        wallets: [],
        session: null,
      }),
    };
    mockState.accountClient = newClient;
    rerender({ subject: "user-b" });

    await waitFor(() => expect(result.current.user?.id).toBe("user-b"));
    await act(async () => {
      resolveOld({
        user: { id: "user-a" },
        linkedAccounts: [],
        wallets: [],
        session: null,
      });
      await oldResponse;
    });
    expect(result.current.user?.id).toBe("user-b");
  });

  it("lets the widget session revoke before provider logout without duplicate account sign-out", async () => {
    const callOrder: string[] = [];
    const getCredential = vi.fn();
    const logout = vi.fn(async () => {
      callOrder.push("provider-logout");
    });

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3002",
        widgetAuth: {
          mode: "provider",
          provider: "para",
          environment: "BETA",
        },
        auth: {
          status: "authenticated",
          provider: "para",
          subject: "para-user",
          getCredential,
          logout,
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => result.current.signOut?.());

    expect(getCredential).not.toHaveBeenCalled();
    expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["provider-logout"]);
  });

  it("lets provider-credential session exchange create the account before auto-SIWE", async () => {
    const credential: AomiAccountCredential = {
      provider: "para",
      tokenKind: "session_jwt",
      providerToken: "provider-session",
    };
    const getCredential = vi.fn().mockResolvedValue(credential);
    const signMessageAsync = vi.fn().mockResolvedValue("0xsig");

    renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: {
          status: "authenticated",
          provider: "para",
          subject: "para-user",
          getCredential,
        } as never,
        evm: {
          activeEvmConnection: {
            address: "0x1111111111111111111111111111111111111111",
            chainId: 1,
          },
          activeAccount: undefined,
          accounts: () => [],
          signMessageAsync,
        } as never,
      }),
    );

    await waitFor(() => {
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).toHaveBeenCalledWith(credential, { newSession: true });
    });

    expect(mockState.accountClient?.siweNonce).not.toHaveBeenCalled();
    expect(signMessageAsync).not.toHaveBeenCalled();
  });

  it("keeps the guest session through provider sign-in", async () => {
    const credential: AomiAccountCredential = {
      provider: "privy",
      tokenKind: "access_token",
      providerToken: "provider-session",
    };
    mockState
      .accountClient!.getAccount.mockResolvedValueOnce({
        guest: true,
        user: { id: "temporary-guest" },
        linkedAccounts: [],
        wallets: [],
        session: null,
      })
      .mockResolvedValue({
        user: { id: "real-user" },
        linkedAccounts: [
          {
            id: "privy-identity",
            provider: "privy",
            subject: "privy-user",
          },
        ],
        wallets: [],
        session: null,
      });
    mockState.accountClient!.signOut.mockResolvedValue(undefined);
    mockState.accountClient!.exchangeProviderCredential.mockResolvedValue({
      status: "linked",
      account: {
        user: { id: "real-user" },
        linkedAccounts: [
          {
            id: "privy-identity",
            provider: "privy",
            subject: "privy-user",
          },
        ],
        wallets: [],
        session: null,
      },
    });
    let authenticated = false;
    const getCredential = vi.fn().mockResolvedValue(credential);
    const { result, rerender } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: {
          status: authenticated ? "authenticated" : "unauthenticated",
          provider: "privy",
          subject: authenticated ? "privy-user" : undefined,
          getCredential,
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );

    await waitFor(() => expect(result.current.guest).toBe(true));
    authenticated = true;
    rerender();

    await waitFor(() =>
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).toHaveBeenCalledWith(credential, { newSession: true }),
    );
    expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.user?.id).toBe("real-user"));
  });

  it.each(["para", "privy"] as const)(
    "restores a matching %s subject without exchanging or signing out",
    async (provider) => {
      mockState.accountClient!.getAccount.mockResolvedValue({
        user: { id: "matching-account" },
        linkedAccounts: [
          { id: "identity", provider, subject: "matching-subject" },
        ],
        wallets: [],
        session: null,
      });
      const getCredential = vi
        .fn()
        .mockResolvedValue({ provider, providerToken: "token" });
      const logout = vi.fn();
      const { result } = renderHook(() =>
        useAomiBackendAccountRuntime({
          enabled: true,
          auth: {
            status: "authenticated",
            provider,
            subject: "matching-subject",
            getCredential,
            logout,
          } as never,
          evm: { accounts: () => [] } as never,
        }),
      );
      await waitFor(() => expect(getCredential).toHaveBeenCalled());
      expect(result.current.user?.id).toBe("matching-account");
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).not.toHaveBeenCalled();
      expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
    },
  );

  it.each(["para", "privy"] as const)(
    "logs out an unsolicited foreign %s SDK subject without changing the Aomi account",
    async (provider) => {
      mockState.accountClient!.getAccount.mockResolvedValue({
        user: { id: "current-account" },
        linkedAccounts: [
          { id: "identity", provider, subject: "linked-subject" },
        ],
        wallets: [],
        session: null,
      });
      const logout = vi.fn().mockResolvedValue(undefined);
      const { result, rerender } = renderHook(() =>
        useAomiBackendAccountRuntime({
          enabled: true,
          auth: {
            status: "authenticated",
            provider,
            subject: "foreign-subject",
            getCredential: vi
              .fn()
              .mockResolvedValue({ provider, providerToken: "token" }),
            logout,
          } as never,
          evm: { accounts: () => [] } as never,
        }),
      );
      await waitFor(() => expect(logout).toHaveBeenCalledOnce());
      rerender();
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).not.toHaveBeenCalled();
      expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
      expect(result.current.user?.id).toBe("current-account");
      expect(result.current.error).toBeUndefined();
      expect(result.current.conflict).toBeUndefined();
    },
  );

  describe.each([
    ["privy", "wallet"],
    ["para", "wallet"],
    ["privy", "another provider login"],
    ["para", "another provider login"],
  ] as const)(
    "adding %s while signed in with %s",
    (provider, existingLogin) => {
      const credential: AomiAccountCredential = {
        provider,
        providerToken: "provider-session",
      };
      const walletAccount = {
        user: { id: "wallet-account" },
        linkedAccounts: [
          {
            id: "siwe-identity",
            provider: existingLogin === "wallet" ? "siwe" : provider,
            subject:
              existingLogin === "wallet" ? "eip155:*:0x2858" : "old-subject",
          },
        ],
        wallets: [],
        session: { betterAuthUserId: "wallet-better-auth-user" },
      };
      const renderSignedIn = () => {
        let authenticated = existingLogin === "another provider login";
        let subject = "old-subject";
        let currentCredential: unknown = credential;
        const logout = vi.fn().mockResolvedValue(undefined);
        const login = vi.fn(async () => {
          authenticated = true;
          subject = "provider-subject";
          hook.rerender();
        });
        const hook = renderHook(() =>
          useAomiBackendAccountRuntime({
            enabled: true,
            baseUrl: "http://localhost:3000",
            auth: {
              status: authenticated ? "authenticated" : "unauthenticated",
              provider,
              subject: authenticated ? subject : undefined,
              login,
              logout,
              getCredential: vi.fn().mockResolvedValue(currentCredential),
            } as never,
            evm: { accounts: () => [] } as never,
          }),
        );
        return {
          ...hook,
          logout,
          refreshCredential: (next: unknown) => {
            currentCredential = next;
            hook.rerender();
          },
          restore: (restoredSubject: string) => {
            subject = restoredSubject;
            hook.rerender();
          },
          signIn: () =>
            act(async () => {
              await hook.result.current.loginProvider!(
                "social-login:" + provider,
              );
              expect(login).toHaveBeenCalledWith("social-login:" + provider);
            }),
        };
      };

      it("links the login to the account and keeps the session", async () => {
        mockState.accountClient!.getAccount.mockResolvedValue(walletAccount);
        const linkedAccount = {
          ...walletAccount,
          linkedAccounts: [
            ...walletAccount.linkedAccounts,
            { id: "new-provider", provider, subject: "provider-subject" },
          ],
        };
        mockState.accountClient!.exchangeProviderCredential.mockImplementation(
          async () => {
            mockState.accountClient!.getAccount.mockResolvedValue(
              linkedAccount,
            );
            return { status: "linked", account: linkedAccount };
          },
        );
        const { result, signIn, restore, logout } = renderSignedIn();
        await waitFor(() =>
          expect(result.current.user?.id).toBe("wallet-account"),
        );
        await signIn();

        await waitFor(() =>
          expect(
            mockState.accountClient?.exchangeProviderCredential,
          ).toHaveBeenCalledWith(credential, { newSession: false }),
        );
        await waitFor(() =>
          expect(result.current.linkedAccounts).toEqual(
            linkedAccount.linkedAccounts,
          ),
        );
        expect(result.current.user?.id).toBe("wallet-account");
        expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
        restore("unsolicited-third-subject");
        await waitFor(() => expect(logout).toHaveBeenCalledOnce());
        expect(
          mockState.accountClient?.exchangeProviderCredential,
        ).toHaveBeenCalledOnce();
        expect(result.current.user?.id).toBe("wallet-account");
      });

      it("offers a merge when the login belongs to another account", async () => {
        mockState.accountClient!.getAccount.mockResolvedValue(walletAccount);
        const offer = {
          ticket: "ticket-1",
          other: {
            name: "privy user",
            created_at: "2026-09-12T00:00:00Z",
            chats: 1,
            wallets: 1,
            credits: "0",
            dropped: [],
          },
        };
        mockState.accountClient!.exchangeProviderCredential.mockRejectedValue(
          new AccountGraphApiError(
            409,
            { error: "account_merge_available", ...offer },
            "",
          ),
        );
        const { result, signIn } = renderSignedIn();
        await waitFor(() =>
          expect(result.current.user?.id).toBe("wallet-account"),
        );
        await signIn();

        await waitFor(() =>
          expect(result.current.conflict?.mergeOffer).toEqual(offer),
        );
        expect(result.current.conflict?.provider).toBe(provider);
        expect(result.current.user?.id).toBe("wallet-account");
        expect(result.current.error).toBeUndefined();
        expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
      });

      it("offers one merge per login when the provider refreshes its token", async () => {
        mockState.accountClient!.getAccount.mockResolvedValue(walletAccount);
        const offer = {
          ticket: "ticket-1",
          other: {
            name: "privy user",
            created_at: "2026-09-12T00:00:00Z",
            chats: 1,
            wallets: 1,
            credits: "0",
            dropped: [],
          },
        };
        mockState.accountClient!.exchangeProviderCredential.mockRejectedValue(
          new AccountGraphApiError(
            409,
            { error: "account_merge_available", ...offer },
            "",
          ),
        );
        const { result, signIn, refreshCredential } = renderSignedIn();
        await waitFor(() =>
          expect(result.current.user?.id).toBe("wallet-account"),
        );
        await signIn();
        await waitFor(() =>
          expect(result.current.conflict?.mergeOffer).toEqual(offer),
        );

        // Privy hands over its identity token after the access token.
        await act(async () => {
          refreshCredential({
            ...(credential as object),
            providerToken: "next",
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(
          mockState.accountClient?.exchangeProviderCredential,
        ).toHaveBeenCalledOnce();
        expect(result.current.conflict?.mergeOffer).toEqual(offer);
      });
    },
  );

  it("keeps the add target when a newly selected provider is still loading the account", async () => {
    const currentAccount = {
      user: { id: "current-account" },
      linkedAccounts: [
        { id: "old", provider: "privy", subject: "old-subject" },
      ],
      wallets: [],
      session: null,
    };
    let resolveInitial!: (account: typeof currentAccount) => void;
    mockState
      .accountClient!.getAccount.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      )
      .mockResolvedValue(currentAccount);
    let authenticated = false;
    const login = vi.fn(async () => {
      authenticated = true;
    });
    const credential = { provider: "privy", providerToken: "token" };
    const { result, rerender } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        auth: {
          provider: "privy",
          status: authenticated ? "authenticated" : "unauthenticated",
          subject: authenticated ? "new-subject" : undefined,
          login,
          getCredential: vi.fn().mockResolvedValue(credential),
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() =>
      expect(mockState.accountClient?.getAccount).toHaveBeenCalledOnce(),
    );
    await act(async () => {
      await result.current.loginProvider!("social-login:privy");
      resolveInitial(currentAccount);
    });
    rerender();
    await waitFor(() =>
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).toHaveBeenCalledWith(credential, { newSession: false }),
    );
    expect(result.current.user?.id).toBe("current-account");
    expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
  });

  it.each(["expired", "cancelled", "account changed"] as const)(
    "does not use %s add intent for a later SDK subject",
    async (reason) => {
      let accountId = "current-account";
      mockState.accountClient!.getAccount.mockImplementation(async () => ({
        user: { id: accountId },
        linkedAccounts: [
          { id: "identity", provider: "privy", subject: "linked-subject" },
        ],
        wallets: [],
        session: null,
      }));
      let subject = "linked-subject";
      const login = vi.fn(async () => {
        if (reason === "cancelled") throw new Error("cancelled");
      });
      const logout = vi.fn().mockResolvedValue(undefined);
      const { result, rerender } = renderHook(() =>
        useAomiBackendAccountRuntime({
          enabled: true,
          auth: {
            provider: "privy",
            status: "authenticated",
            subject,
            login,
            logout,
            getCredential: vi
              .fn()
              .mockResolvedValue({ provider: "privy", providerToken: "token" }),
          } as never,
          evm: { accounts: () => [] } as never,
        }),
      );
      await waitFor(() => expect(result.current.user?.id).toBe(accountId));
      await act(async () => {
        const attempt = result.current.loginProvider!("social-login:privy");
        if (reason === "cancelled")
          await expect(attempt).rejects.toThrow("cancelled");
        else await attempt;
      });
      // Login can publish the old matching subject before the new proof arrives.
      rerender();
      if (reason === "expired")
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60_000 + 1);
      if (reason === "account changed") {
        accountId = "other-account";
        await act(async () => result.current.refresh());
      }
      subject = "foreign-subject";
      rerender();
      await waitFor(() => expect(logout).toHaveBeenCalledOnce());
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).not.toHaveBeenCalled();
      expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
      expect(result.current.user?.id).toBe(accountId);
      expect(result.current.conflict).toBeUndefined();
      expect(result.current.error).toBeUndefined();
    },
  );

  it("waits for the account before exchanging a restored provider login", async () => {
    let resolveAccount!: (value: unknown) => void;
    mockState.accountClient!.getAccount.mockReturnValue(
      new Promise((resolve) => {
        resolveAccount = resolve;
      }),
    );
    const credential: AomiAccountCredential = {
      provider: "privy",
      providerToken: "provider-session",
    };
    renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: {
          status: "authenticated",
          provider: "privy",
          subject: "provider-subject",
          getCredential: vi.fn().mockResolvedValue(credential),
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      mockState.accountClient?.exchangeProviderCredential,
    ).not.toHaveBeenCalled();

    await act(async () =>
      resolveAccount({
        user: null,
        linkedAccounts: [],
        wallets: [],
        session: null,
      }),
    );
    await waitFor(() =>
      expect(
        mockState.accountClient?.exchangeProviderCredential,
      ).toHaveBeenCalledWith(credential, { newSession: true }),
    );
  });

  it("shows a failed provider handoff without claiming an Aomi account exists", async () => {
    mockState.accountClient!.exchangeProviderCredential.mockRejectedValue(
      new Error("credential verification failed"),
    );
    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: {
          status: "authenticated",
          provider: "para",
          subject: "para-user",
          getCredential: vi.fn().mockResolvedValue({
            provider: "para",
            providerToken: "provider-session",
          }),
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );
    await waitFor(() =>
      expect(result.current.error).toBe(
        "Your wallet is connected, but Aomi sign-in failed. Try signing in again.",
      ),
    );
    expect(result.current.user).toBeUndefined();
  });

  it("exposes an account conflict instead of silently swallowing provider sign-in failure", async () => {
    const credential: AomiAccountCredential = {
      provider: "para",
      providerToken: "provider-session",
    };
    mockState.accountClient!.exchangeProviderCredential.mockRejectedValue(
      new AccountGraphApiError(
        409,
        { error: "already_linked_to_another_account", signalType: "wallet" },
        "",
      ),
    );

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: {
          status: "authenticated",
          provider: "para",
          subject: "para-user",
          getCredential: vi.fn().mockResolvedValue(credential),
        } as never,
        evm: { accounts: () => [] } as never,
      }),
    );

    await waitFor(() =>
      expect(result.current.error).toContain(
        "already signs in to another Aomi account",
      ),
    );
    expect(result.current.conflict).toEqual({
      code: "already_linked_to_another_account",
      signalType: "wallet",
      provider: "para",
    });
    expect(result.current.user).toBeUndefined();
  });

  it("creates a Solana-only account through BetterAuth SIWS", async () => {
    const address = "45q4DRCin6RkWkUFbTm5L9ZwuA7QgVdHewgQxQcExgdq";
    const signed = vi.fn().mockResolvedValue({ signature: "c2lnbmF0dXJl" });
    mockState
      .accountClient!.getAccount.mockResolvedValueOnce({
        user: null,
        linkedAccounts: [],
        wallets: [],
        session: null,
      })
      .mockResolvedValue({
        user: { id: "aomi-user" },
        linkedAccounts: [],
        wallets: [
          {
            id: "svm-wallet",
            family: "svm",
            address,
            linkedVia: "siws",
          },
        ],
        session: { betterAuthUserId: "ba-user" },
      });
    mockState.accountClient!.siwsNonce.mockResolvedValue({
      nonce: "siws-nonce",
      domain: "localhost:3000",
      uri: "http://localhost:3000",
    });
    mockState.accountClient!.verifySiws.mockResolvedValue({ success: true });

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: { status: "unauthenticated", provider: "para" } as never,
        evm: {
          activeEvmConnection: undefined,
          activeAccount: undefined,
          accounts: () => [],
          signMessageAsync: undefined,
        } as never,
        svm: {
          activeAccount: {
            id: "Phantom",
            family: "svm",
            address,
            walletName: "Phantom",
            active: true,
          },
          identity: () => ({
            address,
            cluster: "solana:devnet",
            walletName: "Phantom",
            walletSource: "injected",
            transport: "extension",
          }),
          selectedNetwork: {
            id: "solana-devnet",
            label: "Solana Devnet",
            cluster: "solana:devnet",
            rpcHttpUrl: "https://api.devnet.solana.com",
          },
          execution: { signSolanaMessage: signed },
          accounts: () => [],
        } as never,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockState.accountClient?.siwsNonce).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.linkWallet?.({
        accountId: "Phantom",
        family: "svm",
        address,
      });
    });
    expect(mockState.accountClient?.verifySiws).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.siwsNonce).toHaveBeenCalledWith({
      walletAddress: address,
      chainId: "solana:devnet",
    });
    const signedMessage = Buffer.from(
      signed.mock.calls[0]![0].message,
      "base64",
    ).toString("utf8");
    expect(signedMessage).toContain(
      "localhost:3000 wants you to sign in with your Solana account:",
    );
    expect(signedMessage).toContain("Chain ID: solana:devnet");
    expect(mockState.accountClient?.verifySiws).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: address,
        chainId: "solana:devnet",
        walletApp: "Phantom",
        signature: "c2lnbmF0dXJl",
      }),
    );
  });

  it("links an external Solana wallet through the wallet link endpoint", async () => {
    const address = "2qbUnCMuAC8egMU2jzsVHUXA2MoJn1v52JNPT3gKqTTB";
    const signed = vi.fn().mockResolvedValue({ signature: "bGlua3NpZw==" });
    mockState.accountClient!.getAccount.mockResolvedValue({
      user: { id: "aomi-user" },
      linkedAccounts: [],
      wallets: [
        {
          id: "evm-wallet",
          family: "evm",
          address: "0x1111111111111111111111111111111111111111",
          linkedVia: "siwe",
        },
      ],
      session: { betterAuthUserId: "ba-user" },
    });
    mockState.accountClient!.getWalletLinkNonce.mockResolvedValue({
      nonce: "link-nonce",
      domain: "localhost:3000",
      uri: "http://localhost:3000",
    });
    mockState.accountClient!.linkWallet.mockResolvedValue({ status: "linked" });

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: { status: "unauthenticated", provider: "para" } as never,
        evm: { accounts: () => [], signMessageAsync: undefined } as never,
        svm: {
          activeAccount: {
            id: "Phantom",
            family: "svm",
            address,
            walletName: "Phantom",
            active: true,
          },
          identity: () => ({
            address,
            cluster: "solana:mainnet",
            walletName: "Phantom",
            walletSource: "injected",
            transport: "extension",
          }),
          selectedNetwork: {
            id: "solana-mainnet",
            label: "Solana Mainnet",
            cluster: "solana:mainnet",
            rpcHttpUrl: "https://api.mainnet-beta.solana.com",
          },
          execution: { signSolanaMessage: signed },
          accounts: () => [],
        } as never,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.linkWallet?.({
        accountId: "Phantom",
        family: "svm",
        address,
      });
    });

    expect(mockState.accountClient?.getWalletLinkNonce).toHaveBeenCalledWith({
      address,
      chainId: "solana:mainnet",
    });
    expect(mockState.accountClient?.linkWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "svm",
        address,
        chainId: "solana:mainnet",
        nonce: "link-nonce",
        walletApp: "Phantom",
        signature: "bGlua3NpZw==",
      }),
    );
    expect(mockState.accountClient?.verifySiws).not.toHaveBeenCalled();
  });

  it("leaves embedded Solana wallets on their provider credential path", async () => {
    const signed = vi.fn();
    renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: { status: "unauthenticated", provider: "para" } as never,
        evm: { accounts: () => [], signMessageAsync: undefined } as never,
        svm: {
          activeAccount: {
            id: "para-solana",
            family: "svm",
            address: "ParaSvmAddress",
            walletName: "Para",
            walletKind: "embedded",
            active: true,
          },
          identity: () => ({
            address: "ParaSvmAddress",
            cluster: "solana:mainnet",
            walletName: "Para",
            walletSource: "embedded",
            transport: "embedded",
          }),
          execution: { signSolanaMessage: signed },
          accounts: () => [],
        } as never,
      }),
    );

    await waitFor(() =>
      expect(mockState.accountClient?.getAccount).toHaveBeenCalled(),
    );
    expect(mockState.accountClient?.siwsNonce).not.toHaveBeenCalled();
    expect(signed).not.toHaveBeenCalled();
  });
});

describe("Solana sign-in with the wallet on another cluster", () => {
  const address = "45q4DRCin6RkWkUFbTm5L9ZwuA7QgVdHewgQxQcExgdq";
  // Phantom's refusal when the message's Chain ID isn't its own network.
  const mismatch = new Error(
    "The app's signature request cannot be shown as the chain ID does not match the provided chain ID for verification.",
  );
  const selectAppNetwork = vi.fn();
  const network = (cluster: string) => ({
    id: cluster.replace(":", "-"),
    label: cluster,
    cluster,
    rpcHttpUrl: "https://rpc.invalid",
  });

  async function linkPhantom(
    sign: ReturnType<typeof vi.fn>,
    live?: () => boolean,
  ) {
    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: { status: "unauthenticated", provider: "para" } as never,
        evm: { accounts: () => [], signMessageAsync: undefined } as never,
        svm: {
          activeAccount: {
            id: "Phantom",
            family: "svm",
            address,
            walletName: "Phantom",
            active: true,
          },
          identity: () => ({
            address,
            cluster: "solana:mainnet",
            walletName: "Phantom",
            walletSource: "injected",
            transport: "extension",
          }),
          selectedNetwork: network("solana:mainnet"),
          supportedNetworks: [
            "solana:mainnet",
            "solana:devnet",
            "solana:testnet",
          ].map(network),
          selectAppNetwork,
          execution: { signSolanaMessage: sign },
          accounts: () => [],
        } as never,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    return act(() =>
      result.current.linkWallet!({
        accountId: "Phantom",
        family: "svm",
        address,
        live,
      }),
    );
  }

  const signedMessages = (sign: ReturnType<typeof vi.fn>) =>
    sign.mock.calls.map(([payload]) =>
      Buffer.from(payload.message, "base64").toString("utf8"),
    );
  const chainIds = (sign: ReturnType<typeof vi.fn>) =>
    signedMessages(sign).map(
      (message) => message.match(/^Chain ID: (.+)$/m)?.[1],
    );

  beforeEach(() => {
    selectAppNetwork.mockReset();
    let issued = 0;
    const nonce = async () => ({
      nonce: `nonce-${++issued}`,
      domain: "localhost:3000",
      uri: "http://localhost:3000",
    });
    mockState.accountClient!.siwsNonce.mockImplementation(nonce);
    mockState.accountClient!.getWalletLinkNonce.mockImplementation(nonce);
    mockState.accountClient!.verifySiws.mockResolvedValue({ success: true });
    mockState.accountClient!.linkWallet.mockResolvedValue({ status: "linked" });
  });

  it("signs in on Devnet with a fresh nonce after Phantom refuses Mainnet", async () => {
    const sign = vi
      .fn()
      .mockRejectedValueOnce(mismatch)
      .mockResolvedValue({ signature: "c2ln" });

    await linkPhantom(sign);

    expect(mockState.accountClient?.siwsNonce.mock.calls).toEqual([
      [{ walletAddress: address, chainId: "solana:mainnet" }],
      [{ walletAddress: address, chainId: "solana:devnet" }],
    ]);
    const devnet = signedMessages(sign)[1]!;
    expect(devnet).toContain("Chain ID: solana:devnet");
    expect(devnet).toContain("Nonce: nonce-2");
    expect(mockState.accountClient?.verifySiws).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.verifySiws).toHaveBeenCalledWith(
      expect.objectContaining({
        message: devnet,
        chainId: "solana:devnet",
        signature: "c2ln",
      }),
    );
    expect(selectAppNetwork.mock.calls).toEqual([["solana-devnet"]]);
  });

  it("keeps the network when the user leaves before the fallback signs", async () => {
    let open = true;
    const sign = vi
      .fn()
      .mockRejectedValueOnce(mismatch)
      .mockImplementation(async () => {
        open = false;
        return { signature: "c2ln" };
      });

    await linkPhantom(sign, () => open);

    expect(chainIds(sign)).toEqual(["solana:mainnet", "solana:devnet"]);
    expect(selectAppNetwork).not.toHaveBeenCalled();
  });

  it("keeps the network when the wallet signs on it", async () => {
    await linkPhantom(vi.fn().mockResolvedValue({ signature: "c2ln" }));

    expect(selectAppNetwork).not.toHaveBeenCalled();
  });

  it("links on Devnet with a fresh link nonce after Phantom refuses Mainnet", async () => {
    mockState.accountClient!.getAccount.mockResolvedValue({
      user: { id: "aomi-user" },
      linkedAccounts: [],
      wallets: [],
      session: { betterAuthUserId: "ba-user" },
    });
    const sign = vi
      .fn()
      .mockRejectedValueOnce(mismatch)
      .mockResolvedValue({ signature: "bGluaw==" });

    await linkPhantom(sign);

    expect(mockState.accountClient?.getWalletLinkNonce.mock.calls).toEqual([
      [{ address, chainId: "solana:mainnet" }],
      [{ address, chainId: "solana:devnet" }],
    ]);
    expect(chainIds(sign)).toEqual(["solana:mainnet", "solana:devnet"]);
    expect(mockState.accountClient?.linkWallet).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.linkWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: "solana:devnet",
        nonce: "nonce-2",
        message: signedMessages(sign)[1],
        signature: "bGluaw==",
      }),
    );
    expect(selectAppNetwork.mock.calls).toEqual([["solana-devnet"]]);
  });

  it("stops after every cluster refuses", async () => {
    const sign = vi.fn().mockRejectedValue(mismatch);

    await expect(linkPhantom(sign)).rejects.toThrow(mismatch.message);

    expect(chainIds(sign)).toEqual([
      "solana:mainnet",
      "solana:devnet",
      "solana:testnet",
    ]);
    expect(mockState.accountClient?.verifySiws).not.toHaveBeenCalled();
    expect(selectAppNetwork).not.toHaveBeenCalled();
  });

  it.each([
    { code: 4001, message: "User rejected the request." },
    {
      code: "ACTION_REJECTED",
      message:
        "User rejected the request because chain ID does not match their network.",
    },
  ])("does not retry a declined prompt ($code)", async (rejected) => {
    const sign = vi.fn().mockRejectedValue(rejected);

    await expect(linkPhantom(sign)).rejects.toBe(rejected);

    expect(sign).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.siwsNonce).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.verifySiws).not.toHaveBeenCalled();
  });

  it("asks no further when the sheet closes during a retry", async () => {
    let open = true;
    mockState.accountClient!.siwsNonce.mockImplementation(async () => {
      const issued = mockState.accountClient!.siwsNonce.mock.calls.length;
      if (issued === 2) open = false;
      return {
        nonce: `nonce-${issued}`,
        domain: "localhost:3000",
        uri: "http://localhost:3000",
      };
    });
    const sign = vi.fn().mockRejectedValue(mismatch);

    await expect(linkPhantom(sign, () => open)).rejects.toThrow("cancelled");

    expect(sign).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.siwsNonce).toHaveBeenCalledTimes(2);
    expect(mockState.accountClient?.verifySiws).not.toHaveBeenCalled();
  });

  it("does not retry once the wallet has signed", async () => {
    const sign = vi.fn().mockResolvedValue({ signature: "c2ln" });
    mockState.accountClient!.verifySiws.mockRejectedValue(mismatch);

    await expect(linkPhantom(sign)).rejects.toBe(mismatch);

    expect(sign).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.siwsNonce).toHaveBeenCalledOnce();
  });
});

describe("resolveLinkedWalletName", () => {
  const accounts = [
    {
      id: "mm",
      address: "0xE9B0000000000000000000000000000000000018",
      walletName: "MetaMask",
    },
    {
      id: "privy-evm",
      address: "0xCC8000000000000000000000000000000000008f",
      walletName: "Privy Smart Wallet",
    },
  ];

  it("names the linked wallet, not the active signer (the reported bug)", () => {
    // Linking MetaMask while the Privy smart wallet is the active EVM signer.
    expect(
      resolveLinkedWalletName({
        accounts,
        accountId: "mm",
        address: "0xE9B0000000000000000000000000000000000018",
        fallbackWalletName: "Privy Smart Wallet",
      }),
    ).toBe("MetaMask");
  });

  it("matches by address case-insensitively when no account id is given", () => {
    expect(
      resolveLinkedWalletName({
        accounts,
        address: "0xe9b0000000000000000000000000000000000018",
      }),
    ).toBe("MetaMask");
  });

  it("falls back to the active connection name when not in the live set", () => {
    expect(
      resolveLinkedWalletName({
        accounts,
        address: "0xDEAD000000000000000000000000000000000000",
        fallbackWalletName: "Rabby",
      }),
    ).toBe("Rabby");
  });
});

describe("walletAppName", () => {
  it("names known wallet apps and leaves unknown ones unnamed", () => {
    expect(walletAppName("MetaMask")).toBe("MetaMask");
    expect(walletAppName(undefined)).toBeUndefined();
  });
});

describe("normalizeAccountWalletProvider", () => {
  it("classifies linked backend wallets that match live embedded provider accounts", () => {
    expect(
      normalizeAccountWalletProvider(
        {
          id: "wallet-1",
          family: "evm",
          address: "0xE7700000000000000000000000000000000000A6",
          linkedVia: "para",
          label: "Para 1",
        },
        [
          {
            family: "evm",
            address: "0xe7700000000000000000000000000000000000a6",
            provider: "para",
            walletKind: "embedded",
          },
        ],
      ),
    ).toMatchObject({
      provider: "para",
      kind: "embedded",
    });
  });

  it("does not reclassify external wallets just because they are live", () => {
    const wallet = {
      id: "wallet-1",
      family: "evm" as const,
      address: "0xE7700000000000000000000000000000000000A6",
      linkedVia: "siwe" as const,
      label: "MetaMask 1",
    };

    expect(
      normalizeAccountWalletProvider(wallet, [
        {
          family: "evm",
          address: "0xe7700000000000000000000000000000000000a6",
          provider: undefined,
          walletKind: undefined,
        },
      ]),
    ).toEqual(wallet);
  });

  it("classifies provider-linked backend wallets even when the wallet is not currently live", () => {
    expect(
      normalizeAccountWalletProvider(
        {
          id: "wallet-1",
          family: "evm",
          address: "0xE7700000000000000000000000000000000000A6",
          linkedVia: "privy",
          label: "Privy 1",
        },
        [],
      ),
    ).toMatchObject({
      provider: "privy",
      kind: "embedded",
    });
  });
});

describe("auth message config", () => {
  it("uses the backend base URL as the SIWE domain when configured", () => {
    expect(
      resolveAuthMessageConfig({
        baseUrl: "https://portal.aomi.dev/api",
      }),
    ).toEqual({
      domain: "portal.aomi.dev",
      uri: "https://portal.aomi.dev",
    });
  });

  it("lets callers override the auth domain and URI", () => {
    expect(
      resolveAuthMessageConfig({
        baseUrl: "https://proxy.example.com",
        authDomain: "auth.example.com",
        authUri: "https://auth.example.com/",
      }),
    ).toEqual({
      domain: "auth.example.com",
      uri: "https://auth.example.com",
    });
  });

  it("keeps localhost host:port auth domains intact", () => {
    const config = resolveAuthMessageConfig({
      authDomain: "localhost:3000",
      authUri: "http://localhost:3000",
    });

    expect(config).toEqual({
      domain: "localhost:3000",
      uri: "http://localhost:3000",
    });
    expect(
      buildSiweMessage({
        address: "0x1111111111111111111111111111111111111111",
        chainId: 1,
        nonce: "nonce",
        ...config,
      }).split("\n")[0],
    ).toBe("localhost:3000 wants you to sign in with your Ethereum account:");
  });

  it("builds SIWE and wallet-link messages with the auth domain", () => {
    expect(
      buildSiweMessage({
        address: "0x1111111111111111111111111111111111111111",
        chainId: 1,
        nonce: "nonce",
        domain: "portal.aomi.dev",
        uri: "https://portal.aomi.dev",
      }),
    ).toContain("portal.aomi.dev wants you to sign in");
    expect(
      buildWalletLinkMessage({
        address: "0x1111111111111111111111111111111111111111",
        chainId: 1,
        nonce: "nonce",
        domain: "portal.aomi.dev",
        uri: "https://portal.aomi.dev",
      }),
    ).toContain("URI: https://portal.aomi.dev");
  });

  it("falls back to the browser origin instead of building blank-domain messages", () => {
    const config = messageConfigFromNonce(
      { nonce: "nonce", domain: " ", uri: " " },
      { domain: " ", uri: " " },
    );
    const proof = {
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      nonce: "nonce",
      ...config,
    };

    expect(buildWalletLinkMessage(proof)).toMatch(
      /^localhost(?::\d+)? wants to link this wallet/,
    );
    expect(buildSiweMessage(proof)).toMatch(
      /^localhost(?::\d+)? wants you to sign in/,
    );
  });

  it("ignores blank auth domains when building messages", () => {
    expect(
      resolveAuthMessageConfig({
        baseUrl: "http://localhost:3001",
        authDomain: " ",
      }),
    ).toEqual({
      domain: "localhost:3001",
      uri: "http://localhost:3001",
    });
  });
});
