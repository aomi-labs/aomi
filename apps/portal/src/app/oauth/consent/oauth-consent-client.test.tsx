import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search:
    "client_id=codex-mcp&scope=agent%3Aread+mcp%3Aagent&resource=https%3A%2F%2Fchat-staging.aomi.dev%2Fv1%2Fagent%2Fmcp&exp=4102444800&sig=signed-request",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import { OAuthConsentClient } from "./oauth-consent-client";

describe("OAuthConsentClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({}, { status: 400 })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits Better Auth's signed query instead of requiring a nonexistent consent code", async () => {
    render(<OAuthConsentClient />);

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
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
      screen.queryByText("This authorization request is incomplete."),
    ).not.toBeInTheDocument();
  });
});
