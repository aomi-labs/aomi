import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthorizationState } from "./use-authorization-state";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const provider = Object.assign(
  vi.fn(async () => "wst-token"),
  {
    dispose: vi.fn(),
    subscribe: vi.fn(),
  },
);
const wallet = { address: ADDRESS, id: "wallet-1", delegated: true };

function profile(overrides: Record<string, unknown> = {}) {
  return {
    delegated_accounts: [],
    signing_policies: [],
    ...overrides,
  };
}

describe("useAuthorizationState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    provider.mockClear();
  });

  it("restores both completed steps from the backend profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        profile({
          delegated_accounts: [
            {
              address: { chain: "evm", address: ADDRESS.toUpperCase() },
              status: "active",
              revoked_at: null,
            },
          ],
          signing_policies: [
            { address: { chain: "evm", address: ADDRESS }, mode: "auto" },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useAuthorizationState({ provider: provider as never, wallet }),
    );

    await waitFor(() =>
      expect(result.current).toEqual({ delegated: true, serverAuto: true }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat.aomi.dev/api/account",
      {
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer wst-token",
        },
      },
    );
  });

  it("does not report completion for another wallet or a revoked grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          profile({
            delegated_accounts: [
              {
                address: {
                  chain: "evm",
                  address: "0x2222222222222222222222222222222222222222",
                },
                status: "active",
                revoked_at: null,
              },
              {
                address: { chain: "evm", address: ADDRESS },
                status: "revoked",
                revoked_at: 1,
              },
            ],
            signing_policies: [
              { address: { chain: "evm", address: ADDRESS }, mode: "manual" },
            ],
          }),
      }),
    );

    const { result } = renderHook(() =>
      useAuthorizationState({ provider: provider as never, wallet }),
    );
    await waitFor(() =>
      expect(result.current).toEqual({ delegated: false, serverAuto: false }),
    );
  });
});
