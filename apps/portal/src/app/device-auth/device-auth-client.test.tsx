import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search:
    "state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback",
  replace: vi.fn(),
  wallet: {
    connectSocial: vi.fn(),
  },
  getAccountCredential: vi.fn<() => Promise<unknown>>() as
    | ReturnType<typeof vi.fn<() => Promise<unknown>>>
    | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => ({
    ...mocks.wallet,
    getAccountCredential: mocks.getAccountCredential,
  }),
}));

vi.mock("@portal/lib/device-auth-provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@portal/lib/device-auth-provider")>();
  // CI has no public Para/Privy configuration, and the page reads it at
  // module load, so classify against a fixed configured deployment instead of
  // whatever NEXT_PUBLIC_* happens to be in the environment.
  const configured = { paraApiKey: "para-public-key", privyAppId: "privy-app" };
  return {
    ...actual,
    providerConfigurationFailure: () => null,
    classifyProviderInitializationFailure: (
      provider: "para" | "privy",
      error: unknown,
    ) =>
      actual.classifyProviderInitializationFailure(provider, error, configured),
  };
});

vi.mock("@aomi-labs/widget-lib/providers/para", () => ({}));
vi.mock("@aomi-labs/widget-lib/providers/privy", () => ({}));

import { DeviceAuthClient } from "./device-auth-client";

const PARA_SEARCH =
  "provider=para&state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback";

function mockHandoffResponses() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(
      Response.json({
        code: "one-time-code",
        state: "state_1234567890abcdef",
      }),
    );
}

describe("DeviceAuthClient provider ownership", () => {
  beforeEach(() => {
    mocks.search =
      "state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback";
    mocks.replace.mockReset();
    mocks.wallet.connectSocial.mockReset();
    mocks.getAccountCredential = vi.fn<() => Promise<unknown>>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("navigates with the selected provider instead of nesting a provider", () => {
    render(<DeviceAuthClient />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));

    expect(mocks.replace).toHaveBeenCalledOnce();
    const destination = String(mocks.replace.mock.calls[0]?.[0]);
    expect(destination).toContain("/device-auth?");
    expect(
      new URL(destination, "https://portal.example").searchParams.get(
        "provider",
      ),
    ).toBe("para");
  });

  it("never renders a raw provider error after connect", async () => {
    mocks.search =
      "provider=para&state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback";
    mocks.wallet.connectSocial.mockResolvedValue(undefined);
    mocks.getAccountCredential!.mockRejectedValue(
      new Error("private provider response containing a credential"),
    );

    render(<DeviceAuthClient />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));

    expect(
      await screen.findByText(/para_initialization_failed/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/private provider response/),
    ).not.toBeInTheDocument();
  });

  it("keeps the CLI handoff pending while provider login takes over 30 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(
        Response.json({
          code: "one-time-code",
          state: "state_1234567890abcdef",
        }),
      );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      mocks.search =
        "provider=para&state=state_1234567890abcdef&code_challenge=challenge_1234567890abcdefghijklmnop&redirect_uri=http%3A%2F%2F127.0.0.1%3A4173%2Fcallback";
      mocks.wallet.connectSocial.mockResolvedValue(undefined);
      mocks.getAccountCredential = undefined;

      const view = render(<DeviceAuthClient />);
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Para" }),
      );
      await act(async () => {});

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });

      expect(
        screen.queryByText(/para_initialization_failed/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Continue with Para" }),
      ).toBeDisabled();

      const credential = { provider: "para", token: "provider-credential" };
      const getCredential = vi.fn(async () => credential);
      mocks.getAccountCredential = getCredential;
      view.rerender(<DeviceAuthClient />);
      await act(async () => {});

      expect(getCredential).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/auth/aomi/provider/exchange",
        expect.objectContaining({ body: JSON.stringify(credential) }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/v1/account/device-auth/grant",
        expect.any(Object),
      );
      expect(
        screen.getByText("Authentication complete. Returning to the CLI..."),
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("outlasts a provider credential cooldown of 30 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = mockHandoffResponses();
    mocks.search = PARA_SEARCH;
    mocks.wallet.connectSocial.mockResolvedValue(undefined);
    const startedAt = Date.now();
    const credential = { provider: "para", token: "provider-credential" };
    // Para's getter answers null while its 30-second backoff is armed. The
    // page must keep asking (with `fresh`) until the credential appears.
    const getCredential = vi.fn(async (options?: { fresh?: boolean }) => {
      expect(options).toEqual({ fresh: true });
      return Date.now() - startedAt < 31_000 ? null : credential;
    });
    mocks.getAccountCredential = getCredential;

    render(<DeviceAuthClient />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Continue with Para" }),
    ).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(getCredential.mock.calls.length).toBeGreaterThan(15);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/aomi/provider/exchange",
      expect.objectContaining({ body: JSON.stringify(credential) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/v1/account/device-auth/grant",
      expect.any(Object),
    );
    expect(
      screen.getByText("Authentication complete. Returning to the CLI..."),
    ).toBeInTheDocument();
  });

  it("reports a stable timeout code when no credential is ever issued", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    mocks.search = PARA_SEARCH;
    mocks.wallet.connectSocial.mockResolvedValue(undefined);
    mocks.getAccountCredential = vi.fn(async () => null);

    render(<DeviceAuthClient />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/provider_credential_timeout/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue with Para" }),
    ).toBeEnabled();
  });

  it("lets the user cancel a dismissed provider modal and try again", async () => {
    vi.useFakeTimers();
    const fetchMock = mockHandoffResponses();
    mocks.search = PARA_SEARCH;
    mocks.wallet.connectSocial.mockResolvedValue(undefined);
    mocks.getAccountCredential = undefined;

    const view = render(<DeviceAuthClient />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: "Continue with Para" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Continue with Para" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    // A credential surfacing after cancellation must not start a handoff.
    const credential = { provider: "para", token: "late-credential" };
    mocks.getAccountCredential = vi.fn(async () => credential);
    view.rerender(<DeviceAuthClient />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Authentication complete. Returning to the CLI..."),
    ).toBeInTheDocument();
  });

  it("names an account conflict instead of a generic provider failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          { message: "already_linked_to_another_account" },
          { status: 409 },
        ),
      );
    mocks.search = PARA_SEARCH;
    mocks.wallet.connectSocial.mockResolvedValue(undefined);
    mocks.getAccountCredential = vi.fn(async () => ({
      provider: "para",
      token: "provider-credential",
    }));

    render(<DeviceAuthClient />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Para" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/provider_account_conflict/)).toBeInTheDocument();
    expect(screen.queryByText(/already_linked/)).toBeNull();
  });
});
