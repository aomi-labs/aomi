import { describe, expect, it, vi } from "vitest";
import {
  consumeWidgetOAuthBootstrapTicket,
  issueWidgetOAuthBootstrapTicket,
  sha256Hex,
} from "./oauth-bootstrap";
import type { WidgetAuthStore, WidgetAuthTicket } from "./store";

function memoryStore() {
  const records = new Map<
    string,
    { ticket: WidgetAuthTicket; expiresAt: Date }
  >();
  const store: WidgetAuthStore = {
    write: vi.fn(async ({ identifier, ticket, expiresAt }) => {
      records.set(identifier, { ticket, expiresAt });
    }),
    read: vi.fn(async ({ identifier, now }) => {
      const record = records.get(identifier);
      return record && record.expiresAt > now ? record.ticket : null;
    }),
    consume: vi.fn(async ({ identifier, now }) => {
      const record = records.get(identifier);
      records.delete(identifier);
      return record && record.expiresAt > now ? record.ticket : null;
    }),
    delete: vi.fn(async ({ identifier }) => records.delete(identifier)),
  };
  return { store, records };
}

describe("widget OAuth bootstrap tickets", () => {
  it("stores only a hash-indexed, short-lived binding and consumes it once", async () => {
    const { store, records } = memoryStore();
    const now = new Date("2026-08-27T12:00:00.000Z");
    const issued = await issueWidgetOAuthBootstrapTicket({
      origin: "https://partner.example",
      userId: "user-1",
      authMethod: "siwe",
      widgetSessionIdentifier: "aomi:widget:session:hash",
      clientId: "widget-client",
      redirectUri: "https://partner.example/oauth/callback",
      codeChallenge: "a".repeat(43),
      resource: "https://portal.example/v1/agent",
      scopes: ["agent:read"],
      stateDigest: sha256Hex("state-state-state"),
      channelNonceDigest: sha256Hex("channel-channel-channel"),
      now,
      store,
    });

    expect(issued.ticket).toMatch(/^aomi_obt_[A-Za-z0-9_-]{40,}$/);
    expect([...records.keys()][0]).not.toContain(issued.ticket);
    expect(issued.expiresAt).toBe(Math.floor(now.getTime() / 1000) + 90);
    await expect(
      consumeWidgetOAuthBootstrapTicket({ ticket: issued.ticket, now, store }),
    ).resolves.toMatchObject({
      kind: "widget_oauth_bootstrap",
      origin: "https://partner.example",
      clientId: "widget-client",
    });
    await expect(
      consumeWidgetOAuthBootstrapTicket({ ticket: issued.ticket, now, store }),
    ).resolves.toBeNull();
  });

  it("rejects expired and non-bootstrap ticket values", async () => {
    const { store } = memoryStore();
    await expect(
      consumeWidgetOAuthBootstrapTicket({ ticket: "wrong", store }),
    ).resolves.toBeNull();
  });
});
