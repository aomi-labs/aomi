import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOrigins: vi.fn(),
  readClient: vi.fn(),
}));
vi.mock("@aomi-labs/account/better-auth", () => ({
  aomiOAuthResources: () => ({ portalOrigin: "https://portal.example" }),
  listManagedWidgetOrigins: mocks.listOrigins,
  readManagedOAuthClient: mocks.readClient,
}));

import {
  applyManagedWidgetCors,
  applyManagedWidgetOriginCors,
  managedWidgetPreflight,
} from "./cors";

beforeEach(() => {
  mocks.listOrigins.mockReset().mockResolvedValue(["https://partner.example"]);
  mocks.readClient.mockReset().mockResolvedValue({
    clientClass: "partner_widget",
    disabled: false,
    origins: ["https://partner.example"],
  });
});

describe("managed widget OAuth CORS", () => {
  it("allows only registered origins and request headers on preflight", async () => {
    const allowed = await managedWidgetPreflight(
      new Request("https://portal.example/api/auth/oauth2/token", {
        method: "OPTIONS",
        headers: {
          origin: "https://partner.example",
          "access-control-request-headers":
            "authorization, content-type, dpop, idempotency-key",
        },
      }),
      ["POST", "OPTIONS"],
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://partner.example",
    );
    expect(allowed.headers.get("access-control-allow-headers")).toContain(
      "idempotency-key",
    );
    await expect(
      managedWidgetPreflight(
        new Request("https://portal.example/api/auth/oauth2/token", {
          method: "OPTIONS",
          headers: { origin: "https://evil.example" },
        }),
        ["POST", "OPTIONS"],
      ),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("does not emit credentials and binds actual responses to client plus origin", async () => {
    const response = await applyManagedWidgetCors({
      request: new Request("https://portal.example/api/auth/oauth2/token", {
        headers: { origin: "https://partner.example" },
      }),
      response: Response.json({ access_token: "token" }),
      clientId: "widget-client",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://partner.example",
    );
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
    mocks.readClient.mockResolvedValueOnce({
      clientClass: "partner_widget",
      disabled: false,
      origins: ["https://other.example"],
    });
    await expect(
      applyManagedWidgetCors({
        request: new Request("https://portal.example/api/auth/oauth2/token", {
          headers: { origin: "https://partner.example" },
        }),
        response: new Response(),
        clientId: "widget-client",
      }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("leaves first-party responses untouched without requiring a widget client", async () => {
    const response = Response.json({ ok: true });
    const actual = await applyManagedWidgetCors({
      request: new Request("https://portal.example/v1/agent/chat", {
        method: "POST",
        headers: { origin: "https://portal.example" },
      }),
      response,
      clientId: undefined,
    });

    expect(actual).toBe(response);
    expect(actual.headers.has("access-control-allow-origin")).toBe(false);
    expect(mocks.readClient).not.toHaveBeenCalled();
  });

  it("keeps exact-deployment first-party responses and auth errors on their original status", async () => {
    const request = new Request(
      "https://chat-portal-immutable-aomi-labs.vercel.app/v1/agent/chat",
      {
        method: "POST",
        headers: {
          origin: "https://chat-portal-immutable-aomi-labs.vercel.app",
        },
      },
    );
    const success = Response.json({ ok: true });
    const failure = Response.json({ error: "invalid_token" }, { status: 401 });

    expect(
      await applyManagedWidgetCors({
        request,
        response: success,
        clientId: undefined,
      }),
    ).toBe(success);
    expect(
      await applyManagedWidgetOriginCors({ request, response: failure }),
    ).toBe(failure);
    expect(mocks.readClient).not.toHaveBeenCalled();
    expect(mocks.listOrigins).not.toHaveBeenCalled();
  });

  it("still rejects an unregistered origin on the immutable deployment", async () => {
    const request = new Request(
      "https://chat-portal-immutable-aomi-labs.vercel.app/v1/agent/chat",
      { headers: { origin: "https://unregistered.example" } },
    );
    expect(
      (
        await applyManagedWidgetCors({
          request,
          response: new Response(),
          clientId: undefined,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await applyManagedWidgetOriginCors({
          request,
          response: new Response(),
        })
      ).status,
    ).toBe(403);
  });
});
