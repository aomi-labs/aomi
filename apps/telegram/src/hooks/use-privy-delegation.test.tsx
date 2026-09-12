import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@privy-io/react-auth";

const addSessionSigners = vi.fn();
const getAccessToken = vi.fn();
let privyUser: User | null = null;

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken, user: privyUser }),
  useSessionSigners: () => ({ addSessionSigners }),
}));

const { usePrivyDelegation } = await import("./use-privy-delegation");

const ADDRESS = "0x1111111111111111111111111111111111111111";
const SIGNER_ID = "signer-abc";
const AUTH_URL = `https://chat.aomi.dev/api/delegation/privy/begin?signer_id=${SIGNER_ID}&state=s`;

const launch = {
  inTelegram: true,
  proof: { botId: "1", initData: "raw", telegramUserId: "7" },
  sessionId: "telegram:dm:7",
  permissionChain: null,
  permissionWallet: null,
  permissionMode: null,
  verified: true,
};

const wallet = { address: ADDRESS, id: "wallet-1", delegated: false };
const provider = Object.assign(vi.fn(async () => "wst-token"), {
  dispose: vi.fn(),
  subscribe: vi.fn(),
});

function userWithWallet(delegated: boolean, id: string | null = "wallet-1") {
  return {
    id: "did:privy:user",
    linkedAccounts: [
      {
        type: "wallet",
        chainType: "ethereum",
        walletClientType: "privy",
        address: ADDRESS,
        id,
        delegated,
        imported: false,
      },
    ],
  } as unknown as User;
}

function render(overrides: Partial<Parameters<typeof usePrivyDelegation>[0]> = {}) {
  return renderHook(() =>
    usePrivyDelegation({
      launch: launch as never,
      provider: provider as never,
      wallet,
      ...overrides,
    }),
  );
}

function okJson(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("usePrivyDelegation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    addSessionSigners.mockReset().mockResolvedValue({
      user: userWithWallet(true),
    });
    getAccessToken.mockReset().mockResolvedValue("privy-access-token");
    privyUser = userWithWallet(false);
    provider.mockClear();
  });

  it("is ready once a provider, wallet and thread exist", () => {
    expect(render().result.current.status).toBe("ready");
  });

  it("is idle while a prerequisite is missing", () => {
    expect(render({ provider: null }).result.current.status).toBe("idle");
    expect(render({ wallet: null }).result.current.status).toBe("idle");
  });

  it("skips the ceremony for an already-delegated wallet", () => {
    const { result } = render({ wallet: { ...wallet, delegated: true } });
    expect(result.current.status).toBe("done");
  });

  it("runs begin, installs the signer, then confirms via the callback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ auth_url: AUTH_URL, state_token: "st" }))
      .mockResolvedValueOnce(okJson({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = render();
    await act(async () => void (await result.current.delegate()));

    await waitFor(() => expect(result.current.status).toBe("done"));

    const [beginUrl, beginInit] = fetchMock.mock.calls[0];
    expect(beginUrl).toBe("https://chat.aomi.dev/api/delegation/privy/begin");
    // The backend's begin endpoint is thread-authed and bearer-authed.
    expect(beginInit.headers["X-Thread-Id"]).toBe("telegram:dm:7");
    expect(beginInit.headers.Authorization).toBe("Bearer wst-token");
    expect(JSON.parse(beginInit.body)).toEqual({
      wallet_family: "evm",
      purpose: "delegate_signing",
    });

    expect(addSessionSigners).toHaveBeenCalledWith({
      address: ADDRESS,
      signers: [{ signerId: SIGNER_ID, policyIds: [] }],
    });

    const [callbackUrl, callbackInit] = fetchMock.mock.calls[1];
    expect(callbackUrl).toBe(
      "https://chat.aomi.dev/api/delegation/privy/callback",
    );
    expect(JSON.parse(callbackInit.body)).toEqual({
      state: "st",
      access_token: "privy-access-token",
      user_id: "did:privy:user",
      wallets: [{ id: "wallet-1", address: ADDRESS, chain_type: "ethereum" }],
    });
  });

  it("still confirms when Privy reports the signer as already installed", async () => {
    // Privy returns an error for an already-installed signer. The Aomi callback
    // is authoritative, so that must not abort the ceremony.
    addSessionSigners.mockRejectedValue(new Error("already installed"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ auth_url: AUTH_URL, state_token: "st" }))
      .mockResolvedValueOnce(okJson({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = render();
    await act(async () => void (await result.current.delegate()));

    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("takes the wallet id from the user Privy returns after delegating", async () => {
    // Privy assigns the server wallet id only once the wallet is delegated, so
    // the pre-call snapshot can legitimately carry none.
    addSessionSigners.mockResolvedValue({
      user: userWithWallet(true, "wallet-assigned-late"),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ auth_url: AUTH_URL, state_token: "st" }))
      .mockResolvedValueOnce(okJson({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = render({ wallet: { ...wallet, id: null } });
    await act(async () => void (await result.current.delegate()));

    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).wallets[0].id).toBe(
      "wallet-assigned-late",
    );
  });

  it("reports a begin failure without installing a signer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(null, false, 503)));

    const { result } = render();
    await act(async () => void (await result.current.delegate()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("delegation_begin_failed_503");
    expect(addSessionSigners).not.toHaveBeenCalled();
  });

  it("names an unconfigured signer rather than delegating to nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okJson({
          auth_url: "https://chat.aomi.dev/api/delegation/privy/begin",
          state_token: "st",
        }),
      ),
    );

    const { result } = render();
    await act(async () => void (await result.current.delegate()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("delegation_signer_unconfigured");
    expect(addSessionSigners).not.toHaveBeenCalled();
  });

  it("surfaces the callback's own rejection code, with the signer failure", async () => {
    addSessionSigners.mockRejectedValue(new Error("signer refused"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ auth_url: AUTH_URL, state_token: "st" }))
      .mockResolvedValueOnce(
        okJson({ error: "privy_delegation_rejected" }, false, 400),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = render();
    await act(async () => void (await result.current.delegate()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "privy_delegation_rejected (signer refused)",
    );
  });

  it("does not reject into the click handler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = render();
    // An unhandled rejection here would surface as a console error and tell the
    // user nothing; the failure has to be state.
    await expect(result.current.delegate()).resolves.toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
