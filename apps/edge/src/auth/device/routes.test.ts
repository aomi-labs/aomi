// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  issueLinkIntent: vi.fn(),
  issueLinkGrant: vi.fn(),
  exchangeGrant: vi.fn(),
  exchangeProvider: vi.fn(),
}));
let capture: ReturnType<typeof vi.spyOn>;

vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  authServer: () => ({}),
  getBetterAuthSession: mocks.getSession,
}));

vi.mock("./grants", () => ({
  issueDeviceAuthLinkIntent: mocks.issueLinkIntent,
  issueDeviceAuthLinkGrant: mocks.issueLinkGrant,
  exchangeDeviceAuthGrant: mocks.exchangeGrant,
}));

vi.mock("@aomi-labs/account/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/account")>()),
  exchangeProviderForExistingSession: mocks.exchangeProvider,
  getOrCreateAomiUserForBetterAuthSession: async () => ({ id: "account" }),
}));

import { handleRequest } from "../../handler";

const env = { PORTAL_HOSTS: "portal.aomi.dev", PORTAL_UPSTREAM_ORIGIN: "https://pages.example" };
const route = (path: string) => (request: Request) => handleRequest(request, env, async () => new Response(null, { status: 599 }));
const exchange = route("exchange");
const linkGrant = route("link-grant");
const linkIntent = route("link-intent");

const VALID_STATE = "state_1234567890abcdef";
const VALID_CHALLENGE = "challenge_1234567890abcdefghijklmnop";
const REDIRECT_URI = "http://127.0.0.1:4173/callback";

function post(path: string, body: unknown): Request {
  return new Request(`https://portal.aomi.dev${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://portal.aomi.dev",
      cookie: "better-auth.session_token=session",
    },
    body: JSON.stringify(body),
  });
}

describe("device-auth route error ownership", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    capture = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getSession.mockResolvedValue({
      user: { id: "better-auth-user" },
      session: {
        token: "session-token",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mocks.issueLinkIntent.mockReturnValue({
      id: "intent",
      state: VALID_STATE,
      redirectUri: REDIRECT_URI,
      provider: "para",
    });
    mocks.issueLinkGrant.mockReturnValue({
      code: "code",
      state: VALID_STATE,
      redirectUri: REDIRECT_URI,
      provider: "para",
    });
  });

  it("reports a session lookup failure without its message", async () => {
    const failure = new Error("private database detail");
    mocks.getSession.mockRejectedValue(failure);

    const response = await linkIntent(
      post("/v1/account/device-auth/link-intent", {
        state: VALID_STATE,
        codeChallenge: VALID_CHALLENGE,
        redirectUri: REDIRECT_URI,
        provider: "para",
      }),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "device_auth_failed",
    });
    expect(capture).toHaveBeenCalledWith(
      "edge.auth.failure",
      expect.objectContaining({ status: 500, error: `Error: ${failure.message}` }),
    );
  });

  it("keeps link-intent validation errors public and storage failures private", async () => {
    mocks.issueLinkIntent.mockImplementationOnce(() => {
      throw new Error("invalid_redirect_uri");
    });
    const requestBody = {
      state: VALID_STATE,
      codeChallenge: VALID_CHALLENGE,
      redirectUri: REDIRECT_URI,
      provider: "para",
    };

    const expected = await linkIntent(
      post("/v1/account/device-auth/link-intent", requestBody),
    );
    expect(expected.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();

    const failure = new Error("private storage detail");
    mocks.issueLinkIntent.mockImplementationOnce(() => {
      throw failure;
    });
    const unexpected = await linkIntent(
      post("/v1/account/device-auth/link-intent", requestBody),
    );
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      error: "device_auth_failed",
    });
    expect(capture).toHaveBeenCalledWith(
      "edge.auth.failure",
      expect.objectContaining({ status: 500, error: `Error: ${failure.message}` }),
    );
  });

  it("keeps link-grant validation errors public and crypto failures private", async () => {
    const requestBody = {
      linkIntent: "intent",
      state: VALID_STATE,
      redirectUri: REDIRECT_URI,
      provider: "para",
      credential: { provider: "para" },
    };
    mocks.issueLinkGrant.mockImplementationOnce(() => {
      throw new Error("invalid_or_expired_link_intent");
    });

    const expected = await linkGrant(
      post("/v1/account/device-auth/link-grant", requestBody),
    );
    expect(expected.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();

    const failure = new Error("private crypto detail");
    mocks.issueLinkGrant.mockImplementationOnce(() => {
      throw failure;
    });
    const unexpected = await linkGrant(
      post("/v1/account/device-auth/link-grant", requestBody),
    );
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      error: "device_auth_failed",
    });
    expect(capture).toHaveBeenCalledWith(
      "edge.auth.failure",
      expect.objectContaining({ status: 500, error: `Error: ${failure.message}` }),
    );
  });

  it("keeps provider token errors public and provider configuration private", async () => {
    const requestBody = {
      code: "code",
      state: VALID_STATE,
      codeVerifier: "verifier",
      redirectUri: REDIRECT_URI,
    };
    mocks.exchangeGrant.mockReturnValue({
      purpose: "link",
      betterAuthUserId: "better-auth-user",
      credential: { provider: "para" },
      provider: "para",
    });
    mocks.exchangeProvider.mockRejectedValueOnce(
      new Error("provider_token_expired"),
    );

    const expected = await exchange(
      post("/v1/account/device-auth/exchange", requestBody),
    );
    expect(expected.status).toBe(401);
    await expect(expected.json()).resolves.toEqual({
      error: "provider_token_expired",
    });
    expect(capture).not.toHaveBeenCalled();

    const failure = new Error("private provider configuration");
    mocks.exchangeProvider.mockRejectedValueOnce(failure);
    const unexpected = await exchange(
      post("/v1/account/device-auth/exchange", requestBody),
    );
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      error: "device_auth_failed",
    });
    expect(capture).toHaveBeenCalledWith(
      "edge.auth.failure",
      expect.objectContaining({ status: 500, error: `Error: ${failure.message}` }),
    );
  });

  it("returns a safe JSON failure when durable grant consumption fails", async () => {
    const failure = new Error("private postgres connection detail");
    mocks.exchangeGrant.mockRejectedValue(failure);

    const response = await exchange(
      post("/v1/account/device-auth/exchange", {
        code: "code",
        state: VALID_STATE,
        codeVerifier: "verifier",
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "device_auth_failed",
    });
    expect(capture).toHaveBeenCalledWith(
      "edge.auth.failure",
      expect.objectContaining({
        operation: "device_auth.exchange",
        error: "Error: private postgres connection detail",
      }),
    );
  });
});
