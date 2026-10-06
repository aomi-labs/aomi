import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAomiBackendAccountRuntime } from "./aomi-backend-runtime";
import {
  WalletSignInRequiredError,
  useAccountSessionProvider,
} from "./use-widget-session-provider";

const BASE_URL = "https://portal.example";
const ADDRESS = "0x1111111111111111111111111111111111111111";

function walletInput(signMessageAsync: ReturnType<typeof vi.fn>) {
  return {
    baseUrl: BASE_URL,
    widgetAuth: { mode: "wallet" as const },
    auth: { status: "unauthenticated", provider: "wallet" } as never,
    evm: {
      activeEvmConnection: { address: ADDRESS, chainId: 1 },
      signMessageAsync,
      accounts: () => [],
    } as never,
  };
}

function widgetFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/auth/widget/siwe/nonce")) {
      return Response.json({
        nonce: "abcdefgh12345678",
        domain: window.location.host,
        uri: window.location.origin,
        issued_at: new Date().toISOString(),
        expiration_time: new Date(Date.now() + 60_000).toISOString(),
      });
    }
    if (url.endsWith("/api/auth/widget/siwe/verify")) {
      return Response.json({
        access_token: "aomi_wst_wallet_test",
        expires_at: Math.floor(Date.now() / 1000) + 1_800,
      });
    }
    throw new Error(`Unexpected widget request: ${url}`);
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("wallet-mode widget session consent", () => {
  it("keeps an automatic account refresh idle without requesting a signature", async () => {
    const signMessageAsync = vi.fn(async () => "0xsigned");
    const fetchImpl = widgetFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const { result } = renderHook(() =>
      useAomiBackendAccountRuntime({
        enabled: true,
        ...walletInput(signMessageAsync),
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.user).toBeUndefined();
    expect(signMessageAsync).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.getAccountBearer).toBeUndefined();
  });

  it("exchanges once after explicit sign-in and reuses that WST", async () => {
    const signMessageAsync = vi.fn(async () => "0xsigned");
    const fetchImpl = widgetFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { result } = renderHook(() =>
      useAccountSessionProvider(walletInput(signMessageAsync)),
    );

    await expect(result.current?.signIn()).resolves.toBe(
      "aomi_wst_wallet_test",
    );
    await expect(result.current?.()).resolves.toBe("aomi_wst_wallet_test");
    expect(signMessageAsync).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `${BASE_URL}/api/auth/widget/siwe/nonce`,
      `${BASE_URL}/api/auth/widget/siwe/verify`,
    ]);
  });

  it("restores a cached WST after remount without another signature", async () => {
    const signMessageAsync = vi.fn(async () => "0xsigned");
    const fetchImpl = widgetFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const first = renderHook(() =>
      useAccountSessionProvider(walletInput(signMessageAsync)),
    );
    await expect(first.result.current?.signIn()).resolves.toBe(
      "aomi_wst_wallet_test",
    );
    first.unmount();

    const second = renderHook(() =>
      useAccountSessionProvider(walletInput(signMessageAsync)),
    );
    await expect(second.result.current?.()).resolves.toBe(
      "aomi_wst_wallet_test",
    );
    expect(signMessageAsync).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not authorize a background retry after the signer rejects", async () => {
    const signMessageAsync = vi.fn(async () => {
      throw new Error("User rejected the signature");
    });
    const fetchImpl = widgetFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const { result } = renderHook(() =>
      useAccountSessionProvider(walletInput(signMessageAsync)),
    );

    await expect(result.current?.signIn()).rejects.toThrow(
      "User rejected the signature",
    );
    await expect(result.current?.()).rejects.toBeInstanceOf(
      WalletSignInRequiredError,
    );
    await expect(
      result.current?.({ forceRefresh: true }),
    ).rejects.toBeInstanceOf(WalletSignInRequiredError);
    expect(signMessageAsync).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
