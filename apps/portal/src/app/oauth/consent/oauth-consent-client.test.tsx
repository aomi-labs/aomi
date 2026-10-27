import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEARCH =
  "client_id=codex-mcp&scope=agent%3Aread+mcp%3Aagent&resource=https%3A%2F%2Fchat-staging.aomi.dev%2Fv1%2Fagent%2Fmcp&exp=4102444800&sig=signed-request";
const mocks = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock("@aomi-labs/widget/host-composition", async (original) => ({
  ...(await original<typeof import("@aomi-labs/widget/host-composition")>()),
  useAomiWalletKit: () => ({}),
}));

import {
  ConsentSheet,
  consentApp,
  oauthConsentRedirect,
} from "./oauth-consent-client";

/** Allow, once the wallets have loaded. */
async function allowButton() {
  const allow = screen.getByRole("button", { name: "Allow" });
  await waitFor(() => expect(allow).toBeEnabled());
  return allow;
}

describe("OAuthConsentClient", () => {
  beforeEach(() => {
    mocks.search = SEARCH;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({}, { status: 400 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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

    // Allow waits for the wallet list (here it fails, so nothing is written).
    fireEvent.click(await allowButton());

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

  it("locks an app's client to its wallet on an Ask-only link, then writes the pairs after the grant", async () => {
    mocks.search = SEARCH.replace(
      "%2Fv1%2Fagent%2Fmcp",
      "%2Fv1%2Fapps%2Fworld%2Fmcp",
    ).concat("&mode=ask");
    const writes: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT")
          writes.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith("/v1/account/connections"))
          return Response.json({ connections: [] });
        if (url.includes("/v1/account/agent-wallets"))
          return Response.json({ pause_all: false, wallets: [] });
        if (url.includes("/oauth2/consent"))
          return Response.json({ redirect: true, url: "https://codex.test" });
        return Response.json({ wallets: [] });
      }),
    );
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    render(<ConsentSheet name="Codex" />);
    expect(
      screen.getByText("Codex will use World with your Aomi account."),
    ).toBeInTheDocument();
    expect(await screen.findByText("Your wallets")).toBeInTheDocument();
    expect(screen.getByText("Codex sees all")).toBeInTheDocument();
    // The app's wallet, made on approval, is locked at Ask on Aomi.
    expect(screen.getByText(/Created on approval/)).toBeInTheDocument();
    expect(screen.getByText("Ask on Aomi")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByText(/This link asks you to approve every trade on Aomi/),
    ).toBeInTheDocument();
    fireEvent.click(await allowButton());
    await waitFor(() =>
      expect(writes).toEqual([
        {
          url: expect.stringContaining(
            "/v1/account/connections/oauth%3Acodex-mcp/wallets",
          ),
          body: {
            wallets: [],
            application: "world",
            new_app_wallet: { lane: "portal" },
            ask_only: true,
          },
        },
      ]),
    );
  });

  it("consenting again keeps the client's access and writes nothing when it is unchanged", async () => {
    const writes: unknown[] = [];
    const wallet = {
      id: "6f0c1f2e-0000-4000-8000-000000000001",
      name: "Trading",
      paused: false,
      archived_at: null,
      app: null,
      last_used_at: null,
      created_at: 1,
      addresses: [],
      connections: [
        { key: "oauth:codex-mcp", label: "Codex", lane: "instant" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT") writes.push(JSON.parse(String(init.body)));
        if (url.endsWith("/v1/account/connections"))
          return Response.json({ connections: [] });
        if (url.includes("/v1/account/agent-wallets"))
          return Response.json({ pause_all: false, wallets: [wallet] });
        if (url.includes("/v1/account/wallets"))
          return Response.json({ wallets: [] });
        return Response.json({ redirect: true, url: "https://codex.test" });
      }),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ConsentSheet name="Codex" />);
    expect(await screen.findByText("Trading")).toBeInTheDocument();
    // Its lane on the wallet pre-fills from what it has.
    expect(
      screen.getByRole("combobox", { name: "Trading: Instant" }),
    ).toBeInTheDocument();
    fireEvent.click(await allowButton());
    expect(
      await screen.findByRole("heading", { name: "Codex is connected" }),
    ).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("never shows success when the wallet settings fail to save, and retries the same write", async () => {
    mocks.search = SEARCH.replace(
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
        if (url.endsWith("/v1/account/connections"))
          return Response.json({ connections: [] });
        if (url.includes("/v1/account/agent-wallets"))
          return Response.json({ pause_all: false, wallets: [] });
        if (url.includes("/v1/account/wallets"))
          return Response.json({ wallets: [] });
        return Response.json({ redirect: true, url: "https://codex.test" });
      }),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<ConsentSheet name="Codex" />);
    await screen.findByText("Your wallets");
    fireEvent.click(await allowButton());
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
  });
});

describe("OAuth consent response", () => {
  it("accepts Better Auth's canonical redirect response", () => {
    expect(
      oauthConsentRedirect({
        redirect: true,
        url: "https://partner.example/oauth/callback?code=code-1",
      }),
    ).toBe("https://partner.example/oauth/callback?code=code-1");
  });

  it("rejects legacy redirect field aliases", () => {
    expect(
      oauthConsentRedirect({ redirect_uri: "https://example.com/a" }),
    ).toBe(null);
    expect(oauthConsentRedirect({ redirectURI: "https://example.com/b" })).toBe(
      null,
    );
  });
});
