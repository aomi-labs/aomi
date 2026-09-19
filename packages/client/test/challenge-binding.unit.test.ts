/**
 * Never blind-sign an authentication message (agentic-somm#322 review, Q3).
 *
 * The SIWE/SIWS message is built entirely from the server-supplied challenge.
 * Before this guard, the adapter signed whatever the nonce endpoint returned;
 * a misrouted or compromised upstream could bind the user's signature to an
 * attacker's domain, a stale nonce, or an expired session. The Portal always
 * echoes the caller's exact Origin (domain = host, uri = origin), so binding
 * is checkable client-side with zero configuration.
 *
 * Pins: origin/host mismatch, missing nonce, and expired/parseless expiry all
 * throw BEFORE the wallet is asked to sign; a faithful challenge signs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSiweAccountAuthAdapter,
  AccountChallengeBindingError,
} from "../src/widget-session";

const PAGE_ORIGIN = "https://agentic.somm.finance";

function challengeResponse(overrides: Record<string, unknown> = {}) {
  return {
    nonce: "abcdefgh12345678",
    domain: "agentic.somm.finance",
    uri: PAGE_ORIGIN,
    issued_at: new Date().toISOString(),
    expiration_time: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function fetchReturning(challenge: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/nonce")) {
      return new Response(JSON.stringify(challenge), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ access_token: "wst", expires_at: 0 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

const signer = {
  address: "0x00000000000000000000000000000000000000a1",
  chainId: 1,
  signMessage: vi.fn(async () => "0xsigned"),
};

function adapter() {
  return createSiweAccountAuthAdapter({ getSigner: async () => signer });
}

beforeEach(() => {
  signer.signMessage.mockClear();
  vi.stubGlobal("window", { location: { origin: PAGE_ORIGIN } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("widget challenge binding", () => {
  it("signs a challenge bound to this page's origin", async () => {
    await adapter().exchange({
      baseUrl: "",
      fetch: fetchReturning(challengeResponse()),
    });
    expect(signer.signMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["foreign uri", { uri: "https://evil.example" }],
    ["foreign domain", { domain: "evil.example" }],
    ["missing nonce", { nonce: "  " }],
    ["unparseable issued time", { issued_at: "not-a-date" }],
    ["future issued time", { issued_at: new Date(Date.now() + 120_000).toISOString() }],
    ["expired", { expiration_time: new Date(Date.now() - 1_000).toISOString() }],
    ["unparseable expiry", { expiration_time: "not-a-date" }],
    [
      "unbounded lifetime",
      { expiration_time: new Date(Date.now() + 11 * 60_000).toISOString() },
    ],
  ])("refuses to sign on %s", async (_label, overrides) => {
    await expect(
      adapter().exchange({
        baseUrl: "",
        fetch: fetchReturning(challengeResponse(overrides)),
      }),
    ).rejects.toBeInstanceOf(AccountChallengeBindingError);
    // The wallet prompt must never have appeared.
    expect(signer.signMessage).not.toHaveBeenCalled();
  });

  it("skips the origin checks (not nonce/expiry) outside a browser", async () => {
    // jsdom always provides a window; simulate a non-browser runtime.
    vi.stubGlobal("window", undefined);
    await adapter().exchange({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchReturning(challengeResponse({ domain: "chat.aomi.dev", uri: "https://chat.aomi.dev" })),
    });
    expect(signer.signMessage).toHaveBeenCalledTimes(1);

    signer.signMessage.mockClear();
    await expect(
      adapter().exchange({
        baseUrl: "https://chat.aomi.dev",
        fetch: fetchReturning(challengeResponse({ nonce: "" })),
      }),
    ).rejects.toBeInstanceOf(AccountChallengeBindingError);
    expect(signer.signMessage).not.toHaveBeenCalled();
  });
});
