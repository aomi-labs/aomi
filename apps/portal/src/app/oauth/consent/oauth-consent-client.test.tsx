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

import { ConsentSheet, consentApp } from "./oauth-consent-client";

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

  it("reads the app an app-locked resource names", () => {
    expect(consentApp("https://chat.aomi.dev/v1/apps/world/mcp")).toBe("world");
    expect(consentApp("https://chat.aomi.dev/v1/agent/mcp")).toBeUndefined();
    expect(
      consentApp("https://chat.aomi.dev/v1/apps/World/mcp"),
    ).toBeUndefined();
    expect(consentApp(null)).toBeUndefined();
  });

  it("locks an app's client to its wallet under the link's ceiling, then writes the pairs after the grant", async () => {
    const saved = mocks.search;
    mocks.search = saved
      .replace("%2Fv1%2Fagent%2Fmcp", "%2Fv1%2Fapps%2Fworld%2Fmcp")
      .concat("&mode=ask");
    const writes: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT")
          writes.push({ url, body: JSON.parse(String(init.body)) });
        if (url.includes("/v1/account/agent-wallets"))
          return Response.json({ pause_all: false, version: 1, wallets: [] });
        if (url.includes("/oauth2/consent"))
          return Response.json({ redirect: true, url: "https://codex.test" });
        return Response.json({ wallets: [] });
      }),
    );
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    try {
      render(<ConsentSheet name="Codex" />);
      expect(
        screen.getByText("Codex will use World with your Aomi account."),
      ).toBeInTheDocument();
      expect(await screen.findByText("Trade from")).toBeInTheDocument();
      expect(
        screen.getByText("used by World · created now if new"),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Instant" })).toBeDisabled();
      expect(
        screen.getByText(/This link requires approval for every trade/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
      await waitFor(() =>
        expect(writes).toEqual([
          {
            url: expect.stringContaining(
              "/v1/account/connections/oauth%3Acodex-mcp/wallets",
            ),
            body: {
              wallets: [],
              application: "world",
              app_wallet_instant: false,
              ceiling: "ask",
            },
          },
        ]),
      );
    } finally {
      mocks.search = saved;
    }
  });

  it("never shows success when the wallet settings fail to save, and retries the same write", async () => {
    const saved = mocks.search;
    mocks.search = saved.replace(
      "%2Fv1%2Fagent%2Fmcp",
      "%2Fv1%2Fapps%2Fworld%2Fmcp",
    );
    let puts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT")
          return ++puts === 1
            ? Response.json({ error: "internal" }, { status: 500 })
            : Response.json({ wallets: [] });
        if (url.includes("/v1/account/agent-wallets"))
          return Response.json({ pause_all: false, version: 1, wallets: [] });
        return Response.json({ redirect: true, url: "https://codex.test" });
      }),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    try {
      render(<ConsentSheet name="Codex" />);
      await screen.findByText("Trade from");
      fireEvent.click(screen.getByRole("button", { name: "Allow" }));
      expect(
        await screen.findByText(
          "Codex is connected, but its wallet settings didn’t save. Set them in Settings → Connections.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          "Change which wallets it may use in Settings → Connections.",
        ),
      ).toBeNull();
      expect(assign).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByRole("heading", { name: "Codex is connected" }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(
          "Change which wallets it may use in Settings → Connections.",
        ),
      ).toBeInTheDocument();
      expect(puts).toBe(2);
    } finally {
      mocks.search = saved;
    }
  });
});
