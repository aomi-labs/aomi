import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ search: "user_code=aomi-1234" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import { DeviceSheet } from "./oauth-device-client";

const pending = {
  user_code: "AOMI-1234",
  status: "pending",
  client_id: "aomi-cli",
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/auth/device?")) return Response.json(pending);
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
