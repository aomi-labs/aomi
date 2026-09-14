import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@privy-io/react-auth";

const signTypedData = vi.fn();
let privyUser: User | null = null;

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: privyUser }),
  useSignTypedData: () => ({ signTypedData }),
}));

const { usePermissionControl } = await import("./use-permission-control");

const ADDRESS = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

const TYPED_DATA = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }],
    AuthorizationPermit: [{ name: "mode", type: "string" }],
  },
  primaryType: "AuthorizationPermit",
  domain: { name: "Aomi Authorization", version: "1" },
  message: { mode: "server_auto" },
};
const PERMIT = {
  account: "user-1",
  chain_type: "evm",
  wallet: ADDRESS,
  mode: "server_auto",
  version: 3,
  expiry: 1_800_000_000,
};

const provider = Object.assign(
  vi.fn(async () => "wst-token"),
  {
    dispose: vi.fn(),
    subscribe: vi.fn(),
  },
);

function launchWith(permission: Record<string, string | null>) {
  return {
    inTelegram: true,
    proof: { botId: "1", initData: "raw", telegramUserId: "7" },
    sessionId: "telegram:dm:7",
    permissionChain: null,
    permissionWallet: null,
    permissionMode: null,
    verified: true,
    ...permission,
  };
}

function userWithWallet() {
  return {
    id: "did:privy:user",
    linkedAccounts: [
      {
        type: "wallet",
        chainType: "ethereum",
        walletClientType: "privy",
        address: ADDRESS,
        id: "wallet-1",
        delegated: true,
        imported: false,
      },
    ],
  } as unknown as User;
}

function render(launch: unknown, useProvider: unknown = provider) {
  return renderHook(() =>
    usePermissionControl({
      launch: launch as never,
      provider: useProvider as never,
    }),
  );
}

function ceremonyFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ permit: PERMIT, typed_data: TYPED_DATA }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ signing_mode: "server_auto" }),
    });
}

describe("usePermissionControl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    signTypedData.mockReset().mockResolvedValue({ signature: "0xsig" });
    privyUser = userWithWallet();
    provider.mockClear();
  });

  it("honours the key and mode the bot named", () => {
    const { result } = render(
      launchWith({
        permissionChain: "evm",
        permissionWallet: AGENT,
        permissionMode: "denied",
      }),
    );
    expect(result.current.target).toEqual({
      chain: "evm",
      wallet: AGENT,
      mode: "denied",
      fromLaunch: true,
    });
  });

  it("falls back to the user's own wallet when the bot named no key", () => {
    // Launched from /wallet rather than /permission: arming the user's own
    // embedded wallet is a valid, fully-satisfiable target.
    const { result } = render(launchWith({}));
    expect(result.current.target).toEqual({
      chain: "evm",
      wallet: ADDRESS,
      mode: "server_auto",
      fromLaunch: false,
    });
  });

  it("is ready without Privy's connected-wallet list", () => {
    // The regression this guards: gating on `useWallets().ready` left the sign
    // button permanently unrendered inside Telegram's webview, because Privy's
    // wallet-proxy iframe never connects there.
    expect(render(launchWith({})).result.current.status).toBe("ready");
  });

  it("restores the completed state for its own already-armed wallet", () => {
    expect(render(launchWith({}), provider).result.current.status).toBe(
      "ready",
    );
    const { result } = renderHook(() =>
      usePermissionControl({
        launch: launchWith({}) as never,
        provider: provider as never,
        serverAuto: true,
      }),
    );
    expect(result.current.status).toBe("done");
    expect(result.current.signedHere).toBe(false);
  });

  it("never treats a different bot-named key as already armed", () => {
    const { result } = renderHook(() =>
      usePermissionControl({
        launch: launchWith({
          permissionChain: "evm",
          permissionWallet: AGENT,
          permissionMode: "denied",
        }) as never,
        provider: provider as never,
        serverAuto: true,
      }),
    );
    expect(result.current.status).toBe("ready");
  });

  it("is not ready without a wallet or a session", () => {
    privyUser = null;
    expect(render(launchWith({})).result.current.status).toBe("idle");
    privyUser = userWithWallet();
    expect(render(launchWith({}), null).result.current.status).toBe("idle");
  });

  it("signs the challenge with the embedded wallet and commits it", async () => {
    const fetchMock = ceremonyFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = render(launchWith({}));
    await act(async () => void (await result.current.sign()));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.signedHere).toBe(true);

    const [challengeUrl, challengeInit] = fetchMock.mock.calls[0];
    expect(String(challengeUrl)).toBe(
      "https://chat.aomi.dev/api/account/authorization/challenge",
    );
    expect(challengeInit.headers.Authorization).toBe("Bearer wst-token");
    expect(JSON.parse(challengeInit.body)).toEqual({
      chain_type: "evm",
      wallet: ADDRESS,
      mode: "server_auto",
    });

    // Signed through Privy's headless path, targeted by address. The typed data
    // is passed through untouched so it stays byte-identical to the browser's.
    expect(signTypedData).toHaveBeenCalledWith(TYPED_DATA, {
      address: ADDRESS,
    });

    const [commitUrl, commitInit] = fetchMock.mock.calls[1];
    expect(String(commitUrl)).toBe(
      "https://chat.aomi.dev/api/account/authorization/commit",
    );
    expect(JSON.parse(commitInit.body)).toEqual({
      permit: PERMIT,
      signature: "0xsig",
    });
  });

  it("surfaces the backend's own refusal code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "missing_delegated_account" }),
      }),
    );

    const { result } = render(launchWith({}));
    await act(async () => void (await result.current.sign()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    // This exact code is what an undelegated wallet gets, at challenge time.
    expect(result.current.error).toBe("missing_delegated_account");
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("rejects a challenge whose typed data is unusable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ permit: PERMIT, typed_data: { message: {} } }),
      }),
    );

    const { result } = render(launchWith({}));
    await act(async () => void (await result.current.sign()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "permission_challenge_invalid_typed_data",
    );
  });

  it("commits through the session current at commit time", async () => {
    // A provider rebuilt while the signature prompt is up must not strand the
    // commit — the failure that logged a challenge 200 with no commit.
    const fetchMock = ceremonyFetch();
    vi.stubGlobal("fetch", fetchMock);
    const replacement = Object.assign(
      vi.fn(async () => "fresh-token"),
      {
        dispose: vi.fn(),
        subscribe: vi.fn(),
      },
    );

    let releasePrompt: () => void = () => {};
    const prompt = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    signTypedData.mockImplementation(async () => {
      await prompt;
      return { signature: "0xsig" };
    });

    const { result, rerender } = renderHook(
      ({ current }) =>
        usePermissionControl({
          launch: launchWith({}) as never,
          provider: current as never,
        }),
      { initialProps: { current: provider as unknown } },
    );

    let signing: Promise<void> = Promise.resolve();
    await act(async () => {
      signing = result.current.sign();
      // Let the challenge land and the signature prompt open.
      await Promise.resolve();
    });

    // The session is replaced while the prompt is still on screen.
    await act(async () => {
      rerender({ current: replacement });
    });

    await act(async () => {
      releasePrompt();
      await signing;
    });

    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(replacement).toHaveBeenCalled();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer fresh-token",
    );
  });

  it("does not reject into the click handler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = render(launchWith({}));
    await expect(result.current.sign()).resolves.toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
