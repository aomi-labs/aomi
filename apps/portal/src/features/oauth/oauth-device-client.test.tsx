import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: "user_code=aomi-1234",
  name: "Aomi CLI · laptop",
  saves: [] as number[],
}));

vi.mock("@/lib/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import { DeviceSheet } from "./oauth-device-client";

const pending = {
  user_code: "AOMI-1234",
  status: "pending",
  client_id: "aomi-cli",
  scope: "agent:read agent:write account:credentials:write offline_access",
  resource: "https://portal.example/v1",
};
const trading = {
  id: "g-trading",
  name: "Trading",
  paused: false,
  archived_at: null,
  app: null,
  last_used_at: null,
  created_at: 1,
  addresses: [],
  connections: [],
};
const paths = () => vi.mocked(fetch).mock.calls.map(([input]) => String(input));

describe("device code sheet", () => {
  beforeEach(() => {
    mocks.search = "user_code=aomi-1234";
    mocks.name = "Aomi CLI · laptop";
    mocks.saves = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/auth/device?")) return Response.json(pending);
        if (url.startsWith("/api/auth/oauth2/public-client?"))
          return Response.json({ client_name: mocks.name });
        if (
          url.includes("/v1/account/connections/") &&
          init?.method === "PUT"
        ) {
          const status = mocks.saves.shift() ?? 200;
          return Response.json({ wallets: [] }, { status });
        }
        if (url.includes("/v1/account/agent-wallets"))
          return Response.json({ pause_all: false, wallets: [trading] });
        if (url.includes("/v1/account/wallets"))
          return Response.json({ wallets: [] });
        return Response.json({ success: true });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reads the code once, shows it, and approves on Connect", async () => {
    render(<DeviceSheet />);
    expect(
      await screen.findByRole("heading", { name: "Connect your terminal?" }),
    ).toBeTruthy();
    expect(screen.getByText("AOMI-1234")).toHaveAttribute("data-device-code");
    // Every agent wallet starts at Ask in terminal.
    expect(
      await screen.findByRole("combobox", { name: "Trading: Ask in terminal" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByRole("heading", { name: "Terminal connected" }),
    ).toBeTruthy();
    // Better Auth allows few reads per code: one read, then the decision.
    expect(paths().filter((path) => path.startsWith("/api/auth/"))).toEqual([
      "/api/auth/device?user_code=AOMI-1234",
      "/api/auth/oauth2/public-client?client_id=aomi-cli",
      "/api/auth/device/approve",
    ]);
    // Then the terminal's lanes, once the login went through.
    expect(paths().at(-1)).toEqual(
      expect.stringContaining(
        "/v1/account/connections/oauth%3Aaomi-cli/wallets",
      ),
    );
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ wallets: [{ id: "g-trading", lane: "here" }] }),
    });
  });

  it("names the CLI and what it may do", async () => {
    render(<DeviceSheet />);
    expect(
      await screen.findByText(
        "Aomi CLI · laptop can use your Aomi account to:",
      ),
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "What it can do" });
    expect(list.textContent).toContain("Propose trades");
    expect(list.textContent).toContain("Save and remove app keys");
    expect(screen.queryByText(/isn’t the Aomi CLI/)).toBeNull();
  });

  it("does not present another client as your terminal", async () => {
    mocks.name = "Trade Helper";
    render(<DeviceSheet />);
    expect(
      await screen.findByRole("heading", { name: "Allow Trade Helper?" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /terminal/ })).toBeNull();
    expect(screen.getByText(/This isn’t the Aomi CLI/)).toBeTruthy();
    expect(
      screen.getByText("Trade Helper can use your Aomi account to:"),
    ).toBeTruthy();
  });

  it("keeps the picked wallet settings and retries when they didn't save", async () => {
    mocks.saves = [500];
    render(<DeviceSheet />);
    await screen.findByRole("combobox", { name: "Trading: Ask in terminal" });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(
      await screen.findByRole("heading", {
        name: "Your terminal is connected",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/didn’t save, so it keeps its current/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Terminal connected" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Terminal connected" }),
    ).toBeTruthy();
    const puts = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[1]?.[1]?.body).toBe(
      JSON.stringify({ wallets: [{ id: "g-trading", lane: "here" }] }),
    );
  });

  it("denies when the code doesn't match", async () => {
    render(<DeviceSheet />);
    fireEvent.click(
      await screen.findByRole("button", { name: "It doesn’t match" }),
    );
    await waitFor(() => expect(paths().at(-1)).toBe("/api/auth/device/deny"));
    expect(
      await screen.findByRole("heading", { name: "Not connected" }),
    ).toBeTruthy();
  });

  it("says a used or expired code doesn't work", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...pending, status: "approved" }),
    );
    render(<DeviceSheet />);
    expect(
      await screen.findByRole("heading", { name: "This code doesn’t work" }),
    ).toBeTruthy();
  });
});
