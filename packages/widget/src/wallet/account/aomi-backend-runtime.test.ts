import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
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
import { AomiAccountRequestError } from "./aomi-backend-client";

const mockState = vi.hoisted(() => ({
  accountClient: null as null | {
    getAccount: ReturnType<typeof vi.fn>;
    exchangeProviderCredential: ReturnType<typeof vi.fn>;
    createSiweNonce: ReturnType<typeof vi.fn>;
    verifySiwe: ReturnType<typeof vi.fn>;
    createSiwsNonce: ReturnType<typeof vi.fn>;
    verifySiws: ReturnType<typeof vi.fn>;
    getWalletLinkNonce: ReturnType<typeof vi.fn>;
    linkWallet: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
    updateAccount: ReturnType<typeof vi.fn>;
    renameWallet: ReturnType<typeof vi.fn>;
    updateAuthIdentity: ReturnType<typeof vi.fn>;
    unlinkWallet: ReturnType<typeof vi.fn>;
    unlinkAuthIdentity: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("./aomi-backend-client", () => ({
  AomiAccountRequestError: class AomiAccountRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | null,
      readonly signalType: "wallet" | "identity" | "email" | null = null,
      readonly mergeOffer: unknown = null,
    ) {
      super(
        "This wallet or sign-in method belongs to another Aomi account. Sign in another way to open that account.",
      );
      this.name = "AomiAccountRequestError";
    }
  },
  createAomiBackendAccountClient: vi.fn(() => mockState.accountClient),
  mergeOfferFrom: (error: { mergeOffer?: unknown }) =>
    error?.mergeOffer ?? null,
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
    createSiweNonce: vi.fn(),
    verifySiwe: vi.fn(),
    createSiwsNonce: vi.fn(),
    verifySiws: vi.fn(),
    getWalletLinkNonce: vi.fn(),
    linkWallet: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
    updateAccount: vi.fn(),
    renameWallet: vi.fn(),
    updateAuthIdentity: vi.fn(),
    unlinkWallet: vi.fn(),
    unlinkAuthIdentity: vi.fn(),
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
    mockState.accountClient!.createSiweNonce.mockResolvedValue({
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
    expect(mockState.accountClient?.createSiweNonce).not.toHaveBeenCalled();

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
    expect(mockState.accountClient?.createSiweNonce).not.toHaveBeenCalled();

    finishGuestTransition();
    await guestTransition;
    await act(async () => signIn);
    await waitFor(() =>
      expect(result.current.user?.id).toBe("existing-wallet-owner"),
    );
    // The server merges the guest's chats in, so the guest cookie must reach
    // the sign-in.
    expect(mockState.accountClient?.signOut).not.toHaveBeenCalled();
    expect(mockState.accountClient?.createSiweNonce).toHaveBeenCalledTimes(1);
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
      ).toHaveBeenCalledWith(credential, { hasAccount: false });
    });

    expect(mockState.accountClient?.createSiweNonce).not.toHaveBeenCalled();
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
      ).toHaveBeenCalledWith(credential, { hasAccount: false }),
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
              getCredential: vi.fn().mockResolvedValue(credential),
            } as never,
            evm: { accounts: () => [] } as never,
          }),
        );
        return {
          ...hook,
          logout,
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
          ).toHaveBeenCalledWith(credential, { hasAccount: true }),
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
        const offer = { ticket: "ticket-1", other: { name: "privy user" } };
        mockState.accountClient!.exchangeProviderCredential.mockRejectedValue(
          new AomiAccountRequestError(
            409,
            "account_merge_available",
            null,
            offer as never,
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
      ).toHaveBeenCalledWith(credential, { hasAccount: true }),
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
      ).toHaveBeenCalledWith(credential, { hasAccount: false }),
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
      new AomiAccountRequestError(
        409,
        "already_linked_to_another_account",
        "wallet",
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
      expect(result.current.error).toContain("belongs to another Aomi account"),
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
    mockState.accountClient!.createSiwsNonce.mockResolvedValue({
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
    expect(mockState.accountClient?.createSiwsNonce).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.linkWallet?.({
        accountId: "Phantom",
        family: "svm",
        address,
      });
    });
    expect(mockState.accountClient?.verifySiws).toHaveBeenCalledOnce();
    expect(mockState.accountClient?.createSiwsNonce).toHaveBeenCalledWith({
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
    expect(mockState.accountClient?.createSiwsNonce).not.toHaveBeenCalled();
    expect(signed).not.toHaveBeenCalled();
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
