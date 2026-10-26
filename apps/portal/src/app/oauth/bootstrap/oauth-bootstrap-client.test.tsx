import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthBootstrapClient } from "./oauth-bootstrap-client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("origin=https://fuzzer.example"),
}));
const opener = { postMessage: vi.fn() };
const accounts = {
  widget: { id: "account-a", name: "Cecilia" },
  portal: { id: "account-b", name: "Account B" },
  sessionVersion: "a".repeat(64),
};
const relay = {
  type: "aomi.oauth.bootstrap.ticket",
  origin: "https://fuzzer.example",
  ticket: "aomi_obt_test",
  state: "state-state-state",
  clientId: "fuzzer",
  resource: "https://portal.example/v1/account",
  scopes: ["account:credits:read"],
};
const fetchMock = vi.fn();
async function open() {
  render(<OAuthBootstrapClient />);
  await waitFor(() => expect(opener.postMessage).toHaveBeenCalled());
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: opener as unknown as Window,
        origin: relay.origin,
        data: relay,
      }),
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("opener", opener);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/preview") ? Response.json(accounts) : new Promise(() => {}),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("portal account choice", () => {
  it.each([
    ["Use Cecilia on Aomi", "widget"],
    ["Continue as Account B", "portal"],
  ])("submits %s as an explicit choice", async (label, choice) => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: label }));
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/redeem"),
    );
    expect(JSON.parse(call![1].body)).toMatchObject({
      account: choice,
      sessionVersion: accounts.sessionVersion,
      confirmed: true,
    });
    expect(
      screen.getByText(/Existing campaigns remain with their original account/),
    ).toBeTruthy();
  });
  it("offers only the widget account when signed out", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...accounts, portal: null, sessionVersion: null }),
    );
    await open();
    expect(
      await screen.findByRole("button", { name: "Use Cecilia on Aomi" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue as Account B" }),
    ).toBeNull();
  });
  it("automatically continues an already matching canonical account once", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/preview")
        ? Response.json({ ...accounts, portal: accounts.widget })
        : new Promise(() => {}),
    );
    await open();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/redeem")),
      ).toHaveLength(1),
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/redeem"),
    );
    expect(JSON.parse(call![1].body)).toMatchObject({
      account: "portal",
      sessionVersion: accounts.sessionVersion,
    });
    expect(
      screen.queryByText("Which account would you like to use?"),
    ).toBeNull();
  });
  it("never redeems on load or cancel", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    await open();
    await screen.findByRole("button", { name: "Continue as Account B" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires restarting when the portal session changes", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/preview")
        ? Response.json(accounts)
        : Response.json({ message: "portal_session_changed" }, { status: 409 }),
    );
    await open();
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue as Account B" }),
    );
    await screen.findByText(/Your portal account changed/);
    expect(
      screen.queryByRole("button", { name: "Continue as Account B" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Checking accounts…" }),
    ).toBeDisabled();
  });
  it("ignores relay messages from another origin or window", async () => {
    render(<OAuthBootstrapClient />);
    await waitFor(() => expect(opener.postMessage).toHaveBeenCalled());
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: opener as unknown as Window,
          origin: "https://evil.example",
          data: relay,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: relay.origin,
          data: relay,
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
