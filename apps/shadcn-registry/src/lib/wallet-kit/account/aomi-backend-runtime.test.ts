import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSiweMessage,
  buildWalletLinkMessage,
  buildDefaultWalletLabel,
  normalizeAccountWalletProvider,
  resolveAuthMessageConfig,
  resolveLinkedWalletName,
  useAomiBackendAccountRuntime,
} from "./aomi-backend-runtime";
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
    updateWallet: ReturnType<typeof vi.fn>;
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
    ) {
      super(
        "This wallet or sign-in method is already linked to another Aomi account. Sign in to that account, unlink it there, then return here and link it.",
      );
      this.name = "AomiAccountRequestError";
    }
  },
  createAomiBackendAccountClient: vi.fn(() => mockState.accountClient),
}));

beforeEach(() => {
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
    updateWallet: vi.fn(),
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
    expect(result.current.getAccountBearer).toBeDefined();
  });

  it("replaces a guest session before signing in with an existing EVM wallet", async () => {
    const address = "0x1111111111111111111111111111111111111111" as const;
    mockState
      .accountClient!.getAccount.mockResolvedValueOnce({
        guest: true,
        // Defense in depth: even a stale server response that includes the
        // canonical guest user must never make it an account principal.
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

    await act(async () => {
      await result.current.linkWallet?.({
        accountId: "rabby-1",
        family: "evm",
        address,
        chainId: 1,
      });
    });
    await waitFor(() =>
      expect(result.current.user?.id).toBe("existing-wallet-owner"),
    );
    expect(mockState.accountClient?.signOut).toHaveBeenCalledTimes(1);
    expect(mockState.accountClient?.createSiweNonce).toHaveBeenCalledTimes(1);
    expect(mockState.accountClient?.getWalletLinkNonce).not.toHaveBeenCalled();
    expect(
      mockState.accountClient!.signOut.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockState.accountClient!.createSiweNonce.mock.invocationCallOrder[0]!,
    );
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

  it("revokes a guest before provider sign-in and creates a new session", async () => {
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
        linkedAccounts: [],
        wallets: [],
        session: null,
      });
    mockState.accountClient!.signOut.mockResolvedValue(undefined);
    mockState.accountClient!.exchangeProviderCredential.mockResolvedValue({
      status: "linked",
      account: {
        user: { id: "real-user" },
        linkedAccounts: [],
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
    expect(mockState.accountClient?.signOut).toHaveBeenCalledTimes(1);
    expect(
      mockState.accountClient!.signOut.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mockState.accountClient!.exchangeProviderCredential.mock
        .invocationCallOrder[0]!,
    );
    await waitFor(() => expect(result.current.user?.id).toBe("real-user"));
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
          getCredential: vi
            .fn()
            .mockResolvedValue({
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
      new AomiAccountRequestError(409, "already_linked_to_another_account"),
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
        "already linked to another Aomi account",
      ),
    );
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
      intent: "sign-in",
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
        intent: "sign-in",
        label: "Phantom 1",
        signature: "c2lnbmF0dXJl",
      }),
    );
  });

  it("links an external Solana wallet to the current account through SIWS", async () => {
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
    mockState.accountClient!.createSiwsNonce.mockResolvedValue({
      nonce: "link-nonce",
      domain: "localhost:3000",
      uri: "http://localhost:3000",
    });
    mockState.accountClient!.verifySiws.mockResolvedValue({ status: "linked" });

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

    expect(mockState.accountClient?.createSiwsNonce).toHaveBeenCalledWith({
      walletAddress: address,
      chainId: "solana:mainnet",
      intent: "link",
    });
    expect(mockState.accountClient?.verifySiws).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: address,
        chainId: "solana:mainnet",
        intent: "link",
        label: "Phantom 1",
        signature: "bGlua3NpZw==",
      }),
    );
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

  it("labels an unlabeled SIWE wallet from its connected wallet brand", async () => {
    const address = "0x28581d8065da7e25710f25f9dd30f9d361757a7d";
    mockState
      .accountClient!.getAccount.mockResolvedValueOnce({
        user: { id: "aomi-user" },
        linkedAccounts: [],
        wallets: [
          {
            id: "evm-wallet",
            family: "evm",
            address,
            linkedVia: "siwe",
          },
        ],
        session: { betterAuthUserId: "ba-user" },
      })
      .mockResolvedValue({
        user: { id: "aomi-user" },
        linkedAccounts: [],
        wallets: [
          {
            id: "evm-wallet",
            family: "evm",
            address,
            linkedVia: "siwe",
            label: "Rabby 1",
          },
        ],
        session: { betterAuthUserId: "ba-user" },
      });
    mockState.accountClient!.updateWallet.mockResolvedValue({ success: true });

    renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        baseUrl: "http://localhost:3000",
        auth: { status: "unauthenticated", provider: "para" } as never,
        evm: {
          activeEvmConnection: { address, chainId: 8453, walletName: "Rabby" },
          activeAccount: {
            id: "rabby",
            family: "evm",
            address,
            chainId: 8453,
            walletName: "Rabby",
            active: true,
          },
          accounts: () => [
            {
              id: "rabby",
              family: "evm",
              address,
              chainId: 8453,
              walletName: "Rabby",
              active: true,
            },
          ],
          signMessageAsync: vi.fn(),
        } as never,
      }),
    );

    await waitFor(() => {
      expect(mockState.accountClient?.updateWallet).toHaveBeenCalledWith(
        "evm-wallet",
        { label: "Rabby 1" },
      );
    });
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

describe("buildDefaultWalletLabel", () => {
  it("brands and counts per family", () => {
    expect(
      buildDefaultWalletLabel({
        walletName: "MetaMask",
        existingWallets: [],
        family: "evm",
      }),
    ).toBe("MetaMask 1");
  });

  it("increments past same-brand wallets", () => {
    expect(
      buildDefaultWalletLabel({
        walletName: "MetaMask",
        existingWallets: [
          {
            id: "w1",
            family: "evm",
            address: "0x1",
            linkedVia: "siwe",
            label: "MetaMask 1",
          },
        ],
        family: "evm",
      }),
    ).toBe("MetaMask 2");
  });

  it("falls back to 'Wallet' for an unknown brand", () => {
    expect(
      buildDefaultWalletLabel({
        walletName: undefined,
        existingWallets: [],
        family: "evm",
      }),
    ).toBe("Wallet 1");
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
    const linkMessage = buildWalletLinkMessage({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      nonce: "nonce",
      domain: " ",
      uri: " ",
    });
    const siweMessage = buildSiweMessage({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      nonce: "nonce",
      domain: " ",
      uri: " ",
    });

    expect(linkMessage).not.toMatch(/^ wants /);
    expect(siweMessage).not.toMatch(/^ wants /);
    expect(linkMessage).toMatch(
      /^localhost(?::\d+)? wants to link this wallet/,
    );
    expect(siweMessage).toMatch(/^localhost(?::\d+)? wants you to sign in/);
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
