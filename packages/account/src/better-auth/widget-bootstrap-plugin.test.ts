// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../widget-auth/oauth-bootstrap";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  consume: vi.fn(),
  binding: vi.fn(),
  user: vi.fn(),
  identity: vi.fn(),
  owner: vi.fn(),
  client: vi.fn(),
  session: vi.fn(),
  cookie: vi.fn(),
  link: vi.fn(),
}));
vi.mock("better-auth/api", () => ({
  APIError: class extends Error {
    constructor(_status: string, body: { message: string }) {
      super(body.message);
    }
  },
  createAuthEndpoint:
    (
      _path: string,
      options: { body: { parse: (value: unknown) => unknown } },
      handler: (ctx: unknown) => unknown,
    ) =>
    async (ctx: { body: unknown }) =>
      handler({ ...ctx, body: options.body.parse(ctx.body) }),
  getSessionFromCtx: mocks.session,
}));
vi.mock("better-auth/cookies", () => ({ setSessionCookie: mocks.cookie }));
vi.mock("../db/queries", () => ({
  findAomiUserById: mocks.user,
  findAuthIdentityById: mocks.identity,
  findSignalOwner: mocks.owner,
}));
vi.mock("../service/account-service", () => ({
  linkProviderIdentity: mocks.link,
}));
vi.mock("../widget-auth/session", () => ({
  validateWidgetSessionBinding: mocks.binding,
}));
vi.mock("./managed-clients", () => ({ readManagedOAuthClient: mocks.client }));
vi.mock("./oauth-policy", () => ({
  aomiOAuthResourcePolicy: () => ({
    kind: "accountRest",
    allowedScopes: ["account:credits:read"],
    grantableScopes: ["account:credits:read", "offline_access"],
  }),
}));
vi.mock("../widget-auth/oauth-bootstrap", async (original) => ({
  ...(await original<typeof import("../widget-auth/oauth-bootstrap")>()),
  readWidgetOAuthBootstrapTicket: mocks.read,
  consumeWidgetOAuthBootstrapTicket: mocks.consume,
}));
import { aomiWidgetOAuthBootstrapPlugin } from "./widget-bootstrap-plugin";

const ticket = {
  kind: "widget_oauth_bootstrap",
  userId: "cecilia",
  origin: "https://fuzzer.example",
  widgetSessionIdentifier: "session-row",
  authMethod: "siwe",
  clientId: "fuzzer",
  redirectUri: "https://fuzzer.example/callback",
  codeChallenge: "a".repeat(43),
  resource: "https://portal.example/v1/account",
  scopes: ["account:credits:read", "offline_access"],
  stateDigest: sha256Hex("state-state-state"),
  channelNonceDigest: sha256Hex("channel-channel-channel"),
};
const body = {
  ticket: "aomi_obt_example",
  origin: ticket.origin,
  state: "state-state-state",
  channelNonce: "channel-channel-channel",
};
function context(extra = {}) {
  return {
    body: {
      ...body,
      confirmed: true,
      account: "widget",
      sessionVersion: null,
      ...extra,
    },
    json: (value: unknown) => value,
    setHeader: vi.fn(),
    context: {
      adapter: { findOne: vi.fn().mockResolvedValue({ id: "ba-cecilia" }) },
      internalAdapter: {
        createSession: vi.fn().mockResolvedValue({ token: "new-session" }),
        deleteSession: vi.fn(),
        deleteUser: vi.fn(),
        findUserByEmail: vi.fn(),
        createUser: vi.fn(),
      },
    },
  };
}
const endpoints = aomiWidgetOAuthBootstrapPlugin().endpoints;
const preview = (ctx: ReturnType<typeof context>) =>
  endpoints.previewWidgetOAuthBootstrap(ctx as never);
const redeem = (ctx: ReturnType<typeof context>) =>
  endpoints.redeemWidgetOAuthBootstrap(ctx as never);
function signedIn(id = "b") {
  mocks.session.mockResolvedValue({
    user: { id: `ba-${id}`, name: id },
    session: { token: `session-${id}` },
  });
  mocks.owner.mockResolvedValue(id);
  return sha256Hex(JSON.stringify([`session-${id}`, id]));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(ticket);
  mocks.consume.mockResolvedValue(ticket);
  mocks.binding.mockResolvedValue(true);
  mocks.identity.mockResolvedValue(null);
  mocks.session.mockResolvedValue(null);
  mocks.user.mockImplementation(async (id: string) => ({
    id,
    displayName: id === "cecilia" ? "Cecilia" : "Account B",
    betterAuthUserId: `ba-${id}`,
  }));
  mocks.link.mockResolvedValue({ status: "linked" });
  mocks.client.mockResolvedValue({
    clientClass: "partner_widget",
    disabled: false,
    dpopBoundAccessTokens: true,
    origins: [ticket.origin],
    redirectUris: [ticket.redirectUri],
    resources: [ticket.resource],
    scopes: ticket.scopes,
  });
});

describe("account choice at the widget handoff", () => {
  it("previews verified accounts without consuming or changing sessions", async () => {
    const sessionVersion = signedIn();
    const ctx = context();
    expect(await preview(ctx)).toEqual({
      widget: { id: "cecilia", name: "Cecilia" },
      portal: { id: "b", name: "Account B" },
      sessionVersion,
    });
    expect(ctx.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("creates a session for the widget account when signed out", async () => {
    const ctx = context();
    await redeem(ctx);
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "ba-cecilia",
    );
    expect(mocks.cookie).toHaveBeenCalledOnce();
  });
  it("preserves an existing session for the same canonical account", async () => {
    const ctx = context({ sessionVersion: signedIn("cecilia") });
    await redeem(ctx);
    expect(mocks.consume).toHaveBeenCalledOnce();
    expect(mocks.link).not.toHaveBeenCalled();
    expect(ctx.context.internalAdapter.createSession).not.toHaveBeenCalled();
    expect(ctx.context.internalAdapter.deleteSession).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("keeps B and proceeds to OAuth without linking Cecilia's identity to B", async () => {
    const ctx = context({ sessionVersion: signedIn(), account: "portal" });
    expect(await redeem(ctx)).toMatchObject({
      success: true,
      authorization: { clientId: "fuzzer", scopes: ticket.scopes },
    });
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(ctx.context.internalAdapter.deleteSession).not.toHaveBeenCalled();
  });
  it("switches B to Cecilia only after explicit selection", async () => {
    const ctx = context({ sessionVersion: signedIn() });
    await redeem(ctx);
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith(
      "ba-cecilia",
    );
    expect(ctx.context.internalAdapter.deleteSession).toHaveBeenCalledWith(
      "session-b",
    );
    expect(mocks.link).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "cecilia", subject: "ba-cecilia" }),
    );
  });
  it("rejects a stale session preview without consuming the handoff", async () => {
    signedIn();
    await expect(redeem(context())).rejects.toThrow("portal_session_changed");
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("rejects a canonical account change even when the cookie is unchanged", async () => {
    const sessionVersion = signedIn();
    mocks.owner.mockResolvedValue("different-owner");
    await expect(
      redeem(context({ sessionVersion, account: "portal" })),
    ).rejects.toThrow("portal_session_changed");
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("does not treat guests as a selectable portal account", async () => {
    mocks.session.mockResolvedValue({
      user: { id: "guest", isAnonymous: true },
      session: { token: "guest-session" },
    });
    await expect(
      redeem(
        context({
          account: "portal",
          sessionVersion: sha256Hex(JSON.stringify(["guest-session", null])),
        }),
      ),
    ).rejects.toThrow("portal_sign_in_required");
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it.each(["origin", "state", "channelNonce"])(
    "rejects a wrong %s before preview",
    async (field) => {
      await expect(
        preview(context({ [field]: "https://wrong.example" })),
      ).rejects.toThrow("invalid_or_expired_bootstrap_ticket");
      expect(mocks.consume).not.toHaveBeenCalled();
    },
  );
  it("rechecks revocation after preview", async () => {
    await preview(context());
    mocks.binding.mockResolvedValue(false);
    await expect(redeem(context())).rejects.toThrow(
      "invalid_widget_session_binding",
    );
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("rejects a removed provider identity", async () => {
    mocks.read.mockResolvedValue({ ...ticket, providerIdentityId: "removed" });
    await expect(preview(context())).rejects.toThrow(
      "invalid_widget_session_binding",
    );
  });
  it("accepts offline_access while rejecting scopes outside the resource policy", async () => {
    await expect(preview(context())).resolves.toBeDefined();
    mocks.read.mockResolvedValue({
      ...ticket,
      scopes: [...ticket.scopes, "account:credentials:write"],
    });
    mocks.client.mockResolvedValue({
      ...(await mocks.client()),
      scopes: [...ticket.scopes, "account:credentials:write"],
    });
    await expect(preview(context())).rejects.toThrow(
      "oauth_client_policy_changed",
    );
  });
  it("rejects client disablement after preview", async () => {
    await preview(context());
    mocks.client.mockResolvedValue(null);
    await expect(redeem(context())).rejects.toThrow(
      "oauth_client_policy_changed",
    );
  });
  it("allows only one winner when another redemption consumed the ticket", async () => {
    mocks.consume.mockResolvedValue(null);
    const ctx = context();
    await expect(redeem(ctx)).rejects.toThrow(
      "invalid_or_expired_bootstrap_ticket",
    );
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
  it("requires an explicit choice and session preview", async () => {
    await expect(redeem(context({ account: undefined }))).rejects.toThrow();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
