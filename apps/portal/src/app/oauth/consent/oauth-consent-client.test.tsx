import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search:
    "client_id=codex-mcp&scope=agent%3Aread+mcp%3Aagent&resource=https%3A%2F%2Fchat-staging.aomi.dev%2Fv1%2Fagent%2Fmcp&exp=4102444800&sig=signed-request",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("@aomi-labs/widget/host-composition", async (original) => ({
  ...(await original<typeof import("@aomi-labs/widget/host-composition")>()),
  useAomiWalletKit: () => ({}),
}));

import { ConsentSheet } from "./oauth-consent-client";

describe("OAuthConsentClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({}, { status: 400 })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("names the client and words its scopes plainly", () => {
    render(<ConsentSheet name="Codex" />);
    expect(screen.getByRole("heading", { name: "Allow Codex?" })).toBeTruthy();
    expect(
      screen.getByText("Codex will use your Aomi account."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Chat with Aomi and read your wallets"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Propose trades. Each one waits for you."),
    ).toBeInTheDocument();
  });

  it("submits Better Auth's signed query instead of requiring a nonexistent consent code", async () => {
    render(<ConsentSheet name="Codex" />);

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/oauth2/consent",
        expect.anything(),
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/oauth2/consent",
      expect.objectContaining({
        body: JSON.stringify({
          accept: true,
          oauth_query: mocks.search,
          scope: "agent:read mcp:agent",
        }),
      }),
    );
    expect(
      await screen.findByText("That didn’t go through. Try again."),
    ).toBeInTheDocument();
  });
});
