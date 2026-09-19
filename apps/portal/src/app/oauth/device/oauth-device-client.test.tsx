import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: "provider=para&user_code=AOMI-1234",
  replace: vi.fn(),
  useSession: vi.fn(),
  wallet: {
    connectSocial: vi.fn(),
    getAccountCredential: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("@aomi-labs/account/better-auth/client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => mocks.wallet,
}));

vi.mock("@portal/lib/device-auth-provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@portal/lib/device-auth-provider")>();
  return { ...actual, providerConfigurationFailure: () => null };
});

import { OAuthDeviceClient } from "./oauth-device-client";

describe("OAuthDeviceClient claim flow", () => {
  beforeEach(() => {
    mocks.search = "provider=para&user_code=AOMI-1234";
    mocks.replace.mockReset();
    mocks.useSession.mockReturnValue({ data: { session: { id: "session" } } });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("claims and displays a request before approving it", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          user_code: "AOMI-1234",
          status: "pending",
          client_id: "aomi-cli",
          scope: "agent:read offline_access",
          resource: "https://portal.example/v1/agent",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          user_code: "AOMI-1234",
          status: "pending",
          client_id: "aomi-cli",
          scope: "agent:read offline_access",
          resource: "https://portal.example/v1/agent",
        }),
      )
      .mockResolvedValueOnce(Response.json({ success: true }));

    render(<OAuthDeviceClient />);

    expect(await screen.findByText("aomi-cli")).toBeInTheDocument();
    expect(
      screen.getByText("https://portal.example/v1/agent"),
    ).toBeInTheDocument();
    expect(screen.getByText("agent:read, offline_access")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Authorize device" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      "/api/auth/device?user_code=AOMI-1234",
    );
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain(
      "/api/auth/device?user_code=AOMI-1234",
    );
    expect(String(vi.mocked(fetch).mock.calls[2]?.[0])).toBe(
      "/api/auth/device/approve",
    );
  });

  it("claims the request again immediately before denying it", async () => {
    const pendingRequest = {
      user_code: "AOMI-1234",
      status: "pending",
      client_id: "aomi-cli",
      scope: "pipeline:catalog",
      resource: "https://portal.example/v1/pipeline",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(pendingRequest))
      .mockResolvedValueOnce(Response.json(pendingRequest))
      .mockResolvedValueOnce(Response.json({ success: true }));

    render(<OAuthDeviceClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(String(vi.mocked(fetch).mock.calls[1]?.[0])).toContain(
      "/api/auth/device?user_code=AOMI-1234",
    );
    expect(String(vi.mocked(fetch).mock.calls[2]?.[0])).toBe(
      "/api/auth/device/deny",
    );
  });

  it("requires provider selection before mounting login controls", () => {
    mocks.search = "user_code=AOMI-1234";
    mocks.useSession.mockReturnValue({ data: null });
    render(<OAuthDeviceClient />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Privy" }),
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.stringContaining("provider=privy"),
    );
  });
});
