// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  issueGrant: vi.fn(),
  issueLinkIntent: vi.fn(),
  issueLinkGrant: vi.fn(),
  exchangeGrant: vi.fn(),
  exchangeProvider: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@portal/server/account/session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@portal/server/account/session")>();
  return { ...actual, getBetterAuthSession: mocks.getSession };
});

vi.mock("@portal/server/device-auth/grants", () => ({
  issueDeviceAuthGrant: mocks.issueGrant,
  issueDeviceAuthLinkIntent: mocks.issueLinkIntent,
  issueDeviceAuthLinkGrant: mocks.issueLinkGrant,
  exchangeDeviceAuthGrant: mocks.exchangeGrant,
}));

vi.mock("@aomi-labs/account/account", () => ({
  exchangeProviderForExistingSession: mocks.exchangeProvider,
}));

vi.mock("@portal/server/bff/failures", () => ({
  portalFailures: {
    handle: (input: {
      source: "expected" | "local";
      error: unknown;
      response: { status: number; error: string };
      context: Record<string, unknown>;
    }) => {
      if (input.source === "local") {
        mocks.capture(input.error, {
          ...input.context,
          status: input.response.status,
        });
      }
      return {
        response: Response.json(
          { error: input.response.error },
          { status: input.response.status },
        ),
      };
    },
  },
}));

import { POST as exchange } from "./exchange/route";
import { POST as grant } from "./grant/route";
import { POST as linkGrant } from "./link-grant/route";
import { POST as linkIntent } from "./link-intent/route";

const VALID_STATE = "state_1234567890abcdef";
const VALID_CHALLENGE = "challenge_1234567890abcdefghijklmnop";
const REDIRECT_URI = "http://127.0.0.1:4173/callback";

function post(path: string, body: unknown): Request {
  return new Request(`https://portal.aomi.dev${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("device-auth route error ownership", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getSession.mockResolvedValue({
      user: { id: "better-auth-user" },
      session: {
        token: "session-token",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mocks.issueGrant.mockReturnValue({
      code: "code",
      state: VALID_STATE,
      redirectUri: REDIRECT_URI,
      expiresAt: new Date(Date.now() + 60_000),
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
    mocks.exchangeGrant.mockReturnValue({
      purpose: "login",
      sessionToken: "session-token",
      expiresAt: new Date(Date.now() + 60_000),
      betterAuthUserId: "better-auth-user",
      provider: "para",
    });
  });

  it("keeps grant validation failures as ignored 400 responses", async () => {
    mocks.issueGrant.mockImplementation(() => {
      throw new Error("invalid_state");
    });

    const response = await grant(
      post("/v1/account/device-auth/grant", {
        state: VALID_STATE,
        codeChallenge: VALID_CHALLENGE,
        redirectUri: REDIRECT_URI,
        provider: "para",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_state" });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("requires a provider when issuing an ordinary grant", async () => {
    const response = await grant(
      post("/v1/account/device-auth/grant", {
        state: VALID_STATE,
        codeChallenge: VALID_CHALLENGE,
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it("leaves session failures to the framework error boundary", async () => {
    const failure = new Error("private database detail");
    mocks.getSession.mockRejectedValue(failure);

    await expect(
      grant(
        post("/v1/account/device-auth/grant", {
          state: VALID_STATE,
          codeChallenge: VALID_CHALLENGE,
          redirectUri: REDIRECT_URI,
        }),
      ),
    ).rejects.toBe(failure);
    expect(mocks.capture).not.toHaveBeenCalled();
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
    expect(mocks.capture).not.toHaveBeenCalled();

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
    expect(mocks.capture).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ status: 500 }),
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
    expect(mocks.capture).not.toHaveBeenCalled();

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
    expect(mocks.capture).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ status: 500 }),
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
    expect(expected.status).toBe(400);
    await expect(expected.json()).resolves.toEqual({
      error: "provider_token_expired",
    });
    expect(mocks.capture).not.toHaveBeenCalled();

    const failure = new Error("private provider configuration");
    mocks.exchangeProvider.mockRejectedValueOnce(failure);
    const unexpected = await exchange(
      post("/v1/account/device-auth/exchange", requestBody),
    );
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({
      error: "provider_exchange_failed",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ status: 500 }),
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
    expect(mocks.capture).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        operation: "device_auth_grant_consume",
        status: 500,
      }),
    );
  });
});
