import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { GeneralSettings } from "@/account/general-settings";

type FetchCall = {
  input: string | URL | Request;
  init?: RequestInit;
};

const widgetMock = vi.hoisted(() => ({
  accountId: "",
  getAccountCredential: vi.fn(async () => null),
  connect: vi.fn(async () => undefined),
  openAccountUI: vi.fn(async () => undefined),
}));
const runtimeMock = vi.hoisted(() => ({
  creditsGet: vi.fn(),
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  getChainInfo: () => ({ ticker: "ETH" }),
  useAomiRuntime: () => ({
    account: {
      credits: {
        get: runtimeMock.creditsGet,
      },
    },
  }),
}));

vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({
    accountUser: { id: widgetMock.accountId, displayName: "Aron" },
    accountWallets: [
      {
        id: "wallet-rabby",
        family: "evm",
        address: "0xabc",
        label: "Rabby",
        kind: "external",
      },
      {
        id: "wallet-metamask",
        family: "evm",
        address: "0xdef",
        label: "MetaMask",
        kind: "external",
      },
    ],
    accounts: [
      {
        id: "rabby",
        family: "evm",
        address: "0xabc",
        walletName: "Rabby",
        active: true,
        linked: true,
      },
    ],
    wallets: [
      {
        key: "evm:0xabc",
        family: "evm",
        address: "0xabc",
        kind: "external",
        walletName: "Rabby",
        label: "Rabby",
        connectionId: "rabby",
        linkedWalletId: "wallet-rabby",
        state: "ready",
        connected: true,
        linked: true,
        operating: true,
        actions: [],
      },
      {
        key: "evm:0xdef",
        family: "evm",
        address: "0xdef",
        kind: "external",
        label: "MetaMask",
        linkedWalletId: "wallet-metamask",
        state: "offline",
        reason: "disconnected",
        connected: false,
        linked: true,
        operating: false,
        actions: [],
      },
    ],
    canConnect: true,
    canOpenAccountUI: true,
    connect: widgetMock.connect,
    getAccountCredential: widgetMock.getAccountCredential,
    identity: {
      address: "0xabc",
      authMethod: "wallet",
      chainId: 1,
      isConnected: true,
      status: "connected",
    },
    openAccountUI: widgetMock.openAccountUI,
  }),
}));

vi.mock("@/account/use-account-acl", () => ({
  useAccountAcl: () => ({
    status: "ready",
    wallets: [],
    delegatedAccounts: [],
    refresh: vi.fn(),
    commitMode: vi.fn(),
    revokeDelegation: vi.fn(),
    stopAllAuto: vi.fn(),
    renewDelegation: vi.fn(),
    blockedReason: () => null,
  }),
}));

function requestUrl(input: FetchCall["input"]): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString(), "https://portal.test");
}

function requestPaths(calls: FetchCall[]): string[] {
  return calls.map((call) => requestUrl(call.input).pathname);
}

const ACCOUNT_OVERVIEW = {
  user: {
    apps: ["default"],
    created_at: 1_700_000_000,
    public_key: "0xabc",
    status: "active",
    tier: "pro",
    updated_at: 1_700_000_100,
    user_id: "acct-user-1",
    verified_email: "alice@example.com",
  },
};

function installFetchRecorder() {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      const url = requestUrl(input);
      const method =
        input instanceof Request ? input.method : (init?.method ?? "GET");

      if (url.pathname === "/v1/account/credits") {
        const position = await runtimeMock.creditsGet();
        return Response.json({
          period_utc_month: position.period_utc_month,
          included_limit: position.included?.limit_microusd,
          included_used: position.included?.used_microusd,
          included_remaining: position.included?.remaining_microusd,
          balance: position.bank.balance_microusd,
          outstanding_debt: position.bank.outstanding_debt_microusd,
          records: position.entries,
          next_before_id: position.next_before_id,
        });
      }
      if (url.pathname === "/api/account" && method === "GET") {
        return Response.json(ACCOUNT_OVERVIEW);
      }

      return new Response(`Unexpected request: ${method} ${url.pathname}`, {
        status: 500,
      });
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// NOTE (settings redesign): the Apps/Bots/App Keys/Secrets/BYOK tabs were
// removed with the three-tab settings redesign. Account is now wired to real
// routes and covered by features/account/account-acl.test.tsx; Usage still
// renders from local fixtures (see docs/SETTINGS-REDESIGN-GAPS.md) — add its
// route-caller test here when /api/account/usage binds.
let accountSequence = 0;
describe("settings route callers", () => {
  beforeEach(() => {
    widgetMock.accountId = `settings-test-${++accountSequence}`;
    widgetMock.getAccountCredential.mockClear();
    runtimeMock.creditsGet.mockReset();
    runtimeMock.creditsGet.mockResolvedValue({
      period_utc_month: "2026-07",
      included: {
        limit_microusd: 100 * 10_000,
        used_microusd: 12 * 10_000,
        remaining_microusd: 88 * 10_000,
      },
      bank: { balance_microusd: 0, outstanding_debt_microusd: 0 },
      entries: [],
      next_before_id: null,
    });
    localStorage.clear();
    // jsdom has no matchMedia; useSettings consults it for the "auto" theme.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the general account overview from the account route", async () => {
    const { calls, fetchMock } = installFetchRecorder();

    render(<GeneralSettings />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestPaths(calls)).toContain("/api/account");
    expect(requestPaths(calls)).not.toContain("/api/settings/account");
  });

  it("renders the summary card with plan and allowance from the account route", async () => {
    installFetchRecorder();

    render(<GeneralSettings />);

    await waitFor(() => expect(screen.getByText("Aron")).toBeTruthy());
    expect(
      screen.getByText("2 linked wallets · 1 not connected on this device"),
    ).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText(/88 remaining/)).toBeTruthy();
    expect(screen.getByText(/12 \/ 100 used/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View usage" })).toBeTruthy();
    expect(screen.queryByText(/Usage shows spend/)).toBeNull();
  });

  it("keeps General settings usable when credits omit the allowance", async () => {
    runtimeMock.creditsGet.mockResolvedValue({
      period_utc_month: "2026-07",
      bank: { balance_microusd: 0, outstanding_debt_microusd: 0 },
      entries: [],
      next_before_id: null,
    });
    installFetchRecorder();

    render(<GeneralSettings />);

    expect(await screen.findByText("Aron")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.queryByText(/remaining/)).toBeNull();
    expect(screen.getByRole("button", { name: "View usage" })).toBeTruthy();
  });
});
